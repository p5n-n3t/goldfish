import { describe, expect, it } from "vitest";
import { contentHash, validateMemoryInput, validateSearchQuery } from "../src/domain";

describe("domain utilities", () => {
  it("creates a stable SHA-256 content hash", async () => {
    await expect(contentHash("hello")).resolves.toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("validates memory input and supplies metadata", () => {
    expect(validateMemoryInput({ content: "Use D1", kind: "fact" })).toMatchObject({
      content: "Use D1", kind: "fact", metadata: {}
    });
  });

  it("rejects invalid search limits", () => {
    expect(() => validateSearchQuery({ query: "d1", limit: 101 })).toThrow(/between 1 and 100/);
  });
});
