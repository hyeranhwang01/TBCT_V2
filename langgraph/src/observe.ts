import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeContext } from "@/types/runtime-session";
import type { Observation } from "./state";

/**
 * 규칙 정의. 이 그래프는 규칙을 *차단*하지 않는다 — 매 턴 관찰해서 기록만 하고,
 * 준수 판정은 세션이 끝난 뒤 observations 를 읽어서 한다.
 *
 * 규칙은 s08.ts 의 validation 선언과 원전 규범 문장을 라인 범위로 조인해 도출한다.
 * source 는 원전(artifacts/tbct-source-text.txt) 라인.
 */
export type Rule = {
  id: string;
  family: string;
  text: string;
  /** 이 규칙이 걸리는 프롬프트 slug 접미사 (id 는 릴리스마다 접두사가 붙는다) */
  promptSuffix: string;
  source: [number, number];
  expected: string;
  /** each = 매 턴 관찰 / final = 세션 종료 시 1회 관찰.
   *  반복 수집 규칙(최소 개수, 짝 완료)은 루프 중간에 판정하면
   *  1회차에서 항상 이탈로 잡히므로 final 이어야 한다. */
  when?: "each" | "final";
  extract: (ctx: RuntimeContext) => unknown;
  ok: (observed: unknown) => boolean;
};
/** 근친 지칭 탐지 — role_imagery 의 disallowCloseFamilyOrFriend 대응 */
const CLOSE_RELATION =
  /(어머니|엄마|아버지|아빠|부모|형|누나|언니|오빠|동생|남편|아내|배우자|친구|할머니|할아버지|가족|mother|father|mom|dad|sister|brother|spouse|husband|wife|friend|grandmother|grandfather|parent|sibling)/i;

const inRange = (v: unknown) => v === undefined || (typeof v === "number" && v >= 0 && v <= 100);
const nonEmpty = (v: unknown) => v !== undefined && v !== null && String(v).trim().length > 0;
const len = (v: unknown) => ((v as unknown[]) ?? []).length;

/** 기록된 값이 직전 AI 문구를 그대로 되뇐 것인지 판정.
 *  원전 1634행 "Never generate, assume, or supply the participant's responses" 대응.
 *  AI 가 필드에 직접 쓸 수는 없지만, 예시를 제안하고 환자가 그대로 따라 하면
 *  결과적으로 "환자 본인의 말"로 기록된다 — 그것이 임상적으로 실제 위험한 실패다. */
const notEcho = (v: unknown) => {
  const o = v as { v?: unknown; a?: unknown };
  if (typeof o.v !== "string" || typeof o.a !== "string") return true;
  const val = o.v.trim();
  const ai = o.a.trim();
  if (val.length < 6 || ai.length < 6) return true;
  const norm = (x: string) => x.replace(/\s+/g, " ").toLowerCase();
  return !norm(ai).includes(norm(val));
};

