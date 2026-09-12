#!/usr/bin/env node
/**
 * Replays Goldfish and legacy Mem0 pending ledgers into Goldfish without ever
 * invoking Mem0. The default is a read-only dry run. An apply run needs both
 * --apply and GOLDFISH_API_KEY, writes an append-only local manifest, and is
 * safe to rerun after an interrupted request.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_LEDGERS = [
  "/home/jq/Desktop/goldfish/.goldfish-pending.jsonl",
  "/home/jq/Desktop/goldfish/.mem0-pending.jsonl",
  "/home/jq/Desktop/trumpfiles.fun-new/.goldfish-pending.jsonl",
  "/home/jq/Desktop/trumpfiles.fun-new/.mem0-pending.jsonl"
];
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MEMORY_KINDS = new Set(["fact", "conversation", "document", "task"]);
const SECRET_FIELD = /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|authorization|cookie|password|secret|private[-_]?key)/iu;
const SECRET_IN_CONTENT = /(?:api[-_ ]?key|access[-_ ]?token|bearer|authorization|cookie|password|secret)\s*[:=]\s*\S{8,}/iu;

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const cleanId = (value) => typeof value === "string" && VALID_ID.test(value) ? value : undefined;
const cleanText = (value) => typeof value === "string" ? value.trim() : "";
const safeJson = (value) => {
  if (Array.isArray(value)) return value.map(safeJson).filter(item => item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_FIELD.test(key))
    .map(([key, item]) => [key, safeJson(item)])
    .filter(([, item]) => item !== undefined));
};

function usage() {
  return `Usage:\n  node scripts/reconcile-pending-ledgers.mjs [--ledger /absolute/file.jsonl]... [--manifest /absolute/manifest.jsonl] [--base-url https://goldfish.ziopsyop.tech] [--apply]\n\nWithout --apply, this reads and validates ledgers only. Apply requires GOLDFISH_API_KEY and records accepted source-line digests in an append-only manifest.`;
}

export function parseArgs(argv) {
  const result = { ledgers: [], baseUrl: "https://goldfish.ziopsyop.tech", apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") result.apply = true;
    else if (token === "--ledger") {
      const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error("Missing value for --ledger");
      result.ledgers.push(value);
    } else if (token === "--manifest" || token === "--base-url") {
      const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      result[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    } else if (token === "--help" || token === "-h") { return { help: true }; }
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!result.ledgers.length) result.ledgers = [...DEFAULT_LEDGERS];
  return result;
}

function inferredProject(path, record) {
  const declared = cleanId(record.project_id ?? record.projectId);
  if (declared) return declared;
  const parent = dirname(resolve(path)).split("/").at(-1) ?? "";
  return cleanId(parent);
}

function inferredKind(record, type) {
  if (MEMORY_KINDS.has(record.kind)) return record.kind;
  if (["prompt_record", "checkpoint", "project_state", "project_init"].includes(type)) return "task";
  if (type === "conversation") return "conversation";
  if (type === "document") return "document";
  return "fact";
}

export function normalisePendingRecord(path, line, lineNumber) {
  const record = JSON.parse(line);
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("record must be a JSON object");
  const projectId = inferredProject(path, record);
  if (!projectId) throw new Error("no valid project_id and parent folder is not a valid project ID");
  const content = cleanText(record.content ?? record.text ?? record.memory);
  if (!content) throw new Error("no usable content/text field");
  if (content.length > 100_000) throw new Error("content exceeds Goldfish maximum length");
  if (SECRET_IN_CONTENT.test(content)) throw new Error("content appears to include a raw credential");
  const legacyMetadata = safeJson(record.metadata && typeof record.metadata === "object" ? record.metadata : {});
  const type = cleanText(record.type ?? legacyMetadata.type) || "legacy_pending";
  const sourceDigest = sha256(`${resolve(path)}\n${lineNumber}\n${line}`);
  const metadata = {
    ...legacyMetadata,
    type,
    source_kind: cleanText(record.source_kind ?? legacyMetadata.source_kind) || "pending-ledger",
    recorded_at: cleanText(record.timestamp ?? record.recorded_at ?? legacyMetadata.recorded_at) || undefined,
    migration: {
      provider: path.includes(".mem0-pending.jsonl") ? "mem0-pending" : "goldfish-pending",
      source_file: resolve(path),
      source_line: lineNumber,
      source_digest: sourceDigest,
      source_app_id: typeof record.app_id === "string" ? record.app_id : undefined,
      schema_version: 1
    }
  };
  for (const [key, value] of Object.entries(metadata)) if (value === undefined) delete metadata[key];
  for (const [key, value] of Object.entries(metadata.migration)) if (value === undefined) delete metadata.migration[key];
  return {
    sourceDigest,
    projectId,
    body: {
      content,
      kind: inferredKind(record, type),
      ...(cleanId(record.agent_id ?? record.agentId ?? legacyMetadata.agent) ? { agentId: cleanId(record.agent_id ?? record.agentId ?? legacyMetadata.agent) } : {}),
      ...(cleanId(record.session_id ?? record.sessionId ?? legacyMetadata.session_id) ? { sessionId: cleanId(record.session_id ?? record.sessionId ?? legacyMetadata.session_id) } : {}),
      metadata
    }
  };
}

function acceptedDigests(manifestPath) {
  const accepted = new Set();
  if (!manifestPath || !existsSync(manifestPath)) return accepted;
  for (const line of readFileSync(manifestPath, "utf8").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (["accepted", "already_present"].includes(entry.status) && typeof entry.source_digest === "string") accepted.add(entry.source_digest);
    } catch { /* An interrupted final line is not trusted or treated as complete. */ }
  }
  return accepted;
}

