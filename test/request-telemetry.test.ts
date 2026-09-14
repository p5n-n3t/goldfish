import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import schema from "../migrations/0001_initial.sql?raw";
import lifecycleSchema from "../migrations/0002_admin_memory_lifecycle.sql?raw";
import foundationSchema from "../migrations/0003_admin_dashboard_foundation.sql?raw";
import workspaceKeySchema from "../migrations/0004_workspace_agent_keys.sql?raw";
import telemetrySchema from "../migrations/0005_request_and_project_intelligence.sql?raw";
import {
  classifyRequest,
  getRequestAnalytics,
  getRequestEventDetail,
  listRequestEvents,
  recordRequestEvent,
  sanitizeTelemetryPreview
} from "../src/request-telemetry";
import type { D1DatabaseLike } from "../src/repositories";

let mf: Miniflare;
let db: D1DatabaseLike;

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2025-09-01",
    d1Databases: ["DB"]
  }));
  const raw = await mf.getD1Database("DB");
  db = raw as unknown as D1DatabaseLike;
  const statements = [schema, lifecycleSchema, foundationSchema, workspaceKeySchema, telemetrySchema]
    .flatMap(sql => sql.split(";"))
    .filter(sql => sql.trim())
    .map(sql => raw.prepare(sql));
  await raw.batch(statements);
  await db.batch([
    db.prepare("INSERT INTO projects (id, name) VALUES ('alpha', 'Alpha'), ('beta', 'Beta')"),
    db.prepare("INSERT INTO agents (id, project_id, name) VALUES ('agent:alpha:codex', 'alpha', 'codex')"),
    db.prepare("INSERT INTO sessions (id, project_id, agent_id) VALUES ('session:alpha:one', 'alpha', 'agent:alpha:codex')"),
    db.prepare(`INSERT INTO memory_records
      (id, project_id, agent_id, session_id, kind, content_hash, metadata_json, lifecycle_status)
      VALUES ('m1', 'alpha', 'agent:alpha:codex', 'session:alpha:one', 'fact', 'h1', '{}', 'active'),
             ('m2', 'alpha', 'agent:alpha:codex', 'session:alpha:one', 'fact', 'h2', '{}', 'active'),
             ('m3', 'beta', NULL, NULL, 'fact', 'h3', '{}', 'active')`),
    db.prepare(`INSERT INTO memory_versions (id, memory_record_id, version, content, content_hash)
      VALUES ('m1:1', 'm1', 1, 'Alpha uses Codex', 'h1'),
             ('m2:1', 'm2', 1, 'Alpha is deployed', 'h2'),
             ('m3:1', 'm3', 1, 'Beta memory', 'h3')`)
  ]);
}, 120_000);

afterAll(async () => { await mf.dispose(); }, 120_000);

describe("request classification and redaction", () => {
  it("classifies API and MCP operations without inspecting request bodies", () => {
    expect(classifyRequest({ method: "POST", path: "/v3/memories/search" })).toBe("search");
    expect(classifyRequest({ protocol: "mcp", toolName: "memory_save" })).toBe("add");
    expect(classifyRequest({ method: "DELETE", path: "/admin/api/projects/alpha/memories/m1" })).toBe("delete");
    expect(classifyRequest({ method: "GET", path: "/health" })).toBe("health");
  });

  it("redacts likely credentials and bounds previews", () => {
    const preview = sanitizeTelemetryPreview("Authorization: Bearer abc.def.ghi password=hunter2 api_key=goldfish_abcdefghijklmnop");
    expect(preview).not.toContain("abc.def.ghi");
    expect(preview).not.toContain("hunter2");
    expect(preview).not.toContain("abcdefghijklmnop");
    expect(preview).toContain("[redacted]");
  });
});

