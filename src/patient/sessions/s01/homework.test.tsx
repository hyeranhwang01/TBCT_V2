import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider, UI_LOCALE_STORAGE_KEY } from "@/shared/i18n/context";
import { S01_COGNITIVE_DISTORTIONS } from "@/patient/sessions/s01/cognitive-distortions";
import { DISTORTION_EXAMPLE_ENTRY_TYPE, DistortionHomeworkTable, buildDistortionExampleData, toDistortionExamples, type DistortionExample } from "@/patient/sessions/s01/distortion-table";
import { appendHomeworkEntry, ensureHomeworkRecord, listHomeworkEntries } from "@/shared/data/repositories/homework-repository";
import { HOMEWORK_LABEL_BY_SESSION } from "@/types/homework";

// S01 homework: the 15-distortion table with a "내 예시" column
// (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign).

beforeEach(() => globalThis.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "ko"));
afterEach(() => globalThis.localStorage.removeItem(UI_LOCALE_STORAGE_KEY));

function renderTable(entries: DistortionExample[], onAdd = vi.fn()) {
  render(<LocaleProvider><DistortionHomeworkTable entries={entries} onAdd={onAdd} /></LocaleProvider>);
  return onAdd;
}

function rowFor(name: string) {
  return screen.getAllByRole("row").find((row) => within(row).queryByText(name, { exact: false }) && row.textContent?.includes(name))!;
}

describe("S01 homework table", () => {
  it("lists all 15 distortions with a '내 예시' column and files each example under its own distortion", () => {
    const emotional = S01_COGNITIVE_DISTORTIONS.find((item) => item.id === "emotional-reasoning")!;
    renderTable([{ id: "e1", distortionId: emotional.id, date: "2026-09-13", text: "무서우니까 위험한 게 분명해" }]);
    expect(screen.getAllByRole("row")).toHaveLength(16); // header + 15
    expect(screen.getByRole("columnheader", { name: "내 예시" })).toBeInTheDocument();
    expect(within(rowFor(emotional.nameKo)).getByText("무서우니까 위험한 게 분명해")).toBeInTheDocument();
    expect(within(rowFor(S01_COGNITIVE_DISTORTIONS[0].nameKo)).queryByText("무서우니까 위험한 게 분명해")).toBeNull();
  });

  it("saves the participant's own example under the row they chose", async () => {
    const onAdd = renderTable([], vi.fn().mockResolvedValue(undefined));
    const second = S01_COGNITIVE_DISTORTIONS[1];
    const row = rowFor(second.nameKo);
    fireEvent.click(within(row).getByRole("button", { name: "내 예시 적기" }));
    const save = within(row).getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    fireEvent.change(within(row).getByLabelText("내 예시"), { target: { value: "  이번 발표도 망칠 거야  " } });
    fireEvent.click(save);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({ distortionId: second.id, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), text: "이번 발표도 망칠 거야" });
    await waitFor(() => expect(within(row).queryByRole("button", { name: "저장" })).toBeNull());
  });

  it("keeps the draft and says so when saving fails", async () => {
    renderTable([], vi.fn().mockRejectedValue(new Error("offline")));
    const row = rowFor(S01_COGNITIVE_DISTORTIONS[0].nameKo);
    fireEvent.click(within(row).getByRole("button", { name: "내 예시 적기" }));
    fireEvent.change(within(row).getByLabelText("내 예시"), { target: { value: "실수했으니 끝이야" } });
    fireEvent.click(within(row).getByRole("button", { name: "저장" }));
    expect(await within(row).findByRole("alert")).toBeInTheDocument();
    expect(within(row).getByLabelText("내 예시")).toHaveValue("실수했으니 끝이야");
  });
});

describe("S01 homework entries", () => {
  it("stores schema version 2 with the registry number and Korean name", () => {
    const data = buildDistortionExampleData({ distortionId: "emotional-reasoning", date: "2026-09-13", text: "무서우니까 위험해" }, new Date("2026-09-13T01:02:03.000Z"));
    const index = S01_COGNITIVE_DISTORTIONS.findIndex((item) => item.id === "emotional-reasoning");
    expect(data).toEqual({ schemaVersion: 2, distortionId: "emotional-reasoning", distortionNumber: index + 1, distortionNameKo: S01_COGNITIVE_DISTORTIONS[index].nameKo, date: "2026-09-13", text: "무서우니까 위험해", createdAt: "2026-09-13T01:02:03.000Z" });
    expect(() => buildDistortionExampleData({ distortionId: "not-a-distortion", date: "2026-09-13", text: "x" })).toThrow();
  });

  it("loads only the new entry type, never the earlier free-form examples", async () => {
    const record = await ensureHomeworkRecord({ runtimeSessionId: "s01-run", sessionDefinitionId: "tbct-s01", participantId: "p1", initialStatus: "in_progress" });
    await appendHomeworkEntry(record.id, "example", { date: "2026-09-01", situation: "발표", thought: "망쳤다", distortionName: "Catastrophizing" });
    await appendHomeworkEntry(record.id, DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData({ distortionId: "labeling", date: "2026-09-13", text: "나는 바보야" }));
    await appendHomeworkEntry(record.id, DISTORTION_EXAMPLE_ENTRY_TYPE, { schemaVersion: 1, distortionId: "labeling", text: "old shape" });
    const examples = toDistortionExamples(await listHomeworkEntries(record.id, DISTORTION_EXAMPLE_ENTRY_TYPE));
    expect(examples.map((item) => item.text)).toEqual(["나는 바보야"]);
    expect(toDistortionExamples(await listHomeworkEntries(record.id))).toHaveLength(1);
  });

  it("names the homework after the distortion examples", () => {
    expect(HOMEWORK_LABEL_BY_SESSION["tbct-s01"]).toBe("Distortion Examples");
  });
});
