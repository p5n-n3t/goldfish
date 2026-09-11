import { contentHash, validateMemoryInput, validateSearchQuery } from "./domain";
import { renderDashboard, type DashboardMetrics } from "./dashboard";
import { LexicalD1MemoryRepository, type D1DatabaseLike } from "./repositories";
import { authenticate, authorize, HttpError, issueKey, requireAdmin, revokeKey, touchKey, type Principal } from "./auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { executeGraphQL } from "./graphql";

export interface Env {
  DB?: D1DatabaseLike;
  ADMIN_BOOTSTRAP_SECRET?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
function validId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "INVALID_ID", "IDs must contain 1-200 letters, numbers, dots, underscores, colons or hyphens");
  return parsed.data;
}
async function saveMemory(repository: LexicalD1MemoryRepository, projectId: string, body: unknown, checkpoint = false) {
  const source = checkpoint && body && typeof body === "object" ? { ...body, kind: "task" } : body;
  const input = validateMemoryInput(source);
  const metadata = checkpoint ? { ...input.metadata, type: "checkpoint" } : input.metadata ?? {};
  return repository.ingest(projectId, { id: crypto.randomUUID(), projectId, content: input.content, kind: input.kind,
    contentHash: await contentHash(input.content), metadata, agentId: input.agentId, sessionId: input.sessionId });
}

