# eunha workroom v1

> 상태: 제품 계약
>
> 구현 상태: Phase 3 완료, Phase 4–5 예정

현재 Phase 3에서는 Project, Contribution Brief, Task, local Workspace와 승인된 branch 생성까지 제공한다. 검사 실행·기록, readiness checklist, GitHub Compare 연결은 아직 구현되지 않았다. `ready_for_pr`과 `submitted`는 Phase 4의 전용 확인 흐름을 위한 예약 상태이며 일반 Task 상태 UI·command에서 설정하지 않는다.

## 브랜드 정의

**eunha — 저장소를 이해하고, 기여를 끝까지.**

eunha는 local-first 오픈소스 기여 workroom이다. `eunha`라는 이름은 유지하지만 Star, galaxy, collection을 제품 구조나 핵심 카피로 사용하지 않는다. 제품을 설명하는 첫 문장은 항상 Project, local Workspace, Contribution Task 중 하나에서 시작한다.

영문 descriptor는 **“From repository context to PR-ready work.”**로 사용한다.

eunha가 아닌 것:

- GitHub Star manager 또는 repository discovery feed
- IDE나 terminal 대체재
- 자동으로 코드를 수정하고 PR을 제출하는 AI agent
- team account와 cloud sync가 전제인 협업 서비스

## 개발 목적

> 오픈소스 기여에서 가장 큰 마찰은 프로젝트를 발견하는 일이 아니라, 흩어진 문서와 이슈를 이해하고 실제 로컬 작업으로 이어 붙이는 일이다. eunha는 공개 GitHub repository와 사용자의 local Git repository를 하나의 Project로 연결하고, README·CONTRIBUTING·template·manifest·issue/PR에서 확인한 근거를 Contribution Brief와 Contribution Task로 정리한다. 개발자가 다음 행동을 판단하고, 작업 맥락을 잃지 않은 채 PR 준비까지 이어가도록 돕는 것이 목적이다.

## 프로젝트 소개

> eunha는 개발자가 오픈소스 프로젝트를 이해하고 기여를 끝까지 이어가기 위한 Tauri desktop workroom이다. 사용자는 GitHub URL, `owner/repo`, 또는 기존 local repository 경로로 Project를 추가한다. eunha는 repository 문서와 공개 GitHub activity를 근거가 연결된 Contribution Brief로 정리하고, 선택한 issue나 직접 만든 목표를 Contribution Task로 보존한다. 완성된 v1에서는 Task 안에서 local Workspace의 branch, 변경 파일, diff, 검사 기록, 개인 메모와 PR 준비 상태를 함께 관리한다. AI는 수집된 근거 안에서만 설명과 다음 행동을 제안하며, 확인하지 못한 내용은 unknown으로 남긴다. branch 생성과 승인된 검사처럼 허용된 mutation은 사용자 확인 없이는 실행하지 않으며 commit·push·PR 생성은 자동화하지 않는다.

## 기대 효과

> eunha를 사용하면 개발자는 Project를 추가한 뒤 “이 repository가 무엇인가”를 반복해서 조사하는 대신 “내가 다음에 무엇을 해야 하는가”를 빠르게 판단할 수 있다. Phase 3에서는 문서, issue, branch, 변경 사항과 메모가 Task에 남아 앱을 다시 열어도 작업 맥락을 복원할 수 있다. 검사 결과와 PR 준비 상태는 Phase 4에서, Maintainer와 Owner의 contributor entry point·onboarding gap 관점은 Phase 5에서 추가한다. 효과는 Project 추가 후 Brief 확인까지의 시간, Task 생성 후 `in_progress` 전환율, 검사 실행률, `ready_for_pr` 도달률, 그리고 “다음 행동을 알 수 있었다”는 피드백으로 검증한다.

## 핵심 객체

| 객체 | 의미 |
|---|---|
| Project | 기여하거나 유지보수할 open-source repository |
| Workspace | 사용자가 연결하거나 승인 후 clone한 local Git root |
| Contribution Brief | source와 excerpt가 연결된 기여 판단 문서 |
| Contribution Task | issue 또는 직접 정의한 실제 작업 단위 |
| Check | 승인 후 실행된 검증 command와 결과 |
| PR Readiness | Git, 문서, check, 사용자 판단을 모은 준비 상태 |

Contributor, Maintainer, Owner는 별도 제품이 아니라 같은 Project를 읽는 관점이다. v1의 주 사용자는 Contributor다.

## v1 목표 흐름

```text
Project 추가
→ 프로젝트·기여 규칙 분석
→ issue 선택 또는 Task 생성
→ local Workspace 연결 / 승인 후 clone
→ branch·변경 사항·검사·메모 관리
→ PR readiness 확인
→ GitHub Compare / PR 페이지로 이동
```

## 제품 원칙

- Tauri v2 + React/Vite + Rust + SQLite를 유지한다.
- 실제 local Git repository에서 일하는 사용자를 최우선으로 한다.
- GitHub API는 public repository 정보를 읽는 데 사용한다.
- AI output보다 source evidence를 우선하며 검증하지 못한 사실은 `unknowns`에 남긴다.
- React는 filesystem, shell, SQLite에 직접 접근하지 않는다. credential은 사용자가 입력할 때만 Rust로 전달하고 저장된 원문을 다시 읽지 않는다.
- mutation은 실행 전 command, path, 목적을 보여주고 별도 확인을 받는다.
- 자동 code edit, commit, push, PR 생성, GitHub write API는 v1 범위가 아니다.
- Star import, feed, graph, digest, collection은 active product 범위가 아니다.
- private repository, team sharing, account, cloud sync, notification은 v1 범위가 아니다.

## v1 완료 기준

공개 프로젝트 3개에서 다음 흐름을 반복해 사용할 수 있어야 한다.

1. remote-only Project와 기존 local repository를 각각 추가한다.
2. Contribution Brief의 evidence, unknowns, partial failure를 확인한다.
3. issue 또는 직접 만든 Task를 시작하고 승인 후 branch를 만든다.
4. 승인한 check의 성공·실패·취소 결과를 저장한다.
5. PR readiness를 확인하고 GitHub Compare 페이지로 이동한다.
6. 앱 재시작 후 Project, Workspace, Task, check 기록을 복원한다.
7. 앱이 commit, push, PR 생성 또는 GitHub write를 자동 수행하지 않음을 확인한다.
