# Goldfish migration plan

## Objective

This migration plan turns the design in `README.md` and `docs/architecture.md` into a phased implementation path for a Cloudflare-native Goldfish project memory system. It is intentionally explicit about what is in scope and what is out of scope.

## Evidence base

The plan is based on:
- `.agent-context/checkpoint.md`
- `mem0_export_2026-09-05.json`
- `mem0_export_2026-09-05 (1).json`
- `memory-export-0a7861cf-bfd1-4d5c-aa8b-5146392fd704.json`
- `memory-export-2d71c5a1-d9c4-4fad-a60b-20b0205994a3.json`
- `memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3.json`
- `memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3 (1).json`
- `memory-export-957fb216-8321-4e69-ac73-077fbf77a001.json`
- `memory-export-bee80f31-b3bc-48c4-8735-656b0cfc3608.json`

## Phase 0: design hardening and contracts

Goals:
- confirm the project model, agent model, session model, and task model
- define canonical record schemas for D1
- define security and retention boundaries
- freeze provider adapter interfaces for extract/embedding/model orchestration

Outputs:
- D1 schema migration files
- Worker route contract table
- provenance schema and validation rules
- retention policy specification

Key decisions:
- project-first memory is the default behavior
- agent/session/task provenance is required for every record
- Cloudflare Agent Memory is not part of the required stack

## Phase 1: Worker API and authentication

Goals:
- build the authenticated management layer
- implement Access/OAuth/API-key validation
- establish project and session scoping
- add audit logs for ingest and recall actions

Outputs:
- authenticated Worker routes for create/read/search/admin
- policy enforcement for project membership and session contexts
- structured request logging

Design notes:
- All mutating routes should pass through a single validation and provenance middleware.
- Query routes should return only the records allowed by current auth and project scope.

## Phase 2: D1 canonical ledger and import pipeline

Goals:
- create D1 tables for projects, agents, sessions, tasks, memory records, imports, and metadata
- implement import normalization and canonicalization
- persist raw artifacts to R2 and canonical metadata to D1

Outputs:
- canonical memory-writing path
- import receipts and snapshots
- deterministic content hashing and version tracking

Design notes:
- R2 stores the raw artifact; D1 stores the canonical record metadata and reference pointer.
- Duplicate or re-imported content should be detected by content hash and provenance boundary.
- The current export set contains 204 candidate memories after collapsing one malformed duplicate pair. Preserve source file and row provenance, do not derive absolute dates from relative timestamps, retain superseded records as inactive, and send short or multi-claim records through review before publication.

## Phase 3: semantic retrieval and AI pipeline

Goals:
- implement embedding pipeline with provider adapter abstraction
- store vector payloads in Vectorize
- add project-scoped semantic retrieval
- support retrieval-only filters by project, agent, session, and source

Outputs:
- vector index definitions
- adapter interface for extraction and embedding
- semantic recall worker handlers

Design notes:
- The provider adapter must hide model-specific responses behind stable interfaces.
- Vectorize is a retrieval acceleration layer, not the source of truth.

## Phase 4: read API, dashboard, and observability

Goals:
- expose GraphQL read API for structured recall and project queries
- add dashboard analytics on memory health and recall usage
- instrument failure paths, retry behavior, and policy violations

Outputs:
- GraphQL schema
- dashboard widgets for activity, recall quality, and ingestion health
- operational alerts for failed jobs and missing provenance

Design notes:
- Dashboard metrics should help operational teams reason about project memory quality, not replace governance.

## Phase 5: cross-agent recall and provenance validation

Goals:
- implement project-first cross-agent recall with explicit session provenance
- validate source traceability and model provenance
- provide recall outputs with agent/session references tied to each result

Outputs:
- recall expansion pipeline across project-scoped sources
- provenance display layer for results
- replayable memory explanation for agent actions

Design notes:
- Cross-agent recall is only allowed within authorized project and session boundaries.
- This design prevents “global memory as default” and prevents hidden cross-context leakage.

## Phase 6: optional relation graph and future expansion

Goals:
- prepare the data model for a future relation graph
- identify nodes and edge types that are worth graph modeling
- keep graph work isolated from the base memory system

Outputs:
- relation graph schema draft
- graph loading rules for entities and edges
- optional query patterns for dependency and influence tracing

Design notes:
- The relation graph is optional and additive; it must not be required for the initial system to work.

## Explicit non-goals

- No dependency on Cloudflare Agent Memory, because it is private beta and cannot be treated as a required platform feature.
- No universal global memory namespace for all agents across all projects.
- No claim of benchmark superiority, pricing guarantees, or deployment ownership.
- No assumption that a single provider or a single model family will be the only valid backend.
- No graph-first implementation before the canonical project memory and retrieval stack is secure and working.
- No remote MCP use as a replacement for source-of-truth D1 records.
- No direct D1/Vectorize exposure to clients without Worker mediation.

## Risk areas to watch

- partial provenance metadata on imported content
- cross-project leak risk in semantic retrieval indexes
- unbounded raw artifact growth in R2
- API-key misuse and stale project membership
- provider adapter drift as model APIs evolve

## Exit criteria

The migration is complete when:
- all record writes are canonicalized in D1
- all raw imports are retained in R2
- retrieval is project-scoped through Vectorize
- auth policies are enforced before read/write access
- agent and session provenance is present in every recall result
- dashboard and read API provide operational visibility without bypassing the Worker contract

## Implementation order

1. project and provenance schema
2. auth and Worker routes
3. D1 canonical ledger and R2 import path
4. provider adapter and embeddings
5. Vectorize index and retrieval
6. GraphQL and dashboards
7. provenance validation and security review
8. optional graph expansion after core system is stable
