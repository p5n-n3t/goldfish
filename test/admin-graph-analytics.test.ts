import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import schema from "../migrations/0001_initial.sql?raw";
import lifecycleSchema from "../migrations/0002_admin_memory_lifecycle.sql?raw";
import foundationSchema from "../migrations/0003_admin_dashboard_foundation.sql?raw";
import workspaceKeySchema from "../migrations/0004_workspace_agent_keys.sql?raw";
import { getMemoryAnalytics } from "../src/admin-analytics";
import { queryMemoryGraph, rebuildCooccurrenceGraph } from "../src/admin-graph";
import type { D1DatabaseLike } from "../src/repositories";

let mf: Miniflare;
let db: D1DatabaseLike;

async function insertMemory(id: string, project: string, createdAt: string, agent: string | null, session: string | null, category: string | null, lifecycle = "active") {
  await db.prepare(`INSERT INTO memory_records (id, project_id, agent_id, session_id, kind, content_hash, metadata_json, lifecycle_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fact', ?, ?, ?, ?, ?)`)
    .bind(id, project, agent, session, `hash-${id}`, JSON.stringify(category ? { category } : {}), lifecycle, createdAt, createdAt).run();
  await db.prepare("INSERT INTO memory_versions (id, memory_record_id, version, content, content_hash, created_at) VALUES (?, ?, 1, ?, ?, ?)")
    .bind(`${id}:1`, id, `memory ${id}`, `hash-${id}`, createdAt).run();
}

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok') } }", compatibilityDate: "2025-09-01", d1Databases: ["DB"] }));
  const raw = await mf.getD1Database("DB"); db = raw as unknown as D1DatabaseLike;
  await raw.batch([...schema.split(";"), ...lifecycleSchema.split(";"), ...foundationSchema.split(";"), ...workspaceKeySchema.split(";")].filter(sql => sql.trim()).map(sql => raw.prepare(sql)));
  await db.batch([
    db.prepare("INSERT INTO projects (id, name) VALUES ('alpha', 'Alpha'), ('beta', 'Beta')"),
    db.prepare("INSERT INTO agents (id, project_id, name) VALUES ('a1', 'alpha', 'a1'), ('a2', 'alpha', 'a2')"),
    db.prepare("INSERT INTO sessions (id, project_id, agent_id) VALUES ('s1', 'alpha', 'a1')")
  ]);
  await insertMemory("m1", "alpha", "2026-09-01T10:00:00Z", "a1", "s1", "work");
  await insertMemory("m2", "alpha", "2026-09-02T10:00:00Z", "a2", null, "research", "needs_review");
  await insertMemory("m3", "alpha", "2026-09-03T10:00:00Z", null, null, null, "deleted");
  await db.batch([
    db.prepare("INSERT INTO entities (id, project_id, name, canonical_name) VALUES ('e1', 'alpha', 'Alpha', 'alpha'), ('e2', 'alpha', 'Beta', 'beta'), ('e3', 'alpha', 'Gamma', 'gamma')"),
    db.prepare("INSERT INTO memory_entities (memory_record_id, entity_id, project_id) VALUES ('m1', 'e1', 'alpha'), ('m1', 'e2', 'alpha'), ('m2', 'e1', 'alpha'), ('m2', 'e2', 'alpha'), ('m2', 'e3', 'alpha'), ('m3', 'e1', 'alpha'), ('m3', 'e3', 'alpha')")
  ]);
});
afterAll(async () => { await mf.dispose(); });

describe("admin graph aggregation", () => {
  it("rebuilds exact persisted association co-occurrences idempotently and omits deleted support", async () => {
    await rebuildCooccurrenceGraph(db, "alpha");
    await rebuildCooccurrenceGraph(db, "alpha");
    const edges = await db.prepare("SELECT source_entity_id, target_entity_id, weight FROM entity_edges WHERE project_id = 'alpha' ORDER BY source_entity_id, target_entity_id").all<{ source_entity_id: string; target_entity_id: string; weight: number }>();
    expect(edges.results).toEqual([
      { source_entity_id: "e1", target_entity_id: "e2", weight: 2 },
      { source_entity_id: "e1", target_entity_id: "e3", weight: 1 },
      { source_entity_id: "e2", target_entity_id: "e3", weight: 1 }
    ]);
  });

  it("removes stale edges when associations change and returns scoped nodes with related memory ids", async () => {
    await db.prepare("DELETE FROM memory_entities WHERE memory_record_id = 'm2' AND entity_id = 'e3'").run();
    await rebuildCooccurrenceGraph(db, "alpha");
    const graph = await queryMemoryGraph(db, "alpha", { query: "alpha" });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ id: "e1", memoryIds: expect.arrayContaining(["m1", "m2", "m3"]) });
    const all = await queryMemoryGraph(db, "alpha");
    expect(all.edges.map(edge => [edge.sourceEntityId, edge.targetEntityId, edge.weight])).toEqual([["e1", "e2", 2]]);
    await expect(rebuildCooccurrenceGraph(db, "beta", ["m1"])).rejects.toMatchObject({ status: 404, code: "MEMORY_NOT_FOUND" });
    await expect(rebuildCooccurrenceGraph(db, "alpha", ["m1"])).rejects.toMatchObject({ status: 400, code: "PARTIAL_GRAPH_REBUILD_UNSUPPORTED" });
  });
});

describe("admin analytics", () => {
  it("reports actual ledger distributions and explicitly unavailable retrieval metrics", async () => {
    const result = await getMemoryAnalytics(db, "alpha", { from: "2026-09-01T00:00:00Z", to: "2026-09-02T23:59:59Z" });
    expect(result.summary).toMatchObject({ memories: 2, createdInRange: 2, needsReview: 1, checkpoints: 0 });
    expect(result.timeline).toEqual([{ label: "2026-09-01", count: 1 }, { label: "2026-09-02", count: 1 }]);
    expect(result.lifecycle).toEqual(expect.arrayContaining([{ label: "active", count: 1 }, { label: "needs_review", count: 1 }]));
    expect(result.categories).toEqual(expect.arrayContaining([{ label: "work", count: 1 }, { label: "research", count: 1 }]));
    expect(result.provenance).toEqual({ total: 2, withAgent: 2, withSession: 1, complete: 1 });
    expect(result.retrieval).toMatchObject({ available: false });
  });

  it("validates range and project scope", async () => {
    await expect(getMemoryAnalytics(db, "missing")).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    await expect(getMemoryAnalytics(db, "alpha", { from: "2026-09-03", to: "2026-09-01" })).rejects.toMatchObject({ status: 400, code: "INVALID_DATE_RANGE" });
  });
});
