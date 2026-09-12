declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
  export function writeFileSync(path: string | URL, data: string, options?: unknown): void;
  export function appendFileSync(path: string | URL, data: string, options?: unknown): void;
  export function mkdirSync(path: string | URL, options?: unknown): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string | URL, options?: unknown): void;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "*.mjs" {
  export const canonicalize: any;
  export const classifyText: any;
  export const scopeHash: any;
  export const stageCsv: any;
  export const normalisePendingRecord: any;
  export const reconcileLedgers: any;
}

declare const process: { cwd(): string };
