# TBCT 회기 구성 — 자료별 대조표

작성 2026-09-21. 자료를 직접 열어 대조한 결과이며, 추정과 확인된 사실을 구분해 표기했다.
회기 수가 자료마다 다르다는 문제를 정리하기 위해 만들었다.

## 0. 대조한 자료

| 약칭 | 파일 | 연도 | 회기 수 | 성격 |
|---|---|---|---|---|
| **원서** | `TBCT_자료/#1888(locked)Trial-Based Cognitive Therapy_9781138801448_text (1).pdf`<br>Oliveira, *TBCT: A Manual for Clinicians*, Routledge, 224쪽 | 2015 | **12장 = 12회기** | 원제작자의 임상가용 매뉴얼. 기법의 정본 |
| **프로토콜** | `TBCT_자료/Protocol_V9.pdf` (32쪽) | 2026 | **12회기** (세 팔 모두) | RCT 연구 설계. 회기 수·평가 시점의 정본 |
| **AI 매뉴얼** | `TBCT_자료/AI Prompts for the TBCT techniques to be used in the RCT.docx` | 2025 | **8회기** | AI 구현용 프롬프트. 레포 `artifacts/tbct-source-text.txt`의 원본 |
| **참가자 매뉴얼** | `TBCT_자료/TBCT_Session_01~08_Manual.docx` (8권) | 2025 | **8회기** | 참가자 사전 읽기 자료 |
| **구현** | `src/patient/sessions/s01~s08/` | 2026 | **8회기** | `SESSION_SPECS` (source-fidelity-catalog.ts:364) |
| **실제 상담** | `공동연구/상담/1회기·2회기` 녹취 | 2026.9 | 상담자가 "열두 번" 명시 | 현장 진행 |

**검증**: AI 매뉴얼 S02 구간과 레포 `artifacts/tbct-source-text.txt` 223–429행은 정규화 비교 **차이 0줄**. 구현이 참조하는 원문은 최신이다.

## 1. 회기별 대조 — 원서 12회기 기준

| 원서 장/회기 | 기법 | 프로토콜 | AI 매뉴얼 | 참가자 매뉴얼 | 구현 |
|---|---|---|---|---|---|
| **1** 인지 모델 소개 | CCD phase1 level1 + 인지왜곡 목록(Table 1.1) | 회기별 명시 없음 | **S01** Introduction to the TBCT Model | S01 | ✅ `s01` |
| **2** 인지왜곡 질문지 도입 | **CD-Quest** | 〃 | **❌ 없음** | ❌ | **❌ 없음** |
| **3** 역기능적 자동적 사고 바꾸기 | Intra-TR(T3.1) + Inter-TR(T3.2) | 〃 | **S03** Intra-TR / **S04** Inter-TR<br>*(1장 → 2회기 분할)* | S03 / S04 | ✅ `s03` `s04` |
| **4** underlying assumption 평가·변화 | circuit 2 + CCSH 카드(F4.3) + CRP(F4.5) + 행동계획(F4.6) | 〃 | **S06** CCSH / **S07** CRP<br>*(1장 → 2회기 분할)* | S06 / S07 | ✅ `s06` `s07` |
| **5** Trial I로 부정 핵심신념 바꾸기 | TBTR (trial I), circuit 3 | 〃 | **S08** Trial One | S08 | ✅ `s08` |
| **6** Trial I 항소 형식 | TBTR appeal | 〃 | ❌ | ❌ | ❌ |
| **7** 두 번째 핵심신념 | TBTR | 〃 | ❌ | ❌ | ❌ |
| **8** 두 번째 신념 항소 형식 | TBTR appeal | 〃 | ❌ | ❌ | ❌ |
| **9** 복수 핵심신념 동시 변화 | TBTR multiple | 〃 | ❌ | ❌ | ❌ |
| **10** 메타인지 자각 | **Trial II** (TBMA) | 〃 | ❌ | ❌ | ❌ |
| **11** 이완 + 돛배 은유 | Relaxation / sailboat | 〃 | ❌ | ❌ | ❌ |
| **12** 참여 평가 | **Trial III** (TBPA) = Participation Grid | 〃 | **S05** Participation Grid<br>*(12장 → 5회기로 앞당김)* | S05 | ✅ `s05` |
| **— 원서에 없음** | **CCPH / CCGH** | 〃 | **S02** Problems and Goals | S02 | ✅ `s02` |

