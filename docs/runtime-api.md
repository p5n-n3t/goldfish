# Running the authenticated memory service

The Worker implements project-scoped API keys, REST memory endpoints, and
stateless Streamable HTTP MCP at `/mcp`. Retrieval currently uses literal,
case-insensitive SQLite `LIKE` substring matching; no semantic ranking is claimed.

## GraphQL read endpoint

`POST /graphql` accepts the same project API key as REST and MCP. It is a
read-only, project-scoped GraphQL surface; mutations are rejected. The body is
`{"query":"{ project { id name } search(query: \"checkpoint\", limit: 10) { id content kind } dashboard { memoryRecords agents } }"}`.

The root fields are `project`, `memory(id)`, `search(query, limit)`, and
`dashboard`. Project fields are `id`, `name`, `createdAt`, and `updatedAt`;
memory fields mirror the REST record; dashboard fields are `memoryRecords`,
`projects`, `agents`, and `imports`. Every lookup is forced to the project
bound to the bearer key, including `memory(id)`.

## Bootstrap and key lifecycle

Apply `migrations/0001_initial.sql` to the D1 database bound as `DB`. Configure
`ADMIN_BOOTSTRAP_SECRET` using Wrangler's secret input with a separately generated
random secret of at least 32 characters; keep it in a password manager. The admin
routes fail closed when that secret is absent or too short. Never share this
admin secret with memory clients.

All admin requests require `Authorization: Bearer <admin-secret>` and HTTPS
(except localhost development):

| Method | Path | JSON body / result |
| --- | --- | --- |
| POST | `/v1/projects` | `{ "id": "project-slug", "name": "Project name" }`; creates or updates a project |
| POST | `/v1/projects/:projectId/keys` | `{ "label": "client name" }`; returns `id`, `projectId`, `keyPrefix`, `label`, and the one-time `token` |
| DELETE | `/v1/projects/:projectId/keys/:keyId` | Revokes the key, preserving its row and writing an audit event |

Transfer the issuance response directly to the intended client's secret store;
do not write it to logs, shell history, source files, or screenshots. Only the
SHA-256 hash and display prefix persist in D1. Issuance and its audit event run
in a single transaction; revocation is idempotent. The exact token contract is
in [api-key-cutover.md](api-key-cutover.md).

## Client API

Every client request requires `Authorization: Bearer <gf_live_token>`. The key
allows access to exactly its stored project. Cross-project requests return 403;
missing, malformed, and revoked credentials return 401. Missing D1 returns 503.
Responses use `Cache-Control: no-store`.

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/v1/projects` | Lists only the authorized project |
| POST | `/v1/projects/:projectId/memory` | `{ "content": "...", "kind": "fact", "metadata": {}, "agentId": "project-agent", "sessionId": "project-session" }` |
| POST | `/v1/projects/:projectId/memory/search` | `{ "query": "literal substring", "limit": 20 }` |
| GET | `/v1/projects/:projectId/memory/:id` | Retrieves a memory in this project; unknown IDs return 404 |
| POST | `/v1/projects/:projectId/checkpoints` | Memory input with optional `kind`; stores `kind: "task"` and `metadata.type: "checkpoint"` |

Kinds are `fact`, `conversation`, `document`, and `task`. Content is required,
nonblank, and at most 100,000 characters; metadata is limited to 32,000 JSON
characters. Search queries are nonblank and at most 2,000 characters; limits are
integers from 1 through 100. IDs use letters, digits, dots, underscores, colons,
and hyphens, begin with a letter or digit, and are at most 200 characters.

Agent and session IDs are optional; when supplied, their provenance rows are
created atomically with the memory. Use project-specific IDs because those
primary keys are globally unique. Existing cross-project identifiers and
conflicting session-agent relationships are rejected. Record/version writes
are transactional. Identical content within a project returns the existing
record and retains its original kind, metadata, and provenance.

## MCP clients

Configure the remote MCP URL `https://goldfish.ziopsyop.tech/mcp` with the same
project API-key Authorization header. Initialization and all MCP operations
require authentication. Tools are:

- `memory_save`: content, kind, optional metadata / agentId / sessionId / projectId.
- `memory_search`: query, optional limit / projectId.
- `memory_get`: id, optional projectId.
- `memory_checkpoint`: content and optional metadata / agentId / sessionId / projectId.
- `memory_list_projects`: no arguments.

Omitting `projectId` selects the key's project. `memory_status` reports the
currently authorized project and lexical retrieval mode. Clients must support
API-key headers; OAuth client authorization is not implemented by this runtime.

## Verification

`npm run check` includes local D1 integration tests for admin boundaries, exact
key hashing, project isolation, provenance, duplicate saves, literal search,
checkpoints, MCP initialization and tool calls, and revoked credentials. Tests
use generated ephemeral keys and an isolated Miniflare D1 database.
