import { HttpError } from "./auth";
import type { D1DatabaseLike } from "./repositories";

export type AnalyticsQuery = { from?: string; to?: string; bucket?: "day" | "week" | "month" };
type CountRow = { label: string; count: number };
const allowedBuckets = new Set(["day", "week", "month"]);

const iso = (value: unknown, label: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new HttpError(400, "INVALID_DATE_RANGE", `${label} must be an ISO date/time`);
  return value;
};
async function requireProject(db: D1DatabaseLike, projectId: string) {
  const result = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).all<{ id: string }>();
  if (!result.results.length) throw new HttpError(404, "PROJECT_NOT_FOUND");
}
const counts = (rows: CountRow[]) => rows.map(row => ({ label: row.label ?? "unclassified", count: Number(row.count) }));

/** Actual ledger aggregates only. Request/retrieval telemetry is intentionally unavailable. */
export async function getMemoryAnalytics(db: D1DatabaseLike, projectId: string, input: AnalyticsQuery = {}) {
  await requireProject(db, projectId);
  const from = iso(input.from, "from"); const to = iso(input.to, "to");
  if (from && to && from > to) throw new HttpError(400, "INVALID_DATE_RANGE", "from must be before to");
  const bucket = input.bucket ?? "day";
  if (!allowedBuckets.has(bucket)) throw new HttpError(400, "INVALID_ANALYTICS_BUCKET");
  const format = bucket === "month" ? "%Y-%m" : bucket === "week" ? "%Y-W%W" : "%Y-%m-%d";
  const scope: string[] = ["project_id = ?"]; const values: unknown[] = [projectId];
  if (from) { scope.push("created_at >= ?"); values.push(from); }
  if (to) { scope.push("created_at <= ?"); values.push(to); }
  const where = scope.join(" AND ");
  const [summary, timeline, lifecycle, kinds, agents, sessions, categories, provenance] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN lifecycle_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN kind = 'task' AND json_extract(metadata_json, '$.type') = 'checkpoint' THEN 1 ELSE 0 END) AS checkpoints,
      AVG(julianday('now') - julianday(created_at)) AS average_age_days
      FROM memory_records WHERE ${where}`).bind(...values).all<{ total: number; needs_review: number | null; checkpoints: number | null; average_age_days: number | null }>(),
    db.prepare(`SELECT strftime('${format}', created_at) AS label, COUNT(*) AS count FROM memory_records WHERE ${where} GROUP BY label ORDER BY label ASC`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT lifecycle_status AS label, COUNT(*) AS count FROM memory_records WHERE ${where} GROUP BY lifecycle_status ORDER BY count DESC, label ASC`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT kind AS label, COUNT(*) AS count FROM memory_records WHERE ${where} GROUP BY kind ORDER BY count DESC, label ASC`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT COALESCE(json_extract(metadata_json, '$._goldfish_provenance.external_agent_id'), agent_id, 'unattributed') AS label, COUNT(*) AS count FROM memory_records WHERE ${where} GROUP BY label ORDER BY count DESC, label ASC LIMIT 100`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT COALESCE(json_extract(metadata_json, '$._goldfish_provenance.external_session_id'), session_id, 'unattributed') AS label, COUNT(*) AS count FROM memory_records WHERE ${where} GROUP BY label ORDER BY count DESC, label ASC LIMIT 100`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT COALESCE(json_extract(metadata_json, '$.category'), 'uncategorized') AS label, COUNT(*) AS count FROM memory_records WHERE ${where} GROUP BY label ORDER BY count DESC, label ASC`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN agent_id IS NOT NULL THEN 1 ELSE 0 END) AS with_agent,
      SUM(CASE WHEN session_id IS NOT NULL THEN 1 ELSE 0 END) AS with_session,
      SUM(CASE WHEN agent_id IS NOT NULL AND session_id IS NOT NULL THEN 1 ELSE 0 END) AS complete
      FROM memory_records WHERE ${where}`).bind(...values).all<{ total: number; with_agent: number | null; with_session: number | null; complete: number | null }>()
  ]);
  const row = summary.results[0] ?? { total: 0, needs_review: 0, checkpoints: 0, average_age_days: null };
  const provenanceRow = provenance.results[0] ?? { total: 0, with_agent: 0, with_session: 0, complete: 0 };
  return {
    projectId, range: { from: from ?? null, to: to ?? null, bucket },
    summary: { memories: Number(row.total), createdInRange: Number(row.total), checkpoints: Number(row.checkpoints ?? 0), needsReview: Number(row.needs_review ?? 0), averageAgeDays: row.average_age_days === null ? null : Number(row.average_age_days) },
    timeline: counts(timeline.results), lifecycle: counts(lifecycle.results), kinds: counts(kinds.results), agents: counts(agents.results), sessions: counts(sessions.results), categories: counts(categories.results),
    provenance: { total: Number(provenanceRow.total), withAgent: Number(provenanceRow.with_agent ?? 0), withSession: Number(provenanceRow.with_session ?? 0), complete: Number(provenanceRow.complete ?? 0) },
    retrieval: { available: false, reason: "Request telemetry is not stored; no retrieval count, latency, or hit-rate is available." }
  };
}
