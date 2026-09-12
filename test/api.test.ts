import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import schema from "../migrations/0001_initial.sql?raw";
import adminSchema from "../migrations/0002_admin_memory_lifecycle.sql?raw";
import foundationSchema from "../migrations/0003_admin_dashboard_foundation.sql?raw";
import workspaceKeySchema from "../migrations/0004_workspace_agent_keys.sql?raw";
import worker, { type Env } from "../src/index";
import { contentHash } from "../src/domain";
import type { D1DatabaseLike } from "../src/repositories";

const admin = "test-only-bootstrap-secret-with-at-least-32-characters";
let mf: Miniflare;
let env: Env;
let projectKey: string;
let otherKey: string;
let keyId: string;
let workspaceKey: string;
const artifacts = new Map<string, Uint8Array>();
const request = async (path: string, method = "GET", body?: unknown, token?: string) => worker.fetch(new Request(`https://goldfish.ziopsyop.tech${path}`, {
  method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {})
}), env);
const data = async (response: Response) => response.json() as Promise<Record<string, any>>;

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok') } }", compatibilityDate: "2025-09-01", d1Databases: ["DB"] }));
  const db = await mf.getD1Database("DB");
  await db.batch([...schema.split(";"), ...adminSchema.split(";"), ...foundationSchema.split(";"), ...workspaceKeySchema.split(";")].filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  env = { DB: db as unknown as D1DatabaseLike, ADMIN_BOOTSTRAP_SECRET: admin, DASHBOARD_PASSWORD: "test-only-dashboard-password-with-at-least-16-characters", ARTIFACTS: { put: async (key, value) => { artifacts.set(key, new Uint8Array(value)); }, get: async key => { const value = artifacts.get(key); if (!value) return null; const copy = new Uint8Array(value.byteLength); copy.set(value); return { body: new Response(copy.buffer).body!, size: copy.byteLength, httpMetadata: { contentType: "application/octet-stream" } }; }, delete: async key => { artifacts.delete(key); } }, AI: { run: async () => ({ response: JSON.stringify({ reply: "I found the dashboard memory.", proposals: [{ type: "create_memory", summary: "Save a concise project fact", payload: { content: "Copilot-created project fact", kind: "fact", metadata: { category: "workflow" } } }] }) }) } };
  for (const id of ["alpha", "beta"]) {
    expect((await request("/v1/projects", "POST", { id, name: id }, admin)).status).toBe(201);
    const issued = await data(await request(`/v1/projects/${id}/keys`, "POST", { label: "integration test" }, admin));
    if (id === "alpha") { projectKey = issued.token; keyId = issued.id; } else otherKey = issued.token;
  }
  workspaceKey = (await data(await request("/v1/workspace-keys", "POST", { anchorProjectId: "alpha", label: "local agents" }, admin))).token;
}, 60000);
afterAll(async () => { await mf?.dispose(); });

