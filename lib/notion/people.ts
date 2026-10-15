export interface NotionPersonReference {
  id: string;
  name?: string | null;
}

export function resolveNotionPeopleByName(
  requestedNames: string[],
  availablePeople: NotionPersonReference[],
): string[] {
  const byName = new Map<string, NotionPersonReference[]>();
  const byExactName = new Map<string, NotionPersonReference[]>();
  for (const person of availablePeople) {
    const name = person.name?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), person]);
    byExactName.set(name, [...(byExactName.get(name) ?? []), person]);
  }

  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const requestedName of requestedNames) {
    const trimmed = requestedName.trim();
    // Two STUDIO accounts are named "Example Colleague" and "Example Colleague". Case-insensitively they are
    // one ambiguous name and neither can be chosen; spelled exactly, each is unambiguous.
    const exact = byExactName.get(trimmed) ?? [];
    const matches = exact.length === 1 ? exact : byName.get(trimmed.toLocaleLowerCase()) ?? [];
    if (matches.length !== 1) {
      unresolved.push(requestedName);
      continue;
    }
    ids.push(matches[0].id);
  }

  if (unresolved.length > 0) {
    const available = availablePeople
      .map((person) => person.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ");
    throw new Error(
      `Attendance must match the linked Notion project team exactly. Review: ${unresolved.join(", ")}.` +
      (available ? ` Available team: ${available}.` : " No Notion team members are available."),
    );
  }
  return [...new Set(ids)];
}
