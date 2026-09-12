import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize, classifyText, scopeHash, stageCsv } from "../scripts/stage-mem0-csv.mjs";

describe("stage-mem0-csv", () => {
  it("stages distinct scoped records, quarantines obvious junk, and preserves provenance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "goldfish-csv-stage-"));
    try {
      const input = join(directory, "export.csv");
      writeFileSync(input, [
        "id,text,memory_type,project_id,user_id,agent_id,categories",
        "a1,Keep project records scoped.,fact,alpha,u1,bot,Architecture",
        "a2, keep  PROJECT records scoped. ,fact,alpha,u1,bot,Architecture",
        "a3,Hello!,fact,alpha,u1,bot,Greeting",
        "a4,Keep project records scoped.,fact,beta,u1,bot,Architecture",
        "a5,\"quoted, text with detail\",fact,alpha,u1,bot,Notes"
      ].join("\n"));
      const existing = join(directory, "existing.txt");
      writeFileSync(existing, `${scopeHash({ project_id: "beta", user_id: "u1", agent_id: "bot", text: "Keep project records scoped." })}\n`);
      const report = await stageCsv({ input, outputDir: join(directory, "review"), existingHashesPath: existing });
      expect(report).toMatchObject({ rows_read: 5, staged: 2, quarantined: 1, duplicates_in_source: 1, duplicates_in_existing_set: 1 });
      const staged = readFileSync(join(directory, "review", "staged.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(staged[0]).toMatchObject({ source_row: 2, source_index: 0, source_uuid: "a1", categories: "Architecture" });
      expect(staged[1].text).toBe("quoted, text with detail");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("uses NFKC, case folding, and whitespace for deterministic hashes", () => {
    expect(canonicalize("  Ａ\u00a0\u00df  ")).toBe("a ss");
    expect(scopeHash({ project_id: "P", user_id: "U", agent_id: "A", text: "Keep  THIS" }))
      .toBe(scopeHash({ project_id: "p", user_id: "u", agent_id: "a", text: " keep this " }));
  });

  it("holds very short entries for review", () => {
    expect(classifyText("note")).toEqual({ classification: "quarantine", reason: "very_short_text" });
  });
});
