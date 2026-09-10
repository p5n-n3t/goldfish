# Goldfish architecture

## Scope and evidence

This design is grounded in the repo-local investigation record and export set, especially `.agent-context/checkpoint.md` and the JSON export files named in the root README. The checkpoint explicitly states that Cloudflare Agent Memory is private beta, that remote MCP/OAuth is feasible, and that recall should be project-first with agent/session provenance. These are treated as design requirements.

## Design principles

1. Project-first memory
   - Memory is organized by project, workspace, and task scope instead of globally across all agents.
   - Recall is answerable only when the caller is authorized for that project and its records.
   - Shared memory is a product feature, not an unscoped default.

2. Provenance-first records
   - Every record carries agent identity, session identity, task identity, source object, model/provider, and timestamp metadata.
   - The canonical record is never a free-form text blob without provenance.
   - A recall result is traceable to exactly which agent produced or imported it.

3. Cloudflare-native minimal dependency set
   - Worker API owns orchestration and auth.
   - D1 holds canonical records and metadata.
   - Vectorize holds semantic search indexes.
   - R2 stores raw artifacts and import snapshots.
   - Workers AI runs extraction and embedding behind a provider adapter.
   - Remote MCP is a connectivity layer, not a standalone memory product.

4. Privacy and trust boundaries
   - Sensitive data remains subject to project auth and API policies.
   - Raw import artifacts are separate from canonical metadata and retrieval indexes.
   - Retrieval is bounded by project membership and provenance scope.

## System components

### 1. Worker API

The Cloudflare Worker is the public control plane for Goldfish.

Responsibilities:
- authenticate request contexts via Access, OAuth, and API keys
- validate project IDs and session scopes
- ingest raw imports and normalized memory records
- trigger asynchronous extraction and embedding tasks
- serve read/search endpoints and GraphQL payloads
- manage admin actions like re-indexing and retention policy

The Worker is also the secure boundary between internal Cloudflare services and external clients. It should not expose D1 or Vectorize directly to untrusted callers.

### 2. Remote MCP layer

Remote MCP connects Goldfish to external tools, agent runners, and provider-specific services without assuming a single vendor memory backend.

Use cases:
- agent-to-agent command and tool invocation
- external retrieval of project context
- metadata exchange for session and task provenance
- tool interoperability across sub-agents and orchestrators

MCP is not a replacement for canonical storage; it is the network protocol layer for coordination.

### 3. D1 canonical records and metadata

D1 is the source of truth for structured and operational memory.

Core entities:
- projects
- agents
- sessions
- tasks
- memory_records
- memory_versions
- imports
- embeddings metadata
- auth identities
- retention policies

Canonical record model:
- id
- project_id
- source_type
- source_ref
- agent_id
- session_id
- task_id
- created_at
- updated_at
- content_hash
- canonical_text
- metadata_json
- provenance_json
- access_policy_json

D1 stores only canonical record data and governance metadata; raw files remain in R2.

### 4. Vectorize semantic retrieval

Vectorize hosts semantic search indexes used for recall and retrieval.

Design patterns:
- project-scoped indexes instead of global search
- embedding model metadata in the same record as the vector
- versioned index namespaces with rebuilds on schema changes
- filter-based recall using project_id, agent_id, session_id, and source_type

Semantic retrieval does not replace the canonical D1 record store; it is an accelerator for search and recall.

### 5. R2 raw import artifacts

R2 stores source artifacts, imported text blobs, logs, and immutable snapshots.

Examples:
- uploaded documents
- extracted transcripts
- session exports
- raw API payloads
- prior versions of a memory blob for auditability

R2 is the artifact store; D1 is the metadata and governance store. This split prevents the canonical system from depending on raw file content for retrieval decisions.

### 6. Workers AI and provider adapter

Goldfish uses Workers AI for extraction and embeddings, but the actual implementation must be adapter-based so the system can change providers without rewriting workflow logic.

Provider abstraction:
- text extraction
- chunking
- embeddings
- reranking (optional)
- summarization (optional)

The adapter contract should be narrow and versioned. A provider may be Cloudflare AI, a remote LLM endpoint, or a future internal gateway. The domain logic must not assume a single model family or provider-specific response schema.

### 7. Auth model

Goldfish supports the expected Cloudflare-friendly auth stack:
- Access for end-user and workforce identity control
- OAuth for delegated app integrations
- API keys for service-to-service and admin automation

Authorization rules:
- project admins manage policy and retention
- agents can read/write only within authorized project scopes
- sessions map to a parent task or project boundary
- sensitive memory actions are logged and auditable

### 8. Dashboard analytics

The dashboard layer collects operational and product metrics.

Examples:
- memory ingest volume by project and source
- recall hit rates by index and agent type
- session provenance coverage
- failed extraction rates and retries
- API volume and latency
- retention and purge events

The dashboard is a management plane, not a replacement for the canonical search system.

### 9. GraphQL read API

Goldfish exposes a GraphQL read API for consumers that need flexible nested retrieval patterns without writing custom SQL.

Read-only patterns:
- project summaries
- session memory history
- agent recall provenance
- source snapshots and versions
- search results with metadata

The read API must be explicitly separated from write operations; mutation flows stay in the Worker API layer.

### 10. Optional future relation graph

A future relation graph is intentionally optional. It would connect memory records by semantic, causal, or project relationship edges.

Potential uses:
- dependency and influence tracing
- cross-agent impact analysis
- project-level narrative reconstruction
- relationship-aware recall ranking

This is a future enhancement and should not block the initial D1 + Vectorize + R2 design.

## Project-first cross-agent recall

Goldfish is designed for agent/session provenance-based recall rather than for an unbounded, global memory pool.

At a minimum, each memory item should include:
- project_id
- agent_id
- session_id
- task_id or task reference
- source_type and source_ref
- prompt or event context
- timestamp
- policy scopes
- trust and validation state

Recall logic:
- gather project-scoped candidate records from D1 and Vectorize
- apply provenance filters from the caller session/task context
- run semantic retrieval only over the approved project index
- merge results with metadata and access policies
- return provenance with each result

This pattern keeps cross-agent recall useful without turning unbounded memory into a security or governance problem.

## Data flow

1. External agent or service calls the Worker API.
2. Auth middleware validates Access/OAuth/API-key scope.
3. The Worker records a session event and provenance context.
4. Imports are persisted to R2 and canonicalized into D1.
5. Extraction and embedding jobs run via the provider adapter.
6. Embedding results are written to Vectorize for semantic retrieval.
7. Read APIs query D1 and Vectorize under project-scoped policies.
8. Dashboard analytics aggregate usage and operational health.

## Security and governance

- Do not expose raw memory writes without project-level authorization.
- Do not treat Agent Memory as a storage dependency; this design is resilient if the private beta remains unavailable.
- Retention and purge should be explicit policy actions, not accidental data survival.
- Canonical records, raw artifacts, and indexes must be separately auditable.

## Constraints to preserve

- Private beta platform dependency is not allowed.
- No pricing, benchmark, or account ownership claims are used in the design.
- No deployment assumptions beyond Cloudflare-native service composition are made.
- External MCP is used as a communication layer, not as the canonical memory store.
