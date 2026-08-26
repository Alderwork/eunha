# CLAUDE.md

이 문서는 eunha 저장소에서 작업할 때 지켜야 할 현재 구현 계약이다.

## Product contract

eunha는 공개 GitHub repository와 실제 local Git repository를 연결하는 local-first 오픈소스 기여 workroom이다. active product는 Star library가 아니라 `Project → Workspace → Contribution Task` 흐름이다. Contributor가 MVP의 주 사용자이며 Maintainer와 Owner는 같은 Project evidence를 다른 관점으로 읽는다.

AI는 수집된 근거를 정리하고 다음 행동을 제안할 뿐이다. commit, push, PR, 임의 명령 실행을 대신하지 않는다. local repository나 외부 시스템 상태를 바꾸는 허용된 mutation에는 각각 별도 사용자 확인이 필요하다.

## Current implementation

- Active frontend entry: `src/main.tsx` → `src/EunhaApp.tsx`
- Project UI: `src/EunhaApp.tsx`
- Task UI: `src/components/workroom/TaskWorkspace.tsx`
- Settings UI: `src/components/workroom/SettingsWorkspace.tsx`
- Project/Git inspection: `src-tauri/src/commands/projects.rs`
- Contribution Brief: `src-tauri/src/commands/project_brief.rs`
- LLM execution: `src-tauri/src/llm.rs`
- Task state and branch creation: `src-tauri/src/commands/tasks.rs`
- Schema runner: `src-tauri/src/db/migrations.rs`
- Current schema version: **16**

Phase 3까지 구현되어 있다. 검사 실행·기록과 PR readiness는 Phase 4, Maintainer/Owner 화면은 Phase 5다. `ready_for_pr`과 `submitted`는 Phase 4 전용 예약 상태이며 Phase 3의 일반 Task 상태 UI·command로 설정하지 않는다.

## Architecture

```text
React / TypeScript
        │ Tauri invoke
        ▼
Rust
 ├─ Project / Task domain commands
 ├─ Git + filesystem inspection
 ├─ GitHub public API client
 ├─ LLM call + response validation
 └─ rusqlite
        ▼
SQLite
```

React는 filesystem, shell, SQLite에 직접 접근하지 않는다. credential 입력은 Rust로 전달하고 저장된 원문은 React로 반환하지 않는다. Rust command가 trust boundary다.

AI connection UI는 `SettingsWorkspace.tsx`에서 Rust의 `conduit_list/save/delete/set_active` command를 직접 호출한다. 저장 구현은 `src-tauri/src/conduit.rs`, LLM 실행과 response validation은 Rust에 남으며 별도 sibling package가 필요하지 않다.

## Database

`PRAGMA user_version` 기반 migration을 매 startup에 실행한다.

현재 domain tables:

- `projects`: repository identity와 role perspective
- `workspaces`: 사용자가 연결한 canonical local Git root와 마지막 status
- `project_snapshots`: 문서, 도구, evidence, Contribution Brief
- `project_issues`: 공개 GitHub issue/PR cache
- `contribution_tasks`: issue 또는 직접 만든 작업, 상태, branch, notes

Task 상태 모델 (`ready_for_pr` 이후는 Phase 4 예약):

```text
candidate → selected → preparing → in_progress → ready_for_pr → submitted
                         ↘ blocked
                         ↘ abandoned
```

domain 전이 순서는 `tasks.rs::valid_transition`이 정본이다. 다만 Phase 3의 일반 상태 변경 command는 `ready_for_pr`과 `submitted`를 모두 거부한다. Phase 4의 근거 기반 readiness 흐름만 `ready_for_pr`을, 사용자 제출 확인 흐름만 `submitted`를 설정해야 한다.

`repos`와 Star 관련 tables는 향후 migration/export를 위한 legacy 데이터 보존용이다. active UI와 command에서는 읽지 않는다. 새 기능을 이 schema에 추가하지 말고 Project domain을 사용한다.

## Contribution Brief contract

Brief JSON shape:

```json
{
  "project_definition": "...",
  "contributor_entry_points": [],
  "setup_requirements": [],
  "verification_commands": [],
  "contribution_rules": [],
  "maturity_signals": [],
  "cautions": [],
  "evidence": [{ "source": "CONTRIBUTING.md", "excerpt": "..." }],
  "unknowns": []
}
```

Invariants:

- evidence excerpt는 해당 source content에 그대로 존재해야 한다.
- `verification_commands`는 manifest/build file에서 감지한 후보만 허용한다.
- 확인하지 못한 파일, 명령, 버전, 규칙, 활동은 `unknowns`로 보낸다.
- AI 응답이 validation을 통과하지 못하면 deterministic brief를 유지하고 partial error를 저장한다.
- network/API/AI 일부 실패가 기존 snapshot을 파괴하면 안 된다.

## Security invariants

- local path는 canonicalize한 Git root만 저장한다.
- 저장된 root가 다른 위치로 resolve되면 접근을 거부한다.
- local source 수집은 workspace root 밖으로 나가는 symlink를 거부한다.
- public GitHub repository만 지원한다.
- branch 이름은 Rust와 Git 양쪽에서 검증한다.
- branch 생성은 `confirmed == true`일 때만 `git switch -c`를 실행한다.
- clone, 검사 command runner, commit, push, GitHub write API, PR 생성은 현재 구현하지 않는다.
- GitHub PAT는 `~/.eunha/config.toml`, AI connection은 `~/.eunha/connections.toml`에 `0600`으로 저장한다.
- credential 입력은 invoke payload로 Rust에 전달될 수 있지만, 저장된 원문을 frontend로 반환하지 않는다.
- secret을 SQLite나 log에 넣지 않는다.

보안 경계와 validation은 단순화를 이유로 생략하지 않는다.

## Commands

```bash
pnpm tauri dev
pnpm tsc --noEmit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build
```

변경 위험에 맞춰 가장 작은 검증부터 실행하고, migration·Git mutation·filesystem boundary를 바꾸면 Rust test를 반드시 남긴다.

## Legacy boundary

Star import/sync, Library, Feed, Graph, Digest, Watching, Trending, Collections의 UI와 command는 active code에서 제거됐다. 데이터 삭제 없이 향후 migration/export를 결정할 수 있도록 legacy schema migration과 tables만 남아 있다.

- 새 product behavior를 legacy command나 `source='starred'` 규칙 위에 만들지 않는다.
- legacy tables 삭제는 Project/Workspace/Task 데이터 보존·export 전략이 확정된 뒤 별도 migration으로 한다.
- 과거 Star 제품 문서는 legacy 안내가 붙은 기록일 뿐 현재 요구사항이 아니다.
