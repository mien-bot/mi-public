import type { IBuffer, IBufferCellPosition, ILink, ILinkProvider } from "@xterm/xterm";

/** Used for web hover labels; the main process validates every actual open request. */
export function terminalWebLink(text: string): string | null {
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Absolute paths only: a shell may have changed directory since its launch. */
export function terminalFileMatches(text: string): { text: string; index: number }[] {
  const pattern = /file:\/\/[^\s<>"`']+|(?<![\w:/\\])(?:[a-z]:[\\/]|\/(?!\/))[^<>:"|?*\r\n]*?\.(?:pdf|docx?|xlsx?|pptx?|txt|md|csv|tsv|rtf|png|jpe?g|gif|webp|tiff?|bmp|dwg|dxf|json|ya?ml|log|tsx?|jsx?|py|html?|css|zip|exe|cmd|bat|ps1)(?=$|[\s)\]}`'",;!?]|:\d|\.(?:\s|$))/gi;
  return Array.from(text.matchAll(pattern), match => {
    let value = match[0];
    if (/^file:/i.test(value)) {
      value = value.replace(/[.,;!?]+$/, "");
      for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
        while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
      }
    }
    return { text: value, index: match.index };
  });
}

/** Map UTF-16 matches back to terminal cells, including wrapped and wide text. */
export function terminalFileLinkProvider(
  getBuffer: () => IBuffer,
  getCols: () => number,
  handlers: Pick<ILink, "activate" | "hover" | "leave">,
): ILinkProvider {
  return { provideLinks(lineNumber, callback) {
    const buffer = getBuffer();
    const cols = getCols();
    let start = lineNumber - 1;
    let end = start;
    // Bound scans so a giant unbroken output line cannot stall pointer movement.
    while (start > 0 && buffer.getLine(start)?.isWrapped && lineNumber - start < 32) start--;
    while (end + 1 < buffer.length && buffer.getLine(end + 1)?.isWrapped && end - start < 32) end++;
    let text = "";
    const starts: IBufferCellPosition[] = [];
    const ends: IBufferCellPosition[] = [];
    for (let y = start; y <= end; y++) {
      const line = buffer.getLine(y);
      if (!line) break;
      for (let x = 0; x < Math.min(cols, line.length); x++) {
        const cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) continue;
        // xterm leaves a spacer when a wide character wraps at the last column.
        if (x === cols - 1 && !cell.getChars() && y < end && buffer.getLine(y + 1)?.getCell(0)?.getWidth() === 2) continue;
        const chars = cell.getChars() || " ";
        text += chars;
        for (let i = 0; i < chars.length; i++) {
          starts.push({ x: x + 1, y: y + 1 });
          ends.push({ x: x + cell.getWidth(), y: y + 1 });
        }
      }
    }
    callback(terminalFileMatches(text).flatMap(match => {
      const from = starts[match.index];
      const to = ends[match.index + match.text.length - 1];
      if (!from || !to || lineNumber < from.y || lineNumber > to.y) return [];
      return [{ text: match.text, range: { start: from, end: to }, ...handlers }];
    }));
  } };
}
