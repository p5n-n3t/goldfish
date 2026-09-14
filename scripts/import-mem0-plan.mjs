#!/usr/bin/env node
/**
 * Resumable importer for a reviewed offline Mem0 plan. It never prints memory
 * text or tokens. A local progress ledger makes retries idempotent even when a
 * network request is interrupted.
 */
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
const plan = args.plan; const credentials = args.credentials; const progress = args.progress; const concurrency = Math.max(1, Math.min(16, Number(args.concurrency || 6)));
if (!plan || !credentials || !progress) throw new Error("Usage: import-mem0-plan.mjs --plan <payload.ndjson> --credentials <credentials.json> --progress <progress.jsonl> [--concurrency 6]");
const config = JSON.parse(readFileSync(credentials, "utf8"));
const token = config.token || config.projectToken;
const baseUrl = String(config.baseUrl || "https://goldfish.ziopsyop.tech").replace(/\/$/, "");
if (typeof token !== "string" || !token.startsWith("gf_live_")) throw new Error("Workspace Goldfish API key is unavailable");
const done = new Set(existsSync(progress) ? readFileSync(progress, "utf8").split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line).idempotencyKey).filter(Boolean) : []);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const writeProgress = row => { appendFileSync(progress, `${JSON.stringify(row)}\n`, { mode: 0o600 }); chmodSync(progress, 0o600); };

async function importOne(record) {
  const key = record?.metadata?.idempotency_key;
  if (typeof key !== "string" || done.has(key)) return "skipped";
  const endpoint = `${baseUrl}/v1/projects/${encodeURIComponent(record.projectId)}/memory`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ content: record.content, kind: record.kind, metadata: record.metadata, agentId: record.agentId }) });
      if (response.ok || response.status === 409) { writeProgress({ idempotencyKey: key, projectId: record.projectId, status: response.ok ? "imported" : "already_present", completedAt: new Date().toISOString() }); done.add(key); return response.ok ? "imported" : "duplicate"; }
      if (response.status < 500 && response.status !== 429) throw new Error(`HTTP_${response.status}`);
    } catch (error) { if (attempt === 3) throw error; }
    await sleep(250 * (2 ** attempt));
  }
  throw new Error("IMPORT_RETRY_EXHAUSTED");
}

const queue = [];
for await (const line of createInterface({ input: createReadStream(plan), crlfDelay: Infinity })) if (line.trim()) queue.push(JSON.parse(line));
const totals = { planned: queue.length, imported: 0, duplicate: 0, skipped: 0, failed: 0 };
let cursor = 0;
async function worker() { while (cursor < queue.length) { const record = queue[cursor++]; try { const result = await importOne(record); totals[result] += 1; } catch { totals.failed += 1; } } }
await Promise.all(Array.from({ length: concurrency }, worker));
process.stdout.write(`${JSON.stringify({ ...totals, resumable: true })}\n`);
if (totals.failed) process.exitCode = 1;
