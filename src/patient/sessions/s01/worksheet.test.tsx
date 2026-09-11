import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { S01Worksheet } from "@/patient/sessions/s01/worksheet";
import { TBCT_S01_BINDINGS } from "@/patient/sessions/s01/worksheet-binding";
import { S01_COGNITIVE_DISTORTIONS } from "@/patient/sessions/s01/cognitive-distortions";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";
import { PATIENT_COMPOSED_WORKSHEET_SESSIONS } from "@/shared/worksheet/composed-worksheet-registry";
import type { WorksheetBinding, WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// The S01 worksheets beside the chat (.claude/TASK_SCOPE.json
// note2026_09_12_s01_redesign): the participant's own cognitive model, the
// three-person example, and the distortion list, filled from session fields.

// Written by s01/turn-rules.ts, never by the participant.
const SYSTEM_FIELDS = ["threePersonScene", "candidateTwoEmotion", "candidateThreeEmotion"];

function field(binding: WorksheetBinding, value: unknown): WorksheetFieldView {
  return {
    definition: {
      id: `def-${binding.worksheetFieldKey}`,
      templateVersionId: "t",
      canonicalFieldKey: binding.canonicalFieldKey,
      worksheetFieldKey: binding.worksheetFieldKey,
      valueType: binding.valueType,
      participantOwned: binding.participantOwned,
      assistantMustNotSupply: binding.assistantMustNotSupply,
      confirmationRequired: binding.confirmationRequired,
      visualElementId: binding.visualElementId,
      displayOrder: binding.displayOrder,
    },
    binding,
    value: {
      id: `v-${binding.worksheetFieldKey}`,
      instanceId: "i",
      fieldDefinitionId: `def-${binding.worksheetFieldKey}`,
      status: "draft_extracted",
      provenance: binding.participantOwned ? "participant_verbatim" : "system_calculated",
      value,
      displayValue: Array.isArray(value) ? value.join(", ") : String(value),
      updatedAt: "2026-09-12T00:00:00.000Z",
    },
  };
}

function view(values: Record<string, unknown>): WorksheetView {
  return {
    instance: { id: "i", runtimeSessionId: "r", templateVersionId: "t", status: "in_progress", createdAt: "", updatedAt: "" },
    templateVersion: { id: "t", templateId: "t", version: 1, sourceTextHash: "h", status: "published", createdAt: "" },
    fields: Object.entries(values).map(([key, value]) => field(TBCT_S01_BINDINGS.find((binding) => binding.worksheetFieldKey === key)!, value)),
  };
}

const OWN_CASE = {
  s01Problems: ["불안이 심해요", "계획대로 안 되면 힘들어요"],
  situationThoughtDistinction: "팀 회의에서 팀원이 제 의견에 반대하면서 다른 방향으로 가자고 했어요",
  situationLine: "팀원이 회의에서 내 의견에 반대했을 때",
  personalEmotion: "배신감",
  personalEmotionIntensity: 50,
  openingInitialThought: "나를 무시하는 거야",
  s01ThoughtBeliefPercent: 75,
  personalBehavior: "혼자 울었어요",
  cycleReinforcedThought: "역시 나는 무시당하는 사람이야",
  threePersonScene: "상담자가 처음 만난 세 사람에게 헤어질 때 똑같이 말합니다.",
  candidateTwoEmotion: "의심",
  candidateThreeEmotion: "화",
  candidateTwoThought: "빈말이겠지",
};

const noop = () => undefined;

describe("S01 worksheet bindings", () => {
  const s01OutputFields = new Set(CANONICAL_PROMPT_ITEMS.filter((item) => item.id.startsWith("tbct-s01-")).flatMap((item) => item.outputFields));

  it("binds only real S01 prompt output fields, plus the fields the session writes itself", () => {
    const unknown = TBCT_S01_BINDINGS.map((binding) => binding.canonicalFieldKey).filter((key) => !s01OutputFields.has(key) && !SYSTEM_FIELDS.includes(key));
    expect(unknown).toEqual([]);
  });

  it("marks exactly the system-written fields as not participant-owned", () => {
    const systemOwned = TBCT_S01_BINDINGS.filter((binding) => !binding.participantOwned).map((binding) => binding.canonicalFieldKey).sort();
    expect(systemOwned).toEqual([...SYSTEM_FIELDS].sort());
    for (const binding of TBCT_S01_BINDINGS.filter((item) => item.participantOwned)) expect(binding.assistantMustNotSupply).toBe(true);
  });

  it("keeps the type of every key that existed before the redesign", () => {
    // A stored field definition's type is never updated in place.
    const before: Record<string, string> = {
      situationThoughtDistinction: "text", openingInitialThought: "text", threePersonModelInsight: "long_text", personalEmotion: "text",
      personalBehavior: "text", personalBodySensations: "text", participantSummary: "long_text", participantSelectedDistortions: "text_list", s01Problems: "text_list",
    };
    for (const [key, valueType] of Object.entries(before)) expect(TBCT_S01_BINDINGS.find((binding) => binding.canonicalFieldKey === key)?.valueType).toBe(valueType);
    expect(new Set(TBCT_S01_BINDINGS.map((binding) => binding.displayOrder)).size).toBe(TBCT_S01_BINDINGS.length);
  });

  it("is the only session whose worksheet the participant sees", () => {
    expect([...PATIENT_COMPOSED_WORKSHEET_SESSIONS]).toEqual(["tbct-s01"]);
  });
});

describe("S01Worksheet (participant, read-only)", () => {
  it("shows the participant's own words in Korean, with gauges and the given feelings", () => {
    render(<S01Worksheet view={view(OWN_CASE)} activeCanonicalFieldKey="cycleSafetyStrategy" onConfirm={noop} onEdit={noop} busy={false} locale="ko-KR" readOnly />);
    expect(screen.getByText("나의 인지 모델 (Level 1)")).toBeInTheDocument();
    expect(screen.getByText("팀원이 회의에서 내 의견에 반대했을 때")).toBeInTheDocument();
    expect(screen.getByText(/처음 하신 말: 팀 회의에서/)).toBeInTheDocument();
    expect(screen.getByText("나를 무시하는 거야")).toBeInTheDocument();
    expect(screen.getByText("믿는 정도 75%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("역시 나는 무시당하는 사람이야")).toBeInTheDocument();
    expect(screen.getByText("빈말이겠지")).toBeInTheDocument();
    expect(screen.getAllByText("주어진 감정")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("칸별 확인 · 수정")).toBeNull();
  });

  it("renders an empty worksheet with placeholders", () => {
    render(<S01Worksheet view={view({})} onConfirm={noop} onEdit={noop} busy={false} locale="ko-KR" readOnly />);
    expect(screen.getAllByText("대화하면서 채워져요").length).toBeGreaterThan(10);
    expect(screen.queryByTestId("s01-distortion-list")).toBeNull();
  });

  it("shows the 15-distortion list from the distortions step on", () => {
    const { rerender } = render(<S01Worksheet view={view(OWN_CASE)} activeCanonicalFieldKey="cycleSafetyStrategy" onConfirm={noop} onEdit={noop} busy={false} locale="ko-KR" readOnly />);
    expect(screen.queryByTestId("s01-distortion-list")).toBeNull();
    rerender(<S01Worksheet view={view(OWN_CASE)} activeCanonicalFieldKey="distortionListRead" onConfirm={noop} onEdit={noop} busy={false} locale="ko-KR" readOnly />);
    const list = screen.getByTestId("s01-distortion-list");
    expect(list.querySelectorAll("li")).toHaveLength(15);
    expect(list.textContent).toContain(S01_COGNITIVE_DISTORTIONS[0].nameKo);
  });
});

describe("S01Worksheet (clinician)", () => {
  it("keeps a review/edit list for participant-owned fields only, in English", () => {
    render(<S01Worksheet view={view(OWN_CASE)} onConfirm={noop} onEdit={noop} busy={false} />);
    expect(screen.getByText("My cognitive model (Level 1)")).toBeInTheDocument();
    expect(screen.getByText("Review / edit each field")).toBeInTheDocument();
    expect(screen.getByText("Person 2 · Thought")).toBeInTheDocument();
    expect(screen.queryByText("The scene (same for all three)")).toBeNull();
    expect(screen.queryByText("Person 2 · Feeling")).toBeNull();
  });
});
