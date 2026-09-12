import { contentHash } from "./domain";
import type { D1DatabaseLike } from "./repositories";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}
export type ApiKeyScope = "project" | "workspace";
export interface Principal { keyId: string; projectId: string; accessScope: ApiKeyScope }
export interface AuthEnv { DB?: D1DatabaseLike; ADMIN_BOOTSTRAP_SECRET?: string; DASHBOARD_PASSWORD?: string }
export interface DashboardPrincipal { actorId: "dashboard-admin" }

const cookieName = "goldfish_admin";
const textEncoder = new TextEncoder();
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const fromBase64url = (value: string): Uint8Array | null => {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch { return null; }
};
async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value))));
}
function equal(left: string, right: string): boolean {
  const width = Math.max(left.length, right.length); let difference = left.length ^ right.length;
  for (let index = 0; index < width; index++) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}
function dashboardSecret(env: AuthEnv): string {
  if (!env.DASHBOARD_PASSWORD || env.DASHBOARD_PASSWORD.length < 16) throw new HttpError(503, "DASHBOARD_NOT_CONFIGURED");
  return env.DASHBOARD_PASSWORD;
}
export async function createDashboardSession(env: AuthEnv): Promise<string> {
  const payload = base64url(textEncoder.encode(JSON.stringify({ role: "admin", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12, nonce: crypto.randomUUID() })));
  return `${payload}.${await hmac(payload, dashboardSecret(env))}`;
}
export async function verifyDashboardPassword(password: unknown, env: AuthEnv): Promise<void> {
  if (typeof password !== "string" || !equal(await contentHash(password), await contentHash(dashboardSecret(env)))) throw new HttpError(401, "INVALID_DASHBOARD_PASSWORD");
}
export async function requireDashboard(request: Request, env: AuthEnv): Promise<DashboardPrincipal> {
  const raw = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!raw) throw new HttpError(401, "DASHBOARD_AUTH_REQUIRED");
  const [payload, signature, ...extra] = raw.split(".");
  if (!payload || !signature || extra.length || !equal(signature, await hmac(payload, dashboardSecret(env)))) throw new HttpError(401, "DASHBOARD_AUTH_REQUIRED");
  const decoded = fromBase64url(payload);
  if (!decoded) throw new HttpError(401, "DASHBOARD_AUTH_REQUIRED");
  try {
    const session = JSON.parse(new TextDecoder().decode(decoded)) as { role?: unknown; exp?: unknown };
    if (session.role !== "admin" || typeof session.exp !== "number" || session.exp <= Math.floor(Date.now() / 1000)) throw new HttpError(401, "DASHBOARD_AUTH_REQUIRED");
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(401, "DASHBOARD_AUTH_REQUIRED"); }
  return { actorId: "dashboard-admin" };
}
export const dashboardCookie = (session: string) => `${cookieName}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
export const clearedDashboardCookie = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  // Non-browser clients do not send Origin; browsers must be same-origin before a cookie-authenticated mutation.
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "CSRF_ORIGIN_FORBIDDEN");
}

export async function authenticate(request: Request, env: AuthEnv): Promise<Principal> {
  if (!env.DB) throw new HttpError(503, "D1_NOT_CONFIGURED");
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer gf_live_[A-Za-z0-9_-]{43}$/i.test(authorization) || !authorization.slice(7).startsWith("gf_live_")) {
    throw new HttpError(401, "UNAUTHORIZED", "A valid project API key is required");
  }
  const hash = await contentHash(authorization.slice(7));
  const result = await env.DB.prepare("SELECT id, project_id, access_scope FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1")
    .bind(hash).all<{ id: string; project_id: string; access_scope: ApiKeyScope }>();
  const key = result.results[0];
  if (!key) throw new HttpError(401, "UNAUTHORIZED", "A valid project API key is required");
  return { keyId: key.id, projectId: key.project_id, accessScope: key.access_scope === "workspace" ? "workspace" : "project" };
}

export function authorize(principal: Principal, projectId: string): void {
  if (principal.accessScope !== "workspace" && principal.projectId !== projectId) throw new HttpError(403, "PROJECT_FORBIDDEN");
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

async function issueScopedKey(db: D1DatabaseLike, projectId: string, label: string | undefined, accessScope: ApiKeyScope) {
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).all<{ id: string }>();
  if (!project.results.length) throw new HttpError(404, "PROJECT_NOT_FOUND");
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = `gf_live_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
      const id = crypto.randomUUID();
      const keyPrefix = token.slice(0, 16);
      try {
      await db.batch([
        db.prepare("INSERT INTO api_keys (id, project_id, key_prefix, key_hash, label, access_scope) VALUES (?, ?, ?, ?, ?, ?)").bind(id, projectId, keyPrefix, await contentHash(token), label ?? null, accessScope),
        db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id, details_json) VALUES (?, ?, 'bootstrap-admin', ?, 'api_key', ?, ?)").bind(crypto.randomUUID(), projectId, accessScope === "workspace" ? "api_key.issue_workspace" : "api_key.issue", id, JSON.stringify({ accessScope }))
      ]);
      return { id, projectId, keyPrefix, label: label ?? null, accessScope, token };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint failed: api_keys.key_hash") || attempt === 2) throw error;
    }
  }
  throw new HttpError(500, "KEY_ISSUANCE_FAILED");
}

/** Project keys remain isolated. Workspace keys are for the user's local agent fleet and require explicit project IDs. */
export async function issueKey(db: D1DatabaseLike, projectId: string, label?: string) {
  return issueScopedKey(db, projectId, label, "project");
}

export async function issueWorkspaceKey(db: D1DatabaseLike, anchorProjectId: string, label?: string) {
  return issueScopedKey(db, anchorProjectId, label, "workspace");
}

export async function revokeKey(db: D1DatabaseLike, projectId: string, keyId: string): Promise<void> {
  const result = await db.prepare("SELECT id FROM api_keys WHERE id = ? AND project_id = ?").bind(keyId, projectId).all<{ id: string }>();
  if (!result.results.length) throw new HttpError(404, "KEY_NOT_FOUND");
  await db.batch([
    db.prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ? AND project_id = ?").bind(keyId, projectId),
    db.prepare("INSERT INTO audit_events (id, project_id, actor_id, action, resource_type, resource_id) VALUES (?, ?, 'bootstrap-admin', 'api_key.revoke', 'api_key', ?)").bind(crypto.randomUUID(), projectId, keyId)
  ]);
}
