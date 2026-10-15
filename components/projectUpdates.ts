import type { ProjectChange } from "@/lib/content/projectDiscoveryTypes";
export interface SeenProject { version: 1; revisions: Record<string, string> }
export function parseSeenProject(raw: string | null): SeenProject | null {
  try { const data = JSON.parse(raw || "null"); return data?.version === 1 && data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions) && Object.values(data.revisions).every(v => typeof v === "string") ? data : null; } catch { return null; }
}
export function projectUpdates(changes: ProjectChange[], seen: SeenProject | null, complete = false, removedHref = "#"): ProjectChange[] {
  if (!seen) return [];
  const updates = changes.filter(change => seen.revisions[change.id] !== change.revision);
  if (complete) {
    const present = new Set(changes.map(change => change.id));
    for (const [id, revision] of Object.entries(seen.revisions)) {
      if (!present.has(id) && revision !== "removed") updates.push({ id, revision: "removed", label: `No longer present: ${id.replace(/^[^:]+:/, "")}`, kind: "record", href: removedHref });
    }
  }
  return updates;
}
export function markProjectSeen(changes: ProjectChange[], previous: SeenProject | null): SeenProject {
  // Retain absent items: an offline/partial scan must not make old items look newly added.
  return { version: 1, revisions: { ...previous?.revisions, ...Object.fromEntries(changes.map(c => [c.id, c.revision])) } };
}
