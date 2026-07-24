# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

eunha is a local-first, keyboard-first desktop app for building a personal GitHub repo library. You import your starred repos (or any repo), then on-demand describe them with an LLM using a consistent prompt. The result is a searchable, categorized library you can navigate without a mouse.

**This is a Tauri v2 app: Rust backend + React frontend.** No cloud component in v1.

## Stack

- **Tauri v2** — Rust backend (`src-tauri/`), React frontend (`src/`)
- **rusqlite** — SQLite on disk; FTS5 for search
- **React + Tailwind** — frontend, with `@tanstack/virtual` for list virtualization
- **Conduit** (`@conduit/core` + `@conduit/react`, `link:../conduit/packages/*`) — AI provider connections (BYOK). Symlinked live to the sibling repo (do NOT use `file:` — pnpm snapshots it at install time and code changes silently stop propagating). Vite consumes their `dist/`, so rebuild the packages after editing them; `resolve.dedupe: ['react','react-dom']` in vite.config.ts keeps one React copy.
- **toml** — `~/.eunha/config.toml` (0600) for GitHub PAT; `~/.eunha/connections.toml` (0600) for LLM connections
- **tauri-plugin-clipboard-manager** — clipboard read on Add dialog open

## Common Commands

```bash
# Dev
pnpm tauri dev

# Build
pnpm tauri build

# Frontend only (faster iteration)
pnpm dev

# Type check
pnpm tsc --noEmit

# Lint
pnpm lint
```

## Architecture

All GitHub API calls and DB writes happen in **Rust command handlers** (`src-tauri/src/commands/`). The React frontend calls these via Tauri's `invoke()` — it never talks to GitHub or SQLite directly.

```
React (src/)
  └── invoke("import_stars" | "add_repo" | "describe_repo" | "search")
        ↓ Tauri IPC
Rust (src-tauri/src/commands/)
  ├── GitHub API (tokio, reqwest) — stars import, repo metadata, README fetch
  ├── LLM API (reqwest) — OpenAI / Anthropic / Ollama / OpenCode Go
  └── SQLite (rusqlite) — repos table + FTS5 virtual table
```

**AI provider connections (Conduit).** Connection management (BYOK: key entry, validation, model discovery, default model) runs on `@conduit/core` in the frontend (`src/lib/conduit.ts`), backed by two Rust bridges in `src-tauri/src/conduit.rs`. All built-in core presets are registered (33 providers) plus two local overrides: `ollama` (native API, auto-managed) and `opencode-go` (static model list + chat-probe validation).

- **Storage** — `conduit_list/save/delete/set_active` commands → `~/.eunha/connections.toml` (0600). Lists strip credentials (`key_set` only).
- **HTTP proxy** — `conduit_http(connection_id, auth, request)`: Rust looks up the key and injects it per the adapter's auth scheme (bearer / x-api-key / api-key / query / none). **API keys never enter the webview.** The proxy only injects into allowlisted hosts (`ALLOWED_REMOTE_HOSTS` in conduit.rs — update it when adding a provider; Azure Foundry is matched by the `.openai.azure.com` suffix); localhost is always allowed for self-hosted providers.

The LLM *execution* path stays in Rust: `get_llm_settings()` (describe.rs) derives `{provider, api_key, model, meta}` from the active connection; `call_llm` routes by provider — anthropic and ollama have native arms, azure-foundry/lmstudio build their URL from connection meta, and every other provider goes through the `chat_completions_url` table (OpenAI-compatible, bearer) with a `response_format` retry fallback. Providers without a stored `default_model` fail with a "pick a model" error until the user selects one. Legacy `llm_api_key`/`llm_provider` settings are migrated into the first connection on startup (idempotent, then removed from config.toml).

**Ollama is auto-managed** (`src-tauri/src/ollama.rs`): before any Ollama request, `ensure_running()` probes `{base}/api/version`; if the base URL is localhost and nothing answers, the app spawns a detached `ollama serve` itself and waits up to 20s for health. Users never run `ollama serve` manually. If the binary isn't found (PATH, `/opt/homebrew/bin`, `/usr/local/bin`, Ollama.app bundle), the error tells the user to install Ollama. Remote (non-localhost) base URLs are never auto-started. Model pulls are still manual (`ollama pull <model>`) — a 404 from `/api/generate` surfaces that instruction. The conduit proxy calls `ensure_running` only when the connection's provider is `ollama`, so other localhost providers (LM Studio) never spawn a server.

