# eunha TODO

현재 기준: local-first contribution workroom Phase 3 완료. 이 문서는 아직 구현되지 않은 작업만 기록한다.

## Phase 4 — Checks and PR readiness

### 승인된 검사 명령 실행

- snapshot의 detected command만 실행 후보로 사용한다.
- shell 문자열을 해석하지 말고 executable과 args로 분리한다.
- pipe, redirect, command substitution, workspace 밖 `cwd`를 거부한다.
- 실행 전 command, cwd, 목적을 보여주고 명시적 확인을 요구한다.
- 실행 중 취소와 timeout을 지원하고 child process를 남기지 않는다.

완료 기준: 승인 없는 실행, allowlist 밖 명령, workspace 밖 cwd가 Rust boundary에서 모두 거부된다.

### Command run persistence

- schema v17에 `command_runs`를 추가한다.
- `task_id`, command, cwd, status, exit code, 시작·종료 시각, 제한된 output excerpt를 저장한다.
- success, failure, cancelled를 구분한다.
- 앱 재시작 후 Task에서 과거 결과를 다시 읽는다.

완료 기준: 성공·실패·취소 기록이 Task에 남고 legacy 데이터가 보존된다.

### Checks UI

- Task Workspace에서 detected command와 최근 실행 결과를 함께 보여준다.
- 확인 dialog에 실제 command와 cwd를 그대로 표시한다.
- 실행 중 상태와 Cancel을 제공한다.
- output은 크기를 제한하고 전체 terminal emulator를 만들지 않는다.

완료 기준: 사용자가 어떤 검사를 어디서 왜 실행하는지 확인할 수 있다.

### PR readiness

- local workspace 연결, Task branch, working tree, required checks, CONTRIBUTING, PR template 상태를 계산한다.
- 개인 checklist 항목을 Task에 저장한다.
- 조건과 사용자 판단을 확인한 뒤에만 `ready_for_pr`로 이동한다.
- 일반 status command로 `submitted`를 설정하지 않는다.

완료 기준: readiness의 각 항목이 실제 snapshot, Git status, command run에 근거한다.

### GitHub Compare handoff

- GitHub remote, default branch, Task branch로 Compare URL을 만든다.
- 사용자가 선택하면 system browser에서 연다.
- push 또는 PR 생성은 실행하지 않는다.
- 실제 PR 제출 여부를 사용자가 확인했을 때만 `submitted`로 전환한다.

완료 기준: GitHub 페이지는 열리지만 앱이 GitHub write API, `git push`, PR 생성 명령을 호출하지 않는다.

### Approved clone flow

- remote-only Project에 clone destination을 제안한다.
- repository URL과 destination을 보여주고 별도 확인을 받는다.
- destination 경계와 기존 파일 충돌을 검증한다.
- clone 완료 후 기존 `connect_project_workspace` 검증 경로를 재사용한다.

완료 기준: clone은 승인 없이는 시작되지 않고, 성공한 repository만 Workspace로 연결된다.

## Phase 5 — Maintainer and Owner perspectives

### Contributor readiness

- CONTRIBUTING, Code of Conduct, issue/PR template, setup/check command 존재 여부를 같은 Project snapshot에서 계산한다.
- 근거가 없는 항목은 낮은 점수로 추정하지 말고 unknown으로 표시한다.

### Issue and PR health

- 열린 issue/PR, entry labels, 최근 activity를 읽기 전용으로 요약한다.
- GitHub 수정 작업은 링크로 handoff한다.

### Onboarding checklist

- maintainer가 로컬 checklist를 작성하고 상태를 저장할 수 있게 한다.
- contributor 화면과 별도 데이터 모델을 만들지 않고 같은 Project evidence를 사용한다.

완료 기준: GitHub 탭을 여러 개 열지 않고 기여 진입점과 누락 문서를 파악할 수 있다.

## Cleanup after the new flow is stable

- legacy tables의 보존·export 전략을 확정한 뒤에만 migration 삭제를 검토한다.
- macOS, Windows, Linux build CI를 추가하고 Tauri bundle을 검증한다.
- 공개 배포 전에 실제 license file과 지원 범위를 확정한다.
- 공개 프로젝트 3개로 Project → Brief → Task → Branch → Check → PR handoff를 dogfood한다.

## Verification gate

```bash
pnpm tsc --noEmit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

수동 acceptance에서는 승인 dialog, command 취소·실패 기록, 재시작 persistence, GitHub write 부재를 확인한다.
