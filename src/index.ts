import { contentHash, validateMemoryInput, validateSearchQuery } from "./domain";
import { renderDashboard } from "./dashboard";
import { LexicalD1MemoryRepository, type D1DatabaseLike } from "./repositories";
import { authenticate, authorize, HttpError, issueKey, issueWorkspaceKey, requireAdmin, revokeKey, touchKey, type Principal, createDashboardSession, dashboardCookie, clearedDashboardCookie, requireDashboard, verifyDashboardPassword, requireSameOrigin } from "./auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { executeGraphQL } from "./graphql";
import { handleAdminApi, renderAdminLoginShell, runScheduledCuration, runScheduledSummaries } from "./admin";
import { classifyRequest, recordRequestEvent, type RequestMemoryLinkType, type RequestProtocol } from "./request-telemetry";

interface DashboardLoginKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  DB?: D1DatabaseLike;
  ADMIN_BOOTSTRAP_SECRET?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  DASHBOARD_PASSWORD?: string;
  ARTIFACTS?: import("./admin").R2Artifacts;
  AI?: import("./admin").CopilotAI;
  /** Shared Cloudflare KV; Goldfish uses a namespaced key for best-effort login throttling. */
  OAUTH_KV?: DashboardLoginKV;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
const baseSecurityHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: baseSecurityHeaders });
const dashboardNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
const dashboardHeaders = (nonce: string) => ({
  ...baseSecurityHeaders,
  "content-type": "text/html; charset=UTF-8",
  "x-frame-options": "DENY",
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'"
  ].join("; ")
});
const dashboardPage = (html: string, nonce: string, head = false) => new Response(head ? null : html, { headers: dashboardHeaders(nonce) });
type DashboardLoginAttempt = { count: number; resetAt: number };
async function dashboardLoginAttempt(request: Request, env: Env): Promise<{ key: string; count: number } | null> {
  const clientIp = request.headers.get("cf-connecting-ip");
  if (!clientIp || !env.OAUTH_KV) return null;
  const key = `goldfish:dashboard-login:${await contentHash(clientIp)}`;
  const raw = await env.OAUTH_KV.get(key);
  if (!raw) return { key, count: 0 };
  try {
    const parsed = JSON.parse(raw) as DashboardLoginAttempt;
    return parsed.resetAt > Date.now() && Number.isInteger(parsed.count) && parsed.count > 0 ? { key, count: parsed.count } : { key, count: 0 };
  } catch { return { key, count: 0 }; }
}
async function recordFailedDashboardLogin(env: Env, attempt: { key: string; count: number } | null): Promise<void> {
  if (!attempt || !env.OAUTH_KV) return;
  const resetAt = Date.now() + 10 * 60 * 1000;
  await env.OAUTH_KV.put(attempt.key, JSON.stringify({ count: Math.min(attempt.count + 1, 99), resetAt }), { expirationTtl: 10 * 60 });
}
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
      if (!projectId && principal.accessScope === "workspace") throw new HttpError(400, "PROJECT_ID_REQUIRED", "Workspace keys require an explicit projectId");
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
    async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true, projectId: principal.projectId, accessScope: principal.accessScope, retrieval: "lexical" }) }] }));
  server.registerTool("memory_save", { description: "Save a project memory with agent and session provenance; identical content is deduplicated within the project", inputSchema: memoryShape },
    async ({ projectId, ...input }) => run(projectId, async project => { if (principal.accessScope === "workspace") await repository.ensureProject(project); return { memory: await saveMemory(repository, project, input) }; }));
  server.registerTool("memory_checkpoint", { description: "Save a resumable project checkpoint as a task memory", inputSchema: { ...memoryShape, kind: z.literal("task").optional() } },
    async ({ projectId, ...input }) => run(projectId, async project => { if (principal.accessScope === "workspace") await repository.ensureProject(project); return { memory: await saveMemory(repository, project, input, true) }; }));
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
    async () => { await touchKey(db, principal); return { content: [{ type: "text", text: JSON.stringify({ projects: principal.accessScope === "workspace" ? await repository.listAllProjects() : await repository.listProjects(principal.projectId) }) }] }; });
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