**OpenCode Go** is a provider option (`opencode-go`) using the OpenAI-compatible endpoint `https://opencode.ai/zen/go/v1/chat/completions`. Its model list is a curated static list in `src/lib/conduit.ts` (MiniMax/Qwen use a different endpoint shape and are not wired up). Key validation probes the chat endpoint with `max_tokens: 1` — `/models` is public and returns 200 for any key, so it cannot validate.

## Database

**Schema version** is tracked via `PRAGMA user_version`. The migration runner in `src-tauri/src/db/migrations.rs` runs on every startup. Current version: 1.

**Core table:**
```sql
repos (
  id TEXT PRIMARY KEY,    -- "{owner}/{repo}"
  full_name TEXT,
  description TEXT,       -- raw GitHub description; shown as fallback when llm_summary is null
  source TEXT,            -- "starred" | "manual"

  -- LLM fields — written atomically or not at all
  llm_summary TEXT,       -- raw JSON blob (backup/audit)
  llm_what TEXT,          -- extracted "what" field; max 80 chars; primary list row display
  llm_why TEXT,           -- extracted "why" field; max 80 chars
  llm_use_case TEXT,      -- extracted "use_case" field; max 80 chars
  llm_category TEXT,      -- extracted from blob; source of truth for filter queries
  llm_tags TEXT,          -- JSON array extracted from blob; source of truth for filter queries
  llm_generated_at DATETIME,
  prompt_version INTEGER, -- incremented when the prompt changes; v1 = 1

  user_notes TEXT,
  user_category TEXT      -- overrides llm_category in display when non-null
)
```

**Schema invariant:** On every describe (both `d` and shift-D), write all 8 llm_* columns atomically: `llm_summary`, `llm_what`, `llm_why`, `llm_use_case`, `llm_category`, `llm_tags`, `llm_generated_at`, `prompt_version`. Never update one without the others. Use the `write_llm_description(repo_id, LlmResult)` function — don't write ad-hoc UPDATE statements.

**FTS5:** `repos_fts` virtual table indexes `full_name`, `llm_what`, `llm_why`, `llm_use_case`, `llm_category`, `llm_tags`, `user_notes` — NOT `llm_summary` (the raw JSON blob would produce garbage search matches on JSON field names). Synced via AFTER INSERT/UPDATE/DELETE triggers. Search query: `SELECT repos.* FROM repos JOIN repos_fts ON repos.rowid = repos_fts.rowid WHERE repos_fts MATCH ?`. Falls back to LIKE if FTS5 query fails.

**FTS5 trigger pattern (critical):** For FTS5 content tables, DELETE and UPDATE triggers must use the special `INSERT INTO fts(fts, rowid, ...) VALUES('delete', ...)` form — NOT `DELETE FROM fts WHERE rowid = ...`. Using plain DELETE leaves stale index entries and causes duplicate/incorrect search results.

**WAL mode:** `PRAGMA journal_mode=WAL` is set as the first step in `migrations.rs` before any schema changes. Required for concurrent import + describe writes to avoid "database is locked" errors.

## LLM Prompt Contract

The prompt is **immutable by design** — consistent output shape is the product feature. Do not change the output fields or their names without bumping `CURRENT_PROMPT_VERSION` and writing a migration path for existing descriptions.

```
Given this GitHub repo:
- Name: {full_name}
- GitHub description: {description}
- Language: {language}
- Topics: {topics}
- README excerpt: {readme_first_500_chars}   ← "[not available]" if missing

Respond ONLY with valid JSON:
{
  "what": "...",        // max 80 chars
  "why": "...",         // max 80 chars
  "use_case": "...",    // max 80 chars
  "category": "CLI Tool | Library | Framework | Service | Learning Resource | Template | Other",
  "tags": ["tag1"]      // 2-4 items, each max 20 chars
}
```

Ollama is best-effort — fail clearly if the model lacks JSON mode. No silent regex fallback.

## Keybindings

