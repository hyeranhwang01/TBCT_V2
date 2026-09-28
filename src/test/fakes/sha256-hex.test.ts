import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/test/fakes/sha256-hex";

describe("sha256Hex", () => {
  it("matches node:crypto on empty, ASCII, Korean and multi-block input", () => {
    for (const text of ["", "abc", "세션 기록 봉인", JSON.stringify({ a: 1, b: ["x", "y"] }), "x".repeat(1000)]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });
});
