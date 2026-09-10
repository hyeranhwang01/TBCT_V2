# TBCT S01~S03 프로토콜 정합성 개발 요청 (Phase 1)

> 경로 표기는 2026-09-10 트리 재편(`src/patient` · `src/clinician` · `src/shared`) 기준으로 기계 치환되었습니다. 본문 내용 자체는 작성 당시 기준입니다.

너는 이 저장소에서 TBCT 상담 플랫폼의 세션 프로토콜 정합성 수정을 수행한다.
이 작업은 **임상시험(Protocol V9)에 사용되는 치료 프로토콜**이다. 사용자에게 노출되는 문구 하나가 임상 데이터의 유효성에 영향을 준다. 추측으로 문구를 만들지 말고, 원문 근거가 없으면 멈추고 물어봐라.

---

## 0. 먼저 읽을 것

저장소에 있는 다음 문서가 **이번 작업의 유일한 기준안**이다.

```
docs/TBCT_S01-S03_고도화_기획안_v3.md
```

`docs/LOCAL_DEV_SETUP.md` 도 함께 읽는다 (로컬 실행 · 푸시 범위 가드).

**이 문서를 찾지 못하면 즉시 중단하고 나에게 경로를 물어봐라.** v3 기준안 없이 착수하지 않는다.
v3에는 §부록 A에 확정 문안(영/한) 13종이 있다. 사용자 노출 문구는 **부록 A를 그대로 사용**한다.

---

## 1. 작업 순서 (이 순서를 지켜라)

```
Phase 0  조사 및 위험 확인   → 코드 수정 금지, 보고만
   ↓
STOP     나에게 질문 → 답변 대기
   ↓
Phase 1  구현
   ↓
Phase 2  검증
   ↓
보고
```

**Phase 0가 끝나기 전에 단 한 줄도 수정하지 마라.**

---

## 2. 수정 허용 파일 (6개, 그 외 전부 금지)

```
protocol/sessions/s01.ts
protocol/sessions/s02.ts
protocol/sessions/s03.ts
runtime/static-messages/s01.ts
runtime/static-messages/s02.ts
runtime/static-messages/s03.ts
```

실제 경로에는 접두어가 있을 수 있다(코드의 import가 `@/shared/protocol/...`, `@/shared/runtime/...` 이므로 `src/lib/...` 가능성이 높다). **Phase 0에서 실제 경로를 확정해서 보고**하고, 이후 그 6개 경로만 만진다.

### 수정 절대 금지

```
runtime-execution-api.ts        runtime-state-reducer.ts
runtime-orchestrator.ts         dialogue-agent-orchestrator.ts
runtime-static-message.ts       patient-input-controls.tsx
worksheet-renderers/*           worksheet-bindings/*
source-fidelity-types.ts        tbct-source-text.generated.ts
```

`tbct-source-text.generated.ts` 는 **읽기 전용**이다. verbatim 판정의 기준이므로 반드시 읽되, 절대 수정하지 마라.

---

## 3. Phase 0 — 착수 전 조사 (코드 수정 없이 보고)

아래를 전부 확인하고 **결과를 표로 보고**하라.

### 3.1 경로·구조 확인

- 6개 대상 파일의 **실제 경로**
- 패키지 매니저 / Node 버전 / 프레임워크 및 버전
- `typecheck` · `lint` · `build` · `test` 스크립트 존재 여부와 명령
- 현재 브랜치, `origin` 기본 브랜치명(main/master), working tree 청결 여부

### 3.2 프롬프트 ID 체계 — **가장 위험한 지점**

static message의 키는 **위치 기반**으로 보인다.

```
tbct-s01-n05-p08-candidate-two-cycle   → 5번째 node, 8번째 prompt
tbct-s02-n08-p02-six-anchor-goal-scale → 8번째 node, 2번째 prompt
tbct-s03-n15-p01-pause-and-escalate    → 15번째 node, 1번째 prompt
```

