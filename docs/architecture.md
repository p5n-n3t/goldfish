# Goldfish architecture

## Purpose

Goldfish is a project-first durable memory system for a single private owner and
multiple coding agents. A project is the authorization and organization
boundary. Agents and sessions are provenance attached to a record; they do not
create a global shared-memory namespace.

Historical JSON exports and local workflow records are retained as migration
provenance. They are not a live dependency or automatic fallback service.

## Runtime components

| Component | Current responsibility | Boundary |
| --- | --- | --- |
| Worker | HTTP routing, authentication, validation, MCP, GraphQL, dashboard session, dashboard API, and scheduled curation | Only public application surface |
| D1 | Canonical projects, memory records and versions, agents/sessions, audit events, API-key metadata, settings, categories, feedback, curation, graph material, and Copilot messages | Canonical ledger; never exposed directly |
| R2 | Private uploaded attachment bytes | Referenced from D1 attachment metadata |
| Workers AI | Goldfish Copilot generation and action proposals | Bounded context; proposals require confirmation |
| Vectorize | Bound infrastructure reserved for a later retrieval adapter | Not in the live search path |

## Data model and provenance

A canonical memory contains content, kind, a SHA-256 content hash, project ID,
optional agent and session IDs, metadata, timestamps, and a current version.
Version rows preserve previous content whenever an administrator changes the
text. Import source references and audit events make a record traceable without
storing credentials or raw authorization data.

The current API accepts four kinds: `fact`, `conversation`, `document`, and
`task`. Workflow types such as `prompt_record`, `checkpoint`, `decision`,
`architecture`, `user_preference`, `project_state`, and `project_init` live in
metadata. A checkpoint is stored as a `task` with `metadata.type = "checkpoint"`.

## Access model

Goldfish currently uses four independent credentials:

1. `ADMIN_BOOTSTRAP_SECRET` creates projects and issues/revokes project API keys.
2. A scoped `gf_live_…` project API key authorizes REST, MCP, and GraphQL reads
   and writes only within its project.
3. A separately issued `gf_live_…` workspace key is limited to the owner's
   local agent installation. It requires explicit `projectId` values and can
   register a first-use project folder ledger. It does not change the scope of
   dashboard-issued project keys.
4. `DASHBOARD_PASSWORD` establishes the private browser administration session.

Project key hashes are stored in D1; plaintext tokens are returned only once at
issuance. Dashboard authentication uses a signed, HttpOnly, Secure,
SameSite=Strict cookie. Dashboard mutations apply same-origin protection.

Cloudflare Access and OAuth 2.1 discovery are not yet part of the deployed
runtime. They remain possible future integrations, not current authorization
claims.

## Agent path

1. An agent receives either a project-scoped key or the owner's protected
   workspace key through its credential store or environment.
2. It calls `/mcp`, the REST API, or read-only `/graphql`.
3. A project key is bound to one project and rejects cross-project access. A
   workspace key must name its target project explicitly, so folder detection
   remains part of every agent request.
4. D1 persists or retrieves canonical memory and provenance.
5. The agent receives the project-scoped response.

Live retrieval is deterministic lexical substring matching in D1. Vectorize is
not currently used to embed, rerank, or search memory, so no semantic ranking
claim should be made.

## Dashboard path

1. The owner opens the Worker root and submits the dashboard password.
2. The Worker returns a signed private-session cookie.
3. The browser calls `/admin/api/*` using that cookie.
4. D1 returns memory, versions, audit records, analytics, policy, graph, and
   curation data; R2 receives private attachment uploads; Workers AI serves
   bounded Copilot requests when configured.
5. Each dashboard mutation writes an audit event. Sensitive actions such as key
   issuance and Copilot proposals remain explicit user actions.

## Relationship graph and lifecycle

The relationship graph is stored in D1 through entities, memory mentions, and
weighted co-occurrence edges. A graph rebuild regenerates derived project graph
material from active records plus agent, session, and category provenance. It is
an operational association graph, not semantic/causal reasoning.

Lifecycle states are `active`, `archived`, `superseded`, `needs_review`, and
`deleted`. Deletion is soft and records remain restorable. Scheduled curation
creates candidate records only; approval currently moves a selected memory to
`needs_review`. This preserves original text and audit history while a human
reviews it.

## Future work that is intentionally not represented as shipped

- semantic embeddings, vector search, reranking, and a Vectorize retrieval
  adapter;
- OAuth 2.1 discovery/dynamic client registration and Cloudflare Access policy
  enforcement;
- public or multi-user dashboard access; and
- irreversible retention deletion or autonomous memory rewriting.

These additions must preserve the project boundary, provenance, explicit user
control, and canonical D1 record history described above.