describe("authenticated D1 REST and MCP", { timeout: 120_000 }, () => {
  it("fails closed and requires a separately configured admin boundary", async () => {
    expect((await request("/v1/projects/alpha/memory", "POST", { content: "x", kind: "fact" })).status).toBe(401);
    expect((await request("/mcp", "POST", {})).status).toBe(401);
    expect((await request("/v1/projects/alpha/keys", "POST", {}, projectKey)).status).toBe(401);
    const response = await worker.fetch(new Request("https://goldfish.ziopsyop.tech/v1/projects", { method: "POST" }), { DB: env.DB });
    expect(response.status).toBe(503);
  });

  it("stores only the exact SHA-256 token hash and never updates last_used for unauthorized project access", async () => {
    expect(projectKey).toMatch(/^gf_live_[A-Za-z0-9_-]{43}$/);
    const rows = await env.DB!.prepare("SELECT key_hash, key_prefix, last_used_at FROM api_keys WHERE id = ?").bind(keyId).all<any>();
    expect(rows.results[0].key_hash).toBe(await contentHash(projectKey));
    expect(rows.results[0].key_prefix).toBe(projectKey.slice(0, 16));
    expect(rows.results[0].last_used_at).toBeNull();
    expect((await request("/v1/projects/beta/memory/search", "POST", { query: "x" }, projectKey)).status).toBe(403);
    const after = await env.DB!.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(keyId).all<any>();
    expect(after.results[0].last_used_at).toBeNull();
  });

  it("saves, deduplicates, searches literal wildcards, retrieves and preserves provenance", async () => {
    const payload = { content: "D1 uses 100% literal_back\\slash", kind: "fact", agentId: "alpha-codex", sessionId: "alpha-session" };
    const saved = await request("/v1/projects/alpha/memory", "POST", payload, projectKey);
    expect(saved.status).toBe(201);
    const { memory } = await data(saved);
    expect(memory.agentId).toBe("alpha-codex");
    const repeated = await data(await request("/v1/projects/alpha/memory", "POST", payload, projectKey));
    expect(repeated.memory.id).toBe(memory.id);
    const search = await data(await request("/v1/projects/alpha/memory/search", "POST", { query: "% literal_back\\" }, projectKey));
    expect(search.results.map((r: any) => r.id)).toEqual([memory.id]);
    expect((await data(await request(`/v1/projects/alpha/memory/${memory.id}`, "GET", undefined, projectKey))).memory.content).toBe(payload.content);
    expect((await request(`/v1/projects/beta/memory/${memory.id}`, "GET", undefined, otherKey)).status).toBe(404);
    const beta = await data(await request("/v1/projects/beta/memory/search", "POST", { query: "D1" }, otherKey));
    expect(beta.results).toEqual([]);
    const betaSaved = await request("/v1/projects/beta/memory", "POST", payload, otherKey);
    expect(betaSaved.status).toBe(201);
    expect((await data(betaSaved)).memory.agentId).toBe("alpha-codex");
  });

  it("rolls back provenance and record rows when version persistence fails", async () => {
    await env.DB!.prepare("CREATE TRIGGER reject_test_version BEFORE INSERT ON memory_versions WHEN NEW.content = 'atomic-failure-test' BEGIN SELECT RAISE(ABORT, 'test rejection'); END").run();
    try {
      const response = await request("/v1/projects/alpha/memory", "POST", { content: "atomic-failure-test", kind: "fact", agentId: "rollback-agent" }, projectKey);
      expect(response.status).toBe(500);
      const records = await env.DB!.prepare("SELECT id FROM memory_records WHERE content_hash = ?").bind(await contentHash("atomic-failure-test")).all();
      const agents = await env.DB!.prepare("SELECT id FROM agents WHERE id = 'rollback-agent'").all();
      expect(records.results).toEqual([]);
      expect(agents.results).toEqual([]);
    } finally {
      await env.DB!.prepare("DROP TRIGGER reject_test_version").run();
    }
  });

  it("checks input, writes checkpoints and lists only authorized projects", async () => {
    expect((await request("/v1/projects/alpha/memory", "POST", { content: "x", kind: "fact", agentId: 42 }, projectKey)).status).toBe(400);
    expect((await request("/v1/projects/alpha/memory/search", "POST", { query: "x", limit: 101 }, projectKey)).status).toBe(400);
    const saved = await data(await request("/v1/projects/alpha/checkpoints", "POST", { content: "Resume from checkpoint", metadata: { phase: 2 } }, projectKey));
    expect(saved.memory).toMatchObject({ kind: "task", metadata: { phase: 2, type: "checkpoint" } });
    const projects = await data(await request("/v1/projects", "GET", undefined, projectKey));
    expect(projects.projects.map((p: any) => p.id)).toEqual(["alpha"]);
  });

  it("uses a workspace key for first-use project registration without widening project keys", async () => {
    const projectId = "trumpfiles.fun-new";
    const saved = await request(`/v1/projects/${projectId}/memory`, "POST", { content: "Workspace key creates the project ledger", kind: "fact", agentId: "chatgpt_desktop" }, workspaceKey);
    expect(saved.status).toBe(201);
    expect((await data(saved)).projectId).toBe(projectId);
    const projects = await data(await request("/v1/projects", "GET", undefined, workspaceKey));
    expect(projects.projects.map((project: any) => project.id)).toContain(projectId);
    expect((await request(`/v1/projects/${projectId}/memory/search`, "POST", { query: "Workspace key" }, projectKey)).status).toBe(403);
  });

  it("requires an explicit projectId for workspace GraphQL reads", async () => {
    const missingProject = await request("/graphql", "POST", { query: "{ search(query: \"Workspace key\") { id } }" }, workspaceKey);
    expect(missingProject.status).toBe(400);
    expect((await data(missingProject)).errors[0].extensions.code).toBe("PROJECT_ID_REQUIRED");
    const scoped = await request("/graphql", "POST", { query: "{ search(projectId: \"trumpfiles.fun-new\", query: \"Workspace key\") { id content } dashboard(projectId: \"trumpfiles.fun-new\") { memoryRecords agents } }" }, workspaceKey);
    expect(scoped.status).toBe(200);
    const result = await data(scoped);
    expect(result.data.search).toHaveLength(1);
    expect(result.data.dashboard.memoryRecords).toBe(1);
  });

  it("performs MCP initialize, discovers five memory tools and calls save/search/get/checkpoint/list", async () => {
    const rpc = async (method: string, params: unknown) => {
      const response = await worker.fetch(new Request("https://goldfish.ziopsyop.tech/mcp", { method: "POST",
        headers: { host: "goldfish.ziopsyop.tech", authorization: `Bearer ${projectKey}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env);
      expect(response.status).toBe(200);
      return data(response);
    };
    const initialize = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(initialize.result.serverInfo.name).toBe("goldfish");
    const listed = await rpc("tools/list", {});
    expect(listed.result.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(["memory_save", "memory_get", "memory_search", "memory_checkpoint", "memory_list_projects"]));
    const call = async (name: string, args: unknown) => (await rpc("tools/call", { name, arguments: args })).result;
    const saved = await call("memory_save", { content: "MCP persists real memory", kind: "fact" });
    expect(saved.isError).not.toBe(true);
    const memoryId = JSON.parse(saved.content[0].text).memory.id;
    expect(JSON.parse((await call("memory_get", { id: memoryId })).content[0].text).memory.content).toBe("MCP persists real memory");
    expect(JSON.parse((await call("memory_search", { query: "MCP persists" })).content[0].text).results).toHaveLength(1);
    expect(JSON.parse((await call("memory_checkpoint", { content: "MCP checkpoint" })).content[0].text).memory.metadata.type).toBe("checkpoint");
    expect(JSON.parse((await call("memory_list_projects", {})).content[0].text).projects).toHaveLength(1);
    expect((await call("memory_search", { projectId: "beta", query: "MCP" })).isError).toBe(true);
  });

  it("gates dashboard pages, manages records and never exposes API key hashes", async () => {
    const loginShell = await request("/", "GET");
    expect(loginShell.status).toBe(200);
    expect(await loginShell.text()).toContain("Unlock dashboard");
    expect((await request("/admin/session", "GET")).status).toBe(401);
    expect((await request("/admin/login", "POST", { password: "wrong" })).status).toBe(401);
    const login = await request("/admin/login", "POST", { password: env.DASHBOARD_PASSWORD });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const dashboardRequest = (path: string, method = "GET", payload?: unknown) => worker.fetch(new Request(`https://goldfish.ziopsyop.tech${path}`, { method, headers: { cookie, ...(payload ? { "content-type": "application/json" } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) }), env);
    expect((await dashboardRequest("/admin/session")).status).toBe(200);
    const settings = await data(await dashboardRequest("/admin/api/projects/alpha/settings", "PATCH", { autoCurationEnabled: true, projectInstructions: "Keep coding memory concise", multilingual: true }));
    expect(settings.autoCurationEnabled).toBe(true);
    expect(settings.curationPolicy.projectInstructions).toBe("Keep coding memory concise");
    expect((await dashboardRequest("/admin/api/projects/alpha/categories", "POST", { name: "Workflow", description: "Agent rules" })).status).toBe(200);
    const created = await data(await dashboardRequest("/admin/api/projects/alpha/memories", "POST", { content: "Manual dashboard memory", kind: "fact", metadata: { category: "workflow" }, agentId: "dashboard-agent" }));
    const memoryId = created.memory.id;
    const uploaded = await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media/upload`, "POST", { base64: "aGVsbG8=", fileName: "note.txt", mimeType: "text/plain" }));
    expect(uploaded.asset.storageProvider).toBe("r2");
    expect(artifacts.has(uploaded.asset.storageKey)).toBe(true);
    const assets = await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media`));
    expect(assets.assets).toHaveLength(1);
    const download = await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media/${uploaded.asset.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("text/plain");
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(download.headers.get("content-disposition")).toContain('filename="note.txt"');
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(await download.text()).toBe("hello");
    const unsafeUpload = await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media/upload`, "POST", { base64: "aGVsbG8=", fileName: "report\r\nunsafe.html", mimeType: "text/html" }));
    const unsafeDownload = await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media/${unsafeUpload.asset.id}`);
    expect(unsafeDownload.headers.get("content-type")).toBe("application/octet-stream");
    expect(unsafeDownload.headers.get("content-disposition")).toContain("attachment;");
    expect(unsafeDownload.headers.get("content-disposition")).not.toMatch(/[\r\n]/);
    await unsafeDownload.arrayBuffer();
    const unrelated = await data(await dashboardRequest("/admin/api/projects/alpha/memories", "POST", { content: "Unrelated dashboard memory", kind: "fact" }));
    expect((await dashboardRequest(`/admin/api/projects/alpha/memories/${unrelated.memory.id}/media/${uploaded.asset.id}`)).status).toBe(404);
    expect((await dashboardRequest(`/admin/api/projects/beta/memories/${memoryId}/media/${uploaded.asset.id}`)).status).toBe(404);
    const removed = await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media/${uploaded.asset.id}`, "DELETE"));
    expect(removed.asset).toMatchObject({ id: uploaded.asset.id, deleted: true, storageProvider: "r2" });
    expect(artifacts.has(uploaded.asset.storageKey)).toBe(false);
    expect((await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media`))).assets).toHaveLength(1);
    expect((await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media/${uploaded.asset.id}`)).status).toBe(404);
    expect((await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media/${unsafeUpload.asset.id}`, "DELETE")).status).toBe(200);
    expect((await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/media`))).assets).toHaveLength(0);
    const mediaAudit = await env.DB!.prepare("SELECT action FROM audit_events WHERE resource_id = ?").bind(uploaded.asset.id).all<any>();
    expect(mediaAudit.results.map(row => row.action)).toContain("memory.media_delete");
    const listed = await data(await dashboardRequest("/admin/api/projects/alpha/memories?query=dashboard&category=workflow&pageSize=10"));
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.memories.map((m: any) => m.id)).toContain(memoryId);
    const edited = await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}`, "PATCH", { content: "Manual dashboard memory revised", lifecycleStatus: "archived", changeSummary: "Corrected title" }));
    expect(edited.memory.currentVersion).toBe(2);
    expect(edited.versions.map((version: any) => version.changeSummary)).toContain("Corrected title");
    expect((await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}`, "DELETE")).status).toBe(200);
    expect((await data(await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/restore`, "POST"))).memory.lifecycleStatus).toBe("active");
    expect((await dashboardRequest(`/admin/api/projects/alpha/memories/${memoryId}/feedback`, "POST", { type: "positive", comment: "Useful" })).status).toBe(201);
    const analytics = await data(await dashboardRequest("/admin/api/projects/alpha/analytics?range=30d"));
    expect(analytics.summary.memoryRecords).toBeGreaterThanOrEqual(1);
    expect(analytics.summary.provenanceCoverage).toBeGreaterThanOrEqual(0);
    expect(analytics.byKind.some((item: any) => item.kind === "fact")).toBe(true);
    expect((await dashboardRequest("/admin/api/projects/alpha/graph/rebuild", "POST", { memoryIds: [memoryId] })).status).toBe(200);
    const graphOnce = await data(await dashboardRequest("/admin/api/projects/alpha/graph"));
    expect((await dashboardRequest("/admin/api/projects/alpha/graph/rebuild", "POST", { memoryIds: [memoryId] })).status).toBe(200);
    const graphTwice = await data(await dashboardRequest("/admin/api/projects/alpha/graph"));
    expect(graphTwice.edges.map((edge: any) => [edge.source_entity_id, edge.target_entity_id, edge.weight])).toEqual(graphOnce.edges.map((edge: any) => [edge.source_entity_id, edge.target_entity_id, edge.weight]));
    const copilot = await data(await dashboardRequest("/admin/api/projects/alpha/copilot", "POST", { message: "What should I do?" }));
    expect(copilot.requiresConfirmation).toBe(true);
    expect(copilot.proposals[0]).toMatchObject({ type: "create_memory" });
    expect(copilot.proposals[0].id).toMatch(/^[0-9a-f-]{36}$/);
    const applied = await data(await dashboardRequest(`/admin/api/projects/alpha/copilot/${copilot.conversationId}/proposals/${copilot.proposals[0].id}/apply`, "POST"));
    expect(applied.proposalType).toBe("create_memory");
    expect((await dashboardRequest(`/admin/api/projects/alpha/copilot/${copilot.conversationId}/proposals/${copilot.proposals[0].id}/apply`, "POST")).status).toBe(404);
    const preview = await data(await dashboardRequest("/admin/api/projects/alpha/curation/preview", "POST", { limit: 20 }));
    expect(preview.run.status).toBe("completed");
    const keyResponse = await data(await dashboardRequest("/admin/api/projects/alpha/api-keys", "POST", { label: "dashboard issued" }));
    expect(keyResponse.token).toMatch(/^gf_live_/);
    const keys = await data(await dashboardRequest("/admin/api/projects/alpha/api-keys"));
    expect(JSON.stringify(keys)).not.toContain("key_hash");
    expect(JSON.stringify(keys)).not.toContain(await contentHash(keyResponse.token));
    expect((await dashboardRequest(`/admin/api/projects/alpha/api-keys/${keyResponse.id}`, "DELETE")).status).toBe(200);
    expect((await dashboardRequest("/admin/logout", "POST")).status).toBe(200);
  });

  it("revokes keys idempotently and rejects them for REST and MCP", async () => {
    expect((await request(`/v1/projects/alpha/keys/${keyId}`, "DELETE", undefined, admin)).status).toBe(200);
    expect((await request(`/v1/projects/alpha/keys/${keyId}`, "DELETE", undefined, admin)).status).toBe(200);
    expect((await request("/v1/projects", "GET", undefined, projectKey)).status).toBe(401);
    expect((await request("/mcp", "POST", {}, projectKey)).status).toBe(401);
    const audit = await env.DB!.prepare("SELECT action FROM audit_events WHERE resource_id = ?").bind(keyId).all<any>();
    expect(audit.results.map(r => r.action)).toContain("api_key.revoke");
  });
});
