import type { MarkupEntry } from "../schema";

/** A CSV row that resolved to a complete, schema-valid MarkupEntry. */
export interface ResolvedMarkupRow {
  kind: "resolved";
  rowNumber: number;
  raw: Record<string, string>;
  entry: MarkupEntry;
  /** Deterministic composite identity — see identity.ts. */
  identity: string;
}

/** A CSV row that could not be safely mapped — never invented, always reported. */
export interface UnresolvedMarkupRow {
  kind: "unresolved";
  rowNumber: number;
  raw: Record<string, string> | null;
  reasons: string[];
}

export type MappedRow = ResolvedMarkupRow | UnresolvedMarkupRow;

export function isResolved(row: MappedRow): row is ResolvedMarkupRow {
  return row.kind === "resolved";
}
