import { contentHash, validateMemoryInput, type MemoryKind } from "./domain";
import { HttpError, issueKey, revokeKey, type AuthEnv } from "./auth";
import { LexicalD1MemoryRepository, type D1DatabaseLike, type D1PreparedStatement } from "./repositories";
import { getMemoryAnalytics } from "./admin-analytics";
import { queryMemoryGraph, rebuildCooccurrenceGraph } from "./admin-graph";

export interface CopilotAI { run(model: string, input: unknown): Promise<unknown> }
export interface R2ArtifactObject {
  body: ReadableStream;
  size?: number;
  httpMetadata?: { contentType?: string };
}
export interface R2Artifacts {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get?(key: string): Promise<R2ArtifactObject | null>;
  delete?(key: string): Promise<unknown>;
}
export interface AdminEnv extends AuthEnv { AI?: CopilotAI; ARTIFACTS?: R2Artifacts }

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const lifecycleStatuses = ["active", "archived", "superseded", "deleted", "needs_review"] as const;
type LifecycleStatus = typeof lifecycleStatuses[number];
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const parseMetadata = (value: string): Record<string, unknown> => { try { const parsed = JSON.parse(value); return isObject(parsed) ? parsed : {}; } catch { return {}; } };
const asNumber = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const validId = (value: string, label = "id") => { if (!idPattern.test(value)) throw new HttpError(400, "INVALID_ID", `${label} is invalid`); return value; };
const validLifecycle = (value: unknown): LifecycleStatus => {
  if (typeof value !== "string" || !lifecycleStatuses.includes(value as LifecycleStatus)) throw new HttpError(400, "INVALID_LIFECYCLE_STATUS");
  return value as LifecycleStatus;
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function body(request: Request, maxBytes = 512_000): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE");
  const text = await request.text(); if (text.length > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE");
  try { const parsed = JSON.parse(text); if (!isObject(parsed)) throw new Error(); return parsed; } catch { throw new HttpError(400, "INVALID_JSON"); }
}
async function audit(db: D1DatabaseLike, projectId: string, action: string, resourceType: string, resourceId: string, details: Record<string, unknown> = {}) {
  await db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), projectId, action, resourceType, resourceId, JSON.stringify(details)).run();
}
type MemoryRow = { id: string; project_id: string; agent_id: string | null; session_id: string | null; kind: MemoryKind; source_type: string; source_ref: string | null; content_hash: string; current_version: number; metadata_json: string; lifecycle_status: LifecycleStatus; deleted_at: string | null; deleted_by: string | null; created_by: string | null; created_at: string; updated_at: string; content: string };
const memorySelect = `SELECT r.id, r.project_id, r.agent_id, r.session_id, r.kind, r.source_type, r.source_ref, r.content_hash,
 r.current_version, r.metadata_json, r.lifecycle_status, r.deleted_at, r.deleted_by, r.created_by, r.created_at, r.updated_at, v.content
 FROM memory_records r JOIN memory_versions v ON v.memory_record_id = r.id AND v.version = r.current_version`;
const shapeMemory = (row: MemoryRow, preview = false) => {
  const metadata = parseMetadata(row.metadata_json);
  const provenance = isObject(metadata._goldfish_provenance) ? metadata._goldfish_provenance : {};
  return { id: row.id, projectId: row.project_id,
    agentId: typeof provenance.external_agent_id === "string" ? provenance.external_agent_id : row.agent_id,
    sessionId: typeof provenance.external_session_id === "string" ? provenance.external_session_id : row.session_id,
    kind: row.kind, sourceType: row.source_type, sourceRef: row.source_ref, contentHash: row.content_hash, currentVersion: row.current_version,
    metadata, lifecycleStatus: row.lifecycle_status, deletedAt: row.deleted_at, deletedBy: row.deleted_by,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, ...(preview ? { contentPreview: row.content.slice(0, 500), contentLength: row.content.length } : { content: row.content }) };
};

async function ensureProvenance(db: D1DatabaseLike, projectId: string, agentId: string | null, sessionId: string | null): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  if (agentId) {
    validId(agentId, "agentId");
    const existing = await db.prepare("SELECT project_id FROM agents WHERE id = ?").bind(agentId).all<{ project_id: string }>();
    if (existing.results[0] && existing.results[0].project_id !== projectId) throw new HttpError(409, "AGENT_PROJECT_CONFLICT");
    statements.push(db.prepare("INSERT OR IGNORE INTO agents (id, project_id, name) VALUES (?, ?, ?)").bind(agentId, projectId, agentId));
  }
  if (sessionId) {
    validId(sessionId, "sessionId");
    const existing = await db.prepare("SELECT project_id, agent_id FROM sessions WHERE id = ?").bind(sessionId).all<{ project_id: string; agent_id: string | null }>();
    if (existing.results[0] && (existing.results[0].project_id !== projectId || (agentId && existing.results[0].agent_id !== agentId))) throw new HttpError(409, "SESSION_PROVENANCE_CONFLICT");
    statements.push(db.prepare("INSERT OR IGNORE INTO sessions (id, project_id, agent_id, external_id) VALUES (?, ?, ?, ?)").bind(sessionId, projectId, agentId, sessionId));
  }
  return statements;
}

async function projectExists(db: D1DatabaseLike, projectId: string) {
  const result = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).all<{ id: string }>();
  if (!result.results.length) throw new HttpError(404, "PROJECT_NOT_FOUND");
}

async function listMemories(db: D1DatabaseLike, projectId: string, url: URL) {
  const query = url.searchParams.get("query")?.trim(); const kind = url.searchParams.get("kind"); const agentId = url.searchParams.get("agentId");
  const sessionId = url.searchParams.get("sessionId"); const category = url.searchParams.get("category"); const lifecycle = url.searchParams.get("lifecycleStatus");
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const page = asNumber(url.searchParams.get("page"), 1, 1, 100_000);
  const pageSize = asNumber(url.searchParams.get("pageSize"), 50, 1, 100); const conditions = ["r.project_id = ?"]; const values: unknown[] = [projectId];
  if (query) { conditions.push("instr(v.content, ?) > 0"); values.push(query); }
  if (kind) { if (!(["fact", "conversation", "document", "task"] as string[]).includes(kind)) throw new HttpError(400, "INVALID_KIND"); conditions.push("r.kind = ?"); values.push(kind); }
  if (agentId) { validId(agentId, "agentId"); conditions.push("r.agent_id = ?"); values.push(agentId); }
  if (sessionId) { validId(sessionId, "sessionId"); conditions.push("r.session_id = ?"); values.push(sessionId); }
  if (category) { conditions.push("json_extract(r.metadata_json, '$.category') = ?"); values.push(category); }
  if (lifecycle) { conditions.push("r.lifecycle_status = ?"); values.push(validLifecycle(lifecycle)); }
  if (from) { conditions.push("r.updated_at >= ?"); values.push(from); }
  if (to) { conditions.push("r.updated_at <= ?"); values.push(to); }
  const where = conditions.join(" AND ");
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM memory_records r JOIN memory_versions v ON v.memory_record_id = r.id AND v.version = r.current_version WHERE ${where}`).bind(...values).all<{ total: number }>();
  const rows = await db.prepare(`${memorySelect} WHERE ${where} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all<MemoryRow>();
  return { memories: rows.results.map(row => shapeMemory(row, true)), page, pageSize, total: Number(count.results[0]?.total ?? 0), filters: { query: query ?? null, kind: kind ?? null, agentId: agentId ?? null, sessionId: sessionId ?? null, category: category ?? null, lifecycleStatus: lifecycle ?? null, from: from ?? null, to: to ?? null } };
}

async function detail(db: D1DatabaseLike, projectId: string, memoryId: string) {
  const result = await db.prepare(`${memorySelect} WHERE r.project_id = ? AND r.id = ?`).bind(projectId, memoryId).all<MemoryRow>(); const row = result.results[0];
  if (!row) throw new HttpError(404, "MEMORY_NOT_FOUND");
  const [versions, events] = await Promise.all([
    db.prepare("SELECT id, version, content, content_hash, changed_by, change_summary, created_at FROM memory_versions WHERE memory_record_id = ? ORDER BY version DESC").bind(memoryId).all<{ id: string; version: number; content: string; content_hash: string; changed_by: string | null; change_summary: string | null; created_at: string }>(),
    db.prepare("SELECT id, actor_id, action, resource_type, resource_id, details_json, created_at FROM audit_events WHERE project_id = ? AND resource_id = ? ORDER BY created_at DESC LIMIT 200").bind(projectId, memoryId).all<{ id: string; actor_id: string | null; action: string; resource_type: string | null; resource_id: string | null; details_json: string; created_at: string }>()
  ]);
  return { memory: shapeMemory(row), versions: versions.results.map(version => ({ id: version.id, version: version.version, content: version.content, contentHash: version.content_hash, changedBy: version.changed_by, changeSummary: version.change_summary, createdAt: version.created_at })), audit: events.results.map(event => ({ id: event.id, actorId: event.actor_id, action: event.action, resourceType: event.resource_type, resourceId: event.resource_id, details: parseMetadata(event.details_json), createdAt: event.created_at })) };
}

