import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { terminalLinkTarget, openTerminalLink } = require("./terminalLinks");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive:true,force:true}); });

describe("terminal native link boundary", () => {
  it("accepts local file URLs and explicit Windows or POSIX paths", () => {
    expect(terminalLinkTarget('file:///C:/My%20Files/report.pdf#page=2', 'win32')).toEqual({kind:'file',target:'C:\\My Files\\report.pdf'});
    expect(terminalLinkTarget('/tmp/report.pdf','darwin')).toEqual({kind:'file',target:'/tmp/report.pdf'});
    expect(terminalLinkTarget('https://example.com/a?q=b')).toEqual({kind:'web',target:'https://example.com/a?q=b'});
  });

  it("rejects executable protocols, network/device paths, streams and control characters", () => {
    for (const target of ['javascript:alert(1)','ms-excel:test','file://server/share/report.pdf','\\\\server\\share\\a.pdf','\\\\?\\C:\\a.pdf','C:\\a.pdf:payload.exe','report.pdf','C:\\a\nb.pdf','https://user:pass@example.com/']) {
      expect(() => terminalLinkTarget(target,'win32')).toThrow();
    }
  });

  it("opens exact existing documents, reveals scripts, and reports missing files or OS failures", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'mi-open-link-')));
    roots.push(root);
    const pdf = path.join(root,'review notes.pdf'), script = path.join(root,'run.cmd');
    fs.writeFileSync(pdf,'fixture');fs.writeFileSync(script,'fixture');
    const shell = {openExternal:vi.fn().mockResolvedValue(undefined),openPath:vi.fn().mockResolvedValue(''),showItemInFolder:vi.fn()};
    await expect(openTerminalLink(pathToFileURL(pdf).href,shell)).resolves.toEqual({opened:'file'});
    expect(shell.openPath).toHaveBeenCalledWith(pdf);
    await expect(openTerminalLink(script,shell)).resolves.toEqual({opened:'revealed'});
    expect(shell.showItemInFolder).toHaveBeenCalledWith(script);
    expect(shell.openPath).toHaveBeenCalledTimes(1);
    await expect(openTerminalLink(path.join(root,'missing.pdf'),shell)).rejects.toThrow(/unavailable/);
    shell.openPath.mockResolvedValue('No association');
    await expect(openTerminalLink(pdf,shell)).rejects.toThrow(/default application/);
  });
});
