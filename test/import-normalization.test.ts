import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeCategories, normalizeImportSources } from "../src/import-normalization";

const exportFilenames = [
  "mem0_export_2026-09-05 (1).json",
  "mem0_export_2026-09-05.json",
  "memory-export-0a7861cf-bfd1-4d5c-aa8b-5146392fd704.json",
  "memory-export-2d71c5a1-d9c4-4fad-a60b-20b0205994a3.json",
  "memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3 (1).json",
  "memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3.json",
  "memory-export-957fb216-8321-4e69-ac73-077fbf77a001.json",
  "memory-export-bee80f31-b3bc-48c4-8735-656b0cfc3608.json"
] as const;

describe("import normalization", () => {
  it("normalizes tabular exports while preserving provenance and lifecycle", () => {
    const result = normalizeImportSources([{
      filename: "mem0_export_2026-09-05.json",
      data: [
        ["Time", "Entities", "Memory Content", "Categories", "Lifecycle", "Action"],
        ["8d ago", "jq", "Keep worker routes project-scoped.", "Architecture Decisions\n+1", "Active", ""],
        ["2026-09-01", "jq", "Retain this inactive record.", "Testing Patterns", "Superseded", ""]
      ]
    }]);

    expect(result.records).toEqual([
      expect.objectContaining({
        content: "Keep worker routes project-scoped.",
        categories: ["architecture-decisions"],
        lifecycleStatus: "Active",
        occurredAt: null,
        provenance: expect.objectContaining({ sourceFilename: "mem0_export_2026-09-05.json", sourceRow: 2 })
      }),
      expect.objectContaining({ lifecycleStatus: "Superseded", occurredAt: "2026-09-01" })
    ]);
  });

  it("normalizes object exports, drops the definite greeting, and exact-dedupes", () => {
    const duplicate = { memory: "A retained checkpoint.", categories: ["Checkpoint", "Build"], timestamp: "2026-08-12" };
    const result = normalizeImportSources([
      { filename: "memory-export-a.json", data: { memory: "hi", categories: ["prompt"], timestamp: "2026-08-28" } },
      { filename: "memory-export-b.json", data: duplicate },
      { filename: "memory-export-b-copy.json", data: duplicate },
      { filename: "memory-export-c.json", data: { analysis: "A retained checkpoint. ", categories: "Checkpoint, Build", timestamp: "yesterday" } }
    ]);

    expect(result.discardedGreetings).toBe(1);
    expect(result.duplicateRecords).toBe(1);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      categories: ["checkpoint", "build"],
      occurredAt: "2026-08-12",
      provenance: { sourceFilename: "memory-export-b.json", sourceRow: 1 }
    });
    expect(result.records[1]).toMatchObject({
      content: "A retained checkpoint. ",
      occurredAt: null,
      provenance: { sourceFilename: "memory-export-c.json", sourceRow: 1 }
    });
  });

  it("makes category normalization deterministic", () => {
    expect(normalizeCategories(["  Task Learnings  ", "task learnings", "", 3])).toEqual(["task-learnings"]);
  });

  it("normalizes the eight root exports to the reviewed 204 import candidates", () => {
    const result = normalizeImportSources(exportFilenames.map((filename) => ({
      filename,
      data: JSON.parse(readFileSync(resolve(process.cwd(), filename), "utf8")) as unknown
    })));

    expect(result).toMatchObject({ discardedGreetings: 1, duplicateRecords: 0 });
    expect(result.records).toHaveLength(203);
    expect(result.records.every((record) => record.provenance.sourceFilename !== "")).toBe(true);
    expect(result.records.some((record) => record.occurredAt === null)).toBe(true);
  });
});