요약: 8회기는 원서 12장을 **1장 유지 · 2장 누락 · 3장 2분할 · 4장 2분할 · 5장 유지 · 6~11장 누락 · 12장을 5번 위치로 이동 · 원서에 없는 CCPH/CCGH를 2번에 신규 추가**한 재편이다.

## 2. 원서 Table C1 — 기법별 회기 배정 (원제작자 명시)

원서 결론부(p172)의 표. 12회기 기준에서 각 기법이 언제 쓰이는지에 대한 권위 있는 근거다.

| 기법 / 양식 | 회기 | 인지 수준 |
|---|---|---|
| TBCT 개념화 도해 (CCD) | **모든 회기** | 1·2·3 |
| **인지왜곡 질문지 (CD-Quest)** | **2회기부터 매 회기** | 1 |
| 개인내적 사고기록 (Intra-TR) | 2 또는 3회기부터 필요에 따라 | 1 |
| 대인관계 사고기록 (Inter-TR) | 2 또는 3회기부터 필요에 따라 | 1 |
| 색상별 증상위계 (CCSH) | 3 또는 4회기부터 필요에 따라 | 2 |
| 합의된 역할극 (CRP) | 3 또는 4회기부터 필요에 따라 | 2 |
| 공판 사고기록 (Trial I) — 최초 | 보통 5회기부터 | 3 |
| Trial I — 항소 형식 | 최초 사용 이후 | 3 |
| Trial I — 복수 신념 동시 | 개별 신념 2~3개 재구조화 후 | 3 |
| 메타인지 자각 (Trial II) | 보통 7회기부터 | 3 |
| 참여 평가 (Trial III / TBPA) | **필요할 때 아무 회기** (죄책감·수치심) | 1·2·3 |
| 이완 + 돛배 은유 | 보통 7회기부터 | 1·2·3 |

**이 표에 CCPH/CCGH는 없다.**

원서의 단서: *"Although this manual describes TBCT use in 12 sessions, this description should not be taken literally. On the contrary, one typical session may be repeated once or twice."* — 12회기는 골격이며 반복·조정을 전제한다.

## 2-1. 원서의 회기 골격 — 1회기와 2회기 이후가 다르다

장별 절 제목을 직접 대조한 결과. **1회기에는 `Setting the Agenda`도 `Reviewing Homework`도 없다**
(첫 회기라 리뷰할 과제가 없고, 아젠다 설정 절은 2장부터 시작한다).

**원서 1장 (1회기)**
```
General Introduction to Therapy
Identifying the Problems                        ← 문제 확인
Setting Therapy Goals                           ← 치료 목표 설정
Introducing the Cognitive Model: First Level
Introducing Cognitive Distortions
Designing Homework, Summarizing, and Concluding Session 1
```

**원서 2장 이후 (2~9장 공통)**
```
Bridge from Session N-1
Setting the Agenda                              오늘의 순서
Reviewing Questionnaires and Homework           과제·질문지 리뷰
Working on the Agenda Item                      본 작업 (해당 회기 기법)
Summarizing / Assigning Homework / Concluding   요약 · 과제 부여 · 마무리
```

`Summary and Feedback` 절은 **원서 10장에만 있다** — 치료 전반을 돌아보는 절이며 매 회기 요소가 아니다.

**그러나 실제 상담은 원서보다 한 발 더 간다.** 상담자는 1·2회기 모두에서 원서 1장에 없는 두 가지를 했다:

| 추가 요소 | 1회기 | 2회기 |
|---|---|---|
| 오늘의 순서 안내 + **참가자 동의** | ✅ 01분 "…이렇게 진행이 되려고 합니다. 괜찮으시겠어요?" | ✅ 02–03분 "괜찮으세요? 이렇게 진행하시는 거?" |
| 세션 요약 + **소감** + **상담 피드백 요청** | ✅ 62–63분 "오늘 첫 번째 세션 했는데 어떠셨어요. 피드백을 좀 듣고 싶습니다" / "상담을 더 잘 받기 위해서 어떻게 하면 제가 더 잘 도움을 드릴 수 있을지" | ✅ 52–55분 "오늘 어떠셨어요?" / "부탁하고 싶은 거나 변화시켜야 될 부분들이 좀 있었나요?" |

