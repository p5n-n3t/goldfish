import { HttpError } from "./auth";
import type { D1DatabaseLike, D1PreparedStatement } from "./repositories";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const edgeType = "co_occurs";
const maxRequestedMemoryIds = 500;

export type GraphQuery = { query?: string; entityType?: string; memoryId?: string; limit?: number };

export type GraphNode = {
  id: string; name: string; canonicalName: string; entityType: string; description: string | null;
  metadata: Record<string, unknown>; memoryCount: number; memoryIds: string[];
};
export type GraphEdge = { id: string; sourceEntityId: string; targetEntityId: string; relationshipType: string; weight: number; confidence: number | null };

const jsonObject = (value: string): Record<string, unknown> => {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
};
const positiveInteger = (value: unknown, fallback: number, max: number) => Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, max) : fallback;
const validateId = (value: string, label: string) => { if (!idPattern.test(value)) throw new HttpError(400, "INVALID_ID", `${label} is invalid`); return value; };

async function requireProject(db: D1DatabaseLike, projectId: string): Promise<void> {
  validateId(projectId, "projectId");
  const found = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).all<{ id: string }>();
  if (!found.results.length) throw new HttpError(404, "PROJECT_NOT_FOUND");
}

/**
 * Recomputes co-occurrence edges from the persisted memory/entity associations.
 * It deliberately does not perform extraction: entity extraction remains a
 * separate, explicitly labelled heuristic step. Repeated calls produce exactly
 * the same graph for the same associations.
 */