즉 **node나 prompt를 중간에 삽입하면 이후 모든 ID가 밀려서**, `resolveStaticText`의 기존 키가 조용히 매칭 실패하고 generic fallback으로 떨어진다. 화면에는 에러가 아니라 **엉뚱한 문장**이 나온다.

확인할 것:

1. ID 생성 규칙이 실제로 위치 기반인지 (생성 코드를 찾아 확인)
2. 위치 기반이 맞다면, v3에서 요구하는 **신규 prompt 추가**를 어떻게 처리할지
   - 원칙: **append-only** (노드 맨 뒤에 추가) 로 기존 인덱스 보존
   - append-only가 임상 순서상 불가능한 지점이 있으면 목록화해서 보고
3. 삽입이 불가피한 경우, 영향받는 static-message 키 전체 목록

### 3.3 타입 시스템 제약 — **7번째 파일이 필요해질 수 있는 지점**

`source-fidelity-types.ts` 는 수정 금지인데, v3는 다음을 요구한다. **각각이 현재 타입으로 표현 가능한지** 확인하라.

| v3 요구 | 확인 사항 |
| --- | --- |
| Q8/Q9 `minItems: 1` + 목표치 2 | `targetItems` 같은 필드가 타입에 있는가? 없으면 대안은? |
| activationCondition 복합 조건 (`A && B`) | `all` / `and` 배열 조건을 지원하는가? |
| Q7 `none` / `unsure` 허용 | 기존 validation으로 표현 가능한가? |
| Candidate emotion validation 의미 변경 | 새 `kind` 없이 기존 kind + 주석으로 가능한가? |
| returning arrows 배열 append | reducer가 배열 append를 지원하는가, 덮어쓰기인가? |
| S03 전역 crisis edge | `extraEdges`에 노드 수만큼 나열하면 되는가? 전역 규칙 지원이 있는가? |
| 신규 필드 (`additionalEvidenceRequested*` 등) | 필드 화이트리스트/타입 선언이 별도 파일에 있는가? |

**하나라도 6개 파일 밖 수정이 필요하면 → 구현하지 말고 STOP.**

### 3.4 source fidelity 검증 장치

- `sourceSessionHash`, `sourceLineStart/End`, `contextRange` 등이 **무엇을 해싱/검증**하는지
- spec을 수정하면 깨지는 검증 테스트가 있는지
- 신규 prompt에 부여할 `source: [a, b]` 범위는 어떻게 정해야 하는지 (임의 값 금지 — 해당 섹션의 기존 범위를 재사용)
- `marker` 가 `tbct-source-text.generated.ts` 에 실제로 존재하지 않으면 추출이 실패하는지

### 3.5 기존 상태 baseline

수정 전 상태를 반드시 남겨라.

- `git rev-parse HEAD` 기록
- S01/S02/S03 **각각 full-session 1회 완주** 후, 각 turn의 `prompt ID / 출력 문장 / fallback 여부 / locale` 를 로그로 저장
- 이 baseline은 Phase 2 비교의 기준이다. **baseline 없이 수정 착수 금지.**

---

## 4. STOP 조건 — 아래 중 하나라도 해당하면 즉시 멈추고 질문하라

**임의로 판단해서 진행하지 마라. 물어보는 것이 항상 옳다.**

