# Goldfish private dashboard

The Goldfish dashboard is an owner-facing memory control room at the Worker
root. It is not an API-key client and it does not expose a request-log product.
It is designed for one private administrator who needs to inspect, improve, and
operate the project ledger directly.

## Sign in

Set `DASHBOARD_PASSWORD` as a Worker secret, then visit the deployed root URL.
The password endpoint creates a signed 12-hour cookie with `HttpOnly`, `Secure`,
and `SameSite=Strict` attributes. The dashboard makes same-origin requests with
that cookie; it never embeds a project API key in the page.

Use **Log out** when finishing a session. Changing the dashboard password
invalidates outstanding dashboard sessions because their signatures use that
secret.

## Memory explorer

The explorer supports:

- case-sensitive literal text search;
- filters for kind, agent, category, lifecycle, and update date;
- bulk lifecycle actions;
- detail inspection with the complete current content, provenance, timestamps,
  lifecycle state, historical versions, and the audit trail;
- manual memory creation and editing;
- useful/not-useful/flag feedback; and
- reversible deletion and restoration.

A memory edit that changes content adds a version. A lifecycle-only edit writes
an audit event without discarding historical content. `deleted` is a soft
lifecycle state, not an irreversible database purge.

## Analytics and provenance

Analytics are calculated from the durable ledger and audit events. They include
memory totals, active records, checkpoints, active keys, average memory age,
provenance coverage, category and curation counts, activity over time, kind and
lifecycle breakdowns, agent activity, feedback, and recent administrative
activity. Since no raw request transcript is retained, traffic/latency metrics
are intentionally absent.

The **Project policy & taxonomy** view exposes category management, project and
agent instructions, multilingual/decay policy fields, and the private audit
trail. Categories are project-local and can be changed without rewriting
historical records.

## Relationship graph

The graph stores project-local entity nodes and weighted relationship edges. A
rebuild derives nodes and co-occurrence links from active memory content and
persisted agent, session, and category provenance. Rebuilds are full-project
and repeatable. This is an explainable association graph, not a claim of
semantic or causal inference.

## Attachments

The dashboard can upload a base64-encoded file to the configured R2 bucket. Decoded uploads are capped at
5 MB. Goldfish saves attachment metadata, content type, byte size, and a hash
alongside the memory. The dashboard controls attachment metadata; it does not
turn the private bucket into a public file browser.

## Lifecycle and curation

Curation is deliberately reversible:

1. A manual run or the daily scheduled job scans active memory.
2. It records candidates for exact low-signal content, retention review, and—if
   enabled—long-memory synthesis.
3. The dashboard shows the candidate rationale and confidence.
4. The owner explicitly approves a candidate.
5. Approval moves its memory into `needs_review`; it does not hard-delete it or
   overwrite its original version.

The setting named **Flag obvious noise** only enables candidate generation for
scheduled runs. It never grants the scheduler permission to delete data.

## Goldfish Copilot

Goldfish Copilot is a Workers AI-assisted dashboard widget. It receives a
bounded slice of recent memory in the selected project, can explain the ledger,
and may propose to create a memory, update a memory, change lifecycle, or add a
synthesis. It cannot silently mutate the ledger: every proposed action stays
pending until the owner chooses **Apply proposal**. Conversations and applied
proposals are audited in D1.

## API keys

The **API keys** view issues project-scoped `gf_live_…` keys, lists their label,
prefix, creation time, last use, and revocation state, and revokes a key. The
full token is shown only at issuance. Store it in an agent credential mechanism
or the client environment as `GOLDFISH_API_KEY`; do not place it in a workflow
file, repository, prompt, screenshot, or task log.
