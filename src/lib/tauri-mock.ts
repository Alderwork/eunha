/**
 * Browser-preview shim for the Tauri APIs eunha uses.
 *
 * Vite aliases the real `@tauri-apps/*` modules here ONLY when the dev server
 * was not spawned by the Tauri CLI (see vite.config.ts). Under `pnpm dev` in a
 * plain browser, `invoke()` resolves against `public/mock-data.json` — real
 * library data exported by `scripts/export-mock-data.mjs` — falling back to a
 * tiny built-in fixture when the export is missing.
 *
 * Everything is in-memory: mutations (watch toggle, notes, collections) mutate
 * local state so the UI behaves, but nothing persists. LLM / GitHub commands
 * fail with a clear "browser preview" error instead of silently succeeding.
 */
import type {
	Collection,
	FeedGroup,
	Repo,
	SimilarRepo,
	WatchedRepoEntry,
} from '../types';

interface MockData {
	exported_at: string;
	repos: Repo[];
	collections: Collection[];
	collectionItems: { collection_id: number; repo_id: string }[];
	releases: {
		id: string;
		repo_id: string;
		tag_name: string;
		name: string | null;
		body: string | null;
		html_url: string;
		published_at: string;
		read_at: string | null;
	}[];
	feedItems: {
		repo_full_name: string;
		repo_description: string | null;
		repo_url: string;
		repo_language: string | null;
		repo_stars_count: number | null;
		repo_topics: string | null;
		starred_by: string;
		starred_at: string;
		dismissed: number;
		added_to_library: number;
	}[];
}

const CURRENT_PROMPT_VERSION = 1;

const fixture: MockData = {
	exported_at: new Date().toISOString(),
	repos: [
		{
			id: 'facebook/react',
			full_name: 'facebook/react',
			description: 'The library for web and native user interfaces.',
			url: 'https://github.com/facebook/react',
			language: 'JavaScript',
			stars_count: 230000,
			topics: '["react","ui","frontend"]',
			added_at: '2026-07-01 10:00:00',
			source: 'starred',
			llm_summary: null,
			llm_what: 'Declarative UI library for web and native apps',
			llm_why: 'Component model + huge ecosystem make it the default',
			llm_use_case: 'Building interactive web app frontends',
			llm_category: 'Library',
			llm_tags: '["ui","components","frontend"]',
			llm_generated_at: '2026-07-02 10:00:00',
			prompt_version: 1,
			user_notes: null,
			user_category: null,
			watching: true,
			category_locked: false,
			owner_avatar_url: 'https://avatars.githubusercontent.com/u/69631?v=4',
		},
		{
			id: 'tauri-apps/tauri',
			full_name: 'tauri-apps/tauri',
			description: 'Build smaller, faster, and more secure desktop and mobile applications.',
			url: 'https://github.com/tauri-apps/tauri',
			language: 'Rust',
			stars_count: 90000,
			topics: '["rust","desktop","webview"]',
			added_at: '2026-06-15 10:00:00',
			source: 'starred',
			llm_summary: null,
			llm_what: null,
			llm_why: null,
			llm_use_case: null,
			llm_category: null,
			llm_tags: null,
			llm_generated_at: null,
			prompt_version: null,
			user_notes: null,
			user_category: null,
			watching: false,
			category_locked: false,
			owner_avatar_url: 'https://avatars.githubusercontent.com/u/46426891?v=4',
		},
	],
	collections: [
		{
			id: 1,
			name: 'Read Later',
			description: null,
			icon: '📌',
			sort_order: 0,
			is_read_later: true,
			repo_count: 1,
			created_at: '2026-07-01 10:00:00',
		},
	],
	collectionItems: [{ collection_id: 1, repo_id: 'facebook/react' }],
	releases: [],
	feedItems: [],
};

const dataPromise: Promise<MockData> = fetch('/mock-data.json')
	.then((r) => {
		if (!r.ok) throw new Error(`mock-data.json: HTTP ${r.status}`);
		return r.json() as Promise<MockData>;
	})
	.catch((e) => {
		console.warn(
			'[tauri-mock] using built-in fixture (run `node scripts/export-mock-data.mjs` for real data):',
			e,
		);
		return fixture;
	});

function previewOnly(what: string): never {
	throw new Error(`${what} is not available in the browser preview — run \`pnpm tauri dev\`.`);
}

function matchesQuery(r: Repo, q: string | null | undefined): boolean {
	const needle = (q ?? '').trim().toLowerCase();
	if (!needle) return true;
	const hay = [
		r.full_name,
		r.description,
		r.llm_what,
		r.llm_why,
		r.llm_use_case,
		r.llm_category,
		r.llm_tags,
		r.user_notes,
	]
		.filter(Boolean)
		.join('\n')
		.toLowerCase();
	return needle.split(/\s+/).every((w) => hay.includes(w));
}

