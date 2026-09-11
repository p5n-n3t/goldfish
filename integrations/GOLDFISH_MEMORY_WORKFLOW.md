# Goldfish durable-memory workflow

This document preserves the existing Mem0 operating discipline while making
Goldfish the project-scoped memory service. It is a contract for an agent,
The deployed API and MCP surface support the workflow with scoped bearer keys;
OAuth-only clients remain a future adapter.

## Identity mapping

| Existing durable field | Goldfish field | Rule |
| --- | --- | --- |
| `user_id` | `metadata.owner_id` | Keep `jq`; it is provenance, not authorization. |
| `agent_id` | `agentId` and `metadata.agent` | Use the adapter-specific stable identifier. |
| `app_id` | `projectId` | Exact lowercased project folder slug; do not invent aliases. |
| `metadata.type` | `metadata.type` | Preserve `prompt_record`, `checkpoint`, `decision`, `architecture`, `user_preference`, `project_state`, and `project_init`. |
| `metadata.status` | `metadata.status` | Preserve `received`, `in_progress`, `completed`, `crashed`, and `paused`. |
| `metadata.source_kind` | `metadata.source_kind` | Preserve the client origin, such as `cli`, `desktop`, or `web`. |

`projectId` is the authorization boundary. A caller must never search or save
outside its authorized project, even if `metadata.owner_id` matches.

## Mandatory startup gate

Before reading project files, planning, or delegating work:

1. Determine the exact `projectId`, `agentId`, `sessionId`, and the task ID if
   the client provides one.
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

Use the MCP tools when they are live. The equivalent REST shapes are shown for
service adapters; every REST request requires a scoped bearer key.

```json
{
  "projectId": "example-project",
  "content": "Full user request — exact scope, constraints, sequencing, context",
  "kind": "task",
  "agentId": "codex_cli",
  "sessionId": "client-session-id",
  "metadata": {
    "owner_id": "jq",
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

Use `kind: "task"` for prompt records and checkpoints, `"fact"` for
decisions/preferences, `"document"` for source-backed reference material,
and `"conversation"` only for compact conversation context that needs
durability. Do not put credentials, raw tokens, cookies, access headers, or
unredacted secrets in `content` or metadata.

## Search contract

Call `memory_search` with the project ID, query, and a bounded limit. The
result must include record ID, content, agent/session provenance, timestamps,
metadata, score where applicable, and the authorization-scoped project ID.
Discard a result with missing project provenance rather than widening search.

## Checkpoint discipline

Save a `checkpoint` after: planning; each completed phase; every five file
edits; every meaningful verification; before a destructive action; and before
context may be lost. The checkpoint states the linked prompt record, completed
work, changed files, validation evidence, remaining work, next concrete
action, and blockers.

On completion, save both a final `checkpoint` and `project_state`. A completed
task without those records is not a complete Goldfish handoff.

## Offline pending ledger and reconciliation

When the Goldfish API or MCP server cannot perform a required operation,
append one JSON object per line to `.goldfish-pending.jsonl` in the project
root. It must preserve the payload above plus `pending_reason` and
`recorded_at`. Add that filename to the project’s untracked/local ignore
policy before using it. Do not overwrite a pending ledger and do not place it
in a global home-directory folder.

When Goldfish becomes available, replay each record in order with an idempotent
client-generated correlation ID in metadata, verify the returned project and
content hash, then retain the pending ledger until reconciliation is recorded
as a Goldfish checkpoint. Do not delete it during the cutover.

## Recovery

For a resumed, crashed, or compacted task: retrieve the latest incomplete
`prompt_record`, then the latest `checkpoint`, filtered to the same project
and agent when possible. Resume from their stated next action. If either is
absent, create a checkpoint explaining the gap before proceeding.

## Live-API status

Goldfish implements authenticated, project-authorized `memory_search`,
`memory_save`, and `memory_checkpoint`; `memory_get` and
`memory_list_projects` support full recovery and project discovery. The
current retrieval path is lexical and deterministic. Use the local pending
ledger only during an actual outage, then reconcile it in order.