즉 **이 연구의 실제 운영에서는 소감+피드백 요청이 매 회기 요소다.**

### 구현 대조 (2026-09-21 코드 확인)

| 골격 | 원서 1장 | 원서 2장+ | 실제 1회기 | 실제 2회기 | 구현 `s01` | 구현 `s02` |
|---|---|---|---|---|---|---|
| 오늘의 순서 + 동의 | ❌ | ✅ | ✅ | ✅ | ✅ `mandatory-opening` (today-agenda, 거절 시 pause) | ❌ |
| 과제 리뷰 | ❌ (첫 회기) | ✅ | — | ✅ | — 해당 없음 | ⚠️ S01 회상 한 줄 |
| 본 작업 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **세션 요약 (오늘 한 일)** | ✅ | ✅ | ✅ | ✅ | **❌** | **❌** |
| **소감 + 피드백 요청** | ❌ | ❌ (10장만) | ✅ | ✅ | **❌** | **❌** |
| 과제 부여 | ✅ | ✅ | ✅ | ✅ | ✅ `homework-closing` | ❌ |

`s01`의 `participant-summary` 노드(16/18번)는 세션 요약이 **아니다** — 3인 예시 직후 인지모델 이해를
참가자 말로 확인하는 중간 노드다 (`objective`: "Do not summarize for them").
`s01`의 마무리는 `homework-assignment → homework-commitment → goodbye("Thank you for sharing today. See you next time.")`로 끝난다.

**결론: 세션 요약과 소감·피드백 요청은 s01·s02 공통으로 빠져 있다.** 회기 번호 논쟁과 무관하게 둘 다 보완 대상이다.
s02는 추가로 오늘의 순서+동의, 과제 리뷰, 과제 부여가 없다.

## 2-2. 문제·목표는 원서 1회기에 있다

원서 1장에 `Identifying the Problems`와 `Setting Therapy Goals` 절이 있고,
실제 1회기 04–11분이 이 순서 그대로였다 (어려움 3개 수집 → 각각의 목표 설정 → TBCT·인지왜곡 소개 → 과제).

**따라서 12회기 기준에서 CCPH/CCGH 내용의 자리는 1회기다.** 0~5 색상 평가만 그 단계에 붙이고,
이후 월 1회 재평가 양식으로 운영하는 것이 원서 구조와 맞는다. 2회기 자리는 CD-Quest다.

## 3. CCPH/CCGH가 원서에 없다는 근거

원서 224쪽 전문 검색:

| 검색어 | 출현 |
|---|---|
| CCPH / CCGH | **0** |
| color-coded **problem** / color-coded **goal** | **0** |
| problem hierarchy / goals hierarchy / aspirations | **0** |
| color-coded **symptoms** (= CCSH) | 10 |
| CD-Quest | 52 |
| Intra-TR / Inter-TR | 46 / 19 |
| CCD | 42 |

원서 부록("환자와 함께, 환자가 쓸 빈 양식" 전체 모음)의 구성 — **CCPH/CCGH 카드가 없다**:

Figure A1–A5 CCD 도해 · A6 Intra-TR · A7 Inter-TR · **A8 CCSH 카드** · A9 CRP · A10 행동계획
Table A1 인지왜곡 목록 + **CD-Quest** · A2 Trial I 양식 · A3–A5 항소 준비 양식 · A6 참여 격자표

**범위 한정**: 확인한 것은 2015년 이 책 한 권이다. CCPH/CCGH가 이후 개정판·워크숍 자료·다른 출판물에 도입됐는지는 확인하지 못했다. AI 매뉴얼(© 2025)에 앵커 문구·X/Y/Z 전략·월간 재평가 규칙까지 완성된 형태로 나오는 점을 보면 2015년 이후 원제작자가 추가한 도구로 보이나, **추정이며 원제작자 확인이 필요하다.**

## 4. 8회기 계열은 내부적으로 일관된다

참가자 매뉴얼 8권은 각 권 첫 단락이 직전 회기에서 넘어오는 다리를 놓는다. 8회기는 우연한 절단이 아니라 설계된 서사다.

