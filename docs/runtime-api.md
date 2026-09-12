# Goldfish runtime contract

Goldfish exposes an agent API and a separate private administration API from
the same Cloudflare Worker. Every response uses `Cache-Control: no-store`.
The service does not collect a request-history product: dashboard analytics are
derived from durable D1 memory and audit records.

## Deploy prerequisites

Apply all migrations in order before deploying a Worker that serves the
administration plane:

```bash
npx wrangler d1 migrations apply goldfish --remote --config wrangler.jsonc
```

- `0001_initial.sql` creates the project, provenance, memory, version, key,
  import, and audit tables.
- `0002_admin_memory_lifecycle.sql` adds lifecycle and change-history fields.
- `0003_admin_dashboard_foundation.sql` adds project settings, categories,
  feedback, entities and edges, attachment metadata, curation records, and
  Copilot conversations.

The Worker needs `ADMIN_BOOTSTRAP_SECRET` (minimum 32 characters) for project
bootstrap routes and `DASHBOARD_PASSWORD` (minimum 16 characters) for the
browser dashboard. Project clients use a separately issued `gf_live_…` token.

## Authentication boundaries

| Surface | Credential | Scope |
| --- | --- | --- |
| Bootstrap routes | `Authorization: Bearer <ADMIN_BOOTSTRAP_SECRET>` | Create projects, issue/revoke project keys |
| REST, GraphQL, MCP | `Authorization: Bearer <gf_live_…>` | One project per project key; explicit `projectId` per call for the owner's workspace key |
| Dashboard and `/admin/api/*` | `DASHBOARD_PASSWORD` session cookie | Private owner administration |

Dashboard login creates a signed, HttpOnly, Secure, SameSite=Strict cookie that
expires after 12 hours. Cookie-authenticated mutations reject a browser request
whose `Origin` does not match the Worker origin. The dashboard password is never
returned by the API or embedded in its HTML.

OAuth discovery and Cloudflare Access policy integration are not implemented in
this runtime. Do not configure an API key as an OAuth credential.

## Health and dashboard session

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Public liveness response |
| `GET` | `/` | Dashboard when a valid session exists; password sign-in shell otherwise |
| `POST` | `/admin/login` | `{ "password": "…" }`; establishes dashboard session |
| `GET` | `/admin/session` | Confirms the current dashboard session |
| `POST` | `/admin/logout` | Clears the dashboard session cookie |

## Bootstrap and project API keys

All routes in this section require the bootstrap credential and HTTPS (except
local development).

| Method | Path | Input / behavior |
| --- | --- | --- |
| `POST` | `/v1/projects` | `{ "id": "project-slug", "name": "Project name" }`; creates or updates a project |
| `POST` | `/v1/projects/:projectId/keys` | Optional `{ "label": "client name" }`; returns a one-time `gf_live_…` token |
| `DELETE` | `/v1/projects/:projectId/keys/:keyId` | Revokes a key while retaining the audit record |

Only the SHA-256 hash and a display prefix persist in D1. Copy a newly issued
token directly into its intended client credential store. It is deliberately
not recoverable after the issuance response.

The private dashboard has parallel key issuance/list/revocation controls for
the signed-in owner; see [admin-dashboard.md](admin-dashboard.md).

## Project client REST API

Every route here requires a project `gf_live_…` bearer key. The key authorizes
exactly its stored `projectId`; cross-project requests return `403`.

| Method | Path | Input / behavior |
| --- | --- | --- |
| `GET` | `/v1/projects` | Lists the one project authorized by the key |
| `POST` | `/v1/projects/:projectId/memory` | Creates or deduplicates a memory |
| `POST` | `/v1/projects/:projectId/memory/search` | Case-sensitive literal substring search |
| `GET` | `/v1/projects/:projectId/memory/:id` | Retrieves one memory in the authorized project |
| `POST` | `/v1/projects/:projectId/checkpoints` | Saves a `task` memory with `metadata.type = "checkpoint"` |

A normal memory body is:

```json
{
  "content": "Durable project fact or checkpoint",
  "kind": "fact",
  "metadata": { "type": "decision" },
  "agentId": "codex_cli",
  "sessionId": "task-session"
}
```

Allowed kinds are `fact`, `conversation`, `document`, and `task`. Content is
required and limited to 100,000 characters; metadata is an object limited to
32,000 serialized characters. Agent and session IDs must use the supported ID
syntax and stay project-consistent. Identical content within a project is
idempotently deduplicated.

Search accepts `{ "query": "literal text", "limit": 20 }`; `limit` is 1–100.
The current live retrieval mode is case-sensitive lexical substring matching, not semantic/vector ranking.

## Streamable HTTP MCP

