# Goldfish project-memory protocol

Use the Goldfish durable-memory workflow supplied with this template as the
project’s memory protocol. Set `agentId` to the actual runner identity and
derive `projectId` from the exact project folder slug.

Before file reads, planning, or delegation, recall project-scoped Goldfish
records and save the complete user request as a `prompt_record`. Save
checkpoints at the required milestones and save final `checkpoint` plus
`project_state` before handing work off. Preserve provenance and do not store
credentials or raw secrets.

Activate these instructions with a scoped Goldfish bearer key. OAuth-only
clients may wait for the future OAuth adapter; during a Goldfish outage use
the project-local `.goldfish-pending.jsonl` reconciliation path.
