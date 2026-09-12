import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalisePendingRecord, reconcileLedgers } from "../scripts/reconcile-pending-ledgers.mjs";

describe("pending-ledger reconciliation", () => {
  it("normalises legacy records using the containing project folder and strips secret metadata", () => {
    const candidate = normalisePendingRecord("/tmp/trumpfiles.fun-new/.mem0-pending.jsonl", JSON.stringify({ text: "Keep checkpoints concise", app_id: "legacy", agent_id: "codex_cli", metadata: { api_key: "must-not-pass", type: "checkpoint" } }), 4);
    expect(candidate.projectId).toBe("trumpfiles.fun-new");
    expect(candidate.body).toMatchObject({ content: "Keep checkpoints concise", kind: "task", agentId: "codex_cli", metadata: { type: "checkpoint" } });
    expect(JSON.stringify(candidate.body)).not.toContain("must-not-pass");
  });

  it("is dry-run by default, records accepted source lines, and skips them on a rerun", async () => {
    const directory = mkdtempSync(join(tmpdir(), "goldfish-replay-"));
    try {
      const ledger = join(directory, "goldfish", ".goldfish-pending.jsonl");
      const manifest = join(directory, "manifest", "accepted.jsonl");
      mkdirSync(dirname(ledger), { recursive: true });
      writeFileSync(ledger, `${JSON.stringify({ project_id: "alpha", content: "A durable pending record", type: "prompt_record", agent_id: "codex_cli" })}\n`, { encoding: "utf8" });
      const dry = await reconcileLedgers({ ledgers: [ledger], manifestPath: manifest });
      expect(dry).toMatchObject({ files: 1, lines: 1, ready: 1, accepted: 0, dry_run: true });
      const calls: unknown[] = [];
      const fakeFetch = async (_url: string, request: RequestInit) => { calls.push(request); return new Response(JSON.stringify({ memory: { id: "m1" } }), { status: 201 }); };
      const apiKey = `gf_live_${"a".repeat(43)}`;
      const applied = await reconcileLedgers({ ledgers: [ledger], manifestPath: manifest, apply: true, apiKey, fetchImpl: fakeFetch });
      expect(applied.accepted).toBe(1);
      expect(calls).toHaveLength(1);
      expect(readFileSync(manifest, "utf8")).toContain('"status":"accepted"');
      const rerun = await reconcileLedgers({ ledgers: [ledger], manifestPath: manifest, apply: true, apiKey, fetchImpl: fakeFetch });
      expect(rerun.already_reconciled).toBe(1);
      expect(calls).toHaveLength(1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("records a confirmed exact existing memory instead of duplicating a provenance-conflicting record", async () => {
    const directory = mkdtempSync(join(tmpdir(), "goldfish-replay-conflict-"));
    try {
      const ledger = join(directory, "goldfish", ".goldfish-pending.jsonl");
      const manifest = join(directory, "manifest", "accepted.jsonl");
      mkdirSync(dirname(ledger), { recursive: true });
      writeFileSync(ledger, `${JSON.stringify({ project_id: "alpha", content: "Already stored memory" })}\n`);
      const apiKey = `gf_live_${"a".repeat(43)}`;
      const fakeFetch = async (url: string) => url.includes("/search")
        ? new Response(JSON.stringify({ results: [{ id: "present", content: "Already stored memory" }] }), { status: 200 })
        : new Response(JSON.stringify({ error: "PROVENANCE_CONFLICT" }), { status: 409 });
      const report = await reconcileLedgers({ ledgers: [ledger], manifestPath: manifest, apply: true, apiKey, fetchImpl: fakeFetch });
      expect(report).toMatchObject({ accepted: 0, already_present: 1, remote_errors: 0 });
      expect(readFileSync(manifest, "utf8")).toContain('"status":"already_present"');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