function matchesCategory(r: Repo, category: string | null | undefined): boolean {
	if (!category) return true;
	return (r.user_category ?? r.llm_category) === category;
}

function matchesAiStatus(r: Repo, status: string | null | undefined): boolean {
	switch (status) {
		case 'undescribed':
			return r.llm_summary == null;
		case 'stale':
			return r.llm_summary != null && (r.prompt_version ?? 0) < CURRENT_PROMPT_VERSION;
		case 'described':
			return r.llm_summary != null && (r.prompt_version ?? 0) >= CURRENT_PROMPT_VERSION;
		default:
			return true;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invoke<T>(cmd: string, args?: Record<string, any>): Promise<T> {
	const data = await dataPromise;
	const a = args ?? {};

	switch (cmd) {
		// ── Library ──────────────────────────────────────────
		case 'list_repos': {
			const out = data.repos.filter(
				(r) =>
					matchesQuery(r, a.query) &&
					matchesCategory(r, a.category) &&
					matchesAiStatus(r, a.aiStatus),
			);
			return out as T;
		}
		case 'get_collection_repos': {
			const ids = new Set(
				data.collectionItems
					.filter((ci) => ci.collection_id === a.collectionId)
					.map((ci) => ci.repo_id),
			);
			const out = data.repos.filter(
				(r) => ids.has(r.id) && matchesQuery(r, a.query) && matchesCategory(r, a.category),
			);
			return out as T;
		}
		case 'get_categories': {
			const counts = new Map<string, number>();
			for (const r of data.repos) {
				const cat = r.user_category ?? r.llm_category;
				if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
			}
			return [...counts.entries()]
				.map(([category, count]) => ({ category, count }))
				.sort((x, y) => y.count - x.count) as T;
		}
		case 'get_app_constants':
			return { current_prompt_version: CURRENT_PROMPT_VERSION } as T;
		case 'update_repo_user_fields': {
			const repo = data.repos.find((r) => r.id === a.repoId);
			if (!repo) throw new Error(`repo not found: ${a.repoId}`);
			if ('userNotes' in a) repo.user_notes = a.userNotes;
			if ('userCategory' in a) repo.user_category = a.userCategory;
			return repo as T;
		}
		case 'set_category_lock': {
			const repo = data.repos.find((r) => r.id === a.repoId);
			if (!repo) throw new Error(`repo not found: ${a.repoId}`);
			repo.category_locked = !!a.locked;
			return repo as T;
		}
		case 'toggle_watching': {
			const repo = data.repos.find((r) => r.id === a.repoId);
			if (!repo) throw new Error(`repo not found: ${a.repoId}`);
			repo.watching = !repo.watching;
			return repo as T;
		}
		case 'record_engagement':
			return null as T;

		// ── Collections ──────────────────────────────────────
		case 'list_collections': {
			for (const c of data.collections) {
				c.repo_count = data.collectionItems.filter((ci) => ci.collection_id === c.id).length;
			}
			return data.collections as T;
		}
		case 'get_repo_collections': {
			const ids = data.collectionItems
				.filter((ci) => ci.repo_id === a.repoId)
				.map((ci) => ci.collection_id);
			return data.collections.filter((c) => ids.includes(c.id)) as T;
		}
		case 'add_repo_to_collection': {
			if (
				!data.collectionItems.some(
					(ci) => ci.collection_id === a.collectionId && ci.repo_id === a.repoId,
				)
			) {
				data.collectionItems.push({ collection_id: a.collectionId, repo_id: a.repoId });
			}
			return null as T;
		}
		case 'remove_repo_from_collection': {
			data.collectionItems = data.collectionItems.filter(
				(ci) => !(ci.collection_id === a.collectionId && ci.repo_id === a.repoId),
			);
			return null as T;
		}
		case 'create_collection': {
			const id = Math.max(0, ...data.collections.map((c) => c.id)) + 1;
			const col: Collection = {
				id,
				name: a.name,
				description: null,
				icon: a.icon ?? null,
				sort_order: id,
				is_read_later: false,
				repo_count: 0,
				created_at: new Date().toISOString(),
			};
			data.collections.push(col);
			return col as T;
		}

		// ── Watching / releases ──────────────────────────────
		case 'list_watched_repos_with_unread': {
			const out: WatchedRepoEntry[] = data.repos
				.filter((r) => r.watching)
				.map((repo) => ({
					repo,
					unread: data.releases.filter((rel) => rel.repo_id === repo.id && !rel.read_at).length,
				}));
			return out as T;
		}
		case 'list_releases':
			return data.releases.filter((r) => r.repo_id === a.repoId).slice(0, 20) as T;
		case 'get_unread_release_count':
			return data.releases.filter((r) => !r.read_at).length as T;
		case 'mark_release_read': {
			const rel = data.releases.find((r) => r.id === a.releaseId);
			if (rel) rel.read_at = new Date().toISOString();
			return null as T;
		}
		case 'mark_all_releases_read': {
			for (const r of data.releases) r.read_at = r.read_at ?? new Date().toISOString();
			return null as T;
		}
		case 'sync_releases':
			return { checked: 0, new_releases: 0, failed_repos: [] } as T;

		// ── Feed ─────────────────────────────────────────────
		case 'get_feed_items': {
			const inLib = new Set(data.repos.map((r) => r.full_name));
			const groups = new Map<string, FeedGroup>();
			for (const item of data.feedItems) {
				const g = groups.get(item.repo_full_name);
				if (g) {
					g.starred_by.push(item.starred_by);
					if (item.starred_at > g.latest_starred_at) g.latest_starred_at = item.starred_at;
				} else {
					groups.set(item.repo_full_name, {
						repo_full_name: item.repo_full_name,
						repo_description: item.repo_description,
						repo_url: item.repo_url,
						repo_language: item.repo_language,
						repo_stars_count: item.repo_stars_count,
						repo_topics: item.repo_topics,
						starred_by: [item.starred_by],
						latest_starred_at: item.starred_at,
						in_library: inLib.has(item.repo_full_name),
					});
				}
			}
			return [...groups.values()] as T;
		}
		case 'get_feed_unread_count':
			return data.feedItems.filter((f) => !f.dismissed).length as T;
		case 'dismiss_feed_item':
			return null as T;
		case 'fetch_feed':
			previewOnly('Feed fetch');

		// ── Digest / discovery ───────────────────────────────
		case 'get_launch_digest':
		case 'get_current_digest':
			return null as T;
		case 'record_digest_action':
			return null as T;
		case 'get_similar_repos':
			return [] as SimilarRepo[] as T;
		case 'get_contribution_data':
			return null as T;
		case 'fetch_trending':
			return [] as T;

		// ── Settings / onboarding ────────────────────────────
		case 'get_settings':
			return {
				pat_set: true,
				pat_masked: 'ghp_••••••••••••••••',
				output_language: 'en',
				default_release_platform: 'macos-arm64',
				show_tray_icon: true,
				star_sync_interval_minutes: '360',
				last_star_sync_at: data.exported_at,
			} as T;
		case 'save_settings':
		case 'save_pat':
		case 'set_onboarded_at':
		case 'set_tray_visible':
			return null as T;
		case 'get_onboarded_at':
			return '2026-07-01T10:00:00Z' as T;
		case 'validate_pat':
			previewOnly('PAT validation');
		case 'get_my_github_login':
			return 'preview-user' as T;
		case 'sync_stars':
			previewOnly('Star sync');
		case 'export_database':
		case 'import_database':
			previewOnly('Database export/import');

		// ── Conduit (LLM connections) ────────────────────────
		case 'conduit_list':
			return { active: null, connections: [] } as T;
		case 'conduit_save':
		case 'conduit_delete':
		case 'conduit_set_active':
		case 'conduit_http':
			previewOnly('LLM connections');

		// ── LLM / GitHub actions ─────────────────────────────
		case 'describe_repo':
		case 'batch_describe':
			previewOnly('Describe');
		case 'import_stars':
		case 'cancel_import':
		case 'add_repo':
			previewOnly('GitHub import');
		case 'add_feed_repo_to_library':
			previewOnly('Add to library');
		case 'fetch_readme':
			previewOnly('README fetch');
		case 'cancel_feed_fetch':
			return null as T;
		case 'backfill_owner_avatars':
			return null as T;
		case 'get_avatar_urls':
			return {} as T;

		default:
			console.warn(`[tauri-mock] unhandled command: ${cmd}`, a);
			return null as T;
	}
}

// ── @tauri-apps/api/event ────────────────────────────────
type EventCallback<T = unknown> = (event: { payload: T }) => void;

export async function listen<T>(
	event: string,
	_handler: EventCallback<T>,
): Promise<() => void> {
	console.warn(`[tauri-mock] listen("${event}") registered but never fires in browser preview`);
	return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {}

// ── @tauri-apps/api/window ───────────────────────────────
export function getCurrentWindow() {
	return {
		toggleMaximize: () => {
			if (document.fullscreenElement) void document.exitFullscreen();
			else void document.documentElement.requestFullscreen();
		},
		startDragging: () => {},
		setVisibleOnAllWorkspaces: async () => {},
	};
}

// ── @tauri-apps/plugin-opener ────────────────────────────
export async function openUrl(url: string): Promise<void> {
	window.open(url, '_blank', 'noopener,noreferrer');
}

// ── @tauri-apps/plugin-clipboard-manager ─────────────────
export async function readText(): Promise<string> {
	try {
		return await navigator.clipboard.readText();
	} catch {
		return '';
	}
}
