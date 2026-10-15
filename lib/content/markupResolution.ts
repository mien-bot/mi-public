import { getMarkupIndex } from "./projects";

export interface MarkupResolution {
  total: number;
  open: number;
  addressed: number;
  superseded: number;
  percentResolved: number;
}

/** Structurally identical to getChecklistCompletion, but over markupEntrySchema's status. */
export function getMarkupResolution(slug: string): MarkupResolution {
  const markups = getMarkupIndex(slug);
  const total = markups.length;
  const open = markups.filter((m) => m.status === "open").length;
  const addressed = markups.filter((m) => m.status === "addressed").length;
  const superseded = markups.filter((m) => m.status === "superseded").length;

  return {
    total,
    open,
    addressed,
    superseded,
    percentResolved: total === 0 ? 0 : Math.round((addressed / total) * 100),
  };
}
