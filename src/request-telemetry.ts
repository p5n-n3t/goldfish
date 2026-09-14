import { HttpError } from "./auth";
import type { D1DatabaseLike, D1PreparedStatement } from "./repositories";

export type RequestProtocol = "api" | "mcp" | "graphql" | "dashboard" | "system";
export type RequestOperation =
  | "add" | "search" | "fetch" | "list" | "update" | "delete" | "restore"
  | "summarize" | "graph" | "curate" | "authenticate" | "health" | "other";
export type RequestOutcome = "success" | "error";
export type RequestMemoryLinkType = "created" | "returned" | "fetched" | "matched" | "updated" | "deleted" | "restored" | "summarized" | "source";

export interface ClassifyRequestInput {
  method?: string;
  path?: string;
  protocol?: RequestProtocol;
  toolName?: string;
}

export interface RequestMemoryLinkInput {
  memoryId: string;
  type: RequestMemoryLinkType;
  ordinal?: number;
  relevanceScore?: number;
}

export interface RecordRequestEventInput extends ClassifyRequestInput {
  id?: string;
  projectId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  appId?: string | null;
  apiKeyId?: string | null;
  operation?: RequestOperation;
  statusCode: number;
  latencyMs: number;
  authMode?: string | null;
  traceId?: string | null;
  queryPreview?: string | null;
  errorCode?: string | null;
  inputCount?: number;
  outputCount?: number;
  metadata?: Record<string, unknown>;
  memoryLinks?: RequestMemoryLinkInput[];
  createdAt?: string;
}

export interface RequestEventQuery {
  operation?: RequestOperation;
  protocol?: RequestProtocol;
  outcome?: RequestOutcome;
  statusCode?: number;
  agentId?: string;
  sessionId?: string;
  appId?: string;
  apiKeyId?: string;
  from?: string;
  to?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface RequestAnalyticsQuery {
  from?: string;
  to?: string;
  bucket?: "day" | "week" | "month";
}

type EventRow = {
  id: string;
  project_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  app_id: string | null;
  api_key_id: string | null;
  operation: RequestOperation;
  protocol: RequestProtocol;
  method: string;
  path: string;
  status_code: number;
  outcome: RequestOutcome;
  latency_ms: number;
  auth_mode: string | null;
  trace_id: string | null;
  query_preview: string | null;
  error_code: string | null;
  input_count: number;
  output_count: number;
  metadata_json: string;
  created_at: string;
};

const allowedBuckets = new Set(["day", "week", "month"]);
const sensitiveKey = /(?:authorization|cookie|password|passphrase|secret|token|api[_-]?key|credential)/i;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const keyPattern = /\b(?:sk|sm|m0sk|goldfish|gf)[_-][A-Za-z0-9_-]{12,}\b/gi;

const boundedString = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const finiteNonnegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new HttpError(400, "INVALID_TELEMETRY", `${label} must be non-negative`);
  return value;
};
const boundedCount = (value: number | undefined, label: string) => Math.floor(finiteNonnegative(value ?? 0, label));
const iso = (value: string | undefined, label: string) => {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new HttpError(400, "INVALID_DATE_RANGE", `${label} must be an ISO date/time`);
  return new Date(parsed).toISOString();
};
const parseJson = (value: string) => {
  try { return JSON.parse(value) as Record<string, unknown>; }
  catch { return {}; }
};

function redactUnknown(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return value.replace(bearerPattern, "Bearer [redacted]").replace(keyPattern, "[redacted]").slice(0, 1_000);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => redactUnknown(item, depth + 1, seen));
  if (typeof value !== "object") return String(value).slice(0, 200);
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    output[key] = sensitiveKey.test(key) ? "[redacted]" : redactUnknown(item, depth + 1, seen);
  }
  return output;
}