export async function rebuildCooccurrenceGraph(db: D1DatabaseLike, projectId: string, memoryIds?: string[]) {
  await requireProject(db, projectId);
  if (memoryIds && (!memoryIds.length || memoryIds.length > maxRequestedMemoryIds)) throw new HttpError(400, "INVALID_MEMORY_IDS");
  const ids = memoryIds ? [...new Set(memoryIds.map(id => validateId(id, "memoryId")))] : undefined;
  if (ids) {
    const markers = ids.map(() => "?").join(",");
    const records = await db.prepare(`SELECT id FROM memory_records WHERE project_id = ? AND id IN (${markers})`).bind(projectId, ...ids).all<{ id: string }>();
    if (records.results.length !== ids.length) throw new HttpError(404, "MEMORY_NOT_FOUND");
  }

  // A full rebuild is the only safe operation: an edge's weight is its exact
  // number of supporting memories, so partial rebuilds cannot remove obsolete
  // contributions without a separate contribution table.
  if (ids) throw new HttpError(400, "PARTIAL_GRAPH_REBUILD_UNSUPPORTED", "Rebuild the project graph to preserve exact co-occurrence counts");

  const pairs = await db.prepare(`
    SELECT left_link.entity_id AS source_entity_id, right_link.entity_id AS target_entity_id,
      COUNT(*) AS weight
    FROM memory_entities AS left_link
    JOIN memory_entities AS right_link
      ON right_link.memory_record_id = left_link.memory_record_id
     AND right_link.project_id = left_link.project_id
     AND left_link.entity_id < right_link.entity_id
    JOIN memory_records AS record ON record.id = left_link.memory_record_id
    WHERE left_link.project_id = ? AND record.project_id = ? AND record.lifecycle_status != 'deleted'
    GROUP BY left_link.entity_id, right_link.entity_id
  `).bind(projectId, projectId).all<{ source_entity_id: string; target_entity_id: string; weight: number }>();

  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM entity_edges WHERE project_id = ? AND relationship_type = ?").bind(projectId, edgeType),
    ...pairs.results.map(pair => db.prepare(`INSERT INTO entity_edges
      (id, project_id, source_entity_id, target_entity_id, relationship_type, weight, confidence, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), projectId, pair.source_entity_id, pair.target_entity_id, edgeType, Number(pair.weight), null,
        JSON.stringify({ derivedBy: "memory_entities_cooccurrence", exact: true })))
  ];
  await db.batch(statements);
  return { projectId, extraction: "not-run", edgeDerivation: "exact co-occurrence from persisted memory_entities", memoriesScoped: "all non-deleted project memories", edges: pairs.results.length };
}

export async function queryMemoryGraph(db: D1DatabaseLike, projectId: string, input: GraphQuery = {}) {
  await requireProject(db, projectId);
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length > 200) throw new HttpError(400, "INVALID_GRAPH_QUERY");
  const entityType = typeof input.entityType === "string" && input.entityType.trim() ? input.entityType.trim().slice(0, 100) : undefined;
  const memoryId = input.memoryId ? validateId(input.memoryId, "memoryId") : undefined;
  const limit = positiveInteger(input.limit, 250, 1_000);
  if (memoryId) {
    const record = await db.prepare("SELECT id FROM memory_records WHERE id = ? AND project_id = ?").bind(memoryId, projectId).all<{ id: string }>();
    if (!record.results.length) throw new HttpError(404, "MEMORY_NOT_FOUND");
  }
  const where = ["e.project_id = ?"]; const values: unknown[] = [projectId];
  if (entityType) { where.push("e.entity_type = ?"); values.push(entityType); }
  if (query) { where.push("(instr(lower(e.name), lower(?)) > 0 OR instr(lower(e.canonical_name), lower(?)) > 0)"); values.push(query, query); }
  if (memoryId) { where.push("EXISTS (SELECT 1 FROM memory_entities scoped WHERE scoped.entity_id = e.id AND scoped.project_id = e.project_id AND scoped.memory_record_id = ?)"); values.push(memoryId); }
  const nodesResult = await db.prepare(`SELECT e.id, e.name, e.canonical_name, e.entity_type, e.description, e.metadata_json,
      COUNT(DISTINCT me.memory_record_id) AS memory_count,
      COALESCE(json_group_array(DISTINCT me.memory_record_id), '[]') AS memory_ids
    FROM entities e LEFT JOIN memory_entities me ON me.entity_id = e.id AND me.project_id = e.project_id
    WHERE ${where.join(" AND ")}
    GROUP BY e.id ORDER BY memory_count DESC, e.name ASC LIMIT ?`).bind(...values, limit).all<{ id: string; name: string; canonical_name: string; entity_type: string; description: string | null; metadata_json: string; memory_count: number; memory_ids: string }>();
  const nodes = nodesResult.results.map(row => ({ id: row.id, name: row.name, canonicalName: row.canonical_name, entityType: row.entity_type, description: row.description, metadata: jsonObject(row.metadata_json), memoryCount: Number(row.memory_count), memoryIds: JSON.parse(row.memory_ids || "[]").filter((id: unknown): id is string => typeof id === "string") })) as GraphNode[];
  if (!nodes.length) return { projectId, extraction: "not-run", edgeDerivation: "exact co-occurrence from persisted memory_entities", nodes, edges: [] as GraphEdge[] };
  const ids = nodes.map(node => node.id); const markers = ids.map(() => "?").join(",");
  const edges = await db.prepare(`SELECT id, source_entity_id, target_entity_id, relationship_type, weight, confidence
    FROM entity_edges WHERE project_id = ? AND source_entity_id IN (${markers}) AND target_entity_id IN (${markers})
    ORDER BY weight DESC, id ASC LIMIT ?`).bind(projectId, ...ids, ...ids, limit * 4).all<{ id: string; source_entity_id: string; target_entity_id: string; relationship_type: string; weight: number; confidence: number | null }>();
  return { projectId, extraction: "not-run", edgeDerivation: "exact co-occurrence from persisted memory_entities", nodes, edges: edges.results.map(row => ({ id: row.id, sourceEntityId: row.source_entity_id, targetEntityId: row.target_entity_id, relationshipType: row.relationship_type, weight: Number(row.weight), confidence: row.confidence })) as GraphEdge[] };
}