function appendManifest(path, entry) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function reconcileLedgers({ ledgers = DEFAULT_LEDGERS, baseUrl = "https://goldfish.ziopsyop.tech", apply = false, manifestPath, apiKey = process.env.GOLDFISH_API_KEY, fetchImpl = fetch }) {
  if (apply && (!apiKey || !/^gf_live_[A-Za-z0-9_-]{43}$/u.test(apiKey))) throw new Error("--apply requires a valid GOLDFISH_API_KEY");
  const resolvedManifest = manifestPath ? resolve(manifestPath) : resolve(process.env.HOME ?? ".", ".config/goldfish/replay-manifests/pending-ledgers.jsonl");
  const completed = acceptedDigests(resolvedManifest);
  const report = { files: 0, lines: 0, ready: 0, accepted: 0, already_present: 0, already_reconciled: 0, rejected: 0, remote_errors: 0, remote_error_statuses: {}, dry_run: !apply, manifest: resolvedManifest };
  for (const ledger of ledgers) {
    const path = resolve(ledger);
    if (!existsSync(path)) { report.rejected += 1; continue; }
    report.files += 1;
    const lines = readFileSync(path, "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]; if (!line.trim()) continue;
      report.lines += 1;
      let candidate;
      try { candidate = normalisePendingRecord(path, line, index + 1); }
      catch { report.rejected += 1; continue; }
      if (completed.has(candidate.sourceDigest)) { report.already_reconciled += 1; continue; }
      report.ready += 1;
      if (!apply) continue;
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/u, "")}/v1/projects/${encodeURIComponent(candidate.projectId)}/memory`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(candidate.body)
        });
        if (response.status === 409) {
          const search = await fetchImpl(`${baseUrl.replace(/\/$/u, "")}/v1/projects/${encodeURIComponent(candidate.projectId)}/memory/search`, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ query: candidate.body.content, limit: 20 })
          });
          const found = search.ok ? (await search.json())?.results?.find(item => item?.content === candidate.body.content) : undefined;
          if (found?.id) {
            appendManifest(resolvedManifest, { status: "already_present", source_digest: candidate.sourceDigest, project_id: candidate.projectId, memory_id: found.id, recorded_at: new Date().toISOString() });
            completed.add(candidate.sourceDigest); report.already_present += 1; continue;
          }
        }
        if (!response.ok) {
          report.remote_errors += 1;
          report.remote_error_statuses[String(response.status)] = (report.remote_error_statuses[String(response.status)] ?? 0) + 1;
          continue;
        }
        const result = await response.json();
        appendManifest(resolvedManifest, { status: "accepted", source_digest: candidate.sourceDigest, project_id: candidate.projectId, memory_id: result?.memory?.id ?? null, recorded_at: new Date().toISOString() });
        completed.add(candidate.sourceDigest); report.accepted += 1;
      } catch { report.remote_errors += 1; report.remote_error_statuses.network = (report.remote_error_statuses.network ?? 0) + 1; }
    }
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) console.log(usage());
    else {
      const report = await reconcileLedgers({ ledgers: parsed.ledgers, baseUrl: parsed.baseUrl, apply: parsed.apply, manifestPath: parsed.manifest });
      console.log(JSON.stringify({ status: report.dry_run ? "validated_for_replay" : "replayed", ...report }));
      if (report.remote_errors) process.exitCode = 1;
    }
  } catch (error) { console.error(`reconcile-pending-ledgers: ${error instanceof Error ? error.message : "failed"}`); process.exitCode = 1; }
}