Configure the remote endpoint with the same project key:

```text
https://goldfish.ziopsyop.tech/mcp
Authorization: Bearer ${GOLDFISH_API_KEY}
```

MCP authentication is required for initialization and every tool call. The tool
surface is:

- `memory_status`
- `memory_search`
- `memory_get`
- `memory_save`
- `memory_checkpoint`
- `memory_list_projects`

`projectId` is optional only because it defaults to the project authorized by
the key; a caller cannot use it to widen access. See the installation examples
in [`integrations/adapters`](../integrations/adapters).

## GraphQL read API

`POST /graphql` accepts the same API key and supports read-only queries.
Mutations are rejected. The supported root fields are `project`, `memory(id)`,
`search(query, limit)`, and `dashboard`. Workspace keys must include a
`projectId` argument on `memory`, `search`, and `dashboard`, or use the
existing `project(id: ...)` argument.

```json
{
  "query": "{ project { id name } search(query: \"checkpoint\", limit: 10) { id content kind } dashboard { memoryRecords agents } }"
}
```

For example, a workspace-key search is
`search(projectId: "trumpfiles.fun-new", query: "checkpoint")`. This explicit
target prevents an anchor project from being used by accident.

The GraphQL `dashboard` field is a compact legacy summary (`memoryRecords`,
`projects`, `agents`, `imports`). Use the cookie-authenticated admin API for
full analytics, curation, relationship graph, and record management.

## Private dashboard API

All `/admin/api/*` routes require the dashboard session cookie. They are
intended for the supplied browser control room, not untrusted third-party
clients. The central route groups are:

| Route group | Operations |
| --- | --- |
| `/admin/api/projects` | List or create projects |
| `/admin/api/projects/:projectId/memories` | List (with query, kind, agent, session, category, lifecycle, date, page, and page-size filters) or create memory |
| `/admin/api/projects/:projectId/memories/:id` | View full record, versions, and audit; patch or soft-delete |
| `/admin/api/projects/:projectId/memories/:id/restore` | Restore to `active` |
| `/admin/api/projects/:projectId/memories/bulk` | Apply `delete`, `restore`, or lifecycle changes to up to 100 records |
| `/admin/api/projects/:projectId/memories/:id/feedback` | Add feedback, ratings, corrections, or flags |
| `/admin/api/projects/:projectId/memories/:id/media` | List or attach external/R2 attachment metadata |
| `/admin/api/projects/:projectId/memories/:id/media/upload` | Upload one base64-encoded file to the configured R2 bucket; decoded data is limited to 5 MB |
| `/admin/api/projects/:projectId/analytics`, `/meta`, `/summary` | Analytics and filter/provenance metadata |
| `/admin/api/projects/:projectId/settings`, `/categories` | Curation settings and category taxonomy CRUD |
| `/admin/api/projects/:projectId/entities`, `/graph`, `/graph/rebuild` | Relationship graph reads and full-project rebuild |
| `/admin/api/projects/:projectId/curation/preview`, `/jobs`, `/jobs/:id`, `/jobs/:id/approve` | Reviewable curation runs and candidate approval |
| `/admin/api/projects/:projectId/api-keys` | List, issue, and revoke project keys |
| `/admin/api/projects/:projectId/copilot` | Start/continue a Copilot conversation and explicitly apply its proposals |
| `/admin/api/audit` | Recent administrative audit events, optionally filtered by project |

The dashboard API intentionally has no raw request viewer or memory-export
route.

## Lifecycle, curation, graph, and Copilot behavior

Memory lifecycle states are `active`, `archived`, `superseded`, `needs_review`,
and `deleted`. Dashboard deletion is soft: content versions and audit history
remain available, and a record can be restored to `active`.

The daily cron runs only for projects whose `autoCurationEnabled` setting is
on. It creates review candidates for low-signal content, retention windows, and
optional long-memory synthesis. It does **not** silently delete or rewrite a
memory. Approving a curation candidate currently moves its record to
`needs_review`, preserving the original and all historical versions.

Graph rebuilding uses persisted active memory, agents, sessions, and categories
to generate project-local entities and weighted co-occurrence edges. It is a
repeatable full-project rebuild; it does not imply semantic graph inference.

Goldfish Copilot receives a bounded recent project context (up to 16 current
memories, each truncated for the prompt) through the configured Workers AI
binding. It stores its conversation and may offer proposals. A proposal does
nothing until the signed-in owner calls its explicit apply route.

## Verification

Run:

```bash
npm run check
```

The suite covers D1 project isolation, token hashing/revocation, REST and MCP
operations, dashboard login, record lifecycle/history, attachments, analytics,
settings/categories, graph rebuild idempotence, curation, and confirmation-
only Copilot proposals.
