/**
 * eunha's Conduit instance: @conduit/core wired to the Tauri host.
 *
 * - Storage: `conduit_*` commands → ~/.eunha/connections.toml (0600, Rust-only)
 * - HTTP: `conduit_http` proxy — Rust injects credentials, keys never enter JS
 * - Adapters: all built-in presets + eunha-local Ollama and OpenCode Go
 *   (local overrides win: Ollama is auto-managed, OpenCode Go validates via
 *   a chat probe because its /models is public)
 *
 * Every remote host here must also sit in the proxy allowlist
 * (`ALLOWED_REMOTE_HOSTS` in src-tauri/src/conduit.rs).
 */
import { invoke } from '@tauri-apps/api/core';
import {
	Conduit,
	anthropicAdapter,
	createOpenAICompatible,
	geminiAdapter,
	openaiAdapter,
	openrouterAdapter,
	presetAdapters,
	type Connection,
	type HttpClient,
	type HttpRequest,
	type HttpResponse,
	type ModelInfo,
	type ProviderAdapter,
	type RequestContext,
	type StorageAdapter,
	type StoredConnection,
} from '@conduit/core';

// ── Ports ────────────────────────────────────────────────

/** conduit_list rows: StoredConnection without credentials, plus key_set. */
type ListedConnection = Omit<StoredConnection, 'credentials'> & { key_set?: boolean };

interface ConduitListResponse {
	active: string | null;
	connections: ListedConnection[];
}

function toStored(c: ListedConnection): StoredConnection {
	const { key_set: _keySet, ...rest } = c;
	return rest;
}

function createTauriStorage(): StorageAdapter {
	return {
		async list() {
			const res = await invoke<ConduitListResponse>('conduit_list');
			return res.connections.map(toStored);
		},
		async get(id) {
			const res = await invoke<ConduitListResponse>('conduit_list');
			const found = res.connections.find((c) => c.id === id);
			return found ? toStored(found) : null;
		},
		async save(conn) {
			await invoke('conduit_save', { input: conn });
		},
		async remove(id) {
			await invoke('conduit_delete', { id });
		},
		async getActiveId() {
			const res = await invoke<ConduitListResponse>('conduit_list');
			return res.active;
		},
		async setActiveId(id) {
			await invoke('conduit_set_active', { id });
		},
	};
}

function createTauriHttp(): HttpClient {
	return {
		request(req: HttpRequest, ctx: RequestContext) {
			return invoke<HttpResponse>('conduit_http', {
				connectionId: ctx.connectionId,
				auth: ctx.auth,
				request: req,
			});
		},
	};
}

// ── eunha-local adapters ─────────────────────────────────

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function ollamaBase(conn: Connection): string {
	const base = conn.meta?.base_url?.trim();
	return (base ? base : DEFAULT_OLLAMA_URL).replace(/\/$/, '');
}

const ollamaAdapter: ProviderAdapter = {
	id: 'ollama',
	label: 'Ollama',
	authScheme: { type: 'none' },
	requiresKey: false,
	defaultModel: 'llama3',
	metaFields: [
		{
			key: 'base_url',
			label: 'Base URL',
			placeholder: DEFAULT_OLLAMA_URL,
			defaultValue: DEFAULT_OLLAMA_URL,
		},
	],
	validateRequest: (conn) => ({ method: 'GET', url: `${ollamaBase(conn)}/api/version` }),
	validateError: (res) =>
		res.status === 200 ? null : `Ollama is not reachable (status ${res.status})`,
	modelsRequest: (conn) => ({ method: 'GET', url: `${ollamaBase(conn)}/api/tags` }),
	parseModels: (res) => {
		const json: unknown = JSON.parse(res.body);
		const models = (json as { models?: unknown }).models;
		if (!Array.isArray(models)) return [];
		return models
			.map((m): ModelInfo | null => {
				const name = (m as { name?: unknown }).name;
				return typeof name === 'string' && name.length > 0 ? { id: name } : null;
			})
			.filter((m): m is ModelInfo => m !== null);
	},
	capabilitiesFor: () => ({ vision: false, reasoning: false, streaming: true, tools: false }),
};

// Models served through OpenCode Go's OpenAI-compatible chat endpoint
// (https://opencode.ai/zen/go/v1/chat/completions). MiniMax/Qwen use a
// different endpoint shape and are not wired up for describe.
const OPENCODE_GO_MODELS = [
	'deepseek-v4-flash',
	'deepseek-v4-pro',
	'kimi-k3',
	'kimi-k2.7-code',
	'kimi-k2.6',
	'glm-5.2',
	'glm-5.1',
	'grok-4.5',
	'mimo-v2.5',
	'mimo-v2.5-pro',
];

const opencodeGoAdapter: ProviderAdapter = {
	...createOpenAICompatible({
		id: 'opencode-go',
		label: 'OpenCode Go',
		baseUrl: 'https://opencode.ai/zen/go/v1',
		staticModels: OPENCODE_GO_MODELS.map((id) => ({ id })),
		defaultModel: 'deepseek-v4-flash',
		keyHint: 'Subscribe and copy your key at opencode.ai/auth',
	}),
	// /models is public and returns 200 for any key — validation must probe
	// the authenticated chat endpoint instead (costs ~1 token).
	validateRequest: () => ({
		method: 'POST',
		url: 'https://opencode.ai/zen/go/v1/chat/completions',
		body: JSON.stringify({
			model: 'deepseek-v4-flash',
			messages: [{ role: 'user', content: 'ping' }],
			max_tokens: 1,
		}),
	}),
};

// ── Singleton ────────────────────────────────────────────

export const conduit = new Conduit({
	storage: createTauriStorage(),
	http: createTauriHttp(),
	adapters: [
		openaiAdapter,
		anthropicAdapter,
		geminiAdapter,
		openrouterAdapter,
		// Core presets, minus opencode-go — the local override below wins
		// (static model list + chat-probe validation).
		...presetAdapters.filter((a) => a.id !== 'opencode-go'),
		ollamaAdapter,
		opencodeGoAdapter,
	],
});
