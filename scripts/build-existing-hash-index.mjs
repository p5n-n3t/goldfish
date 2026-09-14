#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: build-existing-hash-index.mjs <wrangler-json> <output-json>");
const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("und").replaceAll("ß", "ss").replaceAll("ς", "σ").replace(/\s+/gu, " ").trim();
const sha = value => createHash("sha256").update(value, "utf8").digest("hex");
const payload = JSON.parse(readFileSync(inputPath, "utf8"));
const rows = Array.isArray(payload) ? payload.flatMap(batch => Array.isArray(batch?.results) ? batch.results : []) : [];
const hashes = rows.filter(row => typeof row?.project_id === "string" && typeof row?.content === "string")
  .map(row => ({ project_id: row.project_id, normalized_content_hash: sha(normalize(row.content)) }));
writeFileSync(outputPath, JSON.stringify({ generated_at: new Date().toISOString(), records: hashes }), { mode: 0o600 });
chmodSync(outputPath, 0o600);
unlinkSync(inputPath);
process.stdout.write(JSON.stringify({ records_indexed: hashes.length, raw_snapshot_deleted: true }) + "\n");