async function createMemory(db: D1DatabaseLike, projectId: string, input: Record<string, unknown>) {
  await projectExists(db, projectId); const parsed = validateMemoryInput(input); const repository = new LexicalD1MemoryRepository(db);
  const memory = await repository.ingest(projectId, { id: crypto.randomUUID(), projectId, content: parsed.content, kind: parsed.kind, contentHash: await contentHash(parsed.content), metadata: parsed.metadata ?? {}, agentId: parsed.agentId, sessionId: parsed.sessionId });
  await db.batch([
    db.prepare("UPDATE memory_records SET source_type = 'manual', created_by = 'dashboard-admin', updated_at = datetime('now') WHERE id = ? AND project_id = ?").bind(memory.id, projectId),
    db.prepare("UPDATE memory_versions SET changed_by = 'dashboard-admin', change_summary = 'Created manually' WHERE memory_record_id = ? AND version = 1").bind(memory.id),
    db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id) VALUES (?, ?, 'dashboard-admin', 'memory.create', 'memory', ?)").bind(crypto.randomUUID(), projectId, memory.id)
  ]);
  return detail(db, projectId, memory.id);
}

async function updateMemory(db: D1DatabaseLike, projectId: string, memoryId: string, patch: Record<string, unknown>) {
  const current = await detail(db, projectId, memoryId); const memory = current.memory as Record<string, unknown>;
  const content = patch.content === undefined ? memory.content : patch.content;
  const kind = patch.kind === undefined ? memory.kind : patch.kind;
  const metadata = patch.metadata === undefined ? memory.metadata : patch.metadata;
  const agentId = patch.agentId === undefined ? memory.agentId : patch.agentId;
  const sessionId = patch.sessionId === undefined ? memory.sessionId : patch.sessionId;
  const lifecycleStatus = patch.lifecycleStatus === undefined ? memory.lifecycleStatus : validLifecycle(patch.lifecycleStatus);
  const changeSummary = typeof patch.changeSummary === "string" ? patch.changeSummary.slice(0, 1_000) : "Updated manually";
  const input = validateMemoryInput({ content, kind, metadata, ...(agentId ? { agentId } : {}), ...(sessionId ? { sessionId } : {}) });
  const changedContent = input.content !== memory.content; const hash = changedContent ? await contentHash(input.content) : memory.contentHash as string;
  if (changedContent) {
    const duplicate = await db.prepare("SELECT id FROM memory_records WHERE project_id = ? AND content_hash = ? AND id != ?").bind(projectId, hash, memoryId).all<{ id: string }>();
    if (duplicate.results.length) throw new HttpError(409, "DUPLICATE_MEMORY", "Another memory already has this content");
  }
  const provenance = await ensureProvenance(db, projectId, input.agentId ?? null, input.sessionId ?? null);
  const deleted = lifecycleStatus === "deleted";
  const statements = [...provenance,
    db.prepare(`UPDATE memory_records SET agent_id = ?, session_id = ?, kind = ?, metadata_json = ?, content_hash = ?, lifecycle_status = ?,
      deleted_at = CASE WHEN ? THEN COALESCE(deleted_at, datetime('now')) ELSE NULL END,
      deleted_by = CASE WHEN ? THEN 'dashboard-admin' ELSE NULL END,
      current_version = current_version + ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`)
      .bind(input.agentId ?? null, input.sessionId ?? null, input.kind, JSON.stringify(input.metadata ?? {}), hash, lifecycleStatus, deleted ? 1 : 0, deleted ? 1 : 0, changedContent ? 1 : 0, memoryId, projectId)];
  if (changedContent) statements.push(db.prepare("INSERT INTO memory_versions (id, memory_record_id, version, content, content_hash, changed_by, change_summary) SELECT ?, id, current_version, ?, ?, 'dashboard-admin', ? FROM memory_records WHERE id = ? AND project_id = ?")
    .bind(`${memoryId}:${Number(memory.currentVersion) + 1}`, input.content, hash, changeSummary, memoryId, projectId));
  statements.push(db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', ?, 'memory', ?, ?)")
    .bind(crypto.randomUUID(), projectId, changedContent ? "memory.update_content" : "memory.update", memoryId, JSON.stringify({ lifecycleStatus, changedContent, changeSummary })));
  await db.batch(statements); return detail(db, projectId, memoryId);
}

