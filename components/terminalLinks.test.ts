import { describe, expect, it } from "vitest";
import { terminalFileLinkProvider, terminalFileMatches, terminalWebLink } from "./terminalLinks";
import type { IBuffer, ILink } from "@xterm/xterm";

describe("terminal web links", () => {
  it("preserves queries, fragments and localhost ports", () => {
    for (const url of ["https://example.com/a?q=b#c", "http://localhost:3000/review"]) {
      expect(terminalWebLink(url)).toBe(url);
    }
  });

  it("rejects executable protocols, relative paths, and disguised credentials", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///C:/test.cmd", "/review", "not a URL", "https://user@example.com/"]) {
      expect(terminalWebLink(url)).toBeNull();
    }
  });
});

describe("terminal file links", () => {
  it("recognizes absolute paths with spaces, file URLs, and Markdown targets", () => {
    const text = 'See [report](E:\\STUDIO\\1.00 PROJECTS\\review notes.pdf), /tmp/review.md and file:///C:/My%20Files/report.pdf';
    expect(terminalFileMatches(text).map(link => link.text)).toEqual([
      'E:\\STUDIO\\1.00 PROJECTS\\review notes.pdf', '/tmp/review.md', 'file:///C:/My%20Files/report.pdf',
    ]);
    expect(terminalFileMatches('https://example.com/report.pdf relative/report.pdf')).toEqual([]);
    expect(terminalFileMatches('C:\\report.pdf.exe')[0].text).toBe('C:\\report.pdf.exe');
    expect(terminalFileMatches('[PDF](file:///C:/report(final).pdf).')[0].text).toBe('file:///C:/report(final).pdf');
    expect(terminalFileMatches('C:\\src\\app.ts:12:3')[0].text).toBe('C:\\src\\app.ts');
  });

  it("maps a wrapped file path after a wide glyph to the correct cells", () => {
    const values = [['中', '', ' ', 'C', ':', '/', 'a', 'b'], ['c', '.', 'p', 'd', 'f', '', '', '']];
    const buffer = { length: 2, getLine: (y: number) => values[y] && ({
      isWrapped: y === 1, length: 8,
      getCell: (x: number) => ({getChars: () => values[y][x], getWidth: () => y === 0 && x === 0 ? 2 : y === 0 && x === 1 ? 0 : 1}),
    }) } as unknown as IBuffer;
    const provider = terminalFileLinkProvider(() => buffer, () => 8, {activate() {}});
    let links: ILink[] | undefined;
    provider.provideLinks(2, result => { links = result; });
    expect(links?.[0].text).toBe('C:/abc.pdf');
    expect(links?.[0].range).toEqual({start:{x:4,y:1},end:{x:5,y:2}});
  });
});