async function persistRequestTelemetry(request: Request, response: Response, env: Env, startedAt: number): Promise<void> {
  if (!env.DB) return;
  const url = new URL(request.url);
  if (url.pathname === "/health" || url.pathname.includes("/requests")) return;
  const pathProject = url.pathname.match(/\/projects\/([^/]+)/)?.[1];
  let payload: Record<string, unknown> = {};
  if ((response.headers.get("content-type") || "").includes("application/json")) {
    try { const parsed = await response.clone().json(); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>; } catch { /* response detail is optional */ }
  }
  const projectId = typeof payload.projectId === "string" ? payload.projectId : pathProject ? decodeURIComponent(pathProject) : null;
  const protocol: RequestProtocol = url.pathname === "/mcp" ? "mcp" : url.pathname === "/graphql" ? "graphql" : url.pathname.startsWith("/admin/") ? "dashboard" : "api";
  const operation = classifyRequest({ method: request.method, path: url.pathname, protocol });
  const memoryLinks: Array<{ memoryId: string; type: RequestMemoryLinkType; ordinal?: number }> = [];
  const memory = payload.memory && typeof payload.memory === "object" ? payload.memory as Record<string, unknown> : null;
  if (typeof memory?.id === "string") memoryLinks.push({ memoryId: memory.id, type: operation === "add" ? "created" : operation === "update" ? "updated" : operation === "delete" ? "deleted" : "fetched" });
  if (Array.isArray(payload.results)) payload.results.slice(0, 100).forEach((entry, ordinal) => { if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string") memoryLinks.push({ memoryId: String((entry as Record<string, unknown>).id), type: "matched", ordinal }); });
  await recordRequestEvent(env.DB, { projectId, method: request.method, path: url.pathname, protocol, operation, statusCode: response.status,
    latencyMs: Math.max(0, performance.now() - startedAt), appId: protocol === "dashboard" ? "goldfish_dashboard" : protocol, authMode: protocol === "dashboard" ? "dashboard_session" : "api_key",
    outputCount: Array.isArray(payload.results) ? payload.results.length : memory ? 1 : 0, errorCode: typeof payload.error === "string" ? payload.error : null, memoryLinks });
}
export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const startedAt = performance.now();
    const finish = (response: Response) => {
      const task = persistRequestTelemetry(request, response, env, startedAt).catch(() => undefined);
      if (ctx) ctx.waitUntil(task);
      return response;
    };
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "goldfish-worker" });
      if (request.method === "POST" && url.pathname === "/admin/login") {
        requireSameOrigin(request);
        const attempt = await dashboardLoginAttempt(request, env);
        if (attempt && attempt.count >= 8) throw new HttpError(429, "DASHBOARD_LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again in a few minutes.");
        const input = await readJson(request);
        const password = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).password : undefined;
        try {
          await verifyDashboardPassword(password, env);
        } catch (error) {
          await recordFailedDashboardLogin(env, attempt);
          throw error;
        }
        const response = json({ authenticated: true }); response.headers.set("set-cookie", dashboardCookie(await createDashboardSession(env))); return response;
      }
      if (request.method === "POST" && url.pathname === "/admin/logout") { requireSameOrigin(request); const response = json({ authenticated: false }); response.headers.set("set-cookie", clearedDashboardCookie); return response; }
      if (request.method === "GET" && url.pathname === "/admin/session") { await requireDashboard(request, env); return json({ authenticated: true, role: "dashboard-admin" }); }
      if (url.pathname.startsWith("/admin/api/")) { await requireDashboard(request, env); if (request.method !== "GET" && request.method !== "HEAD") requireSameOrigin(request); return finish(await handleAdminApi(request, env)); }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
        const nonce = dashboardNonce();
        try { await requireDashboard(request, env); }
        catch (error) {
          if (error instanceof HttpError && error.status === 401) return dashboardPage(renderAdminLoginShell(nonce), nonce, request.method === "HEAD");
          throw error;
        }
        if (env.ASSETS) {
          const assetUrl = new URL("/index.html", url);
          const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
          const headers = new Headers(asset.headers);
          for (const [name, value] of Object.entries(dashboardHeaders(nonce))) headers.set(name, value);
          return new Response(request.method === "HEAD" ? null : asset.body, { status: asset.status, headers });
        }
        return dashboardPage(renderDashboard(undefined, nonce), nonce, request.method === "HEAD");
      }
      if (url.pathname === "/mcp") return finish(await handleMcp(request, env));
      if (url.pathname === "/graphql") {
        if (request.method !== "POST") return json({ errors: [{ message: "GraphQL accepts POST only", extensions: { code: "METHOD_NOT_ALLOWED" } }] }, 405);
        const principal = await authenticate(request, env);
        await touchKey(env.DB!, principal);
        const result = await executeGraphQL(env.DB!, principal, await readJson(request) as { query?: unknown; variables?: unknown });
        return finish(json(result, result.errors ? 400 : 200));
      }
      if (url.pathname === "/v1/workspace-keys" && request.method === "POST") {
        await requireAdmin(request, env);
        const parsed = z.object({ anchorProjectId: idSchema.optional(), label: z.string().max(200).optional() }).safeParse(await readJson(request));
        if (!parsed.success) throw new HttpError(400, "INVALID_WORKSPACE_KEY_INPUT");
        const anchorProjectId = parsed.data.anchorProjectId ?? "goldfish";
        return json(await issueWorkspaceKey(env.DB!, anchorProjectId, parsed.data.label), 201);
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
        const repository = new LexicalD1MemoryRepository(env.DB!);
        return finish(json({ projects: principal.accessScope === "workspace" ? await repository.listAllProjects() : await repository.listProjects(principal.projectId) }));
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
          return finish(json({ projectId, memory }));
        }
        if (request.method === "POST") {
          const body = await readJson(request);
          if (action === "search" && memoryMatch[2] === "memory") {
            let query;
            try { query = validateSearchQuery(body); } catch (error) { throw new HttpError(400, "INVALID_SEARCH", (error as Error).message); }
            return finish(json({ projectId, retrieval: "lexical", results: await repository.search(projectId, query) }));
          }
          if (!action) {
            try { validateMemoryInput(memoryMatch[2] === "checkpoints" && body && typeof body === "object" ? { ...body, kind: "task" } : body); }
            catch (error) { throw new HttpError(400, "INVALID_MEMORY", (error as Error).message); }
            if (principal.accessScope === "workspace") await repository.ensureProject(projectId);
            return finish(json({ projectId, memory: await saveMemory(repository, projectId, body, memoryMatch[2] === "checkpoints") }, 201));
          }
        }
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const response = json({ error: error.code, message: error.message }, error.status);
        if (error.status === 401) response.headers.set("www-authenticate", 'Bearer realm="goldfish"');
        return finish(response);
      }
      if (error instanceof URIError) return finish(json({ error: "INVALID_PATH" }, 400));
      return finish(json({ error: "INTERNAL_ERROR", message: "The operation could not be completed" }, 500));
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledCuration(env));
    ctx.waitUntil(runScheduledSummaries(env));
  }
};
