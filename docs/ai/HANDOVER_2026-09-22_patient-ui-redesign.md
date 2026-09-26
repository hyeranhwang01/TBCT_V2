# Patient UI/UX 전면 개편 — 인계 문서 (2026-09-22)

이 문서는 Claude(Cowork 채팅)에서 진행한 준비 작업을 Claude Code로 넘기기 위한
요약이다. 전체 히스토리/근거는 claude.ai의 "TBCT" 프로젝트 문서
`TBCT_PATIENT_UI_OVERHAUL_PREP_2026-09-22.md`,
`TBCT_PATIENT_UI_REDESIGN_MAP_2026-09-22.md`, 이 대화 세션 자체에 더 있음 —
이 파일은 로컬 저장소에서 바로 참고할 수 있도록 핵심만 옮겨 적은 것.

## 1. 지금 하는 작업

동후님이 TBCT Patient UI/UX(시각 디자인) 전면 개편을 전담. 목표는 "예전 팀장이
대충 만들어놓은 걸 갈아엎어서 기깔나는 서비스로." 기능/백엔드는 원리원칙 구현이
1순위, UI는 2순위 — **API·DB 스키마·세션 전환 로직·safety 로직은 건드리지
않고 시각/레이아웃/인터랙션만 개편**하는 범위.

## 2. 참고 피드백 (팀에서 온 것, 참고용이지 강제 요구사항 아님)

1. 현재 UI가 문진표 느낌, 정보 수집형 문답 반복 → 개선 필요
2. 심플하되 20~60대 모두 직관적으로 사용 가능한 디자인 권고
3. 세션 목적을 초기 화면에서 명확히 시각화 (예: 트랙 방식)
4. 챗봇 대화만이 아닌 동영상 강의 등 매체 다양성 고려 필요
5. 단순 대화성보다 '아하!' 인사이트 순간을 만드는 설계가 중요
6. UI 개선은 원리 원칙 구현 이후 2순위로 진행

## 3. 현재 문제점 (코드 기준)

- **세션 진행 화면**(`src/patient/sessions/s0N/spec.ts`): `requiredFields`가
  순차 나열된 구조라 대화가 곧 설문지 리듬으로 느껴짐 (피드백①)
- **프로필 화면**: 체크박스/토글 나열형 폼 (피드백①)
- **홈 화면**(`patient-list-page.tsx`): 세션을 그냥 카드로만 나열, 여정을
  시각화하는 트랙/맵 요소 없음 (피드백③) — 참고: 로컬 미병합 브랜치
  `donghoo/ui-renewal`의 커밋 `fc80c51`("환자 8회기 여정 표시")가 이 문제를
  겨냥해 시도한 흔적 있음, 재활용 여부는 동후님 판단
- **매체 다양성 없음**: STT/TTS만 있고 영상/오디오 콘텐츠 타입 자체가 코드에 없음 (피드백④)
- **진행률/인사이트**: `getPatientProgressSeries`(믿음강도%, 감정강도% 등
  세션 전후 변화)가 이미 계산되고 있는데, 이걸 극적으로 보여주는 연출은
  없어 보임 — 데이터는 있으니 표현 방식만 새로 디자인하면 되는 영역 (피드백⑤)
- **디자인 토큰**: `clinical-blue` 등 임상적 톤 위주 (피드백②)

## 4. 개선 방향 우선순위

| 우선순위 | 영역 | 방향 |
|---|---|---|
| 1 | 홈 화면 | 트랙/경로형 여정 시각화 (Duolingo 학습경로 패턴 참고) |
| 1 | 세션 완료 화면 | before/after 수치를 극적으로 시각화하는 "아하 모먼트" 연출 |
| 2 | 세션 진행 화면 | 한 번에 하나의 질문만, 이모지/버튼형 응답 확대 (구조는 유지) |
| 2 | 디자인 시스템 | 탈포화 블루/세이지그린, 둥근 산세리프, 큰 폰트, 넉넉한 여백 |
| 3 | 프로필/설정 | 카드형/토글형으로 재구성 |
| 3 | 매체 다양성 | 세션 도입부 영상/오디오 — **범위가 UI를 넘어설 수 있어 착수 전 확인 필요** |

레퍼런스 조사 원문 출처와 상세 근거는 claude.ai TBCT 프로젝트의
`TBCT_PATIENT_UI_REDESIGN_MAP_2026-09-22.md` 참고.

## 5. 로컬 환경 — 중요

- `.env.local`엔 `DATABASE_URL`만 있음, Supabase/Anthropic 키 없음 → 평소
  `npm run dev`로는 로그인 자체가 안 됨.
- **dev-mock 시스템**: `NEXT_PUBLIC_TBCT_PATIENT_MOCK=1 npm run dev`로 실행하면
  자격증명 없이 가짜 patient 유저로 즉시 로그인돼서 `/patient`,
  `/patient/homework`, `/patient/history`, `/patient/profile`을 실데이터처럼
  채워진 상태로 볼 수 있음. 구현: `src/shared/mocks/patient-dev-mock.ts`
  (fetch 레벨 offline fake-store + 시드), `src/shared/auth/auth-context.tsx`
  (mock 유저), `src/patient/pages/patient-profile-page.tsx`(MFA 위젯 숨김).
  기본 꺼짐, 프로덕션 빌드에서는 절대 안 켜짐.
- `node_modules`가 한 번 손상된 적 있었음(Cowork 원격 브리지 문제였음,
  Claude Code에서는 해당 없어야 함) — 이상한 `Module not found`가 나오면
  `rm -rf node_modules && npm install`부터 의심.
- baseline: `npm test` → 93 files / 1038 tests 통과, `npm run type-check` → 0 에러.

## 6. 브랜치/커밋 상태

```
worktree: /Users/donghoo/오하영 LAB/TBCT/TBCT_V2_main
branch:   donghoo/patient-ui-overhaul (origin/main 기준)
```
아직 push 안 함 — **동후님이 명시적으로 지시할 때만 push.** 로컬 커밋 2개:
숙제 회차 라벨링(display-only), dev-mock 데이터 추가.

## 7. 열려있는 질문

- `donghoo/ui-renewal`의 미병합 커밋(`fc80c51`) 재활용 여부
- 매체 다양성(영상/오디오) 착수 범위 — 순수 UI 담당 범위를 넘어설 수 있음

## 8. 작업 원칙

큰 변경 전: 구조 파악 → 요구사항 확인 → 영향 범위 확인 → 구현 → 테스트/타입체크
검증. 화면에 안 보인다고 기능이 없는 게 아님 — Feature Preservation Map과
대조할 것(claude.ai TBCT 프로젝트, `TBCT_PATIENT_UI_OVERHAUL_PREP_2026-09-22.md`
§E). 필요 이상의 대규모 refactor/삭제는 명시적 요청 없이 하지 않음.
