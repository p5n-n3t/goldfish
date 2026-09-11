# ChatGPT adapter

**State: remote-only pilot; OAuth pending.** ChatGPT
connects to remote MCP servers; it does not use a local JSON file for this
adapter. Configure a draft custom app in ChatGPT Developer Mode with:

```text
Endpoint: https://goldfish.ziopsyop.tech/mcp
Authentication: OAuth 2.1 (future; not yet implemented)
```

Goldfish advertises the required tools and supports bearer API keys for local
MCP clients. ChatGPT custom connectors generally require OAuth discovery, so
keep this adapter as a documented future integration until OAuth is added.

ChatGPT’s full MCP write support is plan- and rollout-dependent. Keep this
adapter read-only unless the actual workspace permits write tools and an
administrator approves them. Use `agentId: chatgpt` and a platform/session
identifier supplied by the connector where available.

Reference: https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta
