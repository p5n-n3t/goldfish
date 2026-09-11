# Goldfish

Goldfish is a Cloudflare-native project memory and recall system for multi-agent work. The Worker, project-scoped bearer API, Streamable HTTP MCP endpoint, D1 ledger, migration normalizer, and dashboard are implemented in this repository.

## Evidence reviewed

- `.agent-context/checkpoint.md`
- `mem0_export_2026-09-05.json`
- `mem0_export_2026-09-05 (1).json`
- `memory-export-0a7861cf-bfd1-4d5c-aa8b-5146392fd704.json`
- `memory-export-2d71c5a1-d9c4-4fad-a60b-20b0205994a3.json`
- `memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3.json`
- `memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3 (1).json`
- `memory-export-957fb216-8321-4e69-ac73-077fbf77a001.json`
- `memory-export-bee80f31-b3bc-48c4-8735-656b0cfc3608.json`

## Design summary

Goldfish uses a Cloudflare-first architecture with these primary services:

- Worker API for authenticated project actions and orchestration.
- Remote MCP for external tool and agent connectivity without embedding a vendor-specific memory service as a hard dependency.
- D1 as the canonical ledger for memory records, session metadata, provenance, and policy state.
- Vectorize for semantic retrieval over embeddings and project-scoped memory indexes.
- R2 for raw import artifacts, source documents, exports, and immutable snapshots.
- Workers AI for extraction and embedding jobs behind a provider adapter to allow swapping model backends without changing domain logic.
- Access, OAuth, and API-key auth to control read/write access by project, agent, and session.
- Dashboard analytics for agent usage, recall quality, and operational health.
- GraphQL read API for consumer-facing queries that must stay separate from write paths.
- Optional future relation graph for graph-based reasoning and impact tracing.

## Non-negotiable constraints

- Cloudflare Agent Memory is private beta and is explicitly not a dependency for Goldfish.
- Cross-agent recall is scoped to the project, not a global memory namespace.
- Agent and session provenance must be preserved on every record so recall remains explainable and auditable.
- Project-first design wins over a generic “one memory for everyone” model.
- No pricing, deployment, benchmark claims, or ownership assumptions are included in this design.

## Current runtime

The deployed service is `https://goldfish.ziopsyop.tech`.

- `GET /health` is a public liveness check.
- `POST /v1/projects` and `/v1/projects/:id/keys` are protected bootstrap operations.
- Memory REST routes and `POST /mcp` require a scoped `gf_live_...` bearer key.
- MCP exposes `memory_search`, `memory_get`, `memory_save`, `memory_checkpoint`, and `memory_list_projects` alongside `memory_status`.
- D1 is the canonical ledger; the current retrieval implementation is deterministic lexical search with provenance. Vectorize and Workers AI bindings are reserved for the next retrieval adapter.
- OAuth discovery and a ChatGPT-style OAuth connector are future work. API-key clients can use the live endpoint now.

See [`docs/runtime-api.md`](docs/runtime-api.md) for the request contract and [`integrations/README.md`](integrations/README.md) for client setup. Never commit a bearer key; use a client credential store or environment variable.
