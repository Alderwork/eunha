# eunha Phase 1 실행 플랜

> [!WARNING]
> **Legacy product plan.** 이 문서의 Phase 번호와 Star·digest·curation 목표는 피봇 이전 제품에만 적용된다. 현재 local-first contribution workroom의 제품 계약은 [docs/product/workroom-v1.md](docs/product/workroom-v1.md)를 따른다. 과거 실험 맥락을 보존하기 위해 내용은 수정하지 않는다.

**기간:** 4주  
**목표:** LLM 묘사 품질을 개선하고, 다이제스트 루프를 완성해서 본인이 4주 연속 자발적으로 eunha를 열어보게 만든다.  
**큐레이션 시작 조건:** 4주 연속 다이제스트를 실제로 열어본 후  
**신뢰 기준:** "내가 매주 eunha를 자발적으로 열어본다"

---

## Week 1: 현상 파악 + 품질 평가 기준

### Day 1–2: LLM 묘사 품질 평가
- 본인 GitHub 스타 중 AI/LLM/Agent 관련 프로젝트 20개 선정
- 각 프로젝트를 eunha에서 `d` 또는 `shift-A`로 describe
- 아래 기준으로 1~5점 평가

| 항목 | 1점 | 3점 | 5점 |
|---|---|---|---|
| what | 프로젝트가 뭔지 모르겠음 | 한눈에 이핵됨 | 공유하고 싶을 정도 |
| why | 왜 쓰는지 모르겠음 | 쓸 이유가 있음 | 별 누른 이유가 떠오름 |
| use_case | 어디 쓰는지 모르겠음 | 한 가지 시나리오 | 내가 항볼 만한 시나리오 |
| category | 틀림/어울리지 않음 | 적절함 | 찾기 딱 좋음 |
| tags | 무의미 | 2~3개 적절 | 검색/필터에 딱 좋음 |

- 총점 15점 이하 = 개선 대상
- 항목별 평균 3점 미만 = 프롬프트 개선 포인트

### Day 3–4: 문제 패턴 분류
| 문제 유형 | 예시 | 해결 방향 |
|---|---|---|
| 과도하게 추상 | "AI-powered tool for developers" | README에서 구체적 기능 추출 |
| ChatGPT 래퍼 | "ChatGPT wrapper for X" | 본질 기능 재묘사 |
| 카테고리 부정확 | CLI인데 Library로 분류 | 카테고리 정의/예시 추가 |
| 태그 불량 | ["ai", "tool", "github"] | 구체성 강조, generic 태그 금지 |
| README 형편없음 | excerpt가 쓸모없음 | README 파싱 개선 또는 fallback |

### Day 5–7: 다이제스트 경험 평가
- 이번 주 동안 매일 eunha 켜보기
- 다이제스트 열 때마다 기록:
  - 이게 뭔지 1초 안에 기억났는가?
  - 다시 열어만했는가?
  - 묘사가 도움이 되었는가?

---

## Week 2: LLM 프롬프트 개선

### 원칙
- 프롬프트는 immutable — 변경 시 `CURRENT_PROMPT_VERSION` bump + migration 고려
- 1~2개 후볧만 동시에 변경하여 효과 측정

### 개선 후보
| 후보 | 적용 조건 |
|---|---|
| README excerpt → structured sections | what/why 품질이 낮을 때 |
| Few-shot examples 추가 | 형식은 맞지만 내용이 빈약할 때 |
| 카테고리 정의 보강 | category 분류가 틀릴 때 |
| 태그 품질 기준 강화 | tags가 generic할 때 |
| JSON mode 강제 | JSON 파싱 실패율이 높을 때 |

### Day 8–9: v2 프롬프트 초안
- 1~2개 후볧만 반영한 v2 초안 작성

### Day 10–12: A/B 테스트
- 동일 20개 프로젝트를 v1과 v2로 각각 describe
- 평가 기준표로 점수 비교
- **v2 평균이 10% 이상 높고, 어떤 항목도 떨어지지 않아야** 적용

### Day 13–14: v2 적용 결정
- 적용 시:
  - `CURRENT_PROMPT_VERSION` bump
  - migration 전략 수립
  - `shift-A` 또는 batch describe로 기존 데이터 업데이트
- 미적용 시:
  - 다른 후보로 재테스트
  - 또는 현재 프롬프트가 충분하다고 판단

---

## Week 3: 다이제스트 루프 완성

### 작업 항목
| 기능 | 설명 |
|---|---|
| OS 알림 전달 검증 | tray 상주 + launch-at-login + 7일 경과 시 알림 |
| 빈 상태 처리 | 새 별 0개 / 다시 볼 것 0개일 때 알림 억제 또는 대체 메시지 |
| fallback 체인 | `llm_what` → GitHub description → 이름+언어 |
| last_viewed_at 쓰기 | 브라우저 열기 또는 다이제스트 펼치기 시 갱신 |
| 알림 권한 거부 폴역 | 인앱 배지 + 설정에서 재요청 |

### 자가 테스트
- 매일 eunha 열어서 다이제스트 확인
- 기록:
  - 알림이 떴는가?
  - 열어본 이유는?
  - 흥미로운 항목은?
  - 쓸모없는 항목은?

---

## Week 4: 4주 연속 열어보기 + 회고

### 매일 기록
- eunha 열어서 다이제스트 확인
- "오늘 열어본 이유" 한 줄 기록
- "묘사가 도움이 된 경우" 체크

### 4주 말 평가
| 기준 | 통과 |
|---|---|
| 4주 중 3주 이상 다이제스트 열람 | ✅ |
| 열람 항목 중 30% 이상 "아 이거 있었지" | ✅ |
| LLM 묘사 평균 v1 대비 10% 이상 향상 | ✅ |
| 알림 안정적으로 전달 | ✅ |
| 다른 사람에게 추천할 만한 완성도 | ✅ |

### 4주 후 결정
- **통과:** Phase 2로 이동 — 앱 안 "eunha picks" 또는 Community Feed 실험 설계
- **실패:** 실패 기준 진단 후 2~4주 추가 개선

---

## Phase 2 예고: 앱 안 큐레이션

4주 후 신뢰가 확복되면:

1. **앱 안 "eunha picks" 탭 추가**
   - 매주 선정한 AI 프로젝트 5개 노출
   - 개선된 LLM 묘사 활용

2. **"내 picks 공유" 기능**
   - Export to Markdown (TODOS.md P3)
   - 개인 큐레이션 → 공개 큐레이션 연결

3. **외부 뉴스레터 "eunha picks"**
   - 앱 안 picks를 외부로 확장
   - 신뢰 기반 광고주/스폰서 접촉

---

## 오늘 시작할 수 있는 첫 행동

1. 본인 GitHub 스타 중 AI/LLM/Agent 프로젝트 20개 리스트업
2. eunha에서 20개 describe
3. 위 평가 기준표로 점수화
