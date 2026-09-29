# Goldfish

<div align="center">

![Goldfish logo](plugins/goldfish/assets/goldfish-logo.png?size=200)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://www.javascript.com/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![Workers AI](https://img.shields.io/badge/Workers%20AI-FF6B6B?style=flat-square&logo=openai&logoColor=white)](https://developers.cloudflare.com/workers-ai/)
[![D1](https://img.shields.io/badge/D1%20Database-4A90E2?style=flat-square&logo=database&logoColor=white)](https://developers.cloudflare.com/d1/)

</div>

Goldfish is a private, Cloudflare-native memory ledger for coding agents. It keeps
project memory, checkpoints, provenance, lifecycle decisions, and administrator
activity in one project-scoped system that agents can reach through a remote MCP
server or the REST API.

The current deployment is served at <https://goldfish.ziopsyop.tech>.

## What is in this repository

Goldfish has two deliberately separate control planes:

- **Agent plane.** Scoped `gf_live_…` bearer keys authorize project-isolated
  REST, GraphQL read queries, and the Streamable HTTP MCP endpoint at `/mcp`.
  Agents can search, retrieve, save, checkpoint, and discover their authorized
  project.
- **Private administration plane.** The browser dashboard uses a distinct
  `DASHBOARD_PASSWORD` secret and an HttpOnly, Secure, SameSite=Strict session
  cookie. It does not put an API key in the page. The dashboard can inspect and
  manage every project record through its own authenticated `/admin/api` routes.

The implemented dashboard includes:

- memory explorer with literal search, project/agent/category/lifecycle/date
  filters, bulk lifecycle actions, and manual creation and editing;
- immutable content versions, soft deletion and restoration, per-record audit
  history, provenance, feedback, and category management;
- D1-derived analytics for activity, memory kinds, lifecycle, agent/session
  coverage, checkpoints, feedback, curation, and active keys—without retaining
  raw request transcripts;
- a persisted relationship graph that rebuilds entity and co-occurrence edges
  from active project memory and provenance;
- R2 attachment metadata and dashboard uploads for files up to 5 MB of decoded
  data;
- reviewable curation runs for obvious low-signal content, retention review,
  and optional synthesis candidates; approvals move records into reversible
  review quarantine instead of performing automatic deletion; and
- Goldfish Copilot, backed by the configured Workers AI binding. It can answer
  from a bounded project context and propose a create, update, lifecycle, or
  synthesis action. Each proposal needs an explicit dashboard apply request.

## Current architecture

| Component | Role today |
| --- | --- |
| Cloudflare Worker | Authenticated API, remote MCP, GraphQL read endpoint, dashboard session and admin API |
| D1 | Canonical project ledger, versions, provenance, audit events, categories, curation, graph material, and key metadata |
| R2 | Uploaded attachment bytes and their metadata references |
| Workers AI | Goldfish Copilot responses and structured action proposals |
| Vectorize | Bound and reserved for the next semantic-retrieval adapter; live agent search is deterministic lexical matching |

Goldfish does **not** currently implement OAuth discovery, Cloudflare Access
policy integration, or semantic/vector ranking. API-key clients are supported
now. OAuth-only connectors must wait for the OAuth adapter rather than treating
an API key as an OAuth token.

## Quick start

1. Install dependencies and authenticate Wrangler:

   ```bash
   npm install
   npx wrangler login
   ```

2. Apply all D1 migrations. The Worker configuration names the database and
   migration directory:

   ```bash
   npx wrangler d1 migrations apply goldfish --remote --config wrangler.jsonc
   ```

3. Set owner-only secrets through Wrangler. Generate them outside the repository
   and never paste them into a prompt, shell history, source file, or screenshot.

   ```bash
   npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
   npx wrangler secret put DASHBOARD_PASSWORD
   ```

   `ADMIN_BOOTSTRAP_SECRET` must be at least 32 characters and protects project
   bootstrap endpoints. `DASHBOARD_PASSWORD` must be at least 16 characters and
   protects the browser dashboard. They are separate credentials.

4. Deploy and validate the local suite:

   ```bash
   npx wrangler deploy --config wrangler.jsonc
   npm run check
   ```

5. Open the root URL and sign in with the dashboard password. Select the project,
   issue a project API key from **API keys**, copy the one-time token
   into the target client’s secret store, and revoke it from the dashboard when
   it is no longer needed.

See [the runtime contract](docs/runtime-api.md), [dashboard guide](docs/admin-dashboard.md),
[architecture](docs/architecture.md), and [agent install package](integrations/README.md).

## Agent installation

The repository ships a Codex plugin at
[`plugins/goldfish`](plugins/goldfish), plus secret-free connection examples for
Codex CLI, Codex Desktop, Claude Code, Copilot, Antigravity, ChatGPT, and
Perplexity under [`integrations/adapters`](integrations/adapters). Use an
adapter only after a scoped project key exists, and inject `GOLDFISH_API_KEY`
through the client’s credential store or environment—not a repository file.

The Codex plugin supplies the durable-memory workflow and a remote MCP
configuration template. Before distributing a changed package, validate it with
the Codex Plugin Creator validator available in the maintainer environment.

The plugin package is intentionally secret-free. It does not install a token,
rewrite a global agent configuration, or claim that every provider supports
bearer-authenticated remote MCP. Provider-specific limitations are stated in
[the adapter notes](integrations/adapters).

## Migration provenance

The preserved JSON files named in the evidence documents are historical import
sources. They are retained for provenance and normalization tests; they are not
an active fallback provider. The durable workflow now targets Goldfish, and an
agent that cannot reach Goldfish writes a local `.goldfish-pending.jsonl` queue
for later reconciliation rather than invoking a legacy memory service.
