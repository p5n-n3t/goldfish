import type { MemoryRecord, MemorySearchQuery } from "./domain";

export interface MemoryRepository {
  ingest(projectId: string, record: MemoryRecord): Promise<MemoryRecord>;
  search(projectId: string, query: MemorySearchQuery): Promise<MemoryRecord[]>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}

export class LexicalD1MemoryRepository implements MemoryRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async ingest(projectId: string, record: MemoryRecord): Promise<MemoryRecord> {
    await this.db.prepare(
      `INSERT INTO memory_records
       (id, project_id, agent_id, session_id, kind, content_hash, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(record.id, projectId, record.agentId ?? null, record.sessionId ?? null, record.kind, record.contentHash, JSON.stringify(record.metadata)).run();
    await this.db.prepare(
      `INSERT INTO memory_versions
       (id, memory_record_id, version, content, content_hash)
       VALUES (?, ?, 1, ?, ?)`
    ).bind(`${record.id}:1`, record.id, record.content, record.contentHash).run();
    return record;
  }

  async search(projectId: string, query: MemorySearchQuery): Promise<MemoryRecord[]> {
    const pattern = `%${query.query.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const result = await this.db.prepare(
      `SELECT r.id, r.project_id, r.agent_id, r.session_id, v.content, r.kind, r.content_hash, r.metadata_json
       FROM memory_records r
       JOIN memory_versions v ON v.memory_record_id = r.id AND v.version = r.current_version
       WHERE r.project_id = ? AND v.content LIKE ? ESCAPE '\\'
       ORDER BY r.updated_at DESC
       LIMIT ?`
    ).bind(projectId, pattern, query.limit ?? 20).all<{
      id: string; project_id: string; agent_id: string | null; session_id: string | null; content: string; kind: MemoryRecord["kind"];
      content_hash: string; metadata_json: string;
    }>();
    return result.results.map((row) => ({
      id: row.id, projectId: row.project_id, content: row.content, kind: row.kind,
      contentHash: row.content_hash, metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      agentId: row.agent_id ?? undefined, sessionId: row.session_id ?? undefined
    }));
  }
}

export class DeferredVectorizeMemoryRepository implements MemoryRepository {
  ingest(): Promise<MemoryRecord> {
    return Promise.reject(new Error("Vectorize/Workers AI retrieval adapter is not implemented"));
  }
  search(): Promise<MemoryRecord[]> {
    return Promise.reject(new Error("Vectorize/Workers AI retrieval adapter is not implemented"));
  }
}
