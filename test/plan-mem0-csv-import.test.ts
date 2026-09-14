// Runtime coverage for a standalone JavaScript CLI; Vitest executes the
// module directly, while TypeScript intentionally has no static contract for
// arbitrary .mjs command-line tools.
// @ts-nocheck
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assignStrictProject,
  DEFAULT_PENDING_LEDGERS,
  normalizedContentHash,
  planMem0CsvImport,
  projectScopeHash,
  UNASSIGNED_PROJECT,
} from "../scripts/plan-mem0-csv-import.mjs";

const temporary: string[] = [];
const temp = () => {
  const path = mkdtempSync(join(tmpdir(), "goldfish-mem0-plan-"));
  temporary.push(path);
  return path;
};

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("strict Mem0 CSV import planning", () => {
  it("uses explicit project evidence and refuses ambiguous aliases", () => {
    expect(assignStrictProject("Continue /home/jq/Desktop/trumpfiles.fun-new deployment").projectId).toBe("trumpfiles.fun-new");
    expect(assignStrictProject("Checkpoint for MyHayat_new language validation").projectId).toBe("myhayat_new");
    expect(assignStrictProject("Continue the MyHayat project").projectId).toBe(UNASSIGNED_PROJECT);
    expect(assignStrictProject("Compare Ziopsyop with Trumpstein Files")).toMatchObject({
      projectId: UNASSIGNED_PROJECT,
      reason: "multiple_project_evidence",
      candidates: ["trumpfiles.fun-new", "ziopsyop"],
    });
  });

  it("produces stable payloads, deduplicates normalized content, and inventories every pending ledger", async () => {
    const stagingDir = temp();
    const outputDir = temp();
    const records = [
      { source_file: "export.csv", source_row: 2, source_index: 0, source_uuid: "a", project_id: "204840", user_id: "u", agent_id: "614692", memory_type: "long_term", categories: "technology", text: "Continue /home/jq/Desktop/trumpfiles.fun-new deployment" },
      { source_file: "export.csv", source_row: 3, source_index: 1, source_uuid: "b", project_id: "204840", user_id: "u", agent_id: "", memory_type: "long_term", categories: "", text: "  continue /home/jq/Desktop/trumpfiles.fun-new   deployment  " },
      { source_file: "export.csv", source_row: 4, source_index: 2, source_uuid: "c", project_id: "204840", user_id: "u", agent_id: "", memory_type: "state", categories: "task_learnings", text: "A durable fact without project evidence" },
      { source_file: "export.csv", source_row: 5, source_index: 3, source_uuid: "d", project_id: "204840", user_id: "u", agent_id: "", memory_type: "event", categories: "", text: "Checkpoint for MyHayat_new language validation" },
    ];
    writeFileSync(join(stagingDir, "staged.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    writeFileSync(join(stagingDir, "duplicates.jsonl"), "");
    writeFileSync(join(stagingDir, "manual-review.jsonl"), "");

    const existingHash = normalizedContentHash(records[3].text);
    const existingPath = join(stagingDir, "existing.json");
    writeFileSync(existingPath, JSON.stringify({ content_hashes_by_project: { myhayat_new: [existingHash] } }));

    const report = await planMem0CsvImport({ stagingDir, outputDir, existingHashesPath: existingPath, pendingLedgers: DEFAULT_PENDING_LEDGERS });
    expect(report).toMatchObject({ rows_considered: 4, ready: 2, duplicate_in_plan: 1, duplicate_existing: 1 });
    expect(report.assigned).toEqual({ "legacy-mem0-unassigned": 1, "trumpfiles.fun-new": 1 });
    expect(report.pending_ledgers.map((item: { path: string }) => item.path)).toEqual(DEFAULT_PENDING_LEDGERS);
    expect(DEFAULT_PENDING_LEDGERS).toContain("/home/jq/Desktop/superagy-redteam-poc/.mem0-pending.jsonl");

    const payloads = readFileSync(join(outputDir, "import-payloads.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    expect(payloads).toHaveLength(2);
    expect(payloads[0].content).toBe(records[0].text);
    expect(payloads[0]).toMatchObject({ projectId: "trumpfiles.fun-new", agentId: "legacy-mem0-agent-614692" });
    expect(payloads[1]).toMatchObject({ projectId: UNASSIGNED_PROJECT, agentId: "legacy-agent-unknown" });
    expect(payloads[0].metadata.provenance).toMatchObject({ source_uuid: "a", source_row: 2 });
    expect(payloads[0].metadata.provenance.scope_hash).toBe(projectScopeHash("trumpfiles.fun-new", normalizedContentHash(records[0].text)));

    const firstPayloadBytes = readFileSync(join(outputDir, "import-payloads.ndjson"), "utf8");
    const firstManifestBytes = readFileSync(join(outputDir, "manifest.ndjson"), "utf8");
    await planMem0CsvImport({ stagingDir, outputDir, existingHashesPath: existingPath, pendingLedgers: DEFAULT_PENDING_LEDGERS, force: true });
    expect(readFileSync(join(outputDir, "import-payloads.ndjson"), "utf8")).toBe(firstPayloadBytes);
    expect(readFileSync(join(outputDir, "manifest.ndjson"), "utf8")).toBe(firstManifestBytes);
  });
});