export function sanitizeTelemetryPreview(value: string | null | undefined): string | null {
  if (!value) return null;
  const sanitized = value.replace(bearerPattern, "Bearer [redacted]").replace(keyPattern, "[redacted]").replace(/(["']?(?:password|secret|token|api[_-]?key)["']?\s*[:=]\s*)[^\s,;}]+/gi, "$1[redacted]");
  return sanitized.trim().slice(0, 500) || null;
}

/** Classify a request without reading or storing its body. */
export function classifyRequest(input: ClassifyRequestInput): RequestOperation {
  const method = (input.method ?? "GET").toUpperCase();
  const path = (input.path ?? "").toLowerCase();
  const tool = (input.toolName ?? "").toLowerCase();
  const subject = `${tool} ${path}`;
  if (/\b(memory_)?search\b|\/search(?:\/|$)/.test(subject)) return "search";
  if (/summar|project[_-]?brief/.test(subject)) return "summarize";
  if (/graph|relation/.test(subject)) return "graph";
  if (/curat|review/.test(subject)) return "curate";
  if (/restore/.test(subject)) return "restore";
  if (/login|logout|auth|oauth|workspace-keys/.test(subject)) return "authenticate";
  if (/health/.test(subject)) return "health";
  if (/memory_(save|add)|\/memories?\/add/.test(subject)) return "add";
  if (/memory_(get|fetch)|\/memories?\/[^/]+/.test(subject) && method === "GET") return "fetch";
  if (/memory_(list|projects)|\/memories?\/?$/.test(subject) && method === "GET") return "list";
  if (/memory_(update|edit)/.test(subject) || (method === "PATCH" || method === "PUT") && /memor/.test(subject)) return "update";
  if (/memory_(delete|forget)/.test(subject) || method === "DELETE" && /memor/.test(subject)) return "delete";
  if ((method === "POST" || method === "PUT") && /memor/.test(subject)) return "add";
  return "other";
}

function decodeEvent(row: EventRow) {
  return {
    id: row.id, projectId: row.project_id, agentId: row.agent_id, sessionId: row.session_id,
    appId: row.app_id, apiKeyId: row.api_key_id, operation: row.operation, protocol: row.protocol,
    method: row.method, path: row.path, statusCode: Number(row.status_code), outcome: row.outcome,
    latencyMs: Number(row.latency_ms), authMode: row.auth_mode, traceId: row.trace_id,
    queryPreview: row.query_preview, errorCode: row.error_code, inputCount: Number(row.input_count),
    outputCount: Number(row.output_count), metadata: parseJson(row.metadata_json), createdAt: row.created_at
  };
}

/** Persist one completed request and its memory links in one D1 batch. */
export async function recordRequestEvent(db: D1DatabaseLike, input: RecordRequestEventInput) {
  const statusCode = boundedCount(input.statusCode, "statusCode");
  if (statusCode < 100 || statusCode > 599) throw new HttpError(400, "INVALID_TELEMETRY", "statusCode must be between 100 and 599");
  const id = boundedString(input.id, 160) || crypto.randomUUID();
  const projectId = boundedString(input.projectId, 200) || null;
  const method = (boundedString(input.method, 16) || "GET").toUpperCase();
  const path = boundedString(input.path, 500) || "/";
  const protocol = input.protocol ?? "api";
  const operation = input.operation ?? classifyRequest({ method, path, protocol, toolName: input.toolName });
  const outcome: RequestOutcome = statusCode >= 400 ? "error" : "success";
  const createdAt = iso(input.createdAt, "createdAt") ?? new Date().toISOString();
  const metadata = redactUnknown(input.metadata ?? {}) as Record<string, unknown>;
  const encodedMetadata = JSON.stringify(metadata);
  const metadataJson = encodedMetadata.length <= 12_000
    ? encodedMetadata
    : JSON.stringify({ truncated: true, reason: "telemetry_metadata_limit" });
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO request_events
    (id, project_id, agent_id, session_id, app_id, api_key_id, operation, protocol, method, path,
     status_code, outcome, latency_ms, auth_mode, trace_id, query_preview, error_code, input_count,
     output_count, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, projectId, boundedString(input.agentId, 240) || null, boundedString(input.sessionId, 240) || null,
      boundedString(input.appId, 120) || null, boundedString(input.apiKeyId, 160) || null, operation, protocol,
      method, path, statusCode, outcome, finiteNonnegative(input.latencyMs, "latencyMs"),
      boundedString(input.authMode, 80) || null, boundedString(input.traceId, 160) || null,
      sanitizeTelemetryPreview(input.queryPreview), boundedString(input.errorCode, 160) || null,
      boundedCount(input.inputCount, "inputCount"), boundedCount(input.outputCount, "outputCount"),
      metadataJson, createdAt)];
  const links = input.memoryLinks ?? [];
  const seen = new Set<string>();
  for (const link of links.slice(0, 500)) {
    const memoryId = boundedString(link.memoryId, 200);
    const key = `${memoryId}\u0000${link.type}`;
    if (!projectId || !memoryId || seen.has(key)) continue;
    seen.add(key);
    const score = link.relevanceScore === undefined ? null : finiteNonnegative(link.relevanceScore, "relevanceScore");
    if (score !== null && score > 1) throw new HttpError(400, "INVALID_TELEMETRY", "relevanceScore must be at most 1");
    statements.push(db.prepare(`INSERT INTO request_memory_links
      (request_id, memory_record_id, project_id, link_type, ordinal, relevance_score, created_at)
      SELECT ?, id, project_id, ?, ?, ?, ? FROM memory_records WHERE id = ? AND project_id = ?`)
      .bind(id, link.type, link.ordinal === undefined ? null : boundedCount(link.ordinal, "ordinal"), score, createdAt, memoryId, projectId));
  }
  await db.batch(statements);
  const linked = await db.prepare("SELECT COUNT(*) AS count FROM request_memory_links WHERE request_id = ?").bind(id).all<{ count: number }>();
  return { id, projectId, operation, protocol, statusCode, outcome, createdAt, linkedMemoryCount: Number(linked.results[0]?.count ?? 0) };
}

function requestScope(projectId: string, query: RequestEventQuery | RequestAnalyticsQuery) {
  if (!projectId.trim()) throw new HttpError(400, "PROJECT_ID_REQUIRED");
  const clauses = ["project_id = ?"];
  const values: unknown[] = [projectId];
  const add = (clause: string, value: unknown) => { clauses.push(clause); values.push(value); };
  if ("operation" in query && query.operation) add("operation = ?", query.operation);
  if ("protocol" in query && query.protocol) add("protocol = ?", query.protocol);
  if ("outcome" in query && query.outcome) add("outcome = ?", query.outcome);
  if ("statusCode" in query && query.statusCode !== undefined) add("status_code = ?", query.statusCode);
  if ("agentId" in query && query.agentId) add("agent_id = ?", query.agentId);
  if ("sessionId" in query && query.sessionId) add("session_id = ?", query.sessionId);
  if ("appId" in query && query.appId) add("app_id = ?", query.appId);
  if ("apiKeyId" in query && query.apiKeyId) add("api_key_id = ?", query.apiKeyId);
  const from = iso(query.from, "from"); const to = iso(query.to, "to");
  if (from && to && from > to) throw new HttpError(400, "INVALID_DATE_RANGE", "from must be before to");
  if (from) add("created_at >= ?", from);
  if (to) add("created_at <= ?", to);
  if ("query" in query && query.query?.trim()) {
    const value = `%${query.query.trim().slice(0, 200).replace(/[%_]/g, "")}%`;
    clauses.push("(operation LIKE ? OR path LIKE ? OR COALESCE(error_code, '') LIKE ? OR COALESCE(query_preview, '') LIKE ?)");
    values.push(value, value, value, value);
  }
  return { where: clauses.join(" AND "), values, from, to };
}

export async function listRequestEvents(db: D1DatabaseLike, projectId: string, query: RequestEventQuery = {}) {
  const { where, values } = requestScope(projectId, query);
  const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? 50)));
  const offset = Math.min(1_000_000, Math.max(0, Math.floor(query.offset ?? 0)));
  const [rows, total] = await Promise.all([
    db.prepare(`SELECT * FROM request_events WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<EventRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM request_events WHERE ${where}`).bind(...values).all<{ count: number }>()
  ]);
  const count = Number(total.results[0]?.count ?? 0);
  return { items: rows.results.map(decodeEvent), count, limit, offset, hasMore: offset + rows.results.length < count };
}

