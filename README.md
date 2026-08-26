# eunha

> 저장소를 이해하고, 기여를 끝까지.

**eunha**는 공개 GitHub 저장소와 실제 로컬 Git 저장소를 연결하는 local-first 오픈소스 기여 workroom입니다. 프로젝트 문서, 공개 이슈와 PR, 브랜치, 변경 사항, 개인 메모를 하나의 작업 맥락으로 묶어 프로젝트를 발견한 뒤 실제 기여를 시작하고 이어가는 데 드는 마찰을 줄입니다.

eunha의 핵심 객체는 **Project**, **Workspace**, **Contribution Task**입니다. AI는 수집한 근거를 정리하고 다음 행동을 제안하지만, 확인되지 않은 사실을 만들거나 사용자를 대신해 코드를 변경·커밋·푸시·제출하지 않습니다.

## 현재 할 수 있는 일

- GitHub URL, `owner/repo`, 기존 로컬 경로로 Project 추가
- 로컬 Git root, GitHub remote, 기본·현재 브랜치, working tree 상태 확인
- README, CONTRIBUTING, Code of Conduct, Issue/PR template, manifest 수집
- 출처와 인용문이 연결된 Contribution Brief 생성
- `good first issue`, `help wanted`, 최근 공개 이슈·PR 최대 50개 탐색
- 이슈 기반 또는 직접 Contribution Task 생성
- Task 상태와 개인 메모 저장, 앱 재시작 후 복원
- 기존 local clone 연결 및 GitHub remote 일치 여부 확인
- 명시적 확인 후 Task branch 생성
- 변경 파일, diff stat, staged diff, 최근 commit 확인
- Settings에서 GitHub PAT와 AI provider connection 관리

현재 구현은 Phase 3까지입니다. `ready_for_pr`과 `submitted`는 Phase 4의 근거 기반 PR readiness·제출 확인 흐름을 위해 예약되어 있으며, Phase 3의 일반 Task 상태 UI·command에서는 설정하지 않습니다. 검사 명령 실행·기록, readiness checklist, GitHub Compare 페이지 연결은 아직 구현되지 않았습니다.

## 작업 흐름

```text
Project 추가
→ 저장소 근거 수집 및 Contribution Brief 생성
→ 이슈 선택 또는 직접 Task 생성
→ 기존 local clone 연결
→ 사용자 확인 후 branch 생성
→ Git 상태·변경 사항·메모로 작업 맥락 유지
→ 검사와 PR 준비 (Phase 4)
```

## 안전 경계

- public GitHub repository만 지원합니다.
- 파일 접근은 사용자가 연결한 canonical Git workspace root 안으로 제한합니다.
- AI가 제시한 evidence는 실제 수집 문서의 동일한 인용문과 일치해야 합니다.
- 확인되지 않은 파일, 명령, 버전, 규칙은 `unknowns`로 남깁니다.
- branch 생성은 명령과 경로를 보여준 뒤 사용자가 확인해야 실행됩니다.
- clone과 검사 명령은 아직 실행하지 않으며 commit, push, PR 생성은 자동화하지 않습니다.
- GitHub write API를 호출하지 않습니다.
- GitHub token과 AI key는 입력할 때만 webview를 거쳐 Rust가 소유한 설정 파일에 저장되며, 저장된 원문은 webview로 반환하지 않습니다.

## 기술 구성

| 계층 | 역할 |
|---|---|
| Tauri v2 + React/TypeScript | 화면, 입력, 승인 흐름 |
| Rust | Git, filesystem, GitHub API, LLM 호출·검증, SQLite |
| SQLite | Project, Workspace, Snapshot, Issue cache, Contribution Task |
| GitHub API | 공개 repository, issue, PR 읽기 |
| AI provider | 수집된 근거에 한정한 Brief 보강 |

```text
React / EunhaApp
        │ Tauri invoke
        ▼
Rust Core
 ├─ Project / Task commands
 ├─ Git + filesystem inspection
 ├─ GitHub public API client
 ├─ evidence-validated LLM path
 └─ SQLite schema v16
```

React는 filesystem, shell, SQLite에 직접 접근하지 않습니다. credential 입력은 Rust로 전달되며 저장된 원문은 React로 돌아오지 않습니다.

## 개발

### 준비물

- Rust toolchain
- Node.js `^20.19.0` 또는 `>=22.12.0` (Vite 7)
- pnpm
- Git

### 실행

```bash
pnpm install
pnpm tauri dev
```

### 검증

```bash
pnpm tsc --noEmit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

제품 원칙과 범위는 [workroom v1 제품 계약](docs/product/workroom-v1.md), 남은 구현은 [TODOS.md](TODOS.md)를 참고하세요.
