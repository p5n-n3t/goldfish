# Goldfish durable-memory workflow

Goldfish is the project-scoped durable-memory service for agents. This protocol
preserves the established checkpoint and recovery discipline while removing the
legacy provider from the active workflow. The deployed API and MCP surface use
scoped bearer keys; OAuth-only clients cannot use this remote endpoint until an
OAuth adapter exists.

## Identity mapping

| Durable field | Goldfish field | Rule |
| --- | --- | --- |
| agent identity | `agentId` and `metadata.agent` | Use the adapter-specific stable identifier. |
| application/project identity | `projectId` | Exact lowercased project folder slug; do not invent aliases. |
| `metadata.type` | `metadata.type` | Preserve `prompt_record`, `checkpoint`, `decision`, `architecture`, `user_preference`, `project_state`, and `project_init`. |
| `metadata.status` | `metadata.status` | Preserve `received`, `in_progress`, `completed`, `crashed`, and `paused`. |
| `metadata.source_kind` | `metadata.source_kind` | Preserve the client origin, such as `cli`, `desktop`, or `web`. |

`projectId` is the ledger boundary. A project key must never search or save
outside its authorized project. The owner's local-agent workspace key spans
projects only when every operation supplies the exact folder-derived
`projectId`; it never supplies an implicit cross-project default.

## Mandatory startup gate

Before reading project files, planning, or delegating work:

1. Determine the exact `projectId`, `agentId`, `sessionId`, and task ID when the
   client provides one.
2. Call `memory_search` within that project for the current task, prior
   decisions, failures, and checkpoints. Use noun phrases and combine relevant
   result sets; do not treat one broad search as full recall.
3. Save the full user request as a `prompt_record` with status `received`.
4. Emit a compact status only after the operations succeed: `Goldfish: <N>
   records recalled | agent=<agentId> | project=<projectId>`.
5. If Goldfish is unavailable, write the exact prompt record to the local
   project ledger described below, say `Goldfish unavailable; local pending
   ledger active`, and continue. Never silently skip durable context.

## Record shapes

Use the MCP tools when they are available. The equivalent REST shapes are for
service adapters; every REST request requires a scoped bearer key. Workspace
clients must include `projectId` even when it matches the current folder.

```json
{
  "projectId": "example-project",
  "content": "Full user request — exact scope, constraints, sequencing, context",
  "kind": "task",
  "agentId": "codex_cli",
  "sessionId": "client-session-id",
  "metadata": {
    "type": "prompt_record",
    "date": "2026-09-11",
    "status": "received",
    "agent": "codex_cli",
    "source_kind": "cli",
    "task_id": "client-task-id",
    "schema_version": 1
  }
}
```

Use `kind: "task"` for prompt records and checkpoints, `"fact"` for decisions
and preferences, `"document"` for source-backed reference material, and
`"conversation"` only for compact conversation context that needs durability.
Do not put credentials, raw tokens, cookies, access headers, or unredacted
secrets in `content` or metadata.

## Search contract

Call `memory_search` with the project ID, query, and a bounded limit. Results
must be project-scoped and retain content, agent/session provenance,
timestamps, and metadata. The live retrieval path is deterministic lexical
matching, so agents should use precise noun phrases and bounded result sets.

## Checkpoint discipline

Save a `checkpoint` after planning, each completed phase, every five file
edits, each meaningful verification, before a destructive action, and before
context may be lost. Include the linked prompt record, completed work, changed
files, validation evidence, remaining work, next concrete action, and blockers.

On completion, save both a final `checkpoint` and `project_state`. A completed
task without those records is not a complete Goldfish handoff.

## Offline pending ledger and reconciliation

When Goldfish cannot perform a required operation, append one JSON object per
line to `.goldfish-pending.jsonl` in the project root. Preserve the normal
record payload plus `pending_reason` and `recorded_at`. Add that filename to the
project’s local ignore policy before using it. Do not overwrite a pending ledger
and do not place it in a global home-directory folder.

When Goldfish becomes available, replay records in order with a client-generated
idempotency/correlation field in metadata, verify the returned project and
content hash, then retain the pending ledger until reconciliation is recorded as
a Goldfish checkpoint. Do not delete the ledger during recovery.

## Recovery

For a resumed, crashed, or compacted task, retrieve the latest incomplete
`prompt_record`, then the latest `checkpoint`, filtered to the same project and
agent when possible. Resume from their stated next action. If either is absent,
create a checkpoint explaining the gap before proceeding.
