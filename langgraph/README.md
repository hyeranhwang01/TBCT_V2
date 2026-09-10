# LangGraph Traceability Port — TBCT Trial One (S08)

**목적**: 21단계 프로토콜 진행을 명시적 그래프(노드·엣지·체크포인트)로 구조화해
매 턴을 추적 가능하게 만들고, 그 기록으로 핵심 임상 규칙의 준수를 검증한다.

**LangGraph는 새로운 차단 장치가 아니다.** 진행을 추적 가능한 구조로 만드는 것이 목적이며,
규칙 판정은 기록된 관찰(`observations`)을 사후에 읽어서 한다.

## 원칙

1. **재구현 금지** — 파싱·승인문구·조건평가·엣지선택·출력검증은 기존 `src/shared/runtime/*` 함수를 호출한다.
2. **프로덕션 무변경** — 이 폴더 + devDependency + vitest include + `export` 한 단어가 전부.
3. **리듀서는 throw 하지 않는다** — LangGraph는 대기 쓰기를 먼저 영속화하므로,
   throw 하면 해당 `thread_id`가 재개 불가가 된다.
4. **라우터는 순수 동기 함수** — `(state) => string`. async·Date·Math.random 금지.
5. **`pathMap` 항상 명시** — 생략하면 컴파일 시점 도달불가 검사가 무력화된다.

## 파일

| 파일 | 역할 |
|---|---|
| `src/state.ts`    | Annotation.Root 채널 정의 |
| `src/effects.ts`  | completionEffect 어댑터 |
| `src/routers.ts`  | 라우터 생성기 (serial / repeat_until / activation / safety) |
| `src/nodes.ts`    | deliver / collect 생성기 |
| `src/observe.ts`  | 규칙 관찰 기록 |
| `src/compile.ts`  | compileTrialGraph(catalog, release, opts) |
| `src/phrase.ts`   | 문구 생성 (mock 기본, 실 Claude는 옵션) |
| `verify/`         | 규칙 카탈로그 + 검사기 + 시나리오 |

## 실행

```bash
npm test -- langgraph      # 전부 오프라인, 외부 API 0건
```
