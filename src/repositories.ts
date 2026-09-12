import type { MemoryRecord, MemorySearchQuery } from "./domain";
import { HttpError } from "./auth";

export interface MemoryRepository {
  ingest(projectId: string, record: MemoryRecord): Promise<MemoryRecord>;
  search(projectId: string, query: MemorySearchQuery): Promise<MemoryRecord[]>;
}
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}
type MemoryRow = { id: string; project_id: string; agent_id: string | null; session_id: string | null; content: string; kind: MemoryRecord["kind"]; content_hash: string; metadata_json: string };
const selectMemory = `SELECT r.id, r.project_id, r.agent_id, r.session_id, v.content, r.kind, r.content_hash, r.metadata_json
 FROM memory_records r JOIN memory_versions v ON v.memory_record_id = r.id AND v.version = r.current_version`;
type StoredProvenance = { external_agent_id?: string; external_session_id?: string };
const decode = (row: MemoryRow): MemoryRecord => {
  const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  const provenance = metadata._goldfish_provenance as StoredProvenance | undefined;
  return { id: row.id, projectId: row.project_id, content: row.content, kind: row.kind,
    contentHash: row.content_hash, metadata,
    agentId: provenance?.external_agent_id ?? row.agent_id ?? undefined,
    sessionId: provenance?.external_session_id ?? row.session_id ?? undefined };
};
const storageIdentity = (projectId: string, type: "agent" | "session", externalId: string) => `${type}:${projectId}:${externalId}`;

export class LexicalD1MemoryRepository implements MemoryRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  /** A workspace-scoped local agent may begin a new folder without an admin round trip. */
  async ensureProject(projectId: string): Promise<void> {
    await this.db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").bind(projectId, projectId).run();
  }

  async ingest(projectId: string, record: MemoryRecord): Promise<MemoryRecord> {
    const statements: D1PreparedStatement[] = [];
    // D1's original schema makes agents and sessions globally keyed. Store a
    // project-qualified internal identity while returning the caller's stable
    // agent/session names, so codex_cli can safely work in every folder.
    const storedAgentId = record.agentId ? storageIdentity(projectId, "agent", record.agentId) : undefined;
    const storedSessionId = record.sessionId ? storageIdentity(projectId, "session", record.sessionId) : undefined;
    const metadata = {
      ...record.metadata,
      ...(record.agentId || record.sessionId ? { _goldfish_provenance: { external_agent_id: record.agentId, external_session_id: record.sessionId } } : {})
    };
    if (storedAgentId) {
      statements.push(this.db.prepare("INSERT OR IGNORE INTO agents (id, project_id, name) VALUES (?, ?, ?)").bind(storedAgentId, projectId, record.agentId));
    }
    if (storedSessionId) {
      statements.push(this.db.prepare("INSERT OR IGNORE INTO sessions (id, project_id, agent_id, external_id) SELECT ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM agents WHERE id = ? AND project_id = ?)").bind(storedSessionId, projectId, storedAgentId ?? null, record.sessionId, storedAgentId ?? null, storedAgentId ?? null, projectId));
    }
    // A D1 batch is transactional, so an incomplete version cannot be persisted.
    statements.push(this.db.prepare(`INSERT INTO memory_records
      (id, project_id, agent_id, session_id, kind, content_hash, metadata_json)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE (? IS NULL OR EXISTS (SELECT 1 FROM agents WHERE id = ? AND project_id = ?))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM sessions WHERE id = ? AND project_id = ? AND (? IS NULL OR agent_id = ?)))
      ON CONFLICT(project_id, content_hash) DO NOTHING`)
      .bind(record.id, projectId, storedAgentId ?? null, storedSessionId ?? null, record.kind, record.contentHash, JSON.stringify(metadata), storedAgentId ?? null, storedAgentId ?? null, projectId, storedSessionId ?? null, storedSessionId ?? null, projectId, storedAgentId ?? null, storedAgentId ?? null));
    statements.push(this.db.prepare(`INSERT INTO memory_versions (id, memory_record_id, version, content, content_hash)
      SELECT ?, id, 1, ?, ? FROM memory_records WHERE id = ? ON CONFLICT(memory_record_id, version) DO NOTHING`)
      .bind(`${record.id}:1`, record.content, record.contentHash, record.id));
    await this.db.batch(statements);
    const result = await this.db.prepare(`${selectMemory} WHERE r.project_id = ? AND r.content_hash = ?`).bind(projectId, record.contentHash).all<MemoryRow>();
    if (!result.results[0]) throw new HttpError(409, "PROVENANCE_CONFLICT", "Memory provenance conflicts with another project or session");
    return decode(result.results[0]);
  }

  async get(projectId: string, id: string): Promise<MemoryRecord | null> {
    const result = await this.db.prepare(`${selectMemory} WHERE r.project_id = ? AND r.id = ?`).bind(projectId, id).all<MemoryRow>();
    return result.results[0] ? decode(result.results[0]) : null;
  }

  async search(projectId: string, query: MemorySearchQuery): Promise<MemoryRecord[]> {
    // instr performs literal substring search without SQLite LIKE/ESCAPE quirks.
    // It deliberately preserves the old contract: %, _, and backslashes are ordinary text.
    const result = await this.db.prepare(`${selectMemory}
      WHERE r.project_id = ? AND instr(v.content, ?) > 0
      ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`).bind(projectId, query.query.trim(), query.limit ?? 20).all<MemoryRow>();
    return result.results.map(decode);
  }

  async listProjects(projectId: string) {
    const result = await this.db.prepare("SELECT id, name, created_at, updated_at FROM projects WHERE id = ?").bind(projectId).all<{ id: string; name: string; created_at: string; updated_at: string }>();
    return result.results;
  }

  async listAllProjects() {
    const result = await this.db.prepare("SELECT id, name, created_at, updated_at FROM projects ORDER BY updated_at DESC, name ASC LIMIT 1_000").all<{ id: string; name: string; created_at: string; updated_at: string }>();
    return result.results;
  }
}

export class DeferredVectorizeMemoryRepository implements MemoryRepository {
  ingest(): Promise<MemoryRecord> { return Promise.reject(new Error("Vectorize/Workers AI retrieval adapter is not implemented")); }
  search(): Promise<MemoryRecord[]> { return Promise.reject(new Error("Vectorize/Workers AI retrieval adapter is not implemented")); }
}
