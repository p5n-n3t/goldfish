# CSV memory review staging

`scripts/stage-mem0-csv.mjs` is an offline review-preparation tool. It does not
connect to Goldfish, D1, a Cloudflare Worker, or any API, and it has no import
mode. The original CSV is opened read-only.

Run it only after choosing a new empty review directory:

```bash
node scripts/stage-mem0-csv.mjs \
  --input /home/jq/Desktop/memories_export_20260911_204353.csv \
  --output-dir /home/jq/Desktop/mem0-csv-review-20260911
```

For a later re-run, provide a text file with one SHA-256 `scope_hash` per line,
or a JSONL file whose records contain `scope_hash`. Those hashes are treated as
already imported and are recorded in `duplicates.jsonl`, never staged again.

```bash
node scripts/stage-mem0-csv.mjs \
  --input /home/jq/Desktop/memories_export_20260911_204353.csv \
  --output-dir /home/jq/Desktop/mem0-csv-review-20260911-rerun \
  --existing-hashes /absolute/path/to/already-imported-scope-hashes.txt
```

The output directory contains:

- `staged.jsonl`: records eligible for manual review, with original text,
  categories, source row/index/ID, and a deterministic `scope_hash`.
- `staged.csv`: the same eligible rows in spreadsheet-friendly form.
- `quarantine.jsonl`: only conservative low-signal candidates (empty text,
  text of 12 normalized characters or fewer, standalone greetings, or
  punctuation-only text). These are never deleted.
- `duplicates.jsonl`: repeated normalized scope hashes, with whether the match
  came from this file or from `--existing-hashes`.
- `report.json`: counts and file locations; it contains no memory text.

The hash is SHA-256 over NFKC-normalized, case-folded, whitespace-collapsed
`project_id`, `user_id`, `agent_id`, and text, separated by NUL bytes. Therefore
the same text remains distinct when it belongs to a different project, user, or
agent. The tool writes only when invoked. It refuses to overwrite output files
unless `--force` is supplied explicitly.