| Key | Action |
|-----|--------|
| j / k | Navigate list |
| gg / G | Go to top / bottom of list |
| Ctrl+d / u | Half-page down / up (10 rows) |
| h / l | Cycle to prev / next view (library → watching → feed) |
| d | Describe (or hint "press shift-D to regenerate" if already described) |
| shift-D | Describe Again — clears `llm_*` fields, re-runs; suppresses further d/shift-D until done |
| shift-A | Batch describe — describes all undescribed + stale (`prompt_version < CURRENT`) repos sequentially |
| o | Open in browser |
| / | Focus search |
| e | Edit notes + category override — **Escape discards**, save triggers on blur (click outside / j/k / Tab) |
| , | Open settings |
| ? | Keybinding help modal |

Use React `onKeyDown` handlers (not Tauri global shortcuts) — keybindings only fire when the window is focused.

## Secrets

GitHub PAT is stored in `~/.eunha/config.toml` (0600) via `src-tauri/src/config.rs`. LLM API keys live in `~/.eunha/connections.toml` (0600) via `src-tauri/src/conduit.rs` and are only ever read by the `conduit_http` proxy — never returned to the webview. Never write secrets to SQLite. Do not use keychain or tauri-plugin-stronghold.

## Import

Stars import uses `futures::join_all` on 5 concurrent tokio tasks (`GET /user/starred?per_page=100&page=N`). 5 tasks chosen as a safe burst under GitHub's 5000 req/hr authenticated limit. Fetch all pages — no cap. Handle primary 429 with `Retry-After`. Secondary rate limits (burst 403) are in TODOS.md for v1.1.

## Star sync

`sync_stars` (`src-tauri/src/commands/sync.rs`) mirrors the library against the real star list: new stars are inserted, unstarred repos with `source='starred'` are deleted (manual repos are never touched). A background scheduler spawned in `lib.rs` setup runs it on the `star_sync_interval_minutes` setting (0 = off, default 360) and emits `stars:synced`; the header Sync button and Settings → Account → "Sync now" invoke it directly.

**Safety invariants:**
- The COMPLETE star list is fetched before any DB write — a partial fetch must never reach `apply_star_sync`, or unstarred detection would delete legitimate rows.
- Insert + delete happen in ONE transaction (`apply_star_sync` in import.rs), using temp tables for the id sets.
- FK cascades are NOT enforced (no `PRAGMA foreign_keys`), so dependent rows in `releases`, `release_assets`, `digest_items`, `collection_items`, `repo_engagement` are deleted explicitly before the repo row.
- A static `AtomicBool` guard prevents overlapping syncs (button vs scheduler).

## Design System

Linear-inspired dark-native UI. Full reference: `/Users/jinmu/Downloads/DESIGN-linear.app.md`.

- **Background stack**: `#08090a` canvas (`bg-bg`) → `#0f1011` panels (`bg-panel`) → `#191a1b` cards (`bg-surface`) → `#28282c` hover (`bg-elevated`)
- **Typography**: Inter Variable with `font-feature-settings: 'cv01', 'ss03'` globally. Signature weight `font-medium` = 510, `font-semibold` = 590. System mono fallback for `font-mono`.
- **Accent**: Brand indigo `#5e6ad2` (`bg-brand`, `text-brand`) for primary CTAs. Interactive violet `#7170ff` (`text-accent`, `bg-accent`) for selection bars, active states, repo names.
- **Borders**: Semi-transparent white by default — `rgba(255,255,255,0.08)` (`border-border`). Never solid dark borders on dark surfaces.
- **Text tiers**: `text-ink` `#f7f8f8` → `text-dim` `#d0d6e0` → `text-muted` `#8a8f98` → `text-faint` `#62666d`
- **Status tokens**: `text-success/bg-success-tint`, `text-danger/bg-danger-tint`, `text-warn/bg-warn-tint` — never raw Tailwind palette colors.
- **Both themes**: Dark (default) + light via `html.light`. Toggle persisted in `localStorage`.
- **Shared primitives**: `src/components/ui/Button.tsx` (variants: primary/ghost/subtle/icon), `src/components/ui/Kbd.tsx`, `src/components/ui/Modal.tsx`.

## What's explicitly NOT in v1

People graph, feed, cloud sync, export to markdown, README preview (`space` bar), auto-batch LLM on import, archived_at column. See TODOS.md for deferred items with context.
