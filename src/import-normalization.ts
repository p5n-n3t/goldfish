export interface ImportSource {
  filename: string;
  data: unknown;
}

export interface ImportProvenance {
  sourceFilename: string;
  /** One-based row number in a tabular export; one for object exports. */
  sourceRow: number;
  raw: unknown;
}

export interface NormalizedImportRecord {
  content: string;
  categories: string[];
  lifecycleStatus: string | null;
  occurredAt: string | null;
  provenance: ImportProvenance;
}

export interface ImportNormalizationResult {
  records: NormalizedImportRecord[];
  discardedGreetings: number;
  duplicateRecords: number;
}

type TabularRow = [unknown, unknown, unknown, unknown?, unknown?, unknown?];

const relativeTime = /^\s*(?:\d+\s*(?:s|m|h|d|w|mo|y)(?:\s+ago)?|(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago)\s*$/i;
const definiteGreeting = /^(?:full user request:\s*)?(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))(?:[!,.\s]*)$/i;

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

function contentOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
}

function normalizeCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeCategories(value: unknown): string[] {
  const values = (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]+/) : [])
    .filter((entry): entry is string => typeof entry === "string" && !/^\+\d+$/.test(entry.trim()));
  return [...new Set(values
    .map(normalizeCategory)
    .filter(Boolean))];
}

/** Returns ISO dates only when the export supplied an explicit calendar date. */
export function normalizeOccurredAt(value: unknown): string | null {
  const date = stringOrNull(value);
  if (!date || relativeTime.test(date)) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(date);
  return match ? match[1] : null;
}

function objectRow(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fromTabularRow(row: TabularRow, filename: string, sourceRow: number): NormalizedImportRecord | null {
  const content = contentOrNull(row[2]);
  if (!content) return null;
  return {
    content,
    categories: normalizeCategories(row[3]),
    lifecycleStatus: stringOrNull(row[4]),
    occurredAt: normalizeOccurredAt(row[0]),
    provenance: { sourceFilename: filename, sourceRow, raw: row }
  };
}

function fromObjectRow(row: Record<string, unknown>, filename: string): NormalizedImportRecord | null {
  const content = contentOrNull(row.memory ?? row.analysis);
  if (!content) return null;
  return {
    content,
    categories: normalizeCategories(row.categories),
    lifecycleStatus: stringOrNull(row.lifecycle ?? row.status),
    occurredAt: normalizeOccurredAt(row.timestamp),
    provenance: { sourceFilename: filename, sourceRow: 1, raw: row }
  };
}

function recordsForSource(source: ImportSource): NormalizedImportRecord[] {
  if (Array.isArray(source.data)) {
    // Mem0's CSV-style exports start with a header row.
    return source.data.slice(1).flatMap((value, index) => {
      if (!Array.isArray(value)) return [];
      const record = fromTabularRow(value as TabularRow, source.filename, index + 2);
      return record ? [record] : [];
    });
  }
  const row = objectRow(source.data);
  const record = row ? fromObjectRow(row, source.filename) : null;
  return record ? [record] : [];
}

/**
 * Canonicalizes local Mem0 exports without reading files or writing state.
 * Duplicates are exact content matches so source provenance stays meaningful.
 */
export function normalizeImportSources(sources: readonly ImportSource[]): ImportNormalizationResult {
  const records: NormalizedImportRecord[] = [];
  const seenContent = new Set<string>();
  let discardedGreetings = 0;
  let duplicateRecords = 0;

  for (const source of sources) {
    for (const record of recordsForSource(source)) {
      if (definiteGreeting.test(record.content.trim())) {
        discardedGreetings += 1;
        continue;
      }
      if (seenContent.has(record.content)) {
        duplicateRecords += 1;
        continue;
      }
      seenContent.add(record.content);
      records.push(record);
    }
  }

  return { records, discardedGreetings, duplicateRecords };
}
