import { authorize, HttpError, type Principal } from "./auth";
import { validateSearchQuery } from "./domain";
import { LexicalD1MemoryRepository, type D1DatabaseLike } from "./repositories";

type GraphQLRequest = { query?: unknown; variables?: unknown };
type GraphQLResult = { data?: Record<string, unknown>; errors?: Array<{ message: string; extensions?: { code: string } }> };
const gqlError = (message: string, code: string): GraphQLResult => ({ errors: [{ message, extensions: { code } }] });
const scalar = (value: unknown): string | number | boolean | null | undefined => value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
function argument(args: string, name: string, variables: Record<string, unknown>): unknown {
  const match = args.match(new RegExp(`\\b${name}\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?|\\$[A-Za-z_][A-Za-z0-9_]*)`));
  if (!match) return undefined;
  if (match[1].startsWith("$")) return variables[match[1].slice(1)];
  try { return JSON.parse(match[1]); } catch { return undefined; }
}
function fields(source: string, name: string): string[] {
  return source.match(new RegExp(`\\b${name}\\s*(?:\\([^)]*\\))?\\s*\\{([^{}]*)\\}`))?.[1].match(/\b[_A-Za-z][_0-9A-Za-z]*/g) ?? [];
}
function requested(source: string, name: string): boolean { return new RegExp(`\\b${name}\\s*(?:\\([^)]*\\))?\\s*(?:\\{|$)`).test(source); }
const projectShape = (p: Record<string, unknown>, selected: string[]) => {
  const all = { id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at };
  return selected.length ? Object.fromEntries(selected.filter(k => k in all).map(k => [k, all[k as keyof typeof all]])) : all;
};
const memoryShape = (m: Record<string, unknown>, selected: string[]) => selected.length ? Object.fromEntries(selected.filter(k => k in m).map(k => [k, m[k]])) : m;

export async function executeGraphQL(db: D1DatabaseLike, principal: Principal, body: GraphQLRequest): Promise<GraphQLResult> {
  if (typeof body.query !== "string" || !body.query.trim()) return gqlError("A GraphQL query is required", "INVALID_QUERY");
  const query = body.query.trim();
  if (/^mutation\b/i.test(query)) return gqlError("Goldfish GraphQL is read-only", "READ_ONLY");
  if (!/^(?:query\b|\{)/i.test(query)) return gqlError("Only GraphQL query operations are supported", "INVALID_OPERATION");
  const variables = body.variables && typeof body.variables === "object" && !Array.isArray(body.variables) ? body.variables as Record<string, unknown> : {};
  const repository = new LexicalD1MemoryRepository(db); const data: Record<string, unknown> = {};
  if (requested(query, "project")) {
    const projectArgs = query.match(/\bproject\s*\(([^)]*)\)/)?.[1] ?? "";
    const requestedProject = scalar(argument(projectArgs, "id", variables));
    if (requestedProject !== undefined && requestedProject !== principal.projectId) return gqlError("The API key cannot access another project", "PROJECT_FORBIDDEN");
    const project = (await repository.listProjects(principal.projectId))[0];
    if (!project) return gqlError("The authorized project does not exist", "PROJECT_NOT_FOUND");
    data.project = projectShape(project as unknown as Record<string, unknown>, fields(query, "project"));
  }
  if (requested(query, "memory")) {
    const args = query.match(/\bmemory\s*\(([^)]*)\)/)?.[1] ?? ""; const id = scalar(argument(args, "id", variables));
    if (typeof id !== "string" || !id) return gqlError("memory requires an id argument", "INVALID_ARGUMENT");
    const memory = await repository.get(principal.projectId, id);
    data.memory = memory ? memoryShape(memory as unknown as Record<string, unknown>, fields(query, "memory")) : null;
  }
  if (requested(query, "search")) {
    const args = query.match(/\bsearch\s*\(([^)]*)\)/)?.[1] ?? ""; const queryValue = scalar(argument(args, "query", variables)); const limit = scalar(argument(args, "limit", variables));
    if (typeof queryValue !== "string") return gqlError("search requires a query argument", "INVALID_ARGUMENT");
    let input; try { input = validateSearchQuery({ query: queryValue, limit }); } catch (cause) { return gqlError(cause instanceof Error ? cause.message : "Invalid search arguments", "INVALID_ARGUMENT"); }
    data.search = (await repository.search(principal.projectId, input)).map(m => memoryShape(m as unknown as Record<string, unknown>, fields(query, "search")));
  }
  if (requested(query, "dashboard")) {
    const count = async (table: "memory_records" | "agents" | "imports") => (await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE project_id = ?`).bind(principal.projectId).all<{ total: number }>()).results[0]?.total ?? 0;
    const [memoryRecords, agents, imports] = await Promise.all([count("memory_records"), count("agents"), count("imports")]);
    const all = { memoryRecords, projects: (await repository.listProjects(principal.projectId)).length, agents, imports }; const selected = fields(query, "dashboard");
    data.dashboard = selected.length ? Object.fromEntries(selected.filter(k => k in all).map(k => [k, all[k as keyof typeof all]])) : all;
  }
  return Object.keys(data).length ? { data } : gqlError("The query must select project, memory, search, or dashboard", "INVALID_QUERY");
}

export async function handleGraphQL(request: Request, db: D1DatabaseLike, principal: Principal): Promise<Response> {
  try { const result = await executeGraphQL(db, principal, await request.json() as GraphQLRequest); return Response.json(result, { status: result.errors ? 400 : 200, headers: { "cache-control": "no-store" } }); }
  catch (cause) { if (cause instanceof SyntaxError) return Response.json(gqlError("Request body must be valid JSON", "INVALID_JSON"), { status: 400 }); if (cause instanceof HttpError) return Response.json(gqlError(cause.message, cause.code), { status: cause.status }); return Response.json(gqlError("The GraphQL operation could not be completed", "INTERNAL_ERROR"), { status: 500 }); }
}