| 권 | 부제 | 다리 문구 |
|---|---|---|
| S01 | Getting Ready for Your Guided AI Session | — |
| S02 | Your **Second** … | "from your first session to this one" — 한 순간 → 삶의 큰 지도 |
| S03 | Your **Third** … | "from the big picture to a single thought" — 지난번 지도의 문제를 먹이는 생각 하나 |
| S04 | Your **Fourth** … | "from your own mind to the space between two people" |
| S05 | Your **Fifth** … | "from turning thoughts over to setting down a heavy one" — 죄책감 |
| S06 | Your **Sixth** … | "from understanding to doing" — 회피 다루기 |
| S07 | Your **Seventh** … | "from facing situations to deciding to face them" |
| S08 | Your **Eighth** … | "from two sides talking to a full hearing" — 핵심신념 |

## 5. 실제 상담과의 대조

| | 1회기 (2026-09-11, 65분) | 2회기 (2026-09-18, 57분) |
|---|---|---|
| 진행 내용 | 어려움·목표 수집 → TBCT 소개 → 참가자 자기 사례(상황·감정·생각·행동) → 3인 예시 → 인지왜곡 소개 → 과제(15유형 체크리스트) | 지난 회기 리뷰 → 과제 리뷰 → **오늘의 순서 안내+동의** → 인지왜곡 15유형 순회(38분) → **CD-Quest 채점(총 34점)** → 성찰 → 과제 → 피드백 요청 → 다음 예고(핵심신념) |
| 원서 대응 | 1장 (+ 2장 예고) | **2장 (CD-Quest)** |
| AI 매뉴얼 대응 | S01 | **대응 세션 없음** (S02는 CCPH/CCGH) |
| CCPH/CCGH 사용 | ❌ 문제·목표는 대화로만 수집, 0~5 색상 평가 없음 | ❌ 언급 0회 |

어휘 검증 (녹취본 검색):

| 어휘 | 1회기 | 2회기 |
|---|---|---|
| 문제 / 목표 | 34 / 11 | 7 / **0** |
| 점수 | 0 | 13 *(CD-Quest 점수)* |
| 척도 / 색 / 위계 / 총점 | **모두 0** | **모두 0** |
| 왜곡 | 16 | **41** |

상담자는 참가자에게 회기 수를 두 번 명시했다: *"앞으로 한 **열두 번** 정도 상담을 할건데"* (1회기 05분), *"**십이 번** 상담을 받고"* (10분).

## 6. 회기 수 표기가 코드에서 어긋나는 지점

| 위치 | 표기 | 비고 |
|---|---|---|
| `src/shared/i18n/dictionaries/ko.ts:566` | "나의 **8회기** 여정" / "**8회기** 중 {completed}회기 완료" | 참가자에게 노출됨 |
| `src/patient/sessions/s01/task-intents.ts:42-48` | AI는 **회기 수를 말하는 것이 금지** (`OPENING_MUST_NOT`) | "열두 번"·"8회기" 둘 다 위반으로 검출 (`task-intent.test.ts:212-213`). "상담이 끝났을 때"로 우회 |
| 실제 상담자 | "열두 번" | — |

같은 연구 참가자가 arm에 따라 다른 숫자를 듣거나 본다.

## 7. 미해결 — 연구팀 확인 필요

1. **8회기는 누가, 왜 정했나.** 프로토콜 12회기를 AI용으로 축약한 것인지, 프로토콜이 나중에 12로 확정됐는데 AI 매뉴얼이 따라가지 않은 것인지. 후자면 AI 매뉴얼이 낡은 문서다.
2. **CCPH/CCGH가 원서에 없는 신규 도구임을 연구팀이 인지하고 있나.** 원제작자가 AI용으로 추가한 것이라면 의도된 설계이고, 그렇다면 12회기 중 어디에 놓을지도 원제작자에게 물어야 한다.
3. **CD-Quest의 자리.** 원서는 2장(2회기)에 도입하고 이후 매 회기 사용한다. AI 계열에는 아예 없다. 실제 상담 2회기가 이것이었다.
4. **환자 UI "8회기" 표기.** 12회기로 확정되면 즉시 수정 대상.
