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
- **팔로우 업데이트** — 최근 Star 중 직접 고른 프로젝트만 릴리스를 추적하고, 릴리스 노트를 열면 읽음 처리합니다
- **Star 맥락 복원** — 태그와 저장 목적(복수 선택)으로 Star를 다시 찾습니다. `Collections`는 GitHub Star List가 아닌 Eunha의 로컬 컬렉션입니다.
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

## Star management v1

Eunha mirrors the complete GitHub Star list and never stars or unstars a repository on your behalf. A repository removed from GitHub is removed from Eunha on the next successful full sync, including its local classification, follow state, and cached releases. GitHub's actual star timestamp is retained to make the “recent 10” follow recommendations reliable.

The onboarding flow is GitHub connection → full Star sync → rule-based suggestion review → optional follow selection → finish. Suggestions begin with language and GitHub topics; any LLM enrichment remains user-initiated and is separate from the existing description prompt.

GitHub Star Lists are intentionally not synchronized in v1. GitHub documents the feature as a public preview, while the official Starring API does not expose list CRUD or membership synchronization: [Star Lists](https://docs.github.com/en/enterprise-cloud%40latest/get-started/exploring-projects-on-github/saving-repositories-with-stars) · [Starring API](https://docs.github.com/en/rest/activity/starring?apiVersion=2026-03-10).

## License

MIT
