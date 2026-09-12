#!/usr/bin/env node
/**
 * Offline-only CSV review staging. This program deliberately has no HTTP, D1,
 * Worker, or Goldfish client dependency. It never imports a memory anywhere.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Transform } from "node:stream";

const REQUIRED_COLUMNS = ["text", "project_id", "user_id", "agent_id"];
const STAGING_COLUMNS = [
  "source_file", "source_row", "source_index", "source_uuid", "scope_hash", "classification",
  "classification_reason", "project_id", "user_id", "agent_id", "memory_type", "categories", "text"
];

function usage() {
  return `Usage:\n  node scripts/stage-mem0-csv.mjs --input /absolute/export.csv --output-dir /absolute/review-dir [--existing-hashes hashes.txt|hashes.jsonl] [--force]\n\nThis is offline-only: it reads CSV and writes review files. It never calls Goldfish, D1, a Worker, or an API.`;
}

function argumentsFrom(argv) {
  const result = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--force") result.force = true;
    else if (["--input", "--output-dir", "--existing-hashes"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      result[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    } else if (token === "--help" || token === "-h") {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (!result.input || !result.outputDir) throw new Error("--input and --output-dir are required");
  return result;
}

/** Unicode NFKC, practical Unicode case folding, and collapsed whitespace. */
export function canonicalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    // JavaScript has no full Unicode casefold API. These are the two common
    // casefold-only distinctions that matter for deterministic text matching.
    .replaceAll("ß", "ss")
    .replaceAll("ς", "σ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function scopeHash({ project_id, user_id, agent_id, text }) {
  const scope = [project_id, user_id, agent_id, text].map(canonicalize).join("\u0000");
  return createHash("sha256").update(scope, "utf8").digest("hex");
}

export function classifyText(text) {
  const normalized = canonicalize(text);
  if (!normalized) return { classification: "quarantine", reason: "empty_text" };
  if ([...normalized].length <= 12) return { classification: "quarantine", reason: "very_short_text" };
  if (/^(?:hi|hello|hey|greetings|good (?:morning|afternoon|evening))[!. ,]*$/u.test(normalized)) {
    return { classification: "quarantine", reason: "standalone_greeting" };
  }
  if (/^[\p{P}\p{S}_]+$/u.test(normalized)) return { classification: "quarantine", reason: "punctuation_only" };
  return { classification: "stage", reason: null };
}

// Incremental RFC 4180-style parser. It supports quoted commas, quotes, and
// newlines without reading the export into memory.
class CsvRows extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this.field = ""; this.row = []; this.quoted = false; this.afterQuote = false; this.pendingCr = false;
  }
  _transform(chunk, _encoding, callback) {
    try {
      const text = chunk.toString("utf8");
      for (let i = 0; i < text.length; i += 1) this.consume(text[i]);
      callback();
    } catch (error) { callback(error); }
  }
  _flush(callback) {
    try {
      if (this.quoted) throw new Error("Unterminated quoted CSV field");
      if (this.pendingCr) this.finishRow();
      else if (this.field !== "" || this.row.length > 0) this.finishRow();
      callback();
    } catch (error) { callback(error); }
  }
  consume(char) {
    if (this.pendingCr) {
      this.pendingCr = false;
      if (char === "\n") return;
    }
    if (this.quoted) {
      if (char === '"') {
        if (this.afterQuote) { this.field += '"'; this.afterQuote = false; }
        else this.afterQuote = true;
        return;
      }
      if (!this.afterQuote) { this.field += char; return; }
      this.quoted = false;
      this.afterQuote = false;
    }
    if (char === '"' && this.field === "") { this.quoted = true; return; }
    if (char === ",") { this.row.push(this.field); this.field = ""; return; }
    if (char === "\n") { this.finishRow(); return; }
    if (char === "\r") { this.finishRow(); this.pendingCr = true; return; }
    this.field += char;
  }
  finishRow() { this.row.push(this.field); this.push(this.row); this.row = []; this.field = ""; }
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

function parseExistingHashes(path) {
  if (!path) return new Set();
  const hashes = new Set();
  const source = readFileSync(path, "utf8");
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[a-f0-9]{64}$/iu.test(trimmed)) { hashes.add(trimmed.toLowerCase()); continue; }
    try {
      const value = JSON.parse(trimmed);
      if (typeof value.scope_hash === "string" && /^[a-f0-9]{64}$/iu.test(value.scope_hash)) hashes.add(value.scope_hash.toLowerCase());
      else throw new Error("no scope_hash field");
    } catch { throw new Error(`Existing hash input contains neither a SHA-256 line nor JSONL scope_hash: ${path}`); }
  }
  return hashes;
}

function safeUuid(row) { return row.id ?? row.uuid ?? row.memory_id ?? null; }