export async function getRequestEventDetail(db: D1DatabaseLike, projectId: string, requestId: string) {
  const rows = await db.prepare("SELECT * FROM request_events WHERE id = ? AND project_id = ?").bind(requestId, projectId).all<EventRow>();
  const row = rows.results[0];
  if (!row) throw new HttpError(404, "REQUEST_NOT_FOUND");
  const links = await db.prepare(`SELECT l.memory_record_id, l.link_type, l.ordinal, l.relevance_score,
      r.kind, r.lifecycle_status, substr(v.content, 1, 240) AS content_preview
    FROM request_memory_links l
    JOIN memory_records r ON r.id = l.memory_record_id AND r.project_id = l.project_id
    JOIN memory_versions v ON v.memory_record_id = r.id AND v.version = r.current_version
    WHERE l.request_id = ? AND l.project_id = ?
    ORDER BY COALESCE(l.ordinal, 2147483647), l.created_at, l.memory_record_id`)
    .bind(requestId, projectId).all<{ memory_record_id: string; link_type: RequestMemoryLinkType; ordinal: number | null; relevance_score: number | null; kind: string; lifecycle_status: string; content_preview: string }>();
  return { ...decodeEvent(row), memories: links.results.map(link => ({ memoryId: link.memory_record_id, type: link.link_type, ordinal: link.ordinal, relevanceScore: link.relevance_score === null ? null : Number(link.relevance_score), kind: link.kind, lifecycle: link.lifecycle_status, contentPreview: link.content_preview })) };
}

