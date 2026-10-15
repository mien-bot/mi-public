/** Street-only names for address-based leads; business/project names stay intact. */
export function leadProjectName(name: string): string {
  const trimmed = name.trim();
  if (!/^\d+[\w/-]*\s+\S/.test(trimmed)) return trimmed;

  // Postal addresses normally separate the street from the locality with a comma
  // or newline. Also accept Chicago addresses entered as a single unpunctuated line.
  return trimmed.split(/[,\r\n]/, 1)[0]
    .replace(/\s+Chicago(?:\s+(?:Illinois|IL))?(?:\s+\d{5}(?:-\d{4})?)?(?:\s+(?:USA|United States))?$/i, "")
    .replace(/\s+\d{5}(?:-\d{4})?$/, "")
    .trim();
}
