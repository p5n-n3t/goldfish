import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import schema from "../migrations/0001_initial.sql?raw";
import worker, { type Env } from "../src/index";
import { contentHash } from "../src/domain";
import type { D1DatabaseLike } from "../src/repositories";

const admin = "test-only-bootstrap-secret-with-at-least-32-characters";
let mf: Miniflare;
let env: Env;
let projectKey: string;
let otherKey: string;
let keyId: string;
const request = async (path: string, method = "GET", body?: unknown, token?: string) => worker.fetch(new Request(`https://goldfish.ziopsyop.tech${path}`, {
  method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {})
}), env);
const data = async (response: Response) => response.json() as Promise<Record<string, any>>;

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok') } }", compatibilityDate: "2025-09-01", d1Databases: ["DB"] }));
  const db = await mf.getD1Database("DB");
  await db.batch(schema.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  env = { DB: db as unknown as D1DatabaseLike, ADMIN_BOOTSTRAP_SECRET: admin };
  for (const id of ["alpha", "beta"]) {
    expect((await request("/v1/projects", "POST", { id, name: id }, admin)).status).toBe(201);
    const issued = await data(await request(`/v1/projects/${id}/keys`, "POST", { label: "integration test" }, admin));
    if (id === "alpha") { projectKey = issued.token; keyId = issued.id; } else otherKey = issued.token;
  }
}, 60000);
afterAll(async () => { await mf?.dispose(); });

describe("authenticated D1 REST and MCP", { timeout: 30_000 }, () => {
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
    expect((await request("/v1/projects/beta/memory", "POST", payload, otherKey)).status).toBe(409);
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

  it("revokes keys idempotently and rejects them for REST and MCP", async () => {
    expect((await request(`/v1/projects/alpha/keys/${keyId}`, "DELETE", undefined, admin)).status).toBe(200);
    expect((await request(`/v1/projects/alpha/keys/${keyId}`, "DELETE", undefined, admin)).status).toBe(200);
    expect((await request("/v1/projects", "GET", undefined, projectKey)).status).toBe(401);
    expect((await request("/mcp", "POST", {}, projectKey)).status).toBe(401);
    const audit = await env.DB!.prepare("SELECT action FROM audit_events WHERE resource_id = ?").bind(keyId).all<any>();
    expect(audit.results.map(r => r.action)).toContain("api_key.revoke");
  });
});
