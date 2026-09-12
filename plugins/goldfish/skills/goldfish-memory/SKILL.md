---
name: goldfish-memory
description: Use Goldfish as the durable, project-scoped memory layer for Codex tasks.
---

# Goldfish memory

Use the configured `goldfish` MCP server for durable context. This skill is
project-scoped: the current project folder slug is the `projectId` boundary.
When the configured credential is the owner's workspace key, always send that
exact folder-derived `projectId`; do not rely on any implicit project default.
Project-scoped keys must never search or write another project.

## Startup

Before reading project files or planning:

1. Derive the exact lowercased, hyphenated project folder name as `projectId`.
2. Set a stable `agentId` such as `codex_cli` or `chatgpt_desktop`, and retain
   the current `sessionId` and task ID when the host provides them.
3. Call `memory_search` with noun phrases covering the task, prior decisions,
   failures, and checkpoints, with a bounded limit.
4. Save the full user request with `memory_save` as a `prompt_record` and
   `status: received` before file reads or planning.
5. Emit `Goldfish: <N> records recalled | agent=<agentId> | project=<projectId>`
   only after those operations succeed.

If Goldfish is unavailable, append the exact payload as one JSON object per line
to `.goldfish-pending.jsonl` in the project root and continue. Do not silently
skip durable context or put secrets in the pending ledger.

## Records

Use `kind: task` for prompt records and checkpoints, `fact` for decisions and
preferences, `document` for source-backed references, and `conversation` only
for compact conversation context. Preserve these metadata fields where known:

```json
{
  "type": "prompt_record|checkpoint|decision|architecture|user_preference|project_state|project_init",
  "date": "YYYY-MM-DD",
  "status": "received|in_progress|completed|crashed|paused",
  "agent": "codex_cli",
  "source_kind": "cli",
  "schema_version": 1
}
```

Never store API keys, bearer tokens, cookies, authorization headers, or other
secrets in content or metadata. `agentId` is provenance; `projectId` is the
authorization boundary.

## Checkpoints and recovery

Save a `checkpoint` after planning, each phase, every five file edits, each
meaningful verification, before a destructive action, and before context may
be lost. Include the prompt record ID, completed work, changed files, test
evidence, remaining work, next action, and blockers. On completion save both a
final `checkpoint` and a `project_state` record.

For a resumed or crashed task, retrieve the latest incomplete prompt record and
latest checkpoint for this project and agent, then resume their stated next
action. If either is absent, record the gap before proceeding.
