// Turns a terminal selection back into prose for pasting into email or chat. Agent CLIs indent
// their replies and break lines at the terminal width themselves, so xterm sees every visual
// line as a real line break. This removes the shared indent and rejoins the lines the CLI
// wrapped, while keeping paragraphs, list items, and short lines (a sign-off) on their own.

// Claude Code marks each message with ● (⏺ on some platforms) in a two-column gutter.
const MESSAGE_MARKER = /^(\s*)[●⏺](\s)/;
// Lines that start their own block, never a continuation of the line above.
const BLOCK_START = /^(?:[-*+•◦▪]\s|\d+[.)]\s|#{1,6}\s|>|[|│├└┌┐┘┤┬┴┼─━╭╮╯╰])/;
// Selections below this width are short enough that a line break was probably intended.
const MIN_WRAP_WIDTH = 40;

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** Terminal columns a string occupies; CJK and emoji take two. */
export function terminalColumns(text: string): number {
  let columns = 0;
  for (const char of text) columns += isWide(char.codePointAt(0)!) ? 2 : 1;
  return columns;
}

function startsWide(text: string) {
  const first = text.codePointAt(0);
  return first !== undefined && isWide(first);
}

function endsWide(text: string) {
  const last = Array.from(text).at(-1);
  return last !== undefined && isWide(last.codePointAt(0)!);
}

/**
 * @param selection Text from xterm's getSelection().
 * @param columns The terminal's current width, used when the text was laid out at that width.
 */
export function plainTerminalText(selection: string, columns?: number): string {
  const newline = selection.includes("\r\n") ? "\r\n" : "\n";
  const lines = selection
    .split(/\r?\n/)
    .map((line) => line.replace(MESSAGE_MARKER, (_, lead: string, space: string) => `${lead} ${space}`).trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  if (!lines.length) return "";

  const filled = lines.filter(Boolean);
  const indent = Math.min(...filled.map((line) => line.length - line.trimStart().length));
  // The CLI wrapped at some width the selection can only hint at: its longest line. When that
  // sits just under the current terminal width, the text was laid out at the current width.
  const widest = Math.max(...filled.map(terminalColumns));
  const width = columns && columns >= widest && columns - widest <= 8 ? columns : widest;
  const unwrap = width >= MIN_WRAP_WIDTH;

  const out: string[] = [];
  let previous: string | null = null;
  for (const line of lines) {
    if (!line) {
      out.push("");
      previous = null;
      continue;
    }
    const text = line.slice(indent);
    const body = text.trimStart();
    let wrapped = false;
    if (unwrap && previous !== null && !BLOCK_START.test(body)) {
      // Wrapped means the next word would not have fit on the line above.
      const cjk = endsWide(previous) && startsWide(body);
      const nextWord = cjk ? Array.from(body)[0] : body.split(/\s/, 1)[0];
      wrapped = terminalColumns(previous) + (cjk ? 0 : 1) + terminalColumns(nextWord) > width;
      if (wrapped) out[out.length - 1] += (cjk ? "" : " ") + body;
    }
    if (!wrapped) out.push(text);
    previous = line;
  }
  return out.join(newline);
}