export async function stageCsv({ input, outputDir, existingHashesPath, force = false }) {
  const inputPath = resolve(input); const outputPath = resolve(outputDir);
  if (!existsSync(inputPath)) throw new Error(`Input does not exist: ${inputPath}`);
  if (inputPath === outputPath || inputPath.startsWith(`${outputPath}/`)) throw new Error("Output directory must not contain the input export");
  const targets = ["staged.jsonl", "quarantine.jsonl", "duplicates.jsonl", "staged.csv", "report.json"].map((file) => join(outputPath, file));
  if (!force && targets.some(existsSync)) throw new Error("Output directory already contains staging files; choose an empty directory or pass --force");
  mkdirSync(outputPath, { recursive: true });
  const existingHashes = parseExistingHashes(existingHashesPath);
  const seenHashes = new Set(existingHashes);
  const staged = createWriteStream(targets[0], { flags: "w" });
  const quarantine = createWriteStream(targets[1], { flags: "w" });
  const duplicates = createWriteStream(targets[2], { flags: "w" });
  const stagedCsv = createWriteStream(targets[3], { flags: "w" });
  stagedCsv.write(`${STAGING_COLUMNS.map(csvCell).join(",")}\n`);
  const report = { source_file: basename(inputPath), existing_hashes_loaded: existingHashes.size, rows_read: 0, staged: 0, quarantined: 0, duplicates_in_source: 0, duplicates_in_existing_set: 0, malformed_rows: 0, classification_reasons: {} };
  let headers = null;
  let sourceRow = 0;

  for await (const fields of createReadStream(inputPath).pipe(new CsvRows())) {
      sourceRow += 1;
      if (sourceRow === 1) {
        headers = fields.map((header) => canonicalize(header));
        const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
        if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
        continue;
      }
      report.rows_read += 1;
      if (fields.length !== headers.length) { report.malformed_rows += 1; continue; }
      const row = Object.fromEntries(headers.map((header, index) => [header, fields[index]]));
      const record = {
        source_file: basename(inputPath), source_row: sourceRow, source_index: sourceRow - 2,
        source_uuid: safeUuid(row), project_id: row.project_id ?? "", user_id: row.user_id ?? "", agent_id: row.agent_id ?? "",
        memory_type: row.memory_type ?? null, categories: row.categories ?? null, text: row.text ?? ""
      };
      record.scope_hash = scopeHash(record);
      const classification = classifyText(record.text);
      if (classification.classification === "quarantine") {
        const item = { ...record, classification: "quarantine", classification_reason: classification.reason, provenance: { source_file: record.source_file, source_row: record.source_row, source_index: record.source_index, source_uuid: record.source_uuid } };
        quarantine.write(`${JSON.stringify(item)}\n`); report.quarantined += 1;
        report.classification_reasons[classification.reason] = (report.classification_reasons[classification.reason] ?? 0) + 1;
        continue;
      }
      if (seenHashes.has(record.scope_hash)) {
        const reason = existingHashes.has(record.scope_hash) ? "existing_hash_set" : "duplicate_in_source";
        duplicates.write(`${JSON.stringify({ ...record, classification: "duplicate", classification_reason: reason })}\n`);
        if (reason === "existing_hash_set") report.duplicates_in_existing_set += 1; else report.duplicates_in_source += 1;
        continue;
      }
      seenHashes.add(record.scope_hash);
      const item = { ...record, classification: "stage", classification_reason: null, provenance: { source_file: record.source_file, source_row: record.source_row, source_index: record.source_index, source_uuid: record.source_uuid } };
      staged.write(`${JSON.stringify(item)}\n`);
      stagedCsv.write(`${STAGING_COLUMNS.map((key) => csvCell(item[key])).join(",")}\n`);
      report.staged += 1;
  }
  await Promise.all([staged, quarantine, duplicates, stagedCsv].map((stream) => new Promise((resolveStream, reject) => stream.end((error) => error ? reject(error) : resolveStream()))));
  report.output_files = Object.fromEntries([["staged_jsonl", targets[0]], ["quarantine_jsonl", targets[1]], ["duplicates_jsonl", targets[2]], ["staged_csv", targets[3]]]);
  await new Promise((resolveStream, reject) => {
    const output = createWriteStream(targets[4], { flags: "w" });
    output.end(`${JSON.stringify(report, null, 2)}\n`, (error) => error ? reject(error) : resolveStream());
  });
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const report = await stageCsv(argumentsFrom(process.argv.slice(2)));
    console.log(JSON.stringify({ status: "staged_for_review", report: join(resolve(argumentsFrom(process.argv.slice(2)).outputDir), "report.json"), counts: { staged: report.staged, quarantined: report.quarantined, duplicates: report.duplicates_in_source + report.duplicates_in_existing_set, malformed_rows: report.malformed_rows } }));
  } catch (error) { console.error(`stage-mem0-csv: ${error.message}`); process.exitCode = 1; }
}
