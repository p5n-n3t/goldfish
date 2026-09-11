# Perplexity adapter

**State: remote-connector pilot; OAuth pending.**

Goldfish has a publicly reachable Streamable HTTP MCP endpoint and the required
tools. Use the same endpoint and scopes as the common contract for clients that
accept bearer API keys:

```text
https://goldfish.ziopsyop.tech/mcp
memory.read
memory.write
```

The Perplexity account tier, connector UI, supported transport, OAuth behavior,
and write-tool policy must be verified in the target workspace at onboarding;
they were not verified in this audit. Start with `memory_search` only. Add
write tools only after a project-scoped prompt-record test has a visible audit
result. Use `agentId: perplexity` and store any connector-provided session ID.
OAuth discovery remains future work.

No local Perplexity config file is included because its current client format
was not established from an authoritative source. This avoids inventing a
configuration that could place credentials in the wrong scope.
