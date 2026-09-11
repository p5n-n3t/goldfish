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
const decode = (row: MemoryRow): MemoryRecord => ({ id: row.id, projectId: row.project_id, content: row.content, kind: row.kind,
  contentHash: row.content_hash, metadata: JSON.parse(row.metadata_json), agentId: row.agent_id ?? undefined, sessionId: row.session_id ?? undefined });

export class LexicalD1MemoryRepository implements MemoryRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async ingest(projectId: string, record: MemoryRecord): Promise<MemoryRecord> {
    const statements: D1PreparedStatement[] = [];
    // External agent/session identifiers are preserved; collisions across projects are rejected.
    if (record.agentId) {
      const result = await this.db.prepare("SELECT project_id FROM agents WHERE id = ?").bind(record.agentId).all<{ project_id: string }>();
      if (result.results[0] && result.results[0].project_id !== projectId) throw new HttpError(409, "AGENT_PROJECT_CONFLICT", "Use a project-specific agentId");
      statements.push(this.db.prepare("INSERT OR IGNORE INTO agents (id, project_id, name) VALUES (?, ?, ?)").bind(record.agentId, projectId, record.agentId));
    }
    if (record.sessionId) {
      const result = await this.db.prepare("SELECT project_id, agent_id FROM sessions WHERE id = ?").bind(record.sessionId).all<{ project_id: string; agent_id: string | null }>();
      const session = result.results[0];
      if (session && (session.project_id !== projectId || (record.agentId && session.agent_id !== record.agentId))) throw new HttpError(409, "SESSION_PROVENANCE_CONFLICT");
      statements.push(this.db.prepare("INSERT OR IGNORE INTO sessions (id, project_id, agent_id, external_id) SELECT ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM agents WHERE id = ? AND project_id = ?)").bind(record.sessionId, projectId, record.agentId ?? null, record.sessionId, record.agentId ?? null, record.agentId ?? null, projectId));
    }
    // A D1 batch is transactional, so an incomplete version cannot be persisted.
    statements.push(this.db.prepare(`INSERT INTO memory_records
      (id, project_id, agent_id, session_id, kind, content_hash, metadata_json)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE (? IS NULL OR EXISTS (SELECT 1 FROM agents WHERE id = ? AND project_id = ?))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM sessions WHERE id = ? AND project_id = ? AND (? IS NULL OR agent_id = ?)))
      ON CONFLICT(project_id, content_hash) DO NOTHING`)
      .bind(record.id, projectId, record.agentId ?? null, record.sessionId ?? null, record.kind, record.contentHash, JSON.stringify(record.metadata), record.agentId ?? null, record.agentId ?? null, projectId, record.sessionId ?? null, record.sessionId ?? null, projectId, record.agentId ?? null, record.agentId ?? null));
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
    const pattern = `%${query.query.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const result = await this.db.prepare(`${selectMemory}
      WHERE r.project_id = ? AND v.content LIKE ? ESCAPE '\\'
      ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`).bind(projectId, pattern, query.limit ?? 20).all<MemoryRow>();
    return result.results.map(decode);
  }

  async listProjects(projectId: string) {
    const result = await this.db.prepare("SELECT id, name, created_at, updated_at FROM projects WHERE id = ?").bind(projectId).all<{ id: string; name: string; created_at: string; updated_at: string }>();
    return result.results;
  }
}

export class DeferredVectorizeMemoryRepository implements MemoryRepository {
  ingest(): Promise<MemoryRecord> { return Promise.reject(new Error("Vectorize/Workers AI retrieval adapter is not implemented")); }
  search(): Promise<MemoryRecord[]> { return Promise.reject(new Error("Vectorize/Workers AI retrieval adapter is not implemented")); }
}
