# Codex Desktop adapter

**State: API-key pilot ready.** Do not edit the desktop app, its global
configuration, or plugin inventory from this package.

Codex Desktop can use the same remote Streamable HTTP endpoint as Codex CLI:

```text
https://goldfish.ziopsyop.tech/mcp
```

Use `agentId: chatgpt_desktop`, a client-provided session ID, and the project
folder slug as `projectId`. Configure it through the desktop build’s MCP UI or
its documented managed configuration with a scoped bearer key. Verify:

1. Tool discovery returns the five required Goldfish tools plus `memory_status`.
2. A search result contains project, agent, and session provenance.
3. A prompt-record write creates a project-scoped audit trail.

OAuth discovery is not live yet; use API-key authentication for this pilot.

If the build accepts the Codex CLI declaration, use
`codex-cli.toml.example` as the source and provide the token through the
desktop credential mechanism or `GOLDFISH_API_KEY`; never hard-code it.