describe("request telemetry persistence", () => {
  it("records sanitized events and project-scoped memory links", async () => {
    const recorded = await recordRequestEvent(db, {
      id: "req-search",
      projectId: "alpha",
      agentId: "agent:alpha:codex",
      sessionId: "session:alpha:one",
      appId: "codex_desktop",
      method: "POST",
      path: "/v1/projects/alpha/search",
      protocol: "api",
      statusCode: 200,
      latencyMs: 42,
      authMode: "workspace_key",
      queryPreview: "deployment Bearer secret-token-value",
      inputCount: 1,
      outputCount: 2,
      metadata: { stage: "hybrid", apiKey: "must-not-survive" },
      memoryLinks: [
        { memoryId: "m1", type: "returned", ordinal: 0, relevanceScore: 0.91 },
        { memoryId: "m2", type: "returned", ordinal: 1, relevanceScore: 0.72 },
        { memoryId: "m3", type: "returned", ordinal: 2, relevanceScore: 0.4 }
      ],
      createdAt: "2026-09-13T10:00:00Z"
    });
    expect(recorded).toMatchObject({ operation: "search", outcome: "success", linkedMemoryCount: 2 });

    const detail = await getRequestEventDetail(db, "alpha", "req-search");
    expect(detail.memories.map(item => item.memoryId)).toEqual(["m1", "m2"]);
    expect(detail.queryPreview).not.toContain("secret-token-value");
    expect(detail.metadata).toMatchObject({ stage: "hybrid", apiKey: "[redacted]" });
    await expect(getRequestEventDetail(db, "beta", "req-search")).rejects.toMatchObject({ status: 404, code: "REQUEST_NOT_FOUND" });
  });

  it("lists filtered events and reports real latency, errors, and link aggregates", async () => {
    await recordRequestEvent(db, {
      id: "req-add",
      projectId: "alpha",
      method: "POST",
      path: "/v1/projects/alpha/memory",
      protocol: "mcp",
      toolName: "memory_save",
      statusCode: 201,
      latencyMs: 20,
      outputCount: 1,
      memoryLinks: [{ memoryId: "m1", type: "created" }],
      createdAt: "2026-09-13T11:00:00Z"
    });
    await recordRequestEvent(db, {
      id: "req-error",
      projectId: "alpha",
      method: "POST",
      path: "/v1/projects/alpha/search",
      protocol: "api",
      statusCode: 500,
      latencyMs: 100,
      errorCode: "VECTOR_TIMEOUT",
      createdAt: "2026-09-14T11:00:00Z"
    });
    await recordRequestEvent(db, {
      id: "req-beta",
      projectId: "beta",
      method: "GET",
      path: "/v1/projects/beta/memory/m3",
      protocol: "api",
      statusCode: 200,
      latencyMs: 999,
      createdAt: "2026-09-14T12:00:00Z"
    });

    const filtered = await listRequestEvents(db, "alpha", { operation: "search", limit: 1 });
    expect(filtered).toMatchObject({ count: 2, limit: 1, hasMore: true });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].id).toBe("req-error");

    const analytics = await getRequestAnalytics(db, "alpha", { from: "2026-09-13", to: "2026-09-14T23:59:59Z" });
    expect(analytics.summary).toMatchObject({
      requests: 3,
      successes: 2,
      errors: 1,
      errorRate: 1 / 3,
      averageLatencyMs: 54,
      p50LatencyMs: 42,
      p95LatencyMs: 100,
      requestsWithMemoryLinks: 2,
      memoryLinks: 3
    });
    expect(analytics.timeline).toEqual([{ label: "2026-09-13", count: 2 }, { label: "2026-09-14", count: 1 }]);
    expect(analytics.operations).toEqual(expect.arrayContaining([{ label: "search", count: 2 }, { label: "add", count: 1 }]));
  });

  it("rejects malformed telemetry and date ranges", async () => {
    await expect(recordRequestEvent(db, { projectId: "alpha", statusCode: 700, latencyMs: 1 })).rejects.toMatchObject({ status: 400, code: "INVALID_TELEMETRY" });
    await expect(listRequestEvents(db, "alpha", { from: "2026-09-15", to: "2026-09-14" })).rejects.toMatchObject({ status: 400, code: "INVALID_DATE_RANGE" });
  });
});