export function goldfishMcpServer(db: D1DatabaseLike, principal: Principal): McpServer {
  const server = new McpServer({ name: "goldfish", version: "0.2.0" });
  const repository = new LexicalD1MemoryRepository(db);
  const run = async (projectId: string | undefined, operation: (project: string) => Promise<unknown>) => {
    try {
      const project = projectId ?? principal.projectId;
      authorize(principal, project);
      await touchKey(db, principal);
      return { content: [{ type: "text" as const, text: JSON.stringify(await operation(project)) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof HttpError || error instanceof z.ZodError ? error.message : "Memory operation failed" }] };
    }
  };
  const projectId = idSchema.optional().describe("Project ID; defaults to the project authorized by your API key");
  const memoryShape = { projectId, content: z.string().min(1).max(100_000), kind: z.enum(["fact", "conversation", "document", "task"]),
    metadata: z.record(z.string(), z.unknown()).optional(), agentId: idSchema.optional(), sessionId: idSchema.optional() };
  server.registerTool("memory_status", { title: "Goldfish status", description: "Reports the authorized project and retrieval mode", annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true, projectId: principal.projectId, retrieval: "lexical" }) }] }));
  server.registerTool("memory_save", { description: "Save a project memory with agent and session provenance; identical content is deduplicated within the project", inputSchema: memoryShape },
    async ({ projectId, ...input }) => run(projectId, async project => ({ memory: await saveMemory(repository, project, input) })));
  server.registerTool("memory_checkpoint", { description: "Save a resumable project checkpoint as a task memory", inputSchema: { ...memoryShape, kind: z.literal("task").optional() } },
    async ({ projectId, ...input }) => run(projectId, async project => ({ memory: await saveMemory(repository, project, input, true) })));
  server.registerTool("memory_search", { description: "Search saved memory text within the authorized project using literal substring matching", annotations: { readOnlyHint: true },
    inputSchema: { projectId, query: z.string().trim().min(1).max(2000), limit: z.number().int().min(1).max(100).optional() } },
    async ({ projectId, ...input }) => run(projectId, async project => ({ retrieval: "lexical", results: await repository.search(project, validateSearchQuery(input)) })));
  server.registerTool("memory_get", { description: "Retrieve one memory by ID within the authorized project", annotations: { readOnlyHint: true }, inputSchema: { projectId, id: idSchema } },
    async ({ projectId, id }) => run(projectId, async project => {
      const memory = await repository.get(project, id);
      if (!memory) throw new HttpError(404, "MEMORY_NOT_FOUND");
      return { memory };
    }));
  server.registerTool("memory_list_projects", { description: "List projects accessible to the current project-scoped API key", annotations: { readOnlyHint: true }, inputSchema: {} },
    async () => run(undefined, async project => ({ projects: await repository.listProjects(project) })));
  return server;
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const principal = await authenticate(request, env);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: ["goldfish.ziopsyop.tech", "goldfish-worker.joeyq.workers.dev", "localhost:*", "127.0.0.1:*"],
    allowedOrigins: ["https://goldfish.ziopsyop.tech", "http://localhost:*", "http://127.0.0.1:*"] });
  const server = goldfishMcpServer(env.DB!, principal);
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  // JSON mode produces complete responses, so no per-request transport remains open.
  await server.close();
  response.headers.set("cache-control", "no-store");
  return response;
}
async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 512_000) throw new HttpError(413, "BODY_TOO_LARGE");
  const text = await request.text();
  if (text.length > 512_000) throw new HttpError(413, "BODY_TOO_LARGE");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "INVALID_JSON"); }
}
async function dashboardMetrics(db: D1DatabaseLike): Promise<DashboardMetrics> {
  const count = async (table: "memory_records" | "projects" | "agents" | "imports"): Promise<number> => {
    const result = await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).all<{ total: number }>();
    return Number(result.results[0]?.total ?? 0);
  };
  const [memoryRecords, projects, agents, imports, byKind, activity, projectBreakdown, importBreakdown] = await Promise.all([
    count("memory_records"), count("projects"), count("agents"), count("imports"),
    db.prepare("SELECT kind, COUNT(*) AS count FROM memory_records GROUP BY kind ORDER BY count DESC, kind ASC").all<{ kind: string; count: number }>(),
    db.prepare(`SELECT COALESCE(agent_id, 'unattributed') AS label, COUNT(*) AS count, MAX(updated_at) AS latestAt
      FROM memory_records GROUP BY COALESCE(agent_id, 'unattributed') ORDER BY latestAt DESC, label ASC LIMIT 20`).all<{ label: string; count: number; latestAt: string | null }>(),
    db.prepare(`SELECT p.id, p.name, COUNT(DISTINCT r.id) AS memories, COUNT(DISTINCT a.id) AS agents,
      MAX(r.updated_at) AS latestAt FROM projects p
      LEFT JOIN memory_records r ON r.project_id = p.id LEFT JOIN agents a ON a.project_id = p.id
      GROUP BY p.id, p.name ORDER BY latestAt DESC, p.name ASC LIMIT 100`).all<{ id: string; name: string; memories: number; agents: number; latestAt: string | null }>(),
    db.prepare("SELECT status, COUNT(*) AS count FROM imports GROUP BY status ORDER BY status ASC").all<{ status: string; count: number }>()
  ]);
  return {
    memoryRecords, projects, agents, imports,
    byKind: byKind.results.map(row => ({ kind: row.kind, count: Number(row.count) })),
    activity: activity.results.map(row => ({ label: row.label, count: Number(row.count), latestAt: row.latestAt })),
    projectBreakdown: projectBreakdown.results.map(row => ({ id: row.id, name: row.name, memories: Number(row.memories), agents: Number(row.agents), latestAt: row.latestAt })),
    importBreakdown: importBreakdown.results.map(row => ({ status: row.status, count: Number(row.count) }))
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "goldfish-worker" });
      if (request.method === "GET" && url.pathname === "/") {
        const metrics = env.DB ? await dashboardMetrics(env.DB).catch(() => undefined) : undefined;
        return new Response(renderDashboard(metrics), { headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" } });
      }
      if (url.pathname === "/mcp") return await handleMcp(request, env);
      if (url.pathname === "/graphql") {
        if (request.method !== "POST") return json({ errors: [{ message: "GraphQL accepts POST only", extensions: { code: "METHOD_NOT_ALLOWED" } }] }, 405);
        const principal = await authenticate(request, env);
        await touchKey(env.DB!, principal);
        const result = await executeGraphQL(env.DB!, principal, await readJson(request) as { query?: unknown; variables?: unknown });
        return json(result, result.errors ? 400 : 200);
      }
      const keyMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/keys(?:\/([^/]+))?$/);
      if ((url.pathname === "/v1/projects" && request.method === "POST") || keyMatch) {
        await requireAdmin(request, env);
        if (keyMatch) {
          const projectId = validId(decodeURIComponent(keyMatch[1]));
          if (request.method === "POST" && !keyMatch[2]) {
            const body = await readJson(request);
            const parsed = z.object({ label: z.string().max(200).optional() }).safeParse(body);
            if (!parsed.success) throw new HttpError(400, "INVALID_KEY_INPUT");
            return json(await issueKey(env.DB!, projectId, parsed.data.label), 201);
          }
          if (request.method === "DELETE" && keyMatch[2]) {
            await revokeKey(env.DB!, projectId, validId(decodeURIComponent(keyMatch[2])));
            return json({ revoked: true });
          }
          return json({ error: "METHOD_NOT_ALLOWED" }, 405);
        }
        const parsed = z.object({ id: idSchema, name: z.string().trim().min(1).max(200) }).safeParse(await readJson(request));
        if (!parsed.success) throw new HttpError(400, "INVALID_PROJECT_INPUT");
        const { id, name } = parsed.data;
        await env.DB!.prepare("INSERT INTO projects (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = datetime('now')").bind(id, name).run();
        return json({ project: { id, name } }, 201);
      }
      if (url.pathname === "/v1/projects" && request.method === "GET") {
        const principal = await authenticate(request, env);
        await touchKey(env.DB!, principal);
        return json({ projects: await new LexicalD1MemoryRepository(env.DB!).listProjects(principal.projectId) });
      }
      const memoryMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/(memory|checkpoints)(?:\/([^/]+))?$/);
      if (memoryMatch) {
        const principal = await authenticate(request, env);
        const projectId = validId(decodeURIComponent(memoryMatch[1]));
        authorize(principal, projectId);
        await touchKey(env.DB!, principal);
        const repository = new LexicalD1MemoryRepository(env.DB!);
        const action = memoryMatch[3] ? decodeURIComponent(memoryMatch[3]) : undefined;
        if (request.method === "GET" && memoryMatch[2] === "memory" && action && action !== "search") {
          const memory = await repository.get(projectId, validId(action));
          if (!memory) throw new HttpError(404, "MEMORY_NOT_FOUND");
          return json({ projectId, memory });
        }
        if (request.method === "POST") {
          const body = await readJson(request);
          if (action === "search" && memoryMatch[2] === "memory") {
            let query;
            try { query = validateSearchQuery(body); } catch (error) { throw new HttpError(400, "INVALID_SEARCH", (error as Error).message); }
            return json({ projectId, retrieval: "lexical", results: await repository.search(projectId, query) });
          }
          if (!action) {
            try { validateMemoryInput(memoryMatch[2] === "checkpoints" && body && typeof body === "object" ? { ...body, kind: "task" } : body); }
            catch (error) { throw new HttpError(400, "INVALID_MEMORY", (error as Error).message); }
            return json({ projectId, memory: await saveMemory(repository, projectId, body, memoryMatch[2] === "checkpoints") }, 201);
          }
        }
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const response = json({ error: error.code, message: error.message }, error.status);
        if (error.status === 401) response.headers.set("www-authenticate", 'Bearer realm="goldfish"');
        return response;
      }
      if (error instanceof URIError) return json({ error: "INVALID_PATH" }, 400);
      return json({ error: "INTERNAL_ERROR", message: "The operation could not be completed" }, 500);
    }
  }
};
