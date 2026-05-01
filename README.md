<img src="docs/eunha-badge.png" alt="eunha — your stars. your eunha." />

# eunha

**eunha** (은하) means *galaxy* in Korean — a collection of stars, yours to explore.

A local-first, keyboard-first desktop app for building a personal GitHub repo library. Import your starred repos, describe them with an LLM, and navigate your collection without a mouse.

> your stars. your eunha.

## Features

- **Import GitHub stars** — bulk-import all your starred repos in seconds
- **LLM descriptions** — on-demand summaries via OpenAI, Anthropic, or Ollama (what / why / use-case / tags)
- **Full-text search** — FTS5-powered search across summaries, tags, and notes
- **Keyboard-first navigation** — j/k, gg/G, /, o — no mouse required
- **Watching list** — track releases for repos you actively use
- **Network feed** — see what repos your network is starring
- **Batch describe** — describe all undescribed repos in one shot (shift-A)
- **Edit notes & categories** — override LLM output with your own context

## Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Tauri v2 |
| Backend | Rust (tokio, reqwest, rusqlite) |
| Frontend | React + TypeScript + Tailwind |
| Database | SQLite with FTS5 |
| LLM | OpenAI / Anthropic / Ollama |

## Getting Started

### Prerequisites

- [Rust toolchain](https://rustup.rs)
- Node.js 18+ and [pnpm](https://pnpm.io)

### Install & run

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

## Configuration

Create `~/.eunha/config.toml` (permissions `0600`):

```toml
github_token = "ghp_..."

[llm]
provider = "openai"      # "openai" | "anthropic" | "ollama"
api_key  = "sk-..."
model    = "gpt-4o-mini"
```

## Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate list |
| `gg` / `G` | Top / bottom |
| `Ctrl+d` / `Ctrl+u` | Half-page down / up |
| `h` / `l` | Cycle views (library → watching → feed) |
| `d` | Describe repo |
| `shift-D` | Re-describe (force regenerate) |
| `shift-A` | Batch describe all undescribed |
| `o` | Open in browser |
| `/` | Focus search |
| `e` | Edit notes & category |
| `,` | Settings |
| `?` | Keybinding help |

## Architecture

```
React (src/)
  └── invoke("import_stars" | "add_repo" | "describe_repo" | "search" | ...)
        ↓ Tauri IPC
Rust (src-tauri/src/commands/)
  ├── GitHub API  — stars import, repo metadata, README fetch
  ├── LLM API     — OpenAI / Anthropic / Ollama
  └── SQLite      — repos table + FTS5 virtual table
```

All GitHub API calls and DB writes happen in Rust. The React frontend never talks to GitHub or SQLite directly.

## License

MIT