| # | 조건 | 질문 형식 |
| --- | --- | --- |
| S-1 | 6개 파일 밖 수정이 필요함 | 어떤 파일, 왜 필요한지, 대안이 있는지 |
| S-2 | 신규 파일 생성이 필요함 (테스트 포함) | 파일명, 목적, **푸시할지 로컬 전용으로 둘지** |
| S-3 | prompt/node 삽입으로 ID가 밀림 | 영향받는 static-message 키 목록 + append-only 대안 가능 여부 |
| S-4 | v3 부록 A에 문안이 없는데 사용자 노출 문구가 필요함 | 어느 prompt인지, 원문 후보 문장이 있는지 |
| S-5 | v3 지시와 원문(`tbct-source-text.generated.ts`)이 어긋남 | 양쪽 인용 + 어느 쪽을 따를지 |
| S-6 | 6개 파일만 푸시하면 **빌드/타입체크가 깨짐** | 무엇이 없어서 깨지는지 + 최소 추가 파일 목록 |
| S-7 | fidelity 검증 테스트가 수정을 거부함 | 어떤 검증, 어떤 규칙 위반인지 |
| S-8 | 필드명 변경이 불가피함 | v3는 필드명 보존이 원칙 — 왜 불가피한지 |

질문은 **한 번에 모아서** 하라. 한 건씩 나눠 묻지 마라.

---

## 5. Phase 1 구현 — P0 우선

상세는 v3 본문을 따르되, 우선순위와 핵심 함정만 옮긴다.

### S01

1. **Candidate 2/3 recheck를 possibility 재확인으로 교체** (v3 §4.3, 부록 A-1/A-2)
   - 감정을 **되묻지 마라**. 원저에서 감정은 가이드가 제시하는 고정값이다.
   - 현재 `patientText`의 *"being told they seem 'sad or discouraged'"* 는 감정을 면접관 발화처럼 서술하는 오류다. 삭제.
   - 기존 `candidate-two-possibility` prompt와 **중복 발화되지 않게** 게이팅.
2. **compliment 3회 verbatim 동일** (부록 A-3). 기준은 `tbct-source-text.generated.ts` [82,85]. 현재 코드와 v3 인용에 미세 차이가 있으니 **generated 쪽에 맞춰 3곳 통일**.
3. **returning arrows 응답 소실 해소** (§4.6) — `candidateOneReturningArrows` 에 3개 prompt가 동시에 쓴다. 배열 append 또는 하위 필드 분리. reducer 지원 여부는 §3.3에서 확인.
4. **distortion 선택 개수 강제 해제** (§4.8) — `read-distortions` 의 `min_items 2~3` 은 "**읽기** 2~3개"를 "선택 2~3개"로 잘못 구현한 것. `read-distortions` 가 `participantSelectedDistortions` 를 쓰지 않게 분리하고, `identify-distortion` 만 산출하며 하한 0 허용.
5. **distortion list access 게이팅** — `confirm-list` 가 false면 다음 단계 비활성 + Annex 위치 안내.
6. reaction guard (§4.4) — `undefined`/오타를 `negatively` 로 확정하는 현재 삼항 연산 제거. **s01.ts에 activationCondition + recheck, static-messages/s01.ts는 유효값 전제**로 역할 분담.

### S02

7. `[problem]` / `[goal]` 실제 명칭 치환, 대상 없으면 **문장 자체를 생성하지 않음** (§5.1)
8. **CCGH 6-anchor 전면 교체** (§5.2, 부록 A-5) — 현재 goal 척도 문구에 anchor 의미가 **하나도 없고** "problem과 같은 척도"라고 잘못 안내한다. CCPH 쪽은 이미 정확하니 건드리지 마라.
9. **재방문 opening 이중 발화 제거** (§5.5) — `first-session-opening` 에 `returningParticipant === false` 조건 추가.
10. total 완전성 guard (§5.4) — `items.length === ratings.length` 일 때만 총점 문장 생성. baseline 의미 문구 추가(부록 A-6).

### S03

11. **전역 crisis edge** (§6.1) — 현재 crisis edge가 `safety-check` 에서만 나간다. 원문은 *"at any point during the session"*. 모든 노드에서 `safety-pause` 로 가는 edge 추가.
    - `safety-pause` 의 `terminal: true` 는 **유지**한다. Protocol V9이 "human review 전 재개 금지"를 요구한다. 근거를 주석으로 남겨라.