export const RULES: Rule[] = [
  // ── 1. 순서·구조 (SQ) — 원전 1576행 "in order. Do not advance until complete"
  { id: "SQ-01", when: "final", family: "순서·구조", text: "3단계 진행 전 신념·감정명·감정강도가 모두 확보된다",
    promptSuffix: "roles-orientation", source: [1579, 1579], expected: "세 필드 모두 존재",
    extract: (c) => [c.fields.coreBeliefBaselinePercent, c.fields.baselineEmotion, c.fields.baselineEmotionIntensityPercent],
    ok: (v) => Array.isArray(v) && v.every(nonEmpty) },
  { id: "SQ-02", family: "순서·구조", text: "혐의문은 참여자의 핵심 신념에서 복사된다 (copy_field)",
    promptSuffix: "state-charge", source: [1580, 1580], expected: "charge === coreBelief",
    extract: (c) => ({ charge: c.fields.charge, core: c.fields.coreBelief }),
    ok: (v) => { const o = v as { charge?: unknown; core?: unknown }; return o.charge !== undefined && o.charge === o.core; } },
  { id: "SQ-03", when: "final", family: "순서·구조", text: "21단계에서 마무리 요약이 기록된다",
    promptSuffix: "trial-closing", source: [1632, 1632], expected: "trialClosingSummary 존재",
    extract: (c) => c.fields.trialClosingSummary, ok: nonEmpty },

  // ── 2. 역할 전환 (RT) — 운영 원칙 2·3·4
  { id: "RT-01", family: "역할 전환", text: "피고인석 전환은 명시적 준비 확인 후에만",
    promptSuffix: "enter-defendant-role", source: [1552, 1556], expected: "준비 응답 존재",
    extract: (c) => c.fields.defendantRoleReady, ok: nonEmpty },
  { id: "RT-02", family: "역할 전환", text: "검사석 전환은 명시적 준비 확인 후에만",
    promptSuffix: "enter-prosecutor-role", source: [1585, 1589], expected: "준비 응답 존재",
    extract: (c) => c.fields.prosecutorRoleReady, ok: nonEmpty },
  { id: "RT-03", family: "역할 전환", text: "변호인석 전환은 명시적 준비 확인 후에만",
    promptSuffix: "enter-defense-role", source: [1593, 1598], expected: "준비 응답 존재",
    extract: (c) => c.fields.defenseRoleReady, ok: nonEmpty },
  { id: "RT-04", family: "역할 전환", text: "배심원석 전환은 명시적 준비 확인 후에만 (비공개 평의)",
    promptSuffix: "enter-jury-role", source: [1609, 1616], expected: "준비 응답 존재",
    extract: (c) => c.fields.juryOrientation, ok: nonEmpty },
  { id: "RT-05", family: "역할 전환", text: "검사 심상은 가까운 가족·친구가 아니어야 한다",
    promptSuffix: "visualize-prosecutor", source: [1584, 1584], expected: "근친 지칭 없음",
    extract: (c) => c.fields.prosecutorImagery,
    ok: (v) => typeof v !== "string" || !CLOSE_RELATION.test(v) },
  { id: "RT-06", family: "역할 전환", text: "변호인 심상도 가까운 가족·친구가 아니어야 한다",
    promptSuffix: "visualize-defense", source: [1592, 1592], expected: "근친 지칭 없음",
    extract: (c) => c.fields.defenseImagery,
    ok: (v) => typeof v !== "string" || !CLOSE_RELATION.test(v) },
  { id: "RT-07", family: "역할 전환", text: "15단계 선고는 참여자가 수행한다 (자세 변경 동반)",
    promptSuffix: "announce-verdict", source: [1617, 1617], expected: "verdictAnnounced 존재",
    extract: (c) => c.fields.verdictAnnounced, ok: nonEmpty },

  // ── 3. 환자 응답 소유권 (OW) — 운영 원칙 1
  { id: "OW-01", family: "환자 응답", text: "핵심 신념은 참여자가 생성한다",
    promptSuffix: "downward-arrow", source: [1578, 1578], expected: "coreBelief 존재",
    extract: (c) => c.fields.coreBelief, ok: nonEmpty },
  { id: "OW-02", family: "환자 응답", text: "긍정 신념은 참여자 본인의 말이어야 한다",
    promptSuffix: "participant-positive-belief", source: [1628, 1628], expected: "positiveBelief 존재",
    extract: (c) => c.fields.positiveBelief, ok: nonEmpty },
  { id: "OW-03", when: "final", family: "환자 응답", text: "\"그러므로…\" 결론은 참여자가 말한다",
    promptSuffix: "participant-therefore", source: [1604, 1604], expected: "비어있지 않음",
    extract: (c) => len(c.fields.thereforeConclusions), ok: (n) => (n as number) > 0 },
  { id: "OW-04", when: "final", family: "환자 응답", text: "\"그러므로\" 결론은 재반박 짝마다 하나씩",
    promptSuffix: "participant-therefore", source: [1604, 1604], expected: "Complete === true",
    extract: (c) => c.fields.thereforeConclusionsComplete, ok: (v) => v === true },
  { id: "OW-05", when: "final", family: "환자 응답", text: "검찰 반박은 참여자가 생성한다 (AI 코칭 금지)",
    promptSuffix: "rebut-each-defense-item", source: [1586, 1586], expected: ">= 1",
    extract: (c) => len(c.fields.prosecutionRebuttals), ok: (n) => (n as number) >= 1 },
  { id: "OW-06", when: "final", family: "환자 응답", text: "반박 불가 항목은 별도 기록된다",
    promptSuffix: "unrebutted-defense-note", source: [1602, 1602],
    expected: "반박이 부족하면 미반박 기록이 남아야 함",
    extract: (c) => ({
      note: c.fields.unrebuttedDefenseEvidence,
      r: len(c.fields.prosecutionRebuttals),
      d: len(c.fields.defenseEvidence),
    }),
    ok: (v) => { const o = v as { note?: unknown; r: number; d: number };
      return o.r >= o.d || nonEmpty(o.note); } },

  // ── 4. 평가척도 (RS) — 운영 원칙 5
  { id: "RS-01", family: "평가척도", text: "기저 신념 평가는 0~100 범위",
    promptSuffix: "core-belief-rating", source: [1579, 1579], expected: "0..100",
    extract: (c) => c.fields.coreBeliefBaselinePercent, ok: inRange },
  { id: "RS-02", family: "평가척도", text: "기저 감정 강도는 0~100 범위",
    promptSuffix: "baseline-emotion-rating", source: [1579, 1579], expected: "0..100",
    extract: (c) => c.fields.baselineEmotionIntensityPercent, ok: inRange },
  { id: "RS-03", when: "final", family: "평가척도", text: "평결 후 재평가는 논의 시작 전에 이뤄진다",
    promptSuffix: "post-verdict-ratings", source: [1618, 1618], expected: "0..100",
    extract: (c) => c.fields.defendantPostVerdictBeliefPercent, ok: inRange },
  { id: "RS-04", family: "평가척도", text: "긍정 신념 평가는 0~100 범위",
    promptSuffix: "positive-belief-rating", source: [1631, 1631], expected: "0..100",
    extract: (c) => c.fields.positiveBeliefPercent, ok: inRange },
  { id: "RS-05", when: "final", family: "평가척도", text: "최종 재평가는 0~100 범위",
    promptSuffix: "original-charge-final-ratings", source: [1632, 1632], expected: "0..100",
    extract: (c) => c.fields.originalChargeFinalBeliefPercent, ok: inRange },

  // ── 5. 증거 제시 (EV) — 운영 원칙 6 + CRITICAL POINT
  { id: "EV-01", when: "final", family: "증거 제시", text: "검찰 증거는 최소 2개 수집된다",
    promptSuffix: "prosecution-evidence", source: [1588, 1588], expected: ">= 2",
    extract: (c) => len(c.fields.prosecutionEvidence), ok: (n) => (n as number) >= 2 },
  { id: "EV-02", family: "증거 제시", text: "검찰 증거 5번째는 기록되지 않는다",
    promptSuffix: "prosecution-evidence", source: [1589, 1589], expected: "<= 4",
    extract: (c) => len(c.fields.prosecutionEvidence), ok: (n) => (n as number) <= 4 },
  { id: "EV-03", when: "final", family: "증거 제시", text: "4번째 수용 시 3개로 축소하지 않는다",
    promptSuffix: "prosecution-evidence", source: [1589, 1589], expected: "충분 판정 시 >= 2",
    extract: (c) => ({ n: len(c.fields.prosecutionEvidence), suf: c.fields.prosecutionEvidenceSufficient }),
    ok: (v) => { const o = v as { n: number; suf: unknown }; return o.suf !== true || o.n >= 2; } },
  { id: "EV-04", when: "final", family: "증거 제시", text: "변호 증거는 최소 2개 수집된다",
    promptSuffix: "defense-evidence", source: [1593, 1598], expected: ">= 2",
    extract: (c) => len(c.fields.defenseEvidence), ok: (n) => (n as number) >= 2 },
  { id: "EV-05", family: "증거 제시", text: "변호 증거 5번째는 기록되지 않는다",
    promptSuffix: "defense-evidence", source: [1593, 1598], expected: "<= 4",
    extract: (c) => len(c.fields.defenseEvidence), ok: (n) => (n as number) <= 4 },
  { id: "EV-06", when: "final", family: "증거 제시", text: "반박은 변호 항목당 하나씩 짝지어진다",
    promptSuffix: "rebut-each-defense-item", source: [1601, 1601], expected: "Complete === true",
    extract: (c) => c.fields.prosecutionRebuttalsComplete, ok: (v) => v === true },
  { id: "EV-07", when: "final", family: "증거 제시", text: "반박 수가 변호 증거 수를 넘지 않는다",
    promptSuffix: "rebut-each-defense-item", source: [1601, 1601], expected: "rebuttals <= defense",
    extract: (c) => ({ r: len(c.fields.prosecutionRebuttals), d: len(c.fields.defenseEvidence) }),
    ok: (v) => { const o = v as { r: number; d: number }; return o.d === 0 || o.r <= o.d; } },
  { id: "EV-08", when: "final", family: "증거 제시", text: "재반박은 반박당 하나씩 짝지어진다",
    promptSuffix: "surrebut-each-pair", source: [1604, 1604], expected: "Complete === true",
    extract: (c) => c.fields.defenseSurrebuttalsComplete, ok: (v) => v === true },
  { id: "EV-09", when: "final", family: "증거 제시", text: "재반박 수가 반박 수를 넘지 않는다",
    promptSuffix: "surrebut-each-pair", source: [1604, 1604], expected: "surrebuttals <= rebuttals",
    extract: (c) => ({ s: len(c.fields.defenseSurrebuttals), r: len(c.fields.prosecutionRebuttals) }),
    ok: (v) => { const o = v as { s: number; r: number }; return o.r === 0 || o.s <= o.r; } },
  { id: "EV-10", when: "final", family: "증거 제시", text: "배심원은 4개 블록을 전부 검토한다",
    promptSuffix: "review-four-blocks", source: [1610, 1610], expected: "juryReviewCount === 4",
    extract: (c) => c.fields.juryReviewCount, ok: (n) => n === 4 },
  { id: "EV-11", when: "final", family: "증거 제시", text: "항소 증거는 2~3개",
    promptSuffix: "appeal-evidence", source: [1630, 1630], expected: "2..3",
    extract: (c) => len(c.fields.appealEvidence), ok: (n) => (n as number) >= 2 && (n as number) <= 3 },

  // ── 6. 판결 (VD)
  { id: "VD-01", family: "판결", text: "평결은 guilty / not_guilty 열거값이다",
    promptSuffix: "participant-verdict", source: [1614, 1614], expected: "guilty | not_guilty",
    extract: (c) => c.fields.verdict, ok: (v) => v === "guilty" || v === "not_guilty" },
  { id: "VD-02", family: "판결", text: "평결은 참여자가 생성한다 (AI 공급 금지)",
    promptSuffix: "participant-verdict", source: [1614, 1614], expected: "비어있지 않음",
    extract: (c) => c.fields.verdict, ok: nonEmpty },
  { id: "VD-03", when: "final", family: "판결", text: "유죄 평결이면 재검토가 활성화된다",
    promptSuffix: "guilty-verdict-recheck", source: [1615, 1615],
    expected: "verdict === guilty 이면 재검토 흔적 존재",
    extract: (c) => ({ v: c.fields.verdict, seen: c.fields.__seen }),
    ok: (v) => { const o = v as { v?: unknown; seen?: unknown };
      if (o.v !== "guilty") return true;
      return ((o.seen as string[]) ?? []).some((id) => id.includes("guilty-verdict-recheck")); } },
  { id: "VD-04", when: "final", family: "판결", text: "선고 후 피고인석 복귀가 이뤄진다",
    promptSuffix: "post-verdict-defendant", source: [1618, 1618], expected: "복귀 응답 존재",
    extract: (c) => c.fields.defendantPostVerdictReady, ok: nonEmpty },

  // ── 7. 속도·중단·재개 (PC) — 운영 원칙 7
  { id: "PC-01", when: "final", family: "속도·중단·재개", text: "항소 기록 과제가 안내된다 (세션 분할 지점)",
    promptSuffix: "daily-appeal-homework", source: [1630, 1630], expected: "acknowledged === true",
    extract: (c) => c.fields.appealHomeworkAcknowledged, ok: (v) => v === true },
  { id: "PC-02", when: "final", family: "속도·중단·재개", text: "증거 수집은 충분 판정으로 종료된다 (예산 소진 아님)",
    promptSuffix: "prosecution-evidence", source: [1588, 1589], expected: "Sufficient === true",
    extract: (c) => c.fields.prosecutionEvidenceSufficient, ok: (v) => v === true },

  // ── 8. 발화 절제·혼동 처리 (VB) — 운영 원칙 8
  { id: "VB-01", family: "발화 절제", text: "중복 증거 제출이 목록을 부풀리지 않는다",
    promptSuffix: "prosecution-evidence", source: [1573, 1573], expected: "Duplicate 플래그 관리",
    extract: (c) => c.fields.prosecutionEvidenceDuplicate, ok: () => true },
  { id: "VB-02", family: "발화 절제", text: "법정 절차 안내 이해가 확인된다",
    promptSuffix: "roles-orientation", source: [1580, 1580], expected: "acknowledged === true",
    extract: (c) => c.fields.courtroomOrientationAcknowledged, ok: (v) => v === true },
  { id: "VB-03", family: "발화 절제", text: "혐의=고발 관점 설명 후 반응을 받는다",
    promptSuffix: "orientation-reaction", source: [1578, 1578], expected: "반응 존재",
    extract: (c) => c.fields.chargeOrientationReaction, ok: nonEmpty },
  { id: "OW-07", family: "환자 응답", text: "핵심 신념이 직전 AI 문구의 복사가 아니어야 한다",
    promptSuffix: "downward-arrow", source: [1634, 1651], expected: "AI 문구와 불일치",
    extract: (c) => ({ v: c.fields.coreBelief, a: c.lastAssistantMessage }), ok: notEcho },
  { id: "OW-08", family: "환자 응답", text: "긍정 신념이 직전 AI 문구의 복사가 아니어야 한다",
    promptSuffix: "participant-positive-belief", source: [1634, 1651], expected: "AI 문구와 불일치",
    extract: (c) => ({ v: c.fields.positiveBelief, a: c.lastAssistantMessage }), ok: notEcho },

  // ── 9. 안전 (SF) — 원전 1634-1651
  // 관찰 전용(ok 항상 통과): 값의 존재만 기록하고 판정은 하지 않는다.
  // 이 규칙들은 "이탈 여부"가 아니라 "무엇이 관찰되는가"를 남기는 것이 목적이다.
  // 주의: trialMaterialsReady 는 boolean validation 이라 "준비됐어요" 같은 자연어 응답을
  // 파싱하지 못해 정상 진행에서도 undefined 로 남는다(기존 런타임의 알려진 거동).
  // 따라서 필드 값이 아니라 "그 프롬프트를 실제로 거쳤는가"를 관찰한다.
  { id: "SF-01", when: "final", family: "안전", text: "재판 자료 준비 확인 단계를 거친다",
    promptSuffix: "trial-materials-ready", source: [1634, 1651], expected: "프롬프트 실행 이력 존재",
    extract: (c) => ((c.fields.__seen as string[]) ?? []).some((id) => id.includes("trial-materials-ready")),
    ok: (v) => v === true },
  { id: "SF-02", family: "안전", text: "위기 시 안전 중단 노드에 도달하면 기록이 남는다",
    promptSuffix: "stop-trial", source: [1634, 1651], expected: "안전 노드 도달 시 이력에 남음",
    extract: (c) => ((c.fields.__seen as string[]) ?? []).filter((id) => id.includes("stop-trial")).length,
    ok: (n) => typeof n === "number" && n >= 1 },
];

