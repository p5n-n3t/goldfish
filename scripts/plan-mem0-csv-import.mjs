#!/usr/bin/env node
/**
 * Builds a deterministic Goldfish import plan from the protected Mem0 CSV
 * staging directory. This module is deliberately offline-only: it has no HTTP,
 * D1, Worker, or Goldfish client dependency and never imports records.
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

export const DEFAULT_PENDING_LEDGERS = Object.freeze([
  "/home/jq/Desktop/goldfish/.goldfish-pending.jsonl",
  "/home/jq/Desktop/goldfish/.mem0-pending.jsonl",
  "/home/jq/Desktop/trumpfiles.fun-new/.goldfish-pending.jsonl",
  "/home/jq/Desktop/trumpfiles.fun-new/.mem0-pending.jsonl",
  "/home/jq/Desktop/superagy-redteam-poc/.mem0-pending.jsonl",
]);

export const UNASSIGNED_PROJECT = "legacy-mem0-unassigned";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const OUTPUT_FILES = ["import-payloads.ndjson", "manifest.ndjson", "report.json"];

// These rules intentionally require a project-specific proper name, repository
// path, or domain. Generic subject words never assign a project.
const STRICT_PROJECT_RULES = Object.freeze([
  {
    projectId: "trumpfiles.fun-new",
    patterns: [
      /\btrumpfiles[.]fun(?:-new)?\b/iu,
      /\btrump[_ -]?claims\b/iu,
      /\btrumpstein(?: files)?\b/iu,
      /\btrump files\b/iu,
    ],
  },
  {
    projectId: "myhayat_new",
    patterns: [
      /(?:^|[^A-Za-z0-9])myhayat[_ -]?new(?:$|[^A-Za-z0-9])/iu,
    ],
  },
  {
    projectId: "ziopsyop",
    patterns: [/\bziopsyop(?:[.]tech)?\b/iu],
  },
  {
    projectId: "dr-greenthumb",
    patterns: [/\b(?:dr|doctor)[_ -]?greenthumb\b/iu, /\bdr-greenthumb\b/iu],
  },
  {
    projectId: "cannabis",
    patterns: [
      /Desktop[\\/]cannabis(?:$|[\\/\s.,:;])/iu,
      /\bproject\s+[`"']?cannabis\b/iu,
      /\brepository\s+[`"']?cannabis\b/iu,
    ],
  },
  {
    projectId: "icvacation",
    patterns: [/\bicvacation\b/iu, /\bic vacation\b/iu],
  },
  {
    projectId: "goldfish",
    patterns: [
      /Desktop[\\/]goldfish(?:$|[\\/\s.,:;])/iu,
      /\bgoldfish[.]ziopsyop[.]tech\b/iu,
      /\bgoldfish memory(?: layer| service| ledger| project)?\b/iu,
    ],
  },
  {
    projectId: "superagy-redteam-poc",
    patterns: [
      /\bsuperagy[-_]?redteam[-]?poc\b/iu,
      /\bsuperagy[- _]?retheme\b/iu,
      /Desktop[\\/]superagy-redteam-poc(?:$|[\\/\s.,:;])/iu,
    ],
  },
  {
    projectId: "knowledge",
    patterns: [
      /Desktop[\\/]knowledge(?:$|[\\/\s.,:;])/iu,
      /\bproject\s+[`"']?knowledge\b/iu,
      /\brepository\s+[`"']?knowledge\b/iu,
    ],
  },
  {
    projectId: "rathlove",
    patterns: [/\brathlove\b/iu, /Desktop[\\/]rathlove(?:$|[\\/\s.,:;])/iu],
  },
  {
    projectId: "commandork",
    patterns: [/home[\\/]jq[\\/]commandork(?:$|[\\/\s.,:;])/iu, /\bcommandork\b/iu],
  },
]);

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

export function normalizeContent(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replaceAll("ß", "ss")
    .replaceAll("ς", "σ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizedContentHash(content) {
  return sha256(normalizeContent(content));
}

export function projectScopeHash(projectId, normalizedHash) {
  return sha256(`${projectId}\u0000${normalizedHash}`);
}

export function assignStrictProject(content) {
  const matches = STRICT_PROJECT_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(String(content ?? ""))))
    .map((rule) => rule.projectId)
    .sort();
  if (matches.length === 1) {
    return { projectId: matches[0], confidence: 1, reason: "explicit_project_evidence", candidates: matches };
  }
  return {
    projectId: UNASSIGNED_PROJECT,
    confidence: 0,
    reason: matches.length > 1 ? "multiple_project_evidence" : "no_explicit_project_evidence",
    candidates: matches,
  };
}

function normalizedCategories(value) {
  const input = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]+/u) : [];
  return [...new Set(input.map((item) => String(item).trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "")).filter(Boolean))].sort();
}

function agentId(value) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return "legacy-agent-unknown";
  const candidate = `legacy-mem0-agent-${cleaned.replace(/[^A-Za-z0-9._:-]+/gu, "-")}`;
  return SAFE_ID.test(candidate) ? candidate : "legacy-agent-unknown";
}

function memoryKind(memoryType) {
  if (memoryType === "event" || memoryType === "plan" || memoryType === "state") return "task";
  return "fact";
}

function sourceIdentity(row) {
  return {
    source_file: String(row.source_file ?? "mem0-csv-staging"),
    source_row: Number.isInteger(row.source_row) ? row.source_row : null,
    source_index: Number.isInteger(row.source_index) ? row.source_index : null,
    source_uuid: typeof row.source_uuid === "string" && row.source_uuid.trim() ? row.source_uuid.trim() : null,
  };
}

function sourceDigest(row, normalizedHash) {
  const source = sourceIdentity(row);
  return sha256(JSON.stringify([source.source_file, source.source_row, source.source_index, source.source_uuid, normalizedHash]));
}

function existingHashSet(path) {
  const hashes = new Set();
  if (!path) return hashes;
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  const visit = (value, inheritedProject) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, inheritedProject);
      return;
    }
    if (!value || typeof value !== "object") return;
    const projectId = typeof value.project_id === "string" ? value.project_id : typeof value.projectId === "string" ? value.projectId : inheritedProject;
    const scopeHash = typeof value.scope_hash === "string" ? value.scope_hash : typeof value.scopeHash === "string" ? value.scopeHash : null;
    const contentHash = typeof value.normalized_content_hash === "string" ? value.normalized_content_hash : typeof value.normalizedContentHash === "string" ? value.normalizedContentHash : null;
    if (scopeHash && /^[a-f0-9]{64}$/iu.test(scopeHash)) hashes.add(scopeHash.toLowerCase());
    if (projectId && contentHash && /^[a-f0-9]{64}$/iu.test(contentHash)) hashes.add(projectScopeHash(projectId, contentHash.toLowerCase()));
    for (const [key, child] of Object.entries(value)) {
      if (["scope_hash", "scopeHash", "normalized_content_hash", "normalizedContentHash"].includes(key)) continue;
      visit(child, key === "content_hashes_by_project" ? inheritedProject : projectId);
      if (key === "content_hashes_by_project" && child && typeof child === "object" && !Array.isArray(child)) {
        for (const [childProject, childHashes] of Object.entries(child)) {
          for (const hash of Array.isArray(childHashes) ? childHashes : []) {
            if (typeof hash === "string" && /^[a-f0-9]{64}$/iu.test(hash)) hashes.add(projectScopeHash(childProject, hash.toLowerCase()));
          }
        }
      }
    }
  };
  visit(parsed, undefined);
  return hashes;
}

async function readNdjson(path) {
  const rows = [];
  if (!existsSync(path)) return rows;
  let lineNumber = 0;
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); }
    catch { throw new Error(`Invalid JSON in ${basename(path)} at line ${lineNumber}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid record in ${basename(path)} at line ${lineNumber}`);
    rows.push(value);
  }
  return rows;
}

function pendingLedgerInventory(paths) {
  return paths.map((path) => ({
    path,
    exists: existsSync(path),
    records: existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/u).filter((line) => line.trim()).length : 0,
  }));
}

function usage() {
  return "Usage:\n  node scripts/plan-mem0-csv-import.mjs --staging-dir /absolute/staging --output-dir /absolute/plan [--existing-hashes /absolute/hashes.json] [--force]";
}

function parseArgs(argv) {
  const result = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--force") result.force = true;
    else if (["--staging-dir", "--output-dir", "--existing-hashes"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      result[token.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())] = value;
    } else if (token === "--help" || token === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!result.stagingDir || !result.outputDir) throw new Error("--staging-dir and --output-dir are required");
  return result;
}

export async function planMem0CsvImport({
  stagingDir,
  outputDir,
  existingHashesPath,
  force = false,
  pendingLedgers = DEFAULT_PENDING_LEDGERS,
}) {
  const stagingPath = resolve(stagingDir);
  const outputPath = resolve(outputDir);
  const stagedPath = join(stagingPath, "staged.jsonl");
  if (!existsSync(stagedPath)) throw new Error(`Missing staged.jsonl in ${stagingPath}`);
  if (stagingPath === outputPath || stagingPath.startsWith(`${outputPath}/`)) throw new Error("Output directory must not contain the staging input");
  const targets = Object.fromEntries(OUTPUT_FILES.map((name) => [name, join(outputPath, name)]));
  if (!force && OUTPUT_FILES.some((name) => existsSync(targets[name]))) throw new Error("Output directory already contains plan files; choose an empty directory or pass --force");
  mkdirSync(outputPath, { recursive: true });

  const existing = existingHashSet(existingHashesPath);
  const manualReviewRows = await readNdjson(join(stagingPath, "manual-review.jsonl"));
  const manualReviewDigests = new Set(manualReviewRows
    .filter((row) => typeof row.text === "string")
    .map((row) => sourceDigest(row, normalizedContentHash(row.text))));
  const manualReviewUuids = new Set(manualReviewRows
    .map((row) => typeof row.source_uuid === "string" ? row.source_uuid.trim() : "")
    .filter(Boolean));
  const manualReviewRowsBySource = new Set(manualReviewRows
    .filter((row) => Number.isInteger(row.source_row))
    .map((row) => `${String(row.source_file ?? "mem0-csv-staging")}\u0000${row.source_row}`));
  const stagedRows = await readNdjson(stagedPath);
  const duplicateRows = await readNdjson(join(stagingPath, "duplicates.jsonl"));
  const manifestStream = createWriteStream(targets["manifest.ndjson"], { flags: "w", mode: 0o600 });
  const payloadStream = createWriteStream(targets["import-payloads.ndjson"], { flags: "w", mode: 0o600 });
  const seenScopes = new Set(existing);
  const report = {
    schema_version: 1,
    source: basename(stagingPath),
    rows_considered: stagedRows.length + duplicateRows.length,
    ready: 0,
    manual_review: 0,
    duplicate_in_plan: 0,
    duplicate_existing: 0,
    staging_duplicates: duplicateRows.length,
    assigned: {},
    assignment_reasons: {},
    existing_scope_hashes_loaded: existing.size,
    pending_ledgers: pendingLedgerInventory(pendingLedgers),
    outputs: { payloads: targets["import-payloads.ndjson"], manifest: targets["manifest.ndjson"] },
  };

  const writeManifest = (entry) => manifestStream.write(`${JSON.stringify(entry)}\n`);
  for (const row of stagedRows) {
    const content = typeof row.text === "string" ? row.text : "";
    if (!content.trim()) throw new Error(`Staged record ${row.source_row ?? "unknown"} has no text`);
    const assignment = assignStrictProject(content);
    const normalizedHash = normalizedContentHash(content);
    const scopeHash = projectScopeHash(assignment.projectId, normalizedHash);
    const digest = sourceDigest(row, normalizedHash);
    let status = "ready";
    const source = sourceIdentity(row);
    const selectedForManualReview = manualReviewDigests.has(digest)
      || Boolean(source.source_uuid && manualReviewUuids.has(source.source_uuid))
      || manualReviewRowsBySource.has(`${source.source_file}\u0000${source.source_row}`);
    if (selectedForManualReview) status = "manual_review";
    else if (existing.has(scopeHash)) status = "duplicate_existing";
    else if (seenScopes.has(scopeHash)) status = "duplicate_in_plan";
    if (status === "ready") {
      seenScopes.add(scopeHash);
      const payload = {
        projectId: assignment.projectId,
        content,
        kind: memoryKind(row.memory_type),
        agentId: agentId(row.agent_id),
        metadata: {
          type: "legacy_mem0_import",
          source_kind: "mem0-import",
          legacy_memory_type: row.memory_type ?? null,
          categories: normalizedCategories(row.categories),
          assignment: { confidence: assignment.confidence, reason: assignment.reason, candidates: assignment.candidates },
          provenance: {
            ...source,
            legacy_project_id: row.project_id ?? null,
            legacy_user_id: row.user_id ?? null,
            legacy_agent_id: row.agent_id ?? null,
            source_digest: digest,
            normalized_content_hash: normalizedHash,
            scope_hash: scopeHash,
            schema_version: 1,
          },
          idempotency_key: `mem0-csv-v1:${scopeHash}`,
        },
      };
      payloadStream.write(`${JSON.stringify(payload)}\n`);
      report.ready += 1;
      report.assigned[assignment.projectId] = (report.assigned[assignment.projectId] ?? 0) + 1;
      report.assignment_reasons[assignment.reason] = (report.assignment_reasons[assignment.reason] ?? 0) + 1;
    } else report[status] += 1;
    writeManifest({
      schema_version: 1,
      status,
      project_id: assignment.projectId,
      assignment_reason: assignment.reason,
      assignment_candidates: assignment.candidates,
      assignment_confidence: assignment.confidence,
      normalized_content_hash: normalizedHash,
      scope_hash: scopeHash,
      source_digest: digest,
      ...sourceIdentity(row),
    });
  }
  for (const row of duplicateRows) {
    const content = typeof row.text === "string" ? row.text : "";
    const assignment = assignStrictProject(content);
    const normalizedHash = normalizedContentHash(content);
    writeManifest({
      schema_version: 1,
      status: "duplicate_in_staging",
      project_id: assignment.projectId,
      assignment_reason: assignment.reason,
      assignment_candidates: assignment.candidates,
      assignment_confidence: assignment.confidence,
      normalized_content_hash: normalizedHash,
      scope_hash: projectScopeHash(assignment.projectId, normalizedHash),
      source_digest: sourceDigest(row, normalizedHash),
      ...sourceIdentity(row),
    });
  }

  await Promise.all([manifestStream, payloadStream].map((stream) => new Promise((resolveStream, reject) => stream.end((error) => error ? reject(error) : resolveStream()))));
  const stableReport = { ...report, assigned: Object.fromEntries(Object.entries(report.assigned).sort()), assignment_reasons: Object.fromEntries(Object.entries(report.assignment_reasons).sort()) };
  await new Promise((resolveStream, reject) => {
    const output = createWriteStream(targets["report.json"], { flags: "w", mode: 0o600 });
    output.end(`${JSON.stringify(stableReport, null, 2)}\n`, (error) => error ? reject(error) : resolveStream());
  });
  return stableReport;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log(usage());
    else {
      const report = await planMem0CsvImport({ ...args, existingHashesPath: args.existingHashes });
      // Counts and paths only. Memory contents are never written to stdout.
      console.log(JSON.stringify({
        status: "planned_offline",
        rows_considered: report.rows_considered,
        ready: report.ready,
        manual_review: report.manual_review,
        duplicates: report.duplicate_in_plan + report.duplicate_existing + report.staging_duplicates,
        assigned: report.assigned,
        report: join(resolve(args.outputDir), "report.json"),
      }));
    }
  } catch (error) {
    console.error(`plan-mem0-csv-import: ${error instanceof Error ? error.message : "failed"}`);
    process.exitCode = 1;
  }
}