const percentile = (sorted: number[], proportion: number) => {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * proportion) - 1))];
};

export async function getRequestAnalytics(db: D1DatabaseLike, projectId: string, query: RequestAnalyticsQuery = {}) {
  const { where, values, from, to } = requestScope(projectId, query);
  const bucket = query.bucket ?? "day";
  if (!allowedBuckets.has(bucket)) throw new HttpError(400, "INVALID_ANALYTICS_BUCKET");
  const format = bucket === "month" ? "%Y-%m" : bucket === "week" ? "%Y-W%W" : "%Y-%m-%d";
  type CountRow = { label: string; count: number };
  const [summary, timeline, operations, protocols, outcomes, agents, apps, endpoints, latencySample, linked] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors, AVG(latency_ms) AS average_latency_ms,
      SUM(input_count) AS inputs, SUM(output_count) AS outputs FROM request_events WHERE ${where}`).bind(...values).all<{ total: number; successes: number | null; errors: number | null; average_latency_ms: number | null; inputs: number | null; outputs: number | null }>(),
    db.prepare(`SELECT strftime('${format}', created_at) AS label, COUNT(*) AS count FROM request_events WHERE ${where} GROUP BY label ORDER BY label`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT operation AS label, COUNT(*) AS count FROM request_events WHERE ${where} GROUP BY operation ORDER BY count DESC, label`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT protocol AS label, COUNT(*) AS count FROM request_events WHERE ${where} GROUP BY protocol ORDER BY count DESC, label`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT outcome AS label, COUNT(*) AS count FROM request_events WHERE ${where} GROUP BY outcome ORDER BY count DESC, label`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT COALESCE(agent_id, 'unattributed') AS label, COUNT(*) AS count FROM request_events WHERE ${where} GROUP BY label ORDER BY count DESC, label LIMIT 100`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT COALESCE(app_id, 'unattributed') AS label, COUNT(*) AS count FROM request_events WHERE ${where} GROUP BY label ORDER BY count DESC, label LIMIT 100`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT method || ' ' || path AS label, COUNT(*) AS count FROM request_events WHERE ${where} GROUP BY label ORDER BY count DESC, label LIMIT 100`).bind(...values).all<CountRow>(),
    db.prepare(`SELECT latency_ms FROM request_events WHERE ${where} ORDER BY created_at DESC LIMIT 10000`).bind(...values).all<{ latency_ms: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT request_id) AS requests, COUNT(*) AS links FROM request_memory_links
      WHERE request_id IN (SELECT id FROM request_events WHERE ${where})`).bind(...values).all<{ requests: number; links: number }>()
  ]);
  const row = summary.results[0] ?? { total: 0, successes: 0, errors: 0, average_latency_ms: null, inputs: 0, outputs: 0 };
  const latencies = latencySample.results.map(item => Number(item.latency_ms)).sort((a, b) => a - b);
  const total = Number(row.total);
  const mapCounts = (rows: CountRow[]) => rows.map(item => ({ label: item.label ?? "unattributed", count: Number(item.count) }));
  return {
    projectId, range: { from: from ?? null, to: to ?? null, bucket },
    summary: {
      requests: total, successes: Number(row.successes ?? 0), errors: Number(row.errors ?? 0),
      errorRate: total ? Number(row.errors ?? 0) / total : 0,
      averageLatencyMs: row.average_latency_ms === null ? null : Number(row.average_latency_ms),
      p50LatencyMs: percentile(latencies, 0.5), p95LatencyMs: percentile(latencies, 0.95),
      inputCount: Number(row.inputs ?? 0), outputCount: Number(row.outputs ?? 0),
      requestsWithMemoryLinks: Number(linked.results[0]?.requests ?? 0), memoryLinks: Number(linked.results[0]?.links ?? 0),
      latencySampleSize: latencies.length, latencySampleLimited: total > latencies.length
    },
    timeline: mapCounts(timeline.results), operations: mapCounts(operations.results), protocols: mapCounts(protocols.results),
    outcomes: mapCounts(outcomes.results), agents: mapCounts(agents.results), apps: mapCounts(apps.results), endpoints: mapCounts(endpoints.results)
  };
}
