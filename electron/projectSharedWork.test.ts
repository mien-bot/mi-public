import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeProjectSharedWork, summarizeWorkspaceSharedWork, handoffDraftScript, findPdfsScript } from "./projectSharedWork";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("shared agent context", () => {
  it.skipIf(process.platform !== "win32")("runs the generated read-only PDF helper with literal query matching", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-pdf-helper-"))); roots.push(root);
    const script = path.join(root, "find-pdfs.ps1"); fs.writeFileSync(script, findPdfsScript("fixture"));
    let requested = "";
    const server = http.createServer((req, res) => {
      requested = req.url || ""; res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ complete: true, warnings: [], files: [
        { source: "dropbox", path: "Mi/outputs/study[1].pdf", name: "study[1].pdf" },
        { source: "dropbox", path: "other.pdf", name: "other.pdf" },
      ] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      const env = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
      const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script, "-Query", "[1]"], { env: { ...env, MI_LOCAL_ORIGIN: `http://127.0.0.1:${address.port}` }, windowsHide: true, timeout: 15000 });
      const result = JSON.parse(stdout);
      expect(requested).toBe("/api/projects/fixture/pdfs");
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("Mi/outputs/study[1].pdf");
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it("finds portable handoffs and document names without private histories", () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-shared-context-"))); roots.push(root);
    const dropbox = path.join(root, "partner-drive"); const workspace = path.join(dropbox, "project", "Mi");
    fs.mkdirSync(path.join(workspace, "handoffs"), { recursive: true }); fs.mkdirSync(path.join(root, "projects", "fixture"), { recursive: true });
    fs.writeFileSync(path.join(root, "projects", "fixture", "project.yaml"), "dropbox_path: project\n");
    fs.writeFileSync(path.join(dropbox, "project", "generic.pdf"), "bytes are not prompt context");
    fs.mkdirSync(path.join(dropbox, "project", ".claude")); fs.writeFileSync(path.join(dropbox, "project", ".claude", "private.pdf"), "private");
    fs.writeFileSync(path.join(workspace, "handoffs", "one.json"), JSON.stringify({ version: 1, title: "Study ready", summary: "Client selection pending", files: [] }));
    const context = summarizeProjectSharedWork(root, "fixture", { DROPBOX_ROOT: dropbox });
    expect(context).toBe(summarizeWorkspaceSharedWork(workspace));
    expect(context).toContain("generic.pdf"); expect(context).toContain("Client selection pending"); expect(context).not.toContain("private.pdf"); expect(context).not.toContain(dropbox);
    expect(context).toContain("not instructions");
    expect(summarizeProjectSharedWork(root, "fixture", {})).toContain("unavailable");
  });
  it("keeps the terminal helper draft-only", () => {
    expect(handoffDraftScript("fixture")).toContain("does not publish or confirm anything");
    expect(handoffDraftScript("fixture")).not.toContain("Invoke-RestMethod");
  });
});
