/**
 * The descriptive words of a project name, with its job number removed.
 *
 * STUDIO names a project `<year>_<job>_<description>` with inconsistent separators
 * ("26_0805_STUDIO Marketing", "example-record-19", "example-record-25"), so a
 * plain whitespace split treats "26_0805_STUDIO" as one word. Dropping numeric
 * tokens everywhere rather than only at the front is what makes addresses read
 * properly -- "example-record-55" keeps "S Example", not "1002".
 */
function descriptiveWords(name: string): string[] {
  return name.split(/[\s_\-,.()]+/).filter((word) => word && !/^\d+$/.test(word));
}

/**
 * Initials for a multi-word project name. Single-word names get a single letter,
 * not two: "SampleStudio" as "HE" reads like a word rather than a monogram, which is
 * the one thing initials must not do. Those names render as a full wordmark
 * anyway (see projectGlyph) -- this is only their fallback in a tile too small
 * to fit the word.
 */
export function projectInitials(name: string): string {
  const words = descriptiveWords(name);
  if (words.length === 0) {
    // An all-numeric name still needs a tile; use its own digits over a generic mark.
    const digits = name.replace(/\D/g, "");
    return digits ? digits.slice(0, 2) : "MI";
  }
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

/** Longest word the full-size tile can set legibly across its 96px width. */
const WORD_LIMIT = 10;
/** The compact tile is 56px wide, so only short words survive there. */
const COMPACT_WORD_LIMIT = 6;

export interface ProjectGlyph {
  text: string;
  kind: "word" | "initials";
}

/**
 * What to actually draw in the tile.
 *
 * A name that reduces to one word is set as that whole word -- "SampleStudio" tells
 * you more at a glance than any monogram of it could, and there is room for it.
 * Multi-word names stay initials because "STUDIO Marketing" does not fit. Casing is
 * left as authored: a wordmark is not a monogram, and shouting it adds nothing.
 */
export function projectGlyph(name: string, compact = false): ProjectGlyph {
  const words = descriptiveWords(name);
  if (words.length === 1 && words[0].length <= (compact ? COMPACT_WORD_LIMIT : WORD_LIMIT)) {
    return { text: words[0], kind: "word" };
  }
  return { text: projectInitials(name), kind: "initials" };
}

/**
 * Steps the wordmark down as it lengthens so it never overruns the tile. Sized
 * against ~88px of usable width at full size and ~48px compact; `truncate` on the
 * span is the backstop if a display face runs wider than these assume.
 */
function wordSizeClass(length: number, compact: boolean): string {
  if (compact) return length <= 4 ? "text-[11px]" : "text-[9px]";
  if (length <= 5) return "text-base";
  if (length <= 7) return "text-sm";
  return "text-xs";
}

function variantFor(slug: string): number {
  return [...slug].reduce((total, character) => total + character.charCodeAt(0), 0) % 4;
}

const motifs = [
  <><path key="a" d="M8 34 25 8l23 36 16-24 24 36" /><path key="b" d="M4 54h88M22 18v50M66 10v58" /></>,
  <><circle key="a" cx="30" cy="34" r="22" /><path key="b" d="M30 12v44M8 34h44M62 10v48h27" /></>,
  <><path key="a" d="M8 58V16h35v42M43 29h45v29M17 26h17M17 36h17M55 40h23" /><path key="b" d="M4 58h88" /></>,
  <><path key="a" d="m8 52 20-38 20 38 20-30 20 30" /><circle key="b" cx="48" cy="52" r="12" /></>,
];

export function ProjectIdentity({ name, slug, compact = false }: { name: string; slug: string; compact?: boolean }) {
  const glyph = projectGlyph(name, compact);
  // A wordmark needs near-normal tracking to stay readable; a monogram wants the
  // wide letterspacing that made it look deliberate in the first place.
  const typeClass = glyph.kind === "word"
    ? `${wordSizeClass(glyph.text.length, compact)} tracking-[0.02em]`
    : `${compact ? "text-xs" : "text-base"} tracking-[0.18em]`;

  return (
    <span
      className={`project-identity relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-accent/20 bg-accent/10 px-1 text-accent ${compact ? "h-11 w-14" : "h-16 w-24"}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 96 68" fill="none" stroke="currentColor" strokeWidth="1" className="project-identity-lines absolute inset-0 h-full w-full opacity-25">
        {motifs[variantFor(slug)]}
      </svg>
      <span className={`${typeClass} relative max-w-full truncate font-display font-medium`}>{glyph.text}</span>
    </span>
  );
}
