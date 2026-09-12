# Goldfish agent cutover package

This package contains secret-free client instructions and workflow templates for
Goldfish. The production Worker accepts scoped bearer keys for agent REST and
MCP access. The private dashboard is the owner-only control plane that creates
projects and issues/revokes those keys.

## Active connection model

1. The owner signs in at <https://goldfish.ziopsyop.tech> with
   `DASHBOARD_PASSWORD`.
2. In **API keys**, the owner selects the target project and issues a scoped
   `gf_live_…` key.
3. The one-time key goes only into that client’s credential store or
   `GOLDFISH_API_KEY` environment variable.
4. The client connects to `https://goldfish.ziopsyop.tech/mcp` and verifies
   project-scoped search, a prompt record, and a checkpoint.

`DASHBOARD_PASSWORD`, dashboard cookies, and `ADMIN_BOOTSTRAP_SECRET` are never
agent credentials. Do not copy any of them into an MCP configuration, adapter,
prompt, repository, or command-worker package.

| Requirement | Required for | Current state |
| --- | --- | --- |
| scoped bearer API-key verification | every agent read/write client | **live** |
| MCP `memory_search`, `memory_get`, `memory_save`, `memory_checkpoint`, `memory_list_projects` | MCP adapters | **live** |
| project/agent/session provenance and audit records | every agent read/write client | **live in D1 runtime** |
| dashboard project/key management | agent onboarding | **live** |
| OAuth discovery / ChatGPT-style connector | OAuth-only clients | **not implemented** |

The live agent REST shape is:

```text
POST /v1/projects/{projectId}/memory
POST /v1/projects/{projectId}/memory/search
```

Every agent request requires `Authorization: Bearer <gf_live_token>` and is
checked against the key’s project scope. The private dashboard session is not a
substitute for an agent key.

## Files

- `GOLDFISH_MEMORY_WORKFLOW.md` — canonical durable-memory protocol, including
  record mapping, checkpoints, and offline reconciliation.
- `templates/` — project-local `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
  templates. Copy one only after a pilot succeeds.
- `adapters/` — uninstalled, secret-free connection examples and known provider
  constraints.

## Cutover order

1. Run `GET /health` and make sure a dashboard session can open the private
   control room.
2. Select the project in the dashboard and issue a least-privilege pilot
   `gf_live_…` key. Use the protected project-creation route only when a new
   project is genuinely needed. Store only that key in the intended client credential
   mechanism.
3. Connect one read-only-capable MCP client and confirm a project-scoped search
   returns provenance. Then confirm a prompt-record and checkpoint write.
4. Copy the universal workflow into one pilot repository and compare the
   checkpoint/recovery behavior with the existing agent workflow.
5. Migrate clients one at a time. Retain historical import sources for
   provenance, but do not invoke a legacy memory provider as an automatic
   fallback.
6. Revoke the pilot key from the dashboard when a client is removed or its
   credential store is no longer trusted.

## Plugin package

`../plugins/goldfish` is a Codex plugin bundle. It includes a `goldfish-memory`
skill and a secret-free remote MCP declaration. It does not install a token or
alter global configuration itself. Use the Codex plugin installer or plugin UI
to add the local package, then provide `GOLDFISH_API_KEY` through the host’s
approved secret mechanism.

Before distributing a changed bundle, validate its manifest with the installed
Codex Plugin Creator validator and confirm that `.mcp.json` contains only the
`${GOLDFISH_API_KEY}` placeholder.