async function bulk(db: D1DatabaseLike, projectId: string, input: Record<string, unknown>) {
  const ids = input.ids; if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new HttpError(400, "INVALID_BULK_IDS");
  const memoryIds = ids.map(value => { if (typeof value !== "string") throw new HttpError(400, "INVALID_BULK_IDS"); return validId(value, "memory id"); });
  const operation = input.operation; let lifecycleStatus: LifecycleStatus;
  if (operation === "delete") lifecycleStatus = "deleted"; else if (operation === "restore") lifecycleStatus = "active"; else if (operation === "lifecycle") lifecycleStatus = validLifecycle(input.lifecycleStatus); else throw new HttpError(400, "INVALID_BULK_OPERATION");
  const placeholders = memoryIds.map(() => "?").join(","); const exists = await db.prepare(`SELECT id FROM memory_records WHERE project_id = ? AND id IN (${placeholders})`).bind(projectId, ...memoryIds).all<{ id: string }>();
  if (exists.results.length !== memoryIds.length) throw new HttpError(404, "MEMORY_NOT_FOUND");
  const deleted = lifecycleStatus === "deleted";
  await db.batch([
    db.prepare(`UPDATE memory_records SET lifecycle_status = ?, deleted_at = CASE WHEN ? THEN COALESCE(deleted_at, datetime('now')) ELSE NULL END, deleted_by = CASE WHEN ? THEN 'dashboard-admin' ELSE NULL END, updated_at = datetime('now') WHERE project_id = ? AND id IN (${placeholders})`).bind(lifecycleStatus, deleted ? 1 : 0, deleted ? 1 : 0, projectId, ...memoryIds),
    ...memoryIds.map(id => db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', 'memory.bulk_lifecycle', 'memory', ?, ?)").bind(crypto.randomUUID(), projectId, id, JSON.stringify({ lifecycleStatus })))
  ]);
  return { updated: memoryIds.length, lifecycleStatus, ids: memoryIds };
}

async function metadata(db: D1DatabaseLike, projectId: string) {
  await projectExists(db, projectId);
  const [categories, agents, sessions, lifecycle, kinds] = await Promise.all([
    db.prepare("SELECT json_extract(metadata_json, '$.category') AS category, COUNT(*) AS count FROM memory_records WHERE project_id = ? AND json_extract(metadata_json, '$.category') IS NOT NULL GROUP BY category ORDER BY count DESC, category ASC").bind(projectId).all<{ category: string; count: number }>(),
    db.prepare("SELECT a.id, a.name, a.description, a.created_at, a.updated_at, COUNT(r.id) AS memory_count FROM agents a LEFT JOIN memory_records r ON r.agent_id = a.id WHERE a.project_id = ? GROUP BY a.id ORDER BY memory_count DESC, a.name ASC").bind(projectId).all<Record<string, unknown>>(),
    db.prepare("SELECT s.id, s.agent_id, s.external_id, s.started_at, s.ended_at, COUNT(r.id) AS memory_count FROM sessions s LEFT JOIN memory_records r ON r.session_id = s.id WHERE s.project_id = ? GROUP BY s.id ORDER BY s.started_at DESC LIMIT 500").bind(projectId).all<Record<string, unknown>>(),
    db.prepare("SELECT lifecycle_status AS status, COUNT(*) AS count FROM memory_records WHERE project_id = ? GROUP BY lifecycle_status ORDER BY status ASC").bind(projectId).all<{ status: string; count: number }>(),
    db.prepare("SELECT kind, COUNT(*) AS count FROM memory_records WHERE project_id = ? GROUP BY kind ORDER BY count DESC, kind ASC").bind(projectId).all<{ kind: string; count: number }>()
  ]);
  return { categories: categories.results.map(row => ({ category: row.category, count: Number(row.count) })), agents: agents.results, sessions: sessions.results, lifecycle: lifecycle.results.map(row => ({ status: row.status, count: Number(row.count) })), kinds: kinds.results.map(row => ({ kind: row.kind, count: Number(row.count) })) };
}

function analyticsDays(value: string | null): number {
  if (!value || value === "30d") return 30;
  if (value === "7d") return 7;
  if (value === "90d") return 90;
  if (value === "365d") return 365;
  throw new HttpError(400, "INVALID_ANALYTICS_RANGE");
}

/**
 * Privacy-preserving dashboard analytics. This deliberately derives from
 * persisted memory and audit state rather than retaining request transcripts.
 */
async function analytics(db: D1DatabaseLike, projectId: string, url: URL) {
  const days = analyticsDays(url.searchParams.get("range"));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const [ledger, recentActivity, feedback, categoryCount, keyCount, pendingCuration] = await Promise.all([
    getMemoryAnalytics(db, projectId, { from }),
    db.prepare("SELECT action, resource_type, resource_id, created_at FROM audit_events WHERE project_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20").bind(projectId, from).all<Record<string, unknown>>(),
    db.prepare("SELECT feedback_type AS type, COUNT(*) AS count FROM memory_feedback WHERE project_id = ? GROUP BY feedback_type ORDER BY count DESC, type ASC").bind(projectId).all<{ type: string; count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM project_categories WHERE project_id = ?").bind(projectId).all<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE project_id = ? AND revoked_at IS NULL").bind(projectId).all<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM curation_candidates WHERE project_id = ? AND status = 'pending'").bind(projectId).all<{ count: number }>()
  ]);
  const count = (entries: Array<{ label: string; count: number }>, label: string) => Number(entries.find(entry => entry.label === label)?.count ?? 0);
  const attributedAgents = ledger.agents.filter(entry => entry.label !== "unattributed").length;
  const attributedSessions = ledger.sessions.filter(entry => entry.label !== "unattributed").length;
  const memoryCount = ledger.summary.memories;
  return {
    projectId,
    rangeDays: days,
    summary: {
      memoryRecords: memoryCount,
      activeMemories: count(ledger.lifecycle, "active"),
      createdInRange: ledger.summary.createdInRange,
      averageAgeDays: ledger.summary.averageAgeDays === null ? 0 : Math.round(ledger.summary.averageAgeDays * 10) / 10,
      agents: attributedAgents,
      sessions: attributedSessions,
      checkpoints: ledger.summary.checkpoints,
      activeKeys: Number(keyCount.results[0]?.count ?? 0),
      categories: Number(categoryCount.results[0]?.count ?? 0),
      pendingCuration: Number(pendingCuration.results[0]?.count ?? 0),
      provenanceCoverage: memoryCount ? Math.round(((ledger.provenance.withAgent + ledger.provenance.withSession) / (memoryCount * 2)) * 100) : 0
    },
    activity: ledger.timeline.map(item => ({ date: item.label, count: item.count })),
    byKind: ledger.kinds.map(item => ({ kind: item.label, count: item.count })),
    byLifecycle: ledger.lifecycle.map(item => ({ status: item.label, count: item.count })),
    byAgent: ledger.agents.map(item => ({ label: item.label, count: item.count, latestAt: null })),
    provenance: ledger.provenance,
    retrieval: ledger.retrieval,
    feedback: feedback.results.map(item => ({ type: item.type, count: Number(item.count) })),
    recentActivity: recentActivity.results.map(item => ({ action: item.action, resourceType: item.resource_type, resourceId: item.resource_id, createdAt: item.created_at }))
  };
}

async function projectSummary(db: D1DatabaseLike) {
  const result = await db.prepare(`SELECT p.id, p.name, p.created_at, p.updated_at, COUNT(DISTINCT r.id) AS memory_count,
    COUNT(DISTINCT a.id) AS agent_count, COUNT(DISTINCT s.id) AS session_count, MAX(r.updated_at) AS latest_memory_at
    FROM projects p LEFT JOIN memory_records r ON r.project_id = p.id LEFT JOIN agents a ON a.project_id = p.id LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id ORDER BY latest_memory_at DESC, p.name ASC`).all<Record<string, unknown>>();
  return result.results;
}

async function keys(db: D1DatabaseLike, projectId: string) {
  await projectExists(db, projectId); const result = await db.prepare("SELECT id, project_id, key_prefix, label, last_used_at, created_at, revoked_at FROM api_keys WHERE project_id = ? ORDER BY created_at DESC").bind(projectId).all<Record<string, unknown>>();
  return result.results.map(row => ({ id: row.id, projectId: row.project_id, keyPrefix: row.key_prefix, label: row.label, lastUsedAt: row.last_used_at, createdAt: row.created_at, revokedAt: row.revoked_at }));
}

async function auditList(db: D1DatabaseLike, url: URL) {
  const projectId = url.searchParams.get("projectId"); const limit = asNumber(url.searchParams.get("limit"), 200, 1, 500);
  if (projectId) validId(projectId, "projectId"); const result = projectId
    ? await db.prepare("SELECT id, project_id, actor_id, action, resource_type, resource_id, details_json, created_at FROM audit_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").bind(projectId, limit).all<Record<string, unknown>>()
    : await db.prepare("SELECT id, project_id, actor_id, action, resource_type, resource_id, details_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT ?").bind(limit).all<Record<string, unknown>>();
  return result.results.map(event => ({ id: event.id, projectId: event.project_id, actorId: event.actor_id, action: event.action, resourceType: event.resource_type, resourceId: event.resource_id, details: parseMetadata(String(event.details_json ?? "{}")), createdAt: event.created_at }));
}

async function settings(db: D1DatabaseLike, projectId: string, input?: Record<string, unknown>) {
  await projectExists(db, projectId);
  const existing = await db.prepare("SELECT retention_days, auto_curation_enabled, auto_summarize_enabled, auto_delete_gibberish_enabled, curation_policy_json, dashboard_preferences_json, created_at, updated_at FROM project_settings WHERE project_id = ?").bind(projectId).all<Record<string, unknown>>();
  const current = existing.results[0] ?? { retention_days: null, auto_curation_enabled: 0, auto_summarize_enabled: 0, auto_delete_gibberish_enabled: 0, curation_policy_json: "{}", dashboard_preferences_json: "{}" };
  if (input) {
    const currentPolicy = parseMetadata(String(current.curation_policy_json)); const currentPreferences = parseMetadata(String(current.dashboard_preferences_json));
    const policy = isObject(input.curationPolicy) ? { ...currentPolicy, ...input.curationPolicy } : currentPolicy;
    for (const key of ["projectInstructions", "agentInstructions", "multilingual", "decay"]) if (input[key] !== undefined) policy[key] = input[key];
    const preferences = isObject(input.dashboardPreferences) ? { ...currentPreferences, ...input.dashboardPreferences } : currentPreferences;
    const retentionDays = input.retentionDays === undefined ? current.retention_days : input.retentionDays;
    if (retentionDays !== null && (!Number.isInteger(retentionDays) || (retentionDays as number) < 0 || (retentionDays as number) > 36_500)) throw new HttpError(400, "INVALID_RETENTION_DAYS");
    const flag = (name: string, fallback: unknown) => input[name] === undefined ? Number(fallback) : input[name] === true ? 1 : input[name] === false ? 0 : (() => { throw new HttpError(400, "INVALID_SETTING"); })();
    await db.prepare(`INSERT INTO project_settings (project_id, retention_days, auto_curation_enabled, auto_summarize_enabled, auto_delete_gibberish_enabled, curation_policy_json, dashboard_preferences_json)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET retention_days = excluded.retention_days, auto_curation_enabled = excluded.auto_curation_enabled, auto_summarize_enabled = excluded.auto_summarize_enabled, auto_delete_gibberish_enabled = excluded.auto_delete_gibberish_enabled, curation_policy_json = excluded.curation_policy_json, dashboard_preferences_json = excluded.dashboard_preferences_json, updated_at = datetime('now')`)
      .bind(projectId, retentionDays, flag("autoCurationEnabled", current.auto_curation_enabled), flag("autoSummarizeEnabled", current.auto_summarize_enabled), flag("autoDeleteGibberishEnabled", current.auto_delete_gibberish_enabled), JSON.stringify(policy), JSON.stringify(preferences)).run();
    await audit(db, projectId, "settings.update", "project_settings", projectId, { changed: Object.keys(input) });
  } else if (!existing.results.length) await db.prepare("INSERT OR IGNORE INTO project_settings (project_id) VALUES (?)").bind(projectId).run();
  const result = await db.prepare("SELECT retention_days, auto_curation_enabled, auto_summarize_enabled, auto_delete_gibberish_enabled, curation_policy_json, dashboard_preferences_json, created_at, updated_at FROM project_settings WHERE project_id = ?").bind(projectId).all<Record<string, unknown>>(); const row = result.results[0]!;
  return { projectId, retentionDays: row.retention_days, autoCurationEnabled: Boolean(row.auto_curation_enabled), autoSummarizeEnabled: Boolean(row.auto_summarize_enabled), autoDeleteGibberishEnabled: Boolean(row.auto_delete_gibberish_enabled), curationPolicy: parseMetadata(String(row.curation_policy_json)), dashboardPreferences: parseMetadata(String(row.dashboard_preferences_json)), createdAt: row.created_at, updatedAt: row.updated_at };
}

async function categories(db: D1DatabaseLike, projectId: string, request: Request, tail?: string) {
  await projectExists(db, projectId);
  if (!tail && request.method === "GET") { const result = await db.prepare("SELECT id, name, slug, description, color, sort_order, created_at, updated_at FROM project_categories WHERE project_id = ? ORDER BY sort_order, name").bind(projectId).all<Record<string, unknown>>(); return { categories: result.results }; }
  if (!tail && request.method === "POST") { const input = await body(request); const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : ""; const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); if (!name || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new HttpError(400, "INVALID_CATEGORY"); const id = crypto.randomUUID(); await db.prepare("INSERT INTO project_categories (id, project_id, name, slug, description, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, projectId, name, slug, typeof input.description === "string" ? input.description.slice(0, 1_000) : null, typeof input.color === "string" ? input.color.slice(0, 32) : null, Number.isInteger(input.sortOrder) ? input.sortOrder : 0).run(); await audit(db, projectId, "category.create", "category", id); return { category: { id, name, slug } }; }
  if (tail) { const id = validId(tail, "categoryId"); if (request.method === "DELETE") { const result = await db.prepare("DELETE FROM project_categories WHERE id = ? AND project_id = ?").bind(id, projectId).run() as unknown as { meta?: { changes?: number } }; await audit(db, projectId, "category.delete", "category", id); return { deleted: true, id, affected: result.meta?.changes ?? 0 }; } if (request.method === "PATCH") { const input = await body(request); const allowed = ["name", "description", "color", "sortOrder"]; const existing = await db.prepare("SELECT id FROM project_categories WHERE id = ? AND project_id = ?").bind(id, projectId).all(); if (!existing.results.length) throw new HttpError(404, "CATEGORY_NOT_FOUND"); const updates: string[] = []; const values: unknown[] = []; if (typeof input.name === "string") { updates.push("name = ?"); values.push(input.name.trim().slice(0, 120)); } if (typeof input.description === "string" || input.description === null) { updates.push("description = ?"); values.push(input.description === null ? null : input.description.slice(0, 1_000)); } if (typeof input.color === "string" || input.color === null) { updates.push("color = ?"); values.push(input.color === null ? null : input.color.slice(0, 32)); } if (Number.isInteger(input.sortOrder)) { updates.push("sort_order = ?"); values.push(input.sortOrder); } if (!updates.length || Object.keys(input).some(key => !allowed.includes(key))) throw new HttpError(400, "INVALID_CATEGORY_UPDATE"); await db.prepare(`UPDATE project_categories SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ? AND project_id = ?`).bind(...values, id, projectId).run(); await audit(db, projectId, "category.update", "category", id); return { updated: true, id }; } }
  throw new HttpError(405, "METHOD_NOT_ALLOWED");
}

async function feedback(db: D1DatabaseLike, projectId: string, memoryId: string, input: Record<string, unknown>) {
  const memory = await db.prepare("SELECT id FROM memory_records WHERE id = ? AND project_id = ?").bind(memoryId, projectId).all(); if (!memory.results.length) throw new HttpError(404, "MEMORY_NOT_FOUND");
  const feedbackType = typeof input.type === "string" ? input.type : ""; if (!(["positive", "negative", "very_negative", "helpful", "unhelpful", "flag", "correction", "rating", "note"] as string[]).includes(feedbackType)) throw new HttpError(400, "INVALID_FEEDBACK_TYPE");
  const id = crypto.randomUUID(); await db.prepare("INSERT INTO memory_feedback (id, project_id, memory_record_id, actor_id, feedback_type, rating, comment, metadata_json) VALUES (?, ?, ?, 'dashboard-admin', ?, ?, ?, ?)").bind(id, projectId, memoryId, feedbackType, Number.isInteger(input.rating) ? input.rating : null, typeof input.comment === "string" ? input.comment.slice(0, 4_000) : null, JSON.stringify(isObject(input.metadata) ? input.metadata : {})).run(); await audit(db, projectId, "memory.feedback", "memory", memoryId, { feedbackType }); return { id, type: feedbackType };
}

const terms = (content: string) => [...new Set((content.match(/(?:#[A-Za-z][A-Za-z0-9_-]{1,48}|\b[A-Z][a-z]{2,48}\b)/g) ?? []).map(term => term.replace(/^#/, "")).filter(term => !["The", "This", "That", "With", "From", "And"].includes(term)))].slice(0, 12);
type DerivedEntity = { name: string; canonical: string; type: "concept" | "agent" | "session" | "category"; confidence: number };
function derivedEntities(row: MemoryRow): DerivedEntity[] {
  const derived: DerivedEntity[] = terms(row.content).map(name => ({ name, canonical: name.toLowerCase(), type: "concept" as const, confidence: 0.75 }));
  const provenance = parseMetadata(row.metadata_json)._goldfish_provenance;
  const agent = isObject(provenance) && typeof provenance.external_agent_id === "string" ? provenance.external_agent_id : row.agent_id;
  const session = isObject(provenance) && typeof provenance.external_session_id === "string" ? provenance.external_session_id : row.session_id;
  if (agent) derived.push({ name: agent, canonical: agent.toLowerCase(), type: "agent", confidence: 1 });
  if (session) derived.push({ name: session, canonical: session.toLowerCase(), type: "session", confidence: 1 });
  const category = parseMetadata(row.metadata_json).category;
  if (typeof category === "string" && category.trim()) derived.push({ name: category.trim(), canonical: category.trim().toLowerCase(), type: "category", confidence: 0.9 });
  const seen = new Set<string>();
  return derived.filter(entity => {
    const key = `${entity.type}:${entity.canonical}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Recompute automatic graph material from current active memories. */
async function rebuildGraph(db: D1DatabaseLike, projectId: string, memoryIds?: string[]) {
  await projectExists(db, projectId);
  if (memoryIds?.length) {
    const unique = [...new Set(memoryIds)];
    const placeholders = unique.map(() => "?").join(",");
    const found = await db.prepare(`SELECT id FROM memory_records WHERE project_id = ? AND id IN (${placeholders})`).bind(projectId, ...unique).all<{ id: string }>();
    if (found.results.length !== unique.length) throw new HttpError(404, "MEMORY_NOT_FOUND");
  }
  // A partial rebuild cannot accurately decrement co-occurrence weights after edits
  // or deletion, so every rebuild intentionally refreshes the whole project graph.
  const rows = (await db.prepare(`${memorySelect} WHERE r.project_id = ? AND r.lifecycle_status != 'deleted' ORDER BY r.updated_at DESC LIMIT 1_000`).bind(projectId).all<MemoryRow>()).results;
  await db.batch([
    db.prepare("DELETE FROM memory_entities WHERE project_id = ? AND relationship_type = 'mentions'").bind(projectId)
  ]);
  const ids = new Map<string, string>();
  let entityCount = 0;
  for (const row of rows) {
    const entityIds: string[] = [];
    for (const entity of derivedEntities(row)) {
      const key = `${entity.type}:${entity.canonical}`;
      let id = ids.get(key);
      if (!id) {
        const existing = await db.prepare("SELECT id FROM entities WHERE project_id = ? AND canonical_name = ? AND entity_type = ?").bind(projectId, entity.canonical, entity.type).all<{ id: string }>();
        id = existing.results[0]?.id ?? crypto.randomUUID();
        if (!existing.results[0]) {
          await db.prepare("INSERT INTO entities (id, project_id, name, canonical_name, entity_type, metadata_json) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(id, projectId, entity.name, entity.canonical, entity.type, JSON.stringify({ derivedBy: "goldfish-graph-v1" })).run();
          entityCount++;
        }
        ids.set(key, id);
      }
      entityIds.push(id);
      await db.prepare("INSERT OR REPLACE INTO memory_entities (memory_record_id, entity_id, project_id, mention_text, relationship_type, confidence) VALUES (?, ?, ?, ?, 'mentions', ?)")
        .bind(row.id, id, projectId, entity.name, entity.confidence).run();
    }
  }
  await db.prepare("DELETE FROM entities WHERE project_id = ? AND json_extract(metadata_json, '$.derivedBy') = 'goldfish-graph-v1' AND NOT EXISTS (SELECT 1 FROM memory_entities WHERE memory_entities.entity_id = entities.id)").bind(projectId).run();
  const exact = await rebuildCooccurrenceGraph(db, projectId);
  await audit(db, projectId, "graph.rebuild", "graph", projectId, { memories: rows.length, entities: entityCount, edges: exact.edges, fullRebuild: true, edgeDerivation: exact.edgeDerivation });
  return { memories: rows.length, entitiesCreated: entityCount, edgesUpdated: exact.edges, fullRebuild: true, edgeDerivation: exact.edgeDerivation };
}

async function media(db: D1DatabaseLike, projectId: string, memoryId: string, input?: Record<string, unknown>) {
  const record = await db.prepare("SELECT id FROM memory_records WHERE id = ? AND project_id = ?").bind(memoryId, projectId).all(); if (!record.results.length) throw new HttpError(404, "MEMORY_NOT_FOUND");
  if (!input) { const assets = await db.prepare("SELECT id, storage_provider, storage_key, file_name, mime_type, byte_size, content_hash, metadata_json, created_at FROM memory_assets WHERE project_id = ? AND memory_record_id = ? ORDER BY created_at DESC").bind(projectId, memoryId).all<Record<string, unknown>>(); return { assets: assets.results.map(asset => ({ ...asset, metadata: parseMetadata(String(asset.metadata_json)) })) }; }
  const storageProvider = input.storageProvider === "r2" || input.storageProvider === "external" ? input.storageProvider : null; const storageKey = typeof input.storageKey === "string" ? input.storageKey.trim() : ""; if (!storageProvider || !storageKey || storageKey.length > 2_000) throw new HttpError(400, "INVALID_MEDIA_INPUT");
  const id = typeof input.assetId === "string" && idPattern.test(input.assetId) ? input.assetId : crypto.randomUUID(); await db.prepare("INSERT INTO memory_assets (id, project_id, memory_record_id, storage_provider, storage_key, file_name, mime_type, byte_size, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, projectId, memoryId, storageProvider, storageKey, typeof input.fileName === "string" ? input.fileName.slice(0, 500) : null, typeof input.mimeType === "string" ? input.mimeType.slice(0, 200) : null, Number.isInteger(input.byteSize) && (input.byteSize as number) >= 0 ? input.byteSize : null, typeof input.contentHash === "string" ? input.contentHash.slice(0, 128) : null, JSON.stringify(isObject(input.metadata) ? input.metadata : {})).run(); await audit(db, projectId, "memory.media_attach", "memory_asset", id, { memoryId, storageProvider }); return { id };
}

type MediaAssetRow = {
  id: string;
  project_id: string;
  memory_record_id: string;
  storage_provider: "r2" | "external";
  storage_key: string;
  file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
};

async function mediaAsset(db: D1DatabaseLike, projectId: string, memoryId: string, assetId: string): Promise<MediaAssetRow> {
  const result = await db.prepare("SELECT id, project_id, memory_record_id, storage_provider, storage_key, file_name, mime_type, byte_size FROM memory_assets WHERE id = ? AND project_id = ? AND memory_record_id = ?")
    .bind(assetId, projectId, memoryId).all<MediaAssetRow>();
  const asset = result.results[0];
  if (!asset) throw new HttpError(404, "MEDIA_ASSET_NOT_FOUND");
  return asset;
}

const safeMediaType = (value: unknown): string => {
  const candidate = typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(candidate)) return "application/octet-stream";
  // The object is intentionally always an attachment. These types still get a
  // generic type to prevent browsers from treating a downloaded asset as active content.
  if (["text/html", "application/xhtml+xml", "image/svg+xml", "application/javascript", "text/javascript"].includes(candidate)) return "application/octet-stream";
  return candidate;
};

const downloadDisposition = (fileName: string | null, assetId: string): string => {
  const fallbackName = `goldfish-attachment-${assetId}`;
  const name = (fileName ?? fallbackName).normalize("NFKC").replace(/[\u0000-\u001F\u007F\\/]/g, "_").trim().slice(0, 180) || fallbackName;
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || fallbackName;
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

async function downloadMedia(db: D1DatabaseLike, env: AdminEnv, projectId: string, memoryId: string, assetId: string): Promise<Response> {
  const asset = await mediaAsset(db, projectId, memoryId, assetId);
  if (asset.storage_provider !== "r2") throw new HttpError(409, "EXTERNAL_MEDIA_NOT_DOWNLOADABLE");
  if (!env.ARTIFACTS?.get) throw new HttpError(503, "R2_NOT_CONFIGURED");
  const object = await env.ARTIFACTS.get(asset.storage_key);
  if (!object) throw new HttpError(404, "MEDIA_OBJECT_NOT_FOUND");
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": safeMediaType(asset.mime_type ?? object.httpMetadata?.contentType),
    "content-disposition": downloadDisposition(asset.file_name, asset.id),
    "x-content-type-options": "nosniff"
  });
  const size = Number.isInteger(object.size) && (object.size as number) >= 0 ? object.size : asset.byte_size;
  if (Number.isInteger(size) && (size as number) >= 0) headers.set("content-length", String(size));
  return new Response(object.body, { headers });
}

async function deleteMedia(db: D1DatabaseLike, env: AdminEnv, projectId: string, memoryId: string, assetId: string) {
  const asset = await mediaAsset(db, projectId, memoryId, assetId);
  if (asset.storage_provider === "r2") {
    if (!env.ARTIFACTS?.delete) throw new HttpError(503, "R2_NOT_CONFIGURED");
    try { await env.ARTIFACTS.delete(asset.storage_key); }
    catch { throw new HttpError(502, "R2_DELETE_FAILED"); }
  }
  await db.batch([
    db.prepare("DELETE FROM memory_assets WHERE id = ? AND project_id = ? AND memory_record_id = ?").bind(asset.id, projectId, memoryId),
    db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', 'memory.media_delete', 'memory_asset', ?, ?)")
      .bind(crypto.randomUUID(), projectId, asset.id, JSON.stringify({ memoryId, storageProvider: asset.storage_provider }))
  ]);
  return { id: asset.id, deleted: true, storageProvider: asset.storage_provider };
}

async function uploadMedia(db: D1DatabaseLike, env: AdminEnv, projectId: string, memoryId: string, input: Record<string, unknown>) {
  if (!env.ARTIFACTS) throw new HttpError(503, "R2_NOT_CONFIGURED"); const encoded = typeof input.base64 === "string" ? input.base64 : ""; const mimeType = typeof input.mimeType === "string" ? input.mimeType.slice(0, 200) : "application/octet-stream";
  if (!encoded || encoded.length > 7_000_000 || !/^[A-Za-z0-9+/=_-]+$/.test(encoded)) throw new HttpError(400, "INVALID_MEDIA_UPLOAD");
  let bytes: Uint8Array; try { const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/"); bytes = Uint8Array.from(atob(normalized), item => item.charCodeAt(0)); } catch { throw new HttpError(400, "INVALID_MEDIA_UPLOAD"); }
  if (!bytes.byteLength || bytes.byteLength > 5_000_000) throw new HttpError(413, "MEDIA_TOO_LARGE");
  const assetId = crypto.randomUUID(); const extension = mimeType.includes("/") ? mimeType.split("/")[1].replace(/[^a-z0-9]/gi, "").slice(0, 12) : "bin"; const storageKey = `projects/${projectId}/memories/${memoryId}/${assetId}.${extension || "bin"}`;
  await env.ARTIFACTS.put(storageKey, bytes, { httpMetadata: { contentType: mimeType } });
  try { await media(db, projectId, memoryId, { assetId, storageProvider: "r2", storageKey, fileName: typeof input.fileName === "string" ? input.fileName : null, mimeType, byteSize: bytes.byteLength, contentHash: await contentHash(encoded), metadata: { ...(isObject(input.metadata) ? input.metadata : {}), uploadedBy: "dashboard-admin" } }); }
  catch (error) {
    // Keep R2 and D1 in sync when metadata persistence fails after an upload.
    await env.ARTIFACTS.delete?.(storageKey).catch(() => undefined);
    throw error;
  }
  return { id: assetId, storageProvider: "r2", storageKey, mimeType, byteSize: bytes.byteLength };
}

const obviousLowValue = (content: string) => /^(?:hi|hello|hey|thanks|thank you|test|ok|okay|yo|good morning|good evening)[!,.\s]*$/i.test(content.trim());
const obviousGibberish = (content: string) => {
  const value = content.trim();
  return value.length > 0 && value.length <= 32 && (/^(.)\1{4,}$/u.test(value) || (/^[^\p{L}\p{N}]+$/u.test(value) && value.length > 4));
};
type CurationSuggestion = { row: MemoryRow; action: "archive" | "summarize"; confidence: number; rationale: string; proposal: Record<string, unknown> };
async function createCurationRun(db: D1DatabaseLike, projectId: string, input: Record<string, unknown>) {
  await projectExists(db, projectId); const id = crypto.randomUUID(); const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit as number, 1), 1_000) : 500;
  const triggeredBy = input.triggeredBy === "scheduled" ? "scheduled" : "dashboard-admin";
  const settingsRow = await db.prepare("SELECT retention_days, auto_summarize_enabled, auto_delete_gibberish_enabled FROM project_settings WHERE project_id = ?").bind(projectId).all<{ retention_days: number | null; auto_summarize_enabled: number; auto_delete_gibberish_enabled: number }>();
  const settings = settingsRow.results[0] ?? { retention_days: null, auto_summarize_enabled: 0, auto_delete_gibberish_enabled: 0 };
  const rows = await db.prepare(`${memorySelect} WHERE r.project_id = ? AND r.lifecycle_status = 'active' ORDER BY r.updated_at ASC LIMIT ?`).bind(projectId, limit).all<MemoryRow>();
  const suggestLowSignal = triggeredBy !== "scheduled" || Boolean(settings.auto_delete_gibberish_enabled);
  const suggestions: CurationSuggestion[] = [];
  const seen = new Set<string>();
  for (const row of rows.results) {
    if (suggestLowSignal && (obviousLowValue(row.content) || obviousGibberish(row.content))) {
      suggestions.push({ row, action: "archive", confidence: 0.99, rationale: "Exact greeting, acknowledgement, or obvious low-signal text. Approval only moves it to reversible review quarantine.", proposal: { lifecycleStatus: "needs_review", reversible: true } });
      seen.add(row.id);
      continue;
    }
    if (settings.retention_days !== null) {
      const age = (Date.now() - Date.parse(`${row.updated_at.replace(" ", "T")}Z`)) / 86_400_000;
      if (Number.isFinite(age) && age > settings.retention_days) {
        suggestions.push({ row, action: "archive", confidence: 0.7, rationale: `Older than the ${settings.retention_days}-day retention review window. Approval only moves it to reversible review quarantine.`, proposal: { lifecycleStatus: "needs_review", reversible: true, retentionDays: settings.retention_days } });
        seen.add(row.id);
      }
    }
  }
  if (Boolean(settings.auto_summarize_enabled)) {
    for (const row of rows.results.filter(item => !seen.has(item.id) && item.content.length >= 1_000).slice(0, 20)) {
      suggestions.push({ row, action: "summarize", confidence: 0.62, rationale: "Long-lived detailed memory eligible for a human-confirmed condensed synthesis; the original remains intact.", proposal: { sourceMemoryIds: [row.id], preserveOriginal: true, requiresConfirmation: true } });
    }
  }
  const policy = { lowSignal: suggestLowSignal, retentionDays: settings.retention_days, summarize: Boolean(settings.auto_summarize_enabled), irreversibleDeletes: false };
  const statements: D1PreparedStatement[] = [db.prepare("INSERT INTO curation_runs (id, project_id, status, mode, scope_json, policy_json, metrics_json, triggered_by, started_at, completed_at) VALUES (?, ?, 'completed', 'suggest', ?, ?, ?, ?, datetime('now'), datetime('now'))").bind(id, projectId, JSON.stringify({ limit }), JSON.stringify(policy), JSON.stringify({ scanned: rows.results.length, candidates: suggestions.length, archive: suggestions.filter(item => item.action === "archive").length, summarize: suggestions.filter(item => item.action === "summarize").length }), triggeredBy)];
  for (const suggestion of suggestions) statements.push(db.prepare("INSERT INTO curation_candidates (id, curation_run_id, project_id, memory_record_id, proposed_action, status, confidence, rationale, proposal_json) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)").bind(crypto.randomUUID(), id, projectId, suggestion.row.id, suggestion.action, suggestion.confidence, suggestion.rationale, JSON.stringify(suggestion.proposal)));
  statements.push(db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', 'curation.preview', 'curation_run', ?, ?)").bind(crypto.randomUUID(), projectId, id, JSON.stringify({ scanned: rows.results.length, candidates: suggestions.length, policy })));
  await db.batch(statements); return curationDetail(db, projectId, id);
}
export async function runScheduledCuration(env: AuthEnv): Promise<{ projects: number; runs: number }> {
  if (!env.DB) return { projects: 0, runs: 0 };
  const enabled = await env.DB.prepare("SELECT project_id FROM project_settings WHERE auto_curation_enabled = 1 LIMIT 100").all<{ project_id: string }>();
  let runs = 0;
  for (const setting of enabled.results) {
    // The shared classifier only makes pending, reversible quarantine suggestions.
    await createCurationRun(env.DB, setting.project_id, { limit: 500, triggeredBy: "scheduled" }); runs++;
  }
  return { projects: enabled.results.length, runs };
}
async function curationDetail(db: D1DatabaseLike, projectId: string, id: string) {
  const run = await db.prepare("SELECT id, status, mode, scope_json, policy_json, metrics_json, triggered_by, error_message, started_at, completed_at, created_at, updated_at FROM curation_runs WHERE id = ? AND project_id = ?").bind(id, projectId).all<Record<string, unknown>>(); if (!run.results.length) throw new HttpError(404, "CURATION_RUN_NOT_FOUND");
  const candidates = await db.prepare("SELECT c.id, c.memory_record_id, c.proposed_action, c.status, c.confidence, c.rationale, c.proposal_json, c.reviewed_by, c.reviewed_at, c.applied_at, c.created_at, substr(v.content, 1, 500) AS content_preview FROM curation_candidates c LEFT JOIN memory_records r ON r.id = c.memory_record_id LEFT JOIN memory_versions v ON v.memory_record_id = r.id AND v.version = r.current_version WHERE c.curation_run_id = ? AND c.project_id = ? ORDER BY c.created_at DESC").bind(id, projectId).all<Record<string, unknown>>(); return { run: run.results[0], candidates: candidates.results.map(candidate => ({ ...candidate, proposal: parseMetadata(String(candidate.proposal_json)) })) };
}
async function approveCuration(db: D1DatabaseLike, projectId: string, runId: string, input: Record<string, unknown>) {
  const ids = Array.isArray(input.candidateIds) ? input.candidateIds : []; if (!ids.length || ids.length > 500 || ids.some(id => typeof id !== "string" || !idPattern.test(id))) throw new HttpError(400, "INVALID_CURATION_CANDIDATES"); const candidateIds = ids as string[];
  const placeholders = candidateIds.map(() => "?").join(","); const candidates = await db.prepare(`SELECT id, memory_record_id FROM curation_candidates WHERE curation_run_id = ? AND project_id = ? AND status = 'pending' AND id IN (${placeholders})`).bind(runId, projectId, ...candidateIds).all<{ id: string; memory_record_id: string | null }>(); if (candidates.results.length !== candidateIds.length) throw new HttpError(409, "CURATION_CANDIDATES_UNAVAILABLE");
  const statements: D1PreparedStatement[] = []; for (const candidate of candidates.results) { statements.push(db.prepare("UPDATE curation_candidates SET status = 'applied', reviewed_by = 'dashboard-admin', reviewed_at = datetime('now'), applied_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(candidate.id)); if (candidate.memory_record_id) statements.push(db.prepare("UPDATE memory_records SET lifecycle_status = 'needs_review', updated_at = datetime('now') WHERE id = ? AND project_id = ?").bind(candidate.memory_record_id, projectId)); }
  statements.push(db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', 'curation.approve_quarantine', 'curation_run', ?, ?)").bind(crypto.randomUUID(), projectId, runId, JSON.stringify({ candidateCount: candidateIds.length, lifecycleStatus: "needs_review" })));
  await db.batch(statements); return curationDetail(db, projectId, runId);
}

type CopilotProposal = { id: string; type: "create_memory" | "update_memory" | "lifecycle" | "synthesize"; summary: string; payload: Record<string, unknown>; status?: "pending" | "applied" };
function proposals(value: unknown): CopilotProposal[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["create_memory", "update_memory", "lifecycle", "synthesize"]);
  return value.flatMap(item => {
    if (!isObject(item) || typeof item.type !== "string" || !allowed.has(item.type) || typeof item.summary !== "string") return [];
    return [{ id: crypto.randomUUID(), type: item.type as CopilotProposal["type"], summary: item.summary.slice(0, 1_000), payload: isObject(item.payload) ? item.payload : {} }];
  }).slice(0, 12);
}
function copilotResult(value: unknown): { reply: string; proposals: CopilotProposal[] } {
  const response = isObject(value) && typeof value.response === "string" ? value.response : typeof value === "string" ? value : "I could not generate a response.";
  const candidate = response.match(/\{[\s\S]*\}/)?.[0];
  if (candidate) {
    try { const parsed = JSON.parse(candidate); if (isObject(parsed) && typeof parsed.reply === "string") return { reply: parsed.reply.slice(0, 12_000), proposals: proposals(parsed.proposals) }; } catch { /* textual response is still useful */ }
  }
  return { reply: response.slice(0, 12_000), proposals: [] };
}
async function copilot(db: D1DatabaseLike, env: AdminEnv, projectId: string, input: Record<string, unknown>) {
  if (!env.AI) throw new HttpError(503, "AI_NOT_CONFIGURED"); await projectExists(db, projectId);
  const message = typeof input.message === "string" ? input.message.trim() : ""; if (!message || message.length > 12_000) throw new HttpError(400, "INVALID_COPILOT_MESSAGE");
  const conversationId = typeof input.conversationId === "string" && idPattern.test(input.conversationId) ? input.conversationId : crypto.randomUUID();
  const rows = await db.prepare(`${memorySelect} WHERE r.project_id = ? AND r.lifecycle_status != 'deleted' ORDER BY r.updated_at DESC LIMIT 16`).bind(projectId).all<MemoryRow>();
  const context = rows.results.map(row => ({ id: row.id, kind: row.kind, category: parseMetadata(row.metadata_json).category ?? null, agent: row.agent_id, updatedAt: row.updated_at, content: row.content.slice(0, 1_000) }));
  const system = `You are Goldfish Copilot, the private memory administration assistant. Use only the supplied project context. Answer directly. You may propose, but never claim to have executed, mutations. If a mutation helps, return exactly JSON with reply and proposals. Each proposal must use one of create_memory, update_memory, lifecycle, synthesize and have summary and payload. Do not include secrets, API keys, credentials, or instructions to bypass access control.`;
  const result = copilotResult(await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", { messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ request: message, projectId, memories: context }) }] }));
  const messageId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO copilot_messages (id, project_id, conversation_id, role, content, metadata_json) VALUES (?, ?, ?, 'user', ?, '{}')").bind(crypto.randomUUID(), projectId, conversationId, message),
    db.prepare("INSERT INTO copilot_messages (id, project_id, conversation_id, role, content, tool_call_json, metadata_json) VALUES (?, ?, ?, 'assistant', ?, ?, '{}')").bind(messageId, projectId, conversationId, result.reply, JSON.stringify(result.proposals)),
    db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', 'copilot.respond', 'copilot_message', ?, ?)").bind(crypto.randomUUID(), projectId, messageId, JSON.stringify({ conversationId, proposalCount: result.proposals.length }))
  ]);
  return { conversationId, messageId, ...result, requiresConfirmation: result.proposals.length > 0 };
}

async function applyCopilotProposal(db: D1DatabaseLike, projectId: string, conversationId: string, proposalId: string) {
  const messages = await db.prepare("SELECT id, tool_call_json FROM copilot_messages WHERE project_id = ? AND conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 100")
    .bind(projectId, conversationId).all<{ id: string; tool_call_json: string | null }>();
  let messageId: string | undefined; let proposal: CopilotProposal | undefined; let all: CopilotProposal[] = [];
  for (const message of messages.results) {
    try {
      const parsed = message.tool_call_json ? JSON.parse(message.tool_call_json) : [];
      const candidate = proposals(parsed);
      // Stored proposals already have IDs; restoring them must retain those IDs.
      const stored = Array.isArray(parsed) ? parsed.filter((item): item is CopilotProposal => isObject(item) && typeof item.id === "string" && typeof item.type === "string" && typeof item.summary === "string" && isObject(item.payload)) : candidate;
      const match = stored.find(item => item.id === proposalId && item.status !== "applied");
      if (match) { messageId = message.id; proposal = match; all = stored; break; }
    } catch { /* malformed historical tool payloads are not executable */ }
  }
  if (!proposal || !messageId) throw new HttpError(404, "COPILOT_PROPOSAL_NOT_FOUND");
  let result: unknown;
  if (proposal.type === "create_memory" || proposal.type === "synthesize") {
    const content = proposal.payload.content;
    if (typeof content !== "string" || !content.trim()) throw new HttpError(400, "INVALID_COPILOT_PROPOSAL", "The proposal needs a memory content field before it can be applied");
    result = await createMemory(db, projectId, {
      content,
      kind: proposal.type === "synthesize" ? "document" : proposal.payload.kind ?? "fact",
      metadata: { ...(isObject(proposal.payload.metadata) ? proposal.payload.metadata : {}), copilotProposalId: proposal.id, ...(proposal.type === "synthesize" ? { type: "synthesis", sourceMemoryIds: proposal.payload.sourceMemoryIds ?? [] } : {}) },
      agentId: typeof proposal.payload.agentId === "string" ? proposal.payload.agentId : "goldfish-copilot",
      sessionId: typeof proposal.payload.sessionId === "string" ? proposal.payload.sessionId : undefined
    });
  } else {
    const memoryId = typeof proposal.payload.memoryId === "string" ? validId(proposal.payload.memoryId, "memoryId") : null;
    if (!memoryId) throw new HttpError(400, "INVALID_COPILOT_PROPOSAL", "The proposal needs a project memory ID before it can be applied");
    const patch = proposal.type === "lifecycle" ? { lifecycleStatus: proposal.payload.lifecycleStatus, changeSummary: `Copilot: ${proposal.summary}` } : { ...proposal.payload, changeSummary: `Copilot: ${proposal.summary}` };
    result = await updateMemory(db, projectId, memoryId, patch);
  }
  const updated = all.map(item => item.id === proposalId ? { ...item, status: "applied" as const } : item);
  await db.batch([
    db.prepare("UPDATE copilot_messages SET tool_call_json = ? WHERE id = ? AND project_id = ?").bind(JSON.stringify(updated), messageId, projectId),
    db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'dashboard-admin', 'copilot.proposal_apply', 'copilot_message', ?, ?)")
      .bind(crypto.randomUUID(), projectId, messageId, JSON.stringify({ conversationId, proposalId, type: proposal.type }))
  ]);
  return { proposalId, proposalType: proposal.type, result };
}

export async function handleAdminApi(request: Request, env: AdminEnv): Promise<Response> {
  if (!env.DB) throw new HttpError(503, "D1_NOT_CONFIGURED");
  const db = env.DB; const url = new URL(request.url); const path = url.pathname; const projectMatch = path.match(/^\/admin\/api\/projects\/([^/]+)(?:\/(.*))?$/);
  if (path === "/admin/api/projects") {
    if (request.method === "GET") return json({ projects: await projectSummary(db) });
    if (request.method === "POST") { const input = await body(request); const id = typeof input.id === "string" ? validId(input.id, "project id") : ""; const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : ""; if (!id || !name) throw new HttpError(400, "INVALID_PROJECT_INPUT"); await db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").bind(id, name).run(); await audit(db, id, "project.create", "project", id); return json({ project: { id, name } }, 201); }
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (path === "/admin/api/audit" && request.method === "GET") return json({ audit: await auditList(db, url) });
  if (!projectMatch) return json({ error: "NOT_FOUND" }, 404);
  const projectId = validId(decodeURIComponent(projectMatch[1]), "projectId"); const rest = projectMatch[2] ?? "";
  if (rest === "analytics" && request.method === "GET") return json(await analytics(db, projectId, url));
  if (rest === "copilot" && request.method === "POST") return json({ projectId, ...(await copilot(db, env, projectId, await body(request)) ) });
  const proposalMatch = rest.match(/^copilot\/([^/]+)\/proposals\/([^/]+)\/apply$/);
  if (proposalMatch && request.method === "POST") return json({ projectId, ...(await applyCopilotProposal(db, projectId, validId(decodeURIComponent(proposalMatch[1]), "conversationId"), validId(decodeURIComponent(proposalMatch[2]), "proposalId"))) });
  const conversationMatch = rest.match(/^copilot\/([^/]+)$/);
  if (conversationMatch && request.method === "GET") { const conversationId = validId(decodeURIComponent(conversationMatch[1]), "conversationId"); const messages = await db.prepare("SELECT id, role, content, tool_name, tool_call_json, metadata_json, created_at FROM copilot_messages WHERE project_id = ? AND conversation_id = ? ORDER BY created_at ASC LIMIT 500").bind(projectId, conversationId).all<Record<string, unknown>>(); return json({ projectId, conversationId, messages: messages.results.map(message => ({ ...message, proposals: message.tool_call_json ? JSON.parse(String(message.tool_call_json)) : [], metadata: parseMetadata(String(message.metadata_json)) })) }); }
  if (rest === "settings") { if (request.method === "GET") return json(await settings(db, projectId)); if (request.method === "PATCH") return json(await settings(db, projectId, await body(request))); }
  const categoryMatch = rest.match(/^categories(?:\/([^/]+))?$/);
  if (categoryMatch) return json({ projectId, ...(await categories(db, projectId, request, categoryMatch[1] ? decodeURIComponent(categoryMatch[1]) : undefined)) });
  if (rest === "entities" && request.method === "GET") { const entities = await db.prepare("SELECT e.id, e.name, e.canonical_name, e.entity_type, e.description, e.metadata_json, e.created_at, e.updated_at, COUNT(me.memory_record_id) AS memory_count FROM entities e LEFT JOIN memory_entities me ON me.entity_id = e.id WHERE e.project_id = ? GROUP BY e.id ORDER BY memory_count DESC, e.name ASC LIMIT 1000").bind(projectId).all<Record<string, unknown>>(); return json({ projectId, entities: entities.results }); }
  if (rest === "graph" && request.method === "GET") {
    const graph = await queryMemoryGraph(db, projectId, {
      query: url.searchParams.get("query") ?? undefined,
      entityType: url.searchParams.get("entityType") ?? undefined,
      memoryId: url.searchParams.get("memoryId") ?? undefined,
      limit: url.searchParams.get("limit") ? asNumber(url.searchParams.get("limit"), 250, 1, 1_000) : undefined
    });
    return json({
      projectId,
      extraction: graph.extraction,
      edgeDerivation: graph.edgeDerivation,
      nodes: graph.nodes.map(node => ({ id: node.id, name: node.name, canonical_name: node.canonicalName, entity_type: node.entityType, description: node.description, metadata_json: JSON.stringify(node.metadata), memory_count: node.memoryCount, memory_ids: node.memoryIds })),
      edges: graph.edges.map(edge => ({ id: edge.id, source_entity_id: edge.sourceEntityId, target_entity_id: edge.targetEntityId, relationship_type: edge.relationshipType, weight: edge.weight, confidence: edge.confidence }))
    });
  }
  if (rest === "graph/rebuild" && request.method === "POST") { const input = await body(request); const ids = Array.isArray(input.memoryIds) ? input.memoryIds.map(id => { if (typeof id !== "string") throw new HttpError(400, "INVALID_MEMORY_IDS"); return validId(id, "memoryId"); }) : undefined; return json({ projectId, ...(await rebuildGraph(db, projectId, ids)) }); }
  if (rest === "curation/preview" && request.method === "POST") return json({ projectId, ...(await createCurationRun(db, projectId, await body(request))) }, 201);
  if (rest === "jobs" && request.method === "GET") { const jobs = await db.prepare("SELECT id, status, mode, metrics_json, triggered_by, started_at, completed_at, created_at, updated_at FROM curation_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").bind(projectId).all<Record<string, unknown>>(); return json({ projectId, jobs: jobs.results.map(job => ({ ...job, metrics: parseMetadata(String(job.metrics_json)) })) }); }
  const jobMatch = rest.match(/^jobs\/([^/]+)(?:\/(approve))?$/);
  if (jobMatch) { const jobId = validId(decodeURIComponent(jobMatch[1]), "jobId"); if (jobMatch[2] === "approve" && request.method === "POST") return json({ projectId, ...(await approveCuration(db, projectId, jobId, await body(request))) }); if (request.method === "GET") return json({ projectId, ...(await curationDetail(db, projectId, jobId)) }); }
  if (rest === "summary" && request.method === "GET") { const meta = await metadata(db, projectId); return json({ projectId, ...meta }); }
  if (rest === "meta" && request.method === "GET") return json({ projectId, ...(await metadata(db, projectId)) });
  if (rest === "api-keys") {
    if (request.method === "GET") return json({ projectId, keys: await keys(db, projectId) });
    if (request.method === "POST") { const input = await body(request); const label = typeof input.label === "string" ? input.label.slice(0, 200) : undefined; const issued = await issueKey(db, projectId, label); await audit(db, projectId, "api_key.issue_dashboard", "api_key", issued.id, { label: issued.label }); return json(issued, 201); }
  }
  const keyMatch = rest.match(/^api-keys\/([^/]+)$/);
  if (keyMatch && request.method === "DELETE") { const keyId = validId(decodeURIComponent(keyMatch[1]), "keyId"); await revokeKey(db, projectId, keyId); await audit(db, projectId, "api_key.revoke_dashboard", "api_key", keyId); return json({ revoked: true, id: keyId }); }
  if (rest === "memories") {
    if (request.method === "GET") return json({ projectId, ...(await listMemories(db, projectId, url)) });
    if (request.method === "POST") return json({ projectId, ...(await createMemory(db, projectId, await body(request))) }, 201);
  }
  if (rest === "memories/bulk" && request.method === "POST") return json({ projectId, ...(await bulk(db, projectId, await body(request))) });
  const memoryMatch = rest.match(/^memories\/([^/]+)(?:\/(restore))?$/);
  if (memoryMatch) {
    const memoryId = validId(decodeURIComponent(memoryMatch[1]), "memoryId");
    if (memoryMatch[2] === "restore" && request.method === "POST") return json({ projectId, ...(await updateMemory(db, projectId, memoryId, { lifecycleStatus: "active", changeSummary: "Restored from dashboard" })) });
    if (request.method === "GET") return json({ projectId, ...(await detail(db, projectId, memoryId)) });
    if (request.method === "PATCH") return json({ projectId, ...(await updateMemory(db, projectId, memoryId, await body(request))) });
    if (request.method === "DELETE") return json({ projectId, ...(await updateMemory(db, projectId, memoryId, { lifecycleStatus: "deleted", changeSummary: "Deleted from dashboard" })) });
  }
  const feedbackMatch = rest.match(/^memories\/([^/]+)\/feedback$/);
  if (feedbackMatch && request.method === "POST") return json({ projectId, feedback: await feedback(db, projectId, validId(decodeURIComponent(feedbackMatch[1]), "memoryId"), await body(request)) }, 201);
  const mediaMatch = rest.match(/^memories\/([^/]+)\/media$/);
  if (mediaMatch) { const memoryId = validId(decodeURIComponent(mediaMatch[1]), "memoryId"); if (request.method === "GET") return json({ projectId, ...(await media(db, projectId, memoryId)) }); if (request.method === "POST") return json({ projectId, asset: await media(db, projectId, memoryId, await body(request)) }, 201); }
  const uploadMatch = rest.match(/^memories\/([^/]+)\/media\/upload$/);
  if (uploadMatch && request.method === "POST") return json({ projectId, asset: await uploadMedia(db, env, projectId, validId(decodeURIComponent(uploadMatch[1]), "memoryId"), await body(request, 7_000_000)) }, 201);
  const assetMatch = rest.match(/^memories\/([^/]+)\/media\/([^/]+)$/);
  if (assetMatch) {
    const memoryId = validId(decodeURIComponent(assetMatch[1]), "memoryId"); const assetId = validId(decodeURIComponent(assetMatch[2]), "assetId");
    if (request.method === "GET") return downloadMedia(db, env, projectId, memoryId, assetId);
    if (request.method === "DELETE") return json({ projectId, asset: await deleteMedia(db, env, projectId, memoryId, assetId) });
  }
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

export function renderAdminLoginShell(nonce = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goldfish Admin</title><style nonce="${nonce}">body{margin:0;background:#07111b;color:#eaf6ff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{width:min(420px,calc(100vw - 48px));padding:32px;border:1px solid #26465a;border-radius:18px;background:#0c1d2a}h1{margin:0 0 8px;color:#ffb703}p{color:#a8c4d4}input,button{box-sizing:border-box;width:100%;border-radius:9px;padding:12px;font:inherit}input{border:1px solid #466478;background:#06131e;color:#fff;margin:18px 0 12px}button{border:0;background:#ffb703;color:#10222f;font-weight:700;cursor:pointer}#status{min-height:24px;color:#ff9b9b;margin-top:12px}</style></head><body><main class="card"><h1>Goldfish</h1><p>Sign in to your private memory workspace.</p><form id="login"><input id="password" type="password" autocomplete="current-password" required autofocus aria-label="Dashboard password"><button>Unlock dashboard</button><div id="status" role="status"></div></form></main><script nonce="${nonce}">document.getElementById('login').addEventListener('submit',async e=>{e.preventDefault();const s=document.getElementById('status');s.textContent='';const r=await fetch('/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});if(r.ok)location.reload();else s.textContent='Password was not accepted.'})</script></body></html>`;
}
