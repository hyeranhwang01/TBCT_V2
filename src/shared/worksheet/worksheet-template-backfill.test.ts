import { describe, expect, it } from "vitest";
import { ensureWorksheetTemplateVersion, listWorksheetFieldDefinitions } from "@/shared/data/repositories/worksheet-repository";

// Regression for a production bug: TEMPLATE_VERSION is a constant that's
// never bumped (see worksheet-projection.ts), and ensureWorksheetTemplateVersion
// used to only ever write field-definition rows the FIRST time a given
// (templateId, version) was created -- a field added to a session's
// WorksheetBinding[] array afterward silently never got a definition row,
// forever, for that template version. This is exactly what happened to S07:
// emotionReasonSpeakers/consensusSurprise/consensusEmotionIntent/
// consensusPartsNeeds were all added to tbct-s07.ts's bindings after real S07
// sessions already existed, so those fields never appeared in
// getWorksheetView's output for any session created before the addition --
// the worksheet panel rendered, just missing content, in the same family of
// bug as the S01 orphaned-field crash (see getWorksheetView's own comment).
describe("ensureWorksheetTemplateVersion field-definition backfill", () => {
  it("adds a definition row for a field appended to the bindings after the template version already exists", async () => {
    const templateId = "worksheet-template-test-backfill";
    const base = {
      templateId,
      sessionDefinitionId: "tbct-s07",
      title: "test backfill",
      version: 1,
      sourceTextHash: "test-hash",
    };

    const first = await ensureWorksheetTemplateVersion({
      ...base,
      fieldDefinitions: [
        { canonicalFieldKey: "a", worksheetFieldKey: "a", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, visualElementId: "box-a", displayOrder: 0 },
      ],
    });
    expect((await listWorksheetFieldDefinitions(first.id)).map((definition) => definition.worksheetFieldKey)).toEqual(["a"]);

    // Same templateId + version (the constant never bumps) -- one new field,
    // simulating a later content change that grew this session's bindings.
    const second = await ensureWorksheetTemplateVersion({
      ...base,
      fieldDefinitions: [
        { canonicalFieldKey: "a", worksheetFieldKey: "a", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, visualElementId: "box-a", displayOrder: 0 },
        { canonicalFieldKey: "b", worksheetFieldKey: "b", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, visualElementId: "box-b", displayOrder: 1 },
      ],
    });

    expect(second.id).toBe(first.id); // still the same version row, not a new one
    const definitions = await listWorksheetFieldDefinitions(second.id);
    expect(definitions.map((definition) => definition.worksheetFieldKey).sort()).toEqual(["a", "b"]);
  });

  it("never duplicates or overwrites an already-defined field's row", async () => {
    const templateId = "worksheet-template-test-backfill-2";
    const base = {
      templateId,
      sessionDefinitionId: "tbct-s07",
      title: "test backfill",
      version: 1,
      sourceTextHash: "test-hash",
      fieldDefinitions: [
        { canonicalFieldKey: "a", worksheetFieldKey: "a", valueType: "text" as const, participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, visualElementId: "box-a", displayOrder: 0 },
      ],
    };
    const first = await ensureWorksheetTemplateVersion(base);
    const second = await ensureWorksheetTemplateVersion(base);
    expect(second.id).toBe(first.id);
    const definitions = await listWorksheetFieldDefinitions(second.id);
    expect(definitions).toHaveLength(1);
  });
});
