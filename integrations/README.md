# Goldfish agent cutover package

This package contains secret-free client instructions and workflow templates
for Goldfish. The deployed Worker accepts scoped bearer API keys now. Copy an
adapter only after issuing a key for the intended project; never put that key
in a repository or agent prompt.

## Current cutover status: API-key pilot ready

The production route `https://goldfish.ziopsyop.tech` exposes authenticated
REST memory operations and a Streamable HTTP MCP endpoint. API-key clients can
use the five memory tools after provisioning a project key. OAuth discovery is
not implemented yet, so OAuth-only connectors remain future work.

| Requirement | Required for | Current state |
| --- | --- | --- |
| scoped bearer API-key verification | every read/write client | **live** |
| MCP `memory_search`, `memory_get`, `memory_save`, `memory_checkpoint`, `memory_list_projects` | MCP adapters | **live** |
| project/agent/session authorization and audit logging | every read/write client | **live in D1 runtime** |
| project provisioning and key issuance path | adapter onboarding | **live via admin bootstrap** |
| OAuth discovery / ChatGPT-style connector | OAuth-only clients | **future** |

The live Worker REST shape is:

```text
POST /v1/projects/{projectId}/memory
POST /v1/projects/{projectId}/memory/search
```

Every memory request requires `Authorization: Bearer <gf_live_token>` and is
checked against the key's project scope. The admin bootstrap secret is only
for provisioning projects and issuing or revoking keys; it is not a client
memory credential.

## Files

- `GOLDFISH_MEMORY_WORKFLOW.md` — canonical replacement for the Mem0 durable
  workflow, including the exact semantic mapping and offline behavior.
- `templates/` — project-local `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
  instruction templates. Copy one only after preflight.
- `adapters/` — uninstalled, secret-free client adapter examples and platform
  constraints.

## Cutover order

1. Implement and test the preflight requirements above in Goldfish.
2. Create a non-production project and grant a least-privilege test identity.
3. Connect one read-only MCP client and verify project-scoped search returns
   provenance. Then verify a prompt record and checkpoint write.
4. Copy the universal workflow into one pilot repository and compare it with
   the existing Mem0 ledger for a full task.
5. Migrate clients one at a time. Keep Mem0 intact until each migration has a
   recorded reconciliation and a rollback decision.

See `adapters/adapter-contract.yaml` for the expected tool and REST payloads.
All files use environment-variable names only; no tokens belong in this repo.