12. **Q8/Q9 validation 완화** (§6.9) — 현재 `minItems: 2` 가 원문의 "1회 재요청 후 없으면 수용" 을 차단해 **진행 불가**를 만든다. `minItems: 1` + 재요청 1회 소진 플래그.
13. **full-conclusion readback 문안 구현** (§6.10, 부록 A-9) — s03.ts의 `requiresField` 게이팅은 이미 정확하다. 없는 것은 **static message**다.
14. **Q11 original emotion 실제 값 치환** (§6.11, 부록 A-10) — marker에 `[emotion named at Q3a]` 리터럴이 박혀 있다.
15. **Q11b intensity 문안 신규** (§6.12, 부록 A-11) — `emotion-intensities` 는 marker도 patientText도 없어 fallback 확정 발생 지점이다.
16. **Q13 working AT 우선 readback** (§6.14, 부록 A-12) — `workingAutomaticThought ?? automaticThought`.
17. **Q2b도 readback** (§6.5) — factual 경로를 거치면 어떤 thought를 평가하는지 알 수 없다.
18. safety pause 문구 **arm-중립화** (§7.3, 부록 A-13) — `your therapist` → `study clinician`. Protocol V9 Arm 3에는 담당 therapist가 없다.

### 공통

19. **locale parity** (§7.1) — 한/영 혼용의 원인은 `s01.ts` 인라인 `patientText` 6개가 구조적으로 locale 대응이 안 되는 것이다. 사용자 노출 문구가 static message 경로를 타도록 대응 키를 **전수 추가**하고, 동적 생성 문장도 한국어 분기를 갖게 하라.
    - **키 집합 diff 0건**이 검증 기준이다.

---

## 6. 문구 작성 규칙 (위반 시 작업 무효)

- **원칙 P — 복원 우선, 창작 예외.** `patientText`는 원문 문장의 **복원**이 기본이다. marker가 문장을 자르면 원문 전체 문장을 넣어라. 원문에 대응이 없을 때만 창작하고, 그 경우 **코드 주석에 "원문 무대응 — 창작 근거"** 를 남겨라.
- v3 부록 A에 문안이 있으면 **그대로 사용**한다. 더 자연스럽게 다듬지 마라.
- **원칙 F — 스칼라 1:1.** 하나의 스칼라 필드는 하나의 prompt만 산출한다.
- 영어 문안을 추가하면 **반드시 같은 키의 한국어 문안도 추가**한다.
- 임상 문구를 새로 만들어 psychoeducation을 늘리지 마라. fidelity 위험이 fallback보다 크다.

---

## 7. 금지 동작

- `[problem]` `[goal]` `[initial conclusion]` `[extended conclusion]` `[emotion named at Q3a]` `[repeat patient's exact AT]` 등 미치환 placeholder 출력
- 값이 없는 상태를 임의로 `negative` 로 간주
- 사용자가 말하지 않은 emotion·thought·conclusion·distortion 생성
- 사실인 사건 자체를 cognitive distortion 처럼 반박
- S03 14문항 skip 또는 순서 변경
- 사용자에게 distortion 개수를 채우도록 요구
- AI가 안전 확인 후 자율적으로 세션 재개

---

## 8. Phase 2 — 검증

### 8.1 정적 검증

```
1) 타입체크 · 린트 · 빌드 (모두 통과해야 함)
2) placeholder 스캔: 6개 파일 + 런타임 출력에 미치환 [variable] 0건
3) static-message 키 무결성: resolveStaticText / APPROVED_TEXT / koreanText 의
   모든 키가 spec의 실제 prompt ID 집합에 존재하는지 (ID 시프트 조기 탐지)
4) locale 키 집합 동등성: 세션별 영어 노출 키 == koreanText 키
```

3)과 4)를 자동 검증하려면 테스트 파일이 필요하다 → **STOP S-2**로 물어봐라(푸시 여부 결정 필요). 답을 받기 전에는 일회성 스크립트로 확인하고 결과만 보고하라.

