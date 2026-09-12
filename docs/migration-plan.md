# Goldfish migration record and roadmap

This document records the Cloudflare migration from historical local memory
exports to Goldfish. It distinguishes delivered runtime behavior from deferred
work so a workflow file or client installer does not accidentally depend on an
unshipped feature.

## Evidence base

The following preserved files were used as import/provenance sources:

- `.agent-context/checkpoint.md`
- `mem0_export_2026-09-05.json`
- `mem0_export_2026-09-05 (1).json`
- `memory-export-0a7861cf-bfd1-4d5c-aa8b-5146392fd704.json`
- `memory-export-2d71c5a1-d9c4-4fad-a60-20b0205994a3.json`
- `memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3.json`
- `memory-export-31ee8889-37be-4cf9-b618-5acd6a556cb3 (1).json`
- `memory-export-957fb216-8321-4e69-ac73-077fbf77a001.json`
- `memory-export-bee80f31-b3bc-48c4-8735-656b0cfc3608.json`

They remain historical records only. They are not an active provider, fallback,
or client dependency.

## Delivery status

| Phase | Status | Delivered behavior / remaining boundary |
| --- | --- | --- |
| Canonical project and provenance model | Delivered | D1 projects, agents, sessions, memory records, versions, imports, keys, and audit events; project is the access boundary. |
| Worker API and key auth | Delivered | Project-scoped REST, MCP, and read-only GraphQL use hashed `gf_live_…` bearer keys. |
| Import normalization and ledger | Delivered | Historical export normalization, provenance capture, content hashing, deduplication, and versioned D1 records. |
| Private dashboard and observability | Delivered | Password-gated browser dashboard, memory management, analytics, audits, taxonomy, keys, R2 attachment metadata/uploads, lifecycle, and curation records. |
| Cross-agent recall | Delivered for bearer clients | A key can only reach its project; agent/session provenance accompanies its stored records. |
| Relationship graph | Delivered | D1 entities, mentions, and weighted association edges rebuilt from active project data. |
| Semantic retrieval and model pipeline | Deferred | Vectorize is bound, but the live endpoint deliberately uses deterministic lexical retrieval. |
| OAuth and Cloudflare Access | Deferred | Current remote clients need a scoped bearer key; OAuth discovery and Access policy integration are not available. |

## Preserved requirements

- Project-first authorization always wins over a global memory namespace.
- Agent/session provenance is retained when supplied and conflicts across
  projects are rejected.
- D1 is the source of truth; R2 stores private attachment bytes and Vectorize
  is not canonical storage.
- API key plaintext is never stored; it is returned only once at issuance.
- Dashboard lifecycle actions and curation are reversible. Automatic curation
  creates candidates; it does not silently delete or overwrite memory.
- Historical source records stay available for provenance without restoring a
  legacy provider into agent workflows.

## Remaining roadmap

### Semantic retrieval

A future adapter can create embeddings, write project-scoped vectors to
Vectorize, and combine bounded semantic candidates with canonical D1 records.
It must preserve explicit project filtering, provenance, and deterministic
fallback behavior.

### OAuth and workforce access

A future remote connector can add OAuth 2.1 discovery/dynamic registration and
optionally Cloudflare Access policy integration. It must keep dashboard session
credentials separate from client authorization, use least-privilege project
scopes, and avoid placing secrets in plugin files.

### Curation evolution

Current curation is intentionally candidate-only. Future work may add
human-approved synthesis creation, category reclassification, or retention
purge policies, but must preserve versions, auditability, and an explicit
confirmation step before irreversible action.

### Graph evolution

The current graph represents extractable associations and provenance. A future
semantic/causal graph would require a documented evidence model, confidence,
and review workflow; it must not portray co-occurrence as a factual causal
relationship.

## Completion criteria for future phases

A deferred feature is ready only when it has project-scope enforcement,
provenance preservation, tests, a clear dashboard/agent contract, and explicit
documentation of its data retention and credential boundaries.
