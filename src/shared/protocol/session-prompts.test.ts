import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { COMMON_PROMPT, SESSION_PROMPTS, sessionSystemPrompt } from "@/shared/protocol/session-prompts.generated";

// The session prompts (.claude/TASK_SCOPE.json
// note2026_09_25_session_prompt_documents) are generated from text extracted
// out of reviewed PDFs. These checks keep the generated file honest and pin
// the few things that other code will rely on.

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "artifacts/prompts/manifest.json"), "utf8")) as { entries: Array<{ id: string; textSha256: string; version: string }> };

describe("session prompt documents", () => {
  it("holds exactly the text the manifest hashed", () => {
    for (const document of [COMMON_PROMPT, ...Object.values(SESSION_PROMPTS)]) {
      const entry = manifest.entries.find((item) => item.id === document.id);
      expect(entry, document.id).toBeDefined();
      expect(sha256(document.text)).toBe(entry!.textSha256);
      expect(document.sha256).toBe(entry!.textSha256);
      expect(document.version).toBe(entry!.version);
    }
  });

  it("covers Sessions 1 and 2, with the common rules in front", () => {
    expect(Object.keys(SESSION_PROMPTS).sort()).toEqual(["tbct-s01", "tbct-s02"]);
    const prompt = sessionSystemPrompt("tbct-s01")!;
    expect(prompt.startsWith(COMMON_PROMPT.text)).toBe(true);
    expect(prompt).toContain("# Session 01");
    expect(sessionSystemPrompt("tbct-s03")).toBeUndefined();
  });

  it("carries no Korean review paragraphs and no reviewer notes", () => {
    for (const document of [COMMON_PROMPT, ...Object.values(SESSION_PROMPTS)]) {
      expect(document.text).not.toContain("Notes for review");
      expect(document.text).not.toContain("::: ko");
      // Korean is allowed only where the prompt quotes the Korean wording to use.
      expect(document.text).not.toMatch(/이 문서는|회기가 끝날 때 참가자는/);
    }
  });

  it("names the fifteen distortions in the registry's order, with the registry's Korean names", () => {
    for (const id of ["tbct-s01", "tbct-s02"]) {
      const text = SESSION_PROMPTS[id].text;
      let from = text.indexOf("## 7. Reference");
      expect(from, id).toBeGreaterThan(0);
      for (const distortion of COGNITIVE_DISTORTIONS) {
        const at = text.indexOf(distortion.nameKo, from);
        expect(at, `${id}: ${distortion.nameKo}`).toBeGreaterThan(from);
        from = at;
      }
    }
  });

  it("keeps the crisis response out of the prompt: the system owns it", () => {
    const all = [COMMON_PROMPT, ...Object.values(SESSION_PROMPTS)].map((document) => document.text).join("\n");
    expect(all).not.toMatch(/crisis (support )?line|emergency services|reach out to your therapist/i);
    expect(COMMON_PROMPT.text).toContain("safetyConcern");
  });

  it("states the CD-Quest grid the scoring code uses", () => {
    const text = SESSION_PROMPTS["tbct-s02"].text;
    expect(text).toContain("A little (up to 30%): 1–2 days = 1, 3–5 days = 2, 6–7 days = 3.");
    expect(text).toContain("Quite (31% to 70%): 1–2 days = 2, 3–5 days = 3, 6–7 days = 4.");
    expect(text).toContain("Very much (more than 70%): 1–2 days = 3, 3–5 days = 4, 6–7 days = 5.");
  });
});