### 8.2 시나리오 회귀 (v3 §11.2) — **정상 경로만으로는 불충분**

| # | 세션 | 분기 |
| --- | --- | --- |
| R-1 | S01 | Candidate 2에서 candidate 1과 **같은 감정** 응답 → recheck 경로 |
| R-2 | S01 | Candidate 2 reaction **"positive"** → clarification 경로 |
| R-3 | S01 | Candidate 2 reaction **무응답/비정형** → cycle 미생성 |
| R-4 | S01 | distortion list **"없다"** → 게이팅 |
| R-5 | S01 | distortion **1개만** 지목 → 정상 진행 |
| R-6 | S02 | **재방문** 참가자 → opening 1회 |
| R-7 | S02 | problem 3개 중 **1개만** rating → 총점 미확정 |
| R-8 | S02 | X/Y/Z **거절** → deadlock 없음 |
| R-9 | S03 | **Q7 / Q10 시점** crisis 발언 → pause |
| R-10 | S03 | **factual AT** ("I will lose my job") → working AT → Q2b/Q13 readback |
| R-11 | S03 | evidence 1개, 재요청 후에도 1개 → **수용·진행** |
| R-12 | S03 | Q10a만 답하고 therefore 회피 → Q10b 미진입 |
| R-13 | S03 | Q7 **"해당 없음"** → 정상 진행 |
| R-14 | 전체 | **한국어 로케일** full-session ×3 |

### 8.3 before/after 비교

Phase 0 baseline과 다음 항목을 대조한다.

```
prompt ID · output field · 실제 상담사 문장 · fallback 여부 ·
static message 여부 · state transition · 다음 prompt · locale
```

**의도하지 않은 diff가 하나라도 있으면 보고하라.** deterministic progression이 깨지지 않았는지가 핵심이다.

---

## 9. Git · 푸시 범위

`docs/LOCAL_DEV_SETUP.md` 의 **Part C** 를 그대로 수행하라. 요약:

- 작업 브랜치에서 작업
- **6개 파일만 커밋**된다. 나머지는 `.git/info/exclude` + pre-commit/pre-push 훅으로 차단
- 훅과 로컬 문서는 `.git/` 안이거나 exclude 대상이라 **푸시되지 않는다**
- `.gitignore` 를 수정하지 마라 (7번째 파일이 된다)
- 푸시 전 반드시:

```bash
git diff --name-only "$(git merge-base origin/main HEAD)"...HEAD
```

출력이 **정확히 6줄**이어야 한다. 아니면 멈추고 보고하라.

- 푸시 전 **깨끗한 클론에서 빌드**(LOCAL_DEV_SETUP Part D)를 돌려, 6개 파일만으로 Vercel 빌드가 통과하는지 확인하라. 실패하면 **STOP S-6**.

---

## 10. 완료 보고 형식

```
## 1. Phase 0 조사 결과
   - 실제 경로 6개
   - ID 체계 판정 + 삽입 필요 지점
   - 타입 제약 확인표
   - baseline 저장 위치

## 2. 질문 (STOP 항목)   ← 있으면 여기서 멈추고 답 대기

## 3. 변경 요약
   파일별 · 항목별 (v3 절 번호 명시)

## 4. 검증 결과
   - 타입체크/린트/빌드
   - placeholder 스캔
   - static-message 키 무결성
   - locale 키 parity
   - R-1 ~ R-14 결과표
   - before/after 의도치 않은 diff 목록

## 5. 미해결 / Phase 2 이관
   - worksheet ↔ runtime sync (v3 §2.3)
   - 그 외

## 6. 푸시 대상 파일 목록 (git diff 출력 그대로)
```

---

## 11. 지금 할 일

**Phase 0만 수행하고, §10의 1·2번까지만 보고하라. 코드는 아직 수정하지 마라.**

궁금한 게 생기면 추측하지 말고 물어봐라.