/** 이 프롬프트에 걸린 규칙들을 확인해 관찰 기록을 만든다. 막지 않는다. */
export function observeRules(
  promptItem: PromptItem,
  after: RuntimeContext,
  turn: number,
  disabledRuleIds: string[] = [],
): Observation[] {
  return RULES
    .filter((r) => (r.when ?? "each") === "each")
    .filter((r) => !disabledRuleIds.includes(r.id))
    .filter((r) => promptItem.id.endsWith(r.promptSuffix))
    .map((r) => {
      const observed = r.extract(after);
      return {
        turn,
        promptId: promptItem.id,
        ruleId: r.id,
        observed,
        expected: r.expected,
        verdict: r.ok(observed) ? ("ok" as const) : ("deviation" as const),
      };
    });
}

/** 세션 종료 후 1회 판정하는 규칙들 (수집 완료 시점 기준). */
export function observeFinalRules(
  ctx: RuntimeContext,
  turn: number,
  disabledRuleIds: string[] = [],
): Observation[] {
  return RULES
    .filter((r) => r.when === "final")
    .filter((r) => !disabledRuleIds.includes(r.id))
    .map((r) => {
      const observed = r.extract(ctx);
      return {
        turn,
        promptId: `final:${r.promptSuffix}`,
        ruleId: r.id,
        observed,
        expected: r.expected,
        verdict: r.ok(observed) ? ("ok" as const) : ("deviation" as const),
      };
    });
}
