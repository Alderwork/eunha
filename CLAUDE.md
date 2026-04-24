# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

eunha is a local-first, keyboard-first desktop app for building a personal GitHub repo library. You import your starred repos (or any repo), then on-demand describe them with an LLM using a consistent prompt. The result is a searchable, categorized library you can navigate without a mouse.

**This is a Tauri v2 app: Rust backend + React frontend.** No cloud component in v1.

## Stack

- **Tauri v2** — Rust backend (`src-tauri/`), React frontend (`src/`)
- **rusqlite** — SQLite on disk; FTS5 for search
- **React + Tailwind** — frontend, with `@tanstack/virtual` for list virtualization
- **tauri-plugin-keychain** — OS keychain for GitHub PAT + LLM API key (NOT Stronghold)
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
  ├── LLM API (reqwest) — OpenAI / Anthropic / Ollama
  └── SQLite (rusqlite) — repos table + FTS5 virtual table
```

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

PAT and LLM API key are stored in the OS keychain via `tauri-plugin-keychain`. Never write them to SQLite or a config file. Do not use `tauri-plugin-stronghold`.

## Import

Stars import uses `futures::join_all` on 5 concurrent tokio tasks (`GET /user/starred?per_page=100&page=N`). 5 tasks chosen as a safe burst under GitHub's 5000 req/hr authenticated limit. Fetch all pages — no cap. Handle primary 429 with `Retry-After`. Secondary rate limits (burst 403) are in TODOS.md for v1.1.

## Design System

Editorial Minimal: Source Serif 4 for prose, amber `#E8974A` accent, `#0C0C0E` background, max prose width 680px. This is a reading tool, not a task manager — don't use sans-serif or blue/purple accents.

## What's explicitly NOT in v1

People graph, feed, cloud sync, export to markdown, README preview (`space` bar), auto-batch LLM on import, archived_at column. See TODOS.md for deferred items with context.
