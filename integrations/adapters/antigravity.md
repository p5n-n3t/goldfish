# Antigravity adapter

**State: adapter contract ready; client configuration format unverified.**

Use the remote MCP endpoint `https://goldfish.ziopsyop.tech/mcp` with a
project-scoped bearer key. OAuth discovery is not implemented, so inject
`Authorization: Bearer ${GOLDFISH_API_KEY}` through Antigravity’s protected
credential mechanism. Do not put a token in an agent prompt, a repository
instruction file, or a Commandork worker package.

Use `agentId: antigravity`. Preserve the session ID provided by the client and
write it as `sessionId`. Configure a pilot only after the live server advertises
the required tools and a user has approved its project scope.

The installed Antigravity configuration syntax has not been verified in this
audit. Its setup must be performed through its own MCP settings interface or
documented config schema after the endpoint passes the shared preflight; do
not infer a global config path from this document.
