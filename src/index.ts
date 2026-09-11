import { contentHash, validateMemoryInput, validateSearchQuery } from "./domain";
import { renderDashboard } from "./dashboard";
import { LexicalD1MemoryRepository, type D1DatabaseLike } from "./repositories";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export interface Env {
  DB?: D1DatabaseLike;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function goldfishMcpServer(): McpServer {
  const server = new McpServer({ name: "goldfish", version: "0.1.0" });
  server.registerTool("memory_status", {
    title: "Goldfish memory status",
    description: "Reports the Goldfish service status and its current authentication requirement."
  }, async () => ({
    content: [{ type: "text", text: "Goldfish is online. Memory reads and writes require OAuth or a scoped API key." }]
  }));
  return server;
}

async function handleMcp(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: ["goldfish.ziopsyop.tech", "goldfish-worker.joeyq.workers.dev"],
    allowedOrigins: ["https://goldfish.ziopsyop.tech"]
  });
  const server = goldfishMcpServer();
  await server.connect(transport);
  return transport.handleRequest(request);
}

function authenticationConfigurationError(): Response {
  return json({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured for this Worker" }, 503);
}

function requireAuthentication(_request: Request, _env: Env): Response | null {
  // Token verification is intentionally not enabled by default in this baseline.
  return authenticationConfigurationError();
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "goldfish-worker" });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderDashboard(), {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    }
    if (url.pathname === "/mcp") return handleMcp(request);

    const memoryMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/memory(?:\/(search))?$/);
    if (memoryMatch && (request.method === "POST")) {
      const authError = requireAuthentication(request, env);
      if (authError) return authError;
      if (!env.DB) return json({ error: "D1_NOT_CONFIGURED" }, 503);
      const projectId = decodeURIComponent(memoryMatch[1]);
      const repository = new LexicalD1MemoryRepository(env.DB);
      try {
        const body = await readJson(request);
        if (memoryMatch[2] === "search") {
          return json({ projectId, results: await repository.search(projectId, validateSearchQuery(body)) });
        }
        const input = validateMemoryInput(body);
        const record = {
          id: crypto.randomUUID(), projectId, content: input.content, kind: input.kind,
          contentHash: await contentHash(input.content), metadata: input.metadata ?? {},
          agentId: input.agentId, sessionId: input.sessionId
        };
        return json({ projectId, memory: await repository.ingest(projectId, record) }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
      }
    }
    return json({ error: "NOT_FOUND" }, 404);
  }
};
