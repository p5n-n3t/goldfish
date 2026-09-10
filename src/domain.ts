export const MAX_MEMORY_CONTENT_LENGTH = 100_000;

export type MemoryKind = "fact" | "conversation" | "document" | "task";

export interface MemoryInput {
  content: string;
  kind: MemoryKind;
  metadata?: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
}

export interface MemorySearchQuery {
  query: string;
  limit?: number;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  content: string;
  kind: MemoryKind;
  contentHash: string;
  metadata: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  score?: number;
}

export function validateMemoryInput(input: unknown): MemoryInput {
  if (!input || typeof input !== "object") {
    throw new Error("memory input must be an object");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    throw new Error("content is required");
  }
  if (value.content.length > MAX_MEMORY_CONTENT_LENGTH) {
    throw new Error(`content exceeds ${MAX_MEMORY_CONTENT_LENGTH} characters`);
  }
  const kinds: MemoryKind[] = ["fact", "conversation", "document", "task"];
  if (typeof value.kind !== "string" || !kinds.includes(value.kind as MemoryKind)) {
    throw new Error("kind must be one of fact, conversation, document, or task");
  }
  if (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata))) {
    throw new Error("metadata must be an object");
  }
  return {
    content: value.content,
    kind: value.kind as MemoryKind,
    metadata: (value.metadata as Record<string, unknown> | undefined) ?? {},
    agentId: typeof value.agentId === "string" ? value.agentId : undefined,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined
  };
}

export function validateSearchQuery(input: unknown): MemorySearchQuery {
  if (!input || typeof input !== "object") throw new Error("search input must be an object");
  const value = input as Record<string, unknown>;
  if (typeof value.query !== "string" || value.query.trim().length === 0) throw new Error("query is required");
  const limit = value.limit === undefined ? 20 : value.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return { query: value.query.trim(), limit };
}

export async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
