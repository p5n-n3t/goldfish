import { contentHash } from "./domain";
import type { D1DatabaseLike } from "./repositories";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}
export interface Principal { keyId: string; projectId: string }
export interface AuthEnv { DB?: D1DatabaseLike; ADMIN_BOOTSTRAP_SECRET?: string }

export async function authenticate(request: Request, env: AuthEnv): Promise<Principal> {
  if (!env.DB) throw new HttpError(503, "D1_NOT_CONFIGURED");
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer gf_live_[A-Za-z0-9_-]{43}$/i.test(authorization) || !authorization.slice(7).startsWith("gf_live_")) {
    throw new HttpError(401, "UNAUTHORIZED", "A valid project API key is required");
  }
  const hash = await contentHash(authorization.slice(7));
  const result = await env.DB.prepare("SELECT id, project_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1")
    .bind(hash).all<{ id: string; project_id: string }>();
  const key = result.results[0];
  if (!key) throw new HttpError(401, "UNAUTHORIZED", "A valid project API key is required");
  return { keyId: key.id, projectId: key.project_id };
}

export function authorize(principal: Principal, projectId: string): void {
  if (principal.projectId !== projectId) throw new HttpError(403, "PROJECT_FORBIDDEN");
}

export async function touchKey(db: D1DatabaseLike, principal: Principal): Promise<void> {
  await db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(principal.keyId).run();
}

export async function requireAdmin(request: Request, env: AuthEnv): Promise<void> {
  if (!env.ADMIN_BOOTSTRAP_SECRET || env.ADMIN_BOOTSTRAP_SECRET.length < 32) throw new HttpError(503, "ADMIN_NOT_CONFIGURED");
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [actual, expected] = await Promise.all([contentHash(supplied), contentHash(env.ADMIN_BOOTSTRAP_SECRET)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference !== 0) throw new HttpError(401, "UNAUTHORIZED");
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new HttpError(400, "HTTPS_REQUIRED");
  if (!env.DB) throw new HttpError(503, "D1_NOT_CONFIGURED");
}

export async function issueKey(db: D1DatabaseLike, projectId: string, label?: string) {
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).all<{ id: string }>();
  if (!project.results.length) throw new HttpError(404, "PROJECT_NOT_FOUND");
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = `gf_live_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
    const id = crypto.randomUUID();
    const keyPrefix = token.slice(0, 16);
    try {
      await db.batch([
        db.prepare("INSERT INTO api_keys (id, project_id, key_prefix, key_hash, label) VALUES (?, ?, ?, ?, ?)").bind(id, projectId, keyPrefix, await contentHash(token), label ?? null),
        db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id) VALUES (?, ?, 'bootstrap-admin', 'api_key.issue', 'api_key', ?)").bind(crypto.randomUUID(), projectId, id)
      ]);
      return { id, projectId, keyPrefix, label: label ?? null, token };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint failed: api_keys.key_hash") || attempt === 2) throw error;
    }
  }
  throw new HttpError(500, "KEY_ISSUANCE_FAILED");
}

export async function revokeKey(db: D1DatabaseLike, projectId: string, keyId: string): Promise<void> {
  const result = await db.prepare("SELECT id FROM api_keys WHERE id = ? AND project_id = ?").bind(keyId, projectId).all<{ id: string }>();
  if (!result.results.length) throw new HttpError(404, "KEY_NOT_FOUND");
  await db.batch([
    db.prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ? AND project_id = ?").bind(keyId, projectId),
    db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id) VALUES (?, ?, 'bootstrap-admin', 'api_key.revoke', 'api_key', ?)").bind(crypto.randomUUID(), projectId, keyId)
  ]);
}
