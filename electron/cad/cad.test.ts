import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { normalizeBindings, requestNative, discoverSessions } = require("./nativeClient");
const { createHandler, validateArguments } = require("./mcpServer");
const { createCadService } = require("./service");
const { installNative, ADDIN_ID, installAutocad, AUTOCAD_PRODUCT } = require("./install");
const { createReviewBroker, requestReview } = require("./review");
const session = "a".repeat(32), document = "b".repeat(32), pipe = `mi-revit-${process.pid}-${session}`;
const binding = { session, pipe, document, title: "Fixture model" };
const acadPipe = `mi-autocad-${process.pid}-${session}`;
const acadBinding = { session, pipe: acadPipe, document, title: "Fixture.dwg" };
function fixture(run: (root: string) => unknown) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-cad-test-")));
  return Promise.resolve().then(() => run(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

describe("CAD project isolation and MCP", () => {
  it("requires finite, positive, bounded wall dimensions", () => {
    const wall = { operation: "create_wall", type_id: 1, level_id: 2, start_ft: [0, 0, 0], end_ft: [20, 0, 0], height_ft: 10 };
    expect(validateArguments("revit_preview_edit", wall)).toEqual(wall);
    for (const height_ft of [0, -1, 1001, Infinity, NaN]) expect(() => validateArguments("revit_preview_edit", { ...wall, height_ft })).toThrow();
    expect(() => validateArguments("revit_preview_edit", { ...wall, end_ft: [1, 2] })).toThrow();
    expect(() => validateArguments("revit_preview_edit", { ...wall, start_ft: [0, NaN, 0] })).toThrow();
  });
  it("drops malformed and cross-session bindings", () => {
    expect(normalizeBindings({ "projects/test": binding, "../bad": binding, "projects/wrong": { ...binding, session: "c".repeat(32) } })).toEqual({ "projects/test": binding });
  });
  it("requires initialization, hides unknown methods, and never exposes pairing through MCP", () => fixture(async root => {
    const handle = createHandler({ workspace: "projects/test", bindingsFile: path.join(root, "bindings.json") });
    expect((await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })).error.code).toBe(-32002);
    const init = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "future" } });
    expect(init.result.protocolVersion).toBe("2025-11-25");
    const list = await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["cad_drawing_guide", "cad_propose_lesson", "revit_query", "revit_preview_edit", "revit_apply_edit", "acad_query", "acad_preview_edit", "acad_apply_edit"]);
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "bind" } })).error.code).toBe(-32602);
  }));
  it("routes only the configured project and rereads bindings on each call", () => fixture(async root => {
    const file = path.join(root, "bindings.json");
    fs.writeFileSync(file, JSON.stringify({ "projects/test": binding, "projects/other": { ...binding, document: "c".repeat(32) } }));
    const calls: unknown[][] = [];
    const handle = createHandler({ workspace: "projects/test", bindingsFile: file, call: async (...args: unknown[]) => { calls.push(args); return { title: "Fixture" }; } });
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const query = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "revit_query", arguments: { kind: "status" } } };
    expect((await handle(query)).result.isError).toBeUndefined();
    expect(calls[0]).toEqual([pipe, { method: "query", workspace: "projects/test", document, arguments: { kind: "status" } }]);
    fs.writeFileSync(file, "{}");
    expect((await handle(query)).result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  }));
  it("rejects caller-controlled workspace, code execution, NaN, excessive batches, and forged confirmation", () => {
    for (const [name, args] of [
      ["revit_query", { kind: "status", workspace: "projects/other" }],
      ["revit_query", { kind: "status", limit: 201 }],
      ["revit_preview_edit", { operation: "exec", code: "delete" }],
      ["revit_preview_edit", { operation: "move", offset_ft: [NaN, 0, 0] }],
      ["revit_preview_edit", { operation: "delete", element_ids: Array(51).fill(1) }],
      ["revit_apply_edit", { preview_token: "b".repeat(32), confirm: true }],
    ]) expect(() => validateArguments(name, args)).toThrow();
  });
  it("turns native failures into tool errors without retrying", () => fixture(async root => {
    const file = path.join(root, "bindings.json"); fs.writeFileSync(file, JSON.stringify({ "projects/test": binding }));
    let calls = 0;
    const handle = createHandler({ workspace: "projects/test", bindingsFile: file, call: async () => { calls++; throw new Error("Unknown outcome"); } });
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const response = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "revit_apply_edit", arguments: { preview_token: document } } });
    expect(response.result.isError).toBe(true); expect(calls).toBe(1);
  }));
  it("accepts fragmented native responses and rejects disconnects", async () => {
    class Socket extends EventEmitter { setEncoding() {} write() {} destroy() {} }
    const socket = new Socket();
    const call = requestNative(pipe, { method: "discover" }, { connect: () => socket });
    socket.emit("connect"); socket.emit("data", '{"ok":true,'); socket.emit("data", '"result":{"title":"模型"}}\n');
    expect(await call).toEqual({ title: "模型" });
    const socket2 = new Socket(); const failed = requestNative(pipe, {}, { connect: () => socket2 }); socket2.emit("close");
    await expect(failed).rejects.toThrow("Inspect the model");
  });
  it("filters invalid discovery records", () => fixture(root => {
    fs.writeFileSync(path.join(root, session + ".json"), JSON.stringify({ schema: 1, application: "Revit", pid: process.pid, session, pipe, version: "0.1.0" }));
    fs.writeFileSync(path.join(root, "c".repeat(32) + ".json"), "{}");
    expect(discoverSessions(root)).toHaveLength(1);
  }));
});

describe("AutoCAD adapter", () => {
  it("keeps Revit and AutoCAD bindings from crossing applications", () => {
    expect(normalizeBindings({ "projects/test": acadBinding })).toEqual({});
    expect(normalizeBindings({ "projects/test": binding }, "autocad")).toEqual({});
    expect(normalizeBindings({ "projects/test": acadBinding }, "autocad")).toEqual({ "projects/test": acadBinding });
  });
  it("routes each tool family to its own binding, with both or neither paired", () => fixture(async root => {
    const revit = path.join(root, "bindings.json"), autocad = path.join(root, "autocad-bindings.json");
    fs.writeFileSync(revit, JSON.stringify({ "projects/test": binding })); fs.writeFileSync(autocad, "{}");
    const calls: [string, { method: string; document: string }][] = [];
    const handle = createHandler({ workspace: "projects/test", bindingsFile: revit, autocadBindingsFile: autocad, call: async (p: string, r: { method: string; document: string }) => { calls.push([p, r]); return {}; } });
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const acad = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "acad_query", arguments: { kind: "status" } } };
    const unpaired = await handle(acad);
    expect(unpaired.result.isError).toBe(true); expect(unpaired.result.content[0].text).toContain("drawing"); expect(calls).toHaveLength(0);
    fs.writeFileSync(autocad, JSON.stringify({ "projects/test": acadBinding }));
    await handle(acad);
    await handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "revit_query", arguments: { kind: "status" } } });
    expect(calls.map(([p]) => p)).toEqual([acadPipe, pipe]);
    await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "acad_apply_edit", arguments: { preview_token: document } } });
    expect(calls[2][1].method).toBe("apply");
  }));
  it("accepts bounded typed edits only", () => {
    const polyline = { operation: "create_polyline", layer: "A", points: [[0, 0], [1, 0], [1, 1]], closed: true, elevation: 0 };
    expect(validateArguments("acad_preview_edit", polyline)).toEqual(polyline);
    expect(validateArguments("acad_preview_edit", { operation: "move", handles: ["1A", "2f"], offset: [1, 0, 0] })).toBeTruthy();
    const batch = { operation: "batch", edits: [{ operation: "create_layer", name: "A" }, { operation: "create_circle", layer: "A", center: [0, 0, 0], radius: 2 }] };
    expect(validateArguments("acad_preview_edit", batch)).toEqual(batch);
    expect(validateArguments("acad_preview_edit", { operation: "create_text", layer: "A", position: [0, 0, 0], height: 2, text: "Note", rotation_degrees: 90 })).toBeTruthy();
    expect(validateArguments("acad_preview_edit", { operation: "create_polyline", layer: "A", points: [[0, 0], [1, 0]], bulges: [0.5, 0] })).toBeTruthy();
    expect(validateArguments("acad_preview_edit", { operation: "create_leader", layer: "A", arrow: [0, 0, 0], landing: [5, 5, 0], height: 1, text: "Two\nlines" })).toBeTruthy();
    expect(() => validateArguments("acad_preview_edit", { operation: "batch", edits: [] })).toThrow();
    expect(() => validateArguments("acad_preview_edit", { operation: "batch", edits: ["create_line"] })).toThrow();
    expect(() => validateArguments("acad_preview_edit", { operation: "batch", edits: Array(201).fill({ operation: "erase" }) })).toThrow();
    for (const args of [
      { operation: "command", name: "_.ERASE" }, { operation: "lisp", code: "(command)" }, { operation: "save" },
      { operation: "move", handles: ["../x"], offset: [1, 0, 0] }, { operation: "move", handles: Array(51).fill("A"), offset: [1, 0, 0] },
      { operation: "move", handles: ["A"], offset: [NaN, 0, 0] }, { operation: "move", handles: ["A"], offset: [1, 0] },
      { ...polyline, points: [[0, 0, 0], [1, 0, 0]] }, { ...polyline, points: [[0, 0]] }, { ...polyline, points: [[0, Infinity], [1, 1]] }, { ...polyline, points: Array(501).fill([0, 0]) },
      { operation: "create_layer", name: "A", color_index: 256 }, { operation: "erase", handles: ["A"], workspace: "projects/other" },
    ]) expect(() => validateArguments("acad_preview_edit", args)).toThrow();
    expect(() => validateArguments("acad_apply_edit", { preview_token: document, confirm: true })).toThrow();
    expect(() => validateArguments("acad_query", { kind: "status", document: "b" })).toThrow();
    expect(() => validateArguments("acad_query", { kind: "entities", limit: 201 })).toThrow();
  });
  it("reports AutoCAD timeouts in drawing terms and discovers only AutoCAD sessions", () => fixture(async root => {
    class Socket extends EventEmitter { setEncoding() {} write() {} destroy() {} }
    const socket = new Socket(); const failed = requestNative(acadPipe, {}, { connect: () => socket }); socket.emit("close");
    await expect(failed).rejects.toThrow("Inspect the drawing");
    fs.writeFileSync(path.join(root, session + ".json"), JSON.stringify({ schema: 1, application: "AutoCAD", pid: process.pid, session, pipe: acadPipe, version: "0.1.0" }));
    expect(discoverSessions(root, "autocad")).toHaveLength(1);
    expect(discoverSessions(root, "revit")).toHaveLength(0);
  }));
  it("holds independent bindings per project and lists every open drawing", () => fixture(async root => {
    let settings: Record<string, unknown> = { cadBindings: { "projects/test": binding }, autocadBindings: {}, codexBin: null };
    const other = "c".repeat(32);
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32",
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      discover: (_dir: string, application: string) => application === "autocad" ? [{ session, pipe: acadPipe, pid: process.pid }] : [],
      request: async (_pipe: string, args: { method: string; document: string }) => args.method === "discover" ? { version: "26.0.0.0", documents: [{ id: document, title: "A.dwg" }, { id: other, title: "B.dwg" }] } : { id: args.document, title: "B.dwg" } });
    const before = await service.status("projects/test", "autocad");
    expect(before.sessions[0].documents).toHaveLength(2); expect(before.binding).toBeNull();
    const bound = await service.bind("projects/test", "autocad", session, other);
    expect(bound.binding).toMatchObject({ document: other, pipe: acadPipe });
    expect(settings.cadBindings).toEqual({ "projects/test": binding });
    expect(JSON.parse(fs.readFileSync(path.join(root, "cad/autocad-bindings.json"), "utf8"))["projects/test"].document).toBe(other);
    expect(fs.readFileSync(service.launcher("projects/test"), "utf8")).toContain("--autocad-bindings");
    await service.disconnect("projects/test", "autocad");
    expect(settings.autocadBindings).toEqual({}); expect(settings.cadBindings).toEqual({ "projects/test": binding });
    await expect(service.status("projects/test", "fusion")).rejects.toThrow("Choose Revit or AutoCAD");
  }));
  it("installs a hash-verified bundle and refuses a folder it does not own", () => fixture(root => {
    const payload = path.join(root, "payload"); fs.mkdirSync(payload);
    const files: Record<string, string> = { "Mi.AutoCAD.dll": "fixture dll", "Mi.AutoCAD.deps.json": "{}", "PackageContents.xml": `<ApplicationPackage ProductCode="${AUTOCAD_PRODUCT}"/>` };
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(payload, name), text);
    const entries = Object.entries(files).map(([name, text]) => ({ name, sha256: crypto.createHash("sha256").update(text).digest("hex") }));
    fs.writeFileSync(path.join(payload, "payload.json"), JSON.stringify({ year: "2027", apiVersion: "26.0.0.0", framework: "net10.0-windows", version: "0.1.0", files: entries }));
    const options = { payloadDirectory: payload, appData: path.join(root, "roaming"), checkRunning: false, apiVersion: "26.0.0.0" };
    const plugins = path.join(options.appData, "Autodesk/ApplicationPlugins"), bundle = path.join(plugins, "Mi.AutoCAD.bundle");
    const unrelated = path.join(plugins, "Other.bundle"); fs.mkdirSync(unrelated, { recursive: true }); fs.writeFileSync(path.join(unrelated, "keep"), "original");
    installAutocad(options); installAutocad(options);
    expect(fs.existsSync(path.join(bundle, "PackageContents.xml"))).toBe(true);
    expect(fs.existsSync(path.join(bundle, "Contents/Mi.AutoCAD.dll"))).toBe(true);
    expect(fs.readdirSync(plugins).sort()).toEqual(["Mi.AutoCAD.bundle", "Other.bundle"]);
    expect(() => installAutocad({ ...options, apiVersion: "25.1.0.0" })).toThrow("26.0.0.0");
    fs.writeFileSync(path.join(payload, "Mi.AutoCAD.dll"), "tampered");
    expect(() => installAutocad(options)).toThrow("verification failed");
    installAutocad({ ...options, action: "uninstall" }); expect(fs.existsSync(bundle)).toBe(false);
    expect(fs.readFileSync(path.join(unrelated, "keep"), "utf8")).toBe("original");
    fs.mkdirSync(bundle); fs.writeFileSync(path.join(bundle, "PackageContents.xml"), "user owned");
    expect(() => installAutocad({ ...options, action: "uninstall" })).toThrow("unrelated");
  }));
});

describe("CAD setup and payload installation", () => {
  it("records bindings only after native human pairing, preserving other settings", () => fixture(async root => {
    let settings = { cadBindings: {}, codexBin: null };
    let decline = true;
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32",
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      discover: () => [{ session, pipe, pid: process.pid }], request: async (_pipe: string, args: { method: string }) => {
        if (args.method === "bind" && decline) throw new Error("Declined");
        return args.method === "discover" ? { document: { id: document, title: "Fixture" } } : { id: document, title: "Fixture" };
      } });
    await expect(service.bind("projects/test", "revit", session, document)).rejects.toThrow("Declined");
    expect(settings.cadBindings).toEqual({}); decline = false;
    await service.bind("projects/test", "revit", session, document);
    expect(settings.cadBindings).toHaveProperty("projects/test");
    const launcher = fs.readFileSync(service.launcher("projects/test"), "utf8");
    expect(launcher).toContain("mcp_servers.mi_cad"); expect(launcher).not.toContain("--strict-mcp-config");
    expect(fs.existsSync(path.join(root, ".codex"))).toBe(false);
    expect(() => service.agentCommand("projects/test", "codex")).toThrow("supports Claude");
    expect(service.agentCommand("projects/test", "claude")).toContain("launch-cad-only.ps1");
    const agentScript = fs.readFileSync(path.join(path.dirname(service.launcher("projects/test")), "launch-cad-only.ps1"), "utf8");
    expect(agentScript).toContain("--strict-mcp-config"); expect(agentScript).toContain("--allowedTools 'mcp__mi_cad'"); expect(agentScript).toContain("--append-system-prompt-file");
    expect(fs.readFileSync(path.join(path.dirname(service.launcher("projects/test")), "agent-brief.md"), "utf8")).toContain("Apply edit");
    expect(fs.readFileSync(service.launcher("projects/test"), "utf8")).toContain("default_tools_approval_mode");
    const pidFile = path.join(path.dirname(service.launcher("projects/test")), "agent.pid");
    expect(service.agentRunning("projects/test")).toBe(false);
    fs.writeFileSync(pidFile, String(process.pid)); expect(service.agentRunning("projects/test")).toBe(true);
    fs.writeFileSync(pidFile, "2147483646"); expect(service.agentRunning("projects/test")).toBe(false);
    expect(fs.readFileSync(service.launcher("projects/test"), "utf8")).not.toContain("--strict-mcp-config");
    await service.disconnect("projects/test", "revit"); expect(settings.cadBindings).toEqual({});
    expect(() => service.agentCommand("projects/test", "claude")).toThrow("Connect a Revit model");
  }));
  it("asks for install once, and again only for an incompatible add-in", () => fixture(root => {
    const { addinState, installNative, ADDIN_COMPATIBILITY } = require("./install");
    const payload = path.join(root, "payload"); fs.mkdirSync(payload);
    fs.writeFileSync(path.join(payload, "Mi.Revit.dll"), "fixture dll");
    const sha256 = crypto.createHash("sha256").update("fixture dll").digest("hex");
    fs.writeFileSync(path.join(payload, "payload.json"), JSON.stringify({ year: "2026", apiVersion: "26.5.0.0", framework: "net10.0-windows", version: "0.1.0", files: [{ name: "Mi.Revit.dll", sha256 }] }));
    const appData = path.join(root, "roaming");
    const state = (application: string) => addinState({ application, payloadDirectory: payload, appData });
    expect(state("revit")).toBe("missing"); expect(state("autocad")).toBe("missing");
    const { destination } = installNative({ payloadDirectory: payload, localAppData: path.join(root, "local"), appData, checkRunning: false, apiVersion: "26.5.0.0" });
    expect(state("revit")).toBe("installed");
    fs.writeFileSync(path.join(payload, "Mi.Revit.dll"), "newer dll");
    expect(state("revit")).toBe("optional-update"); // A rebuilt DLL alone is not a reason to reinstall.
    expect(addinState({ application: "revit", payloadDirectory: payload, appData, requiredCompatibility: ADDIN_COMPATIBILITY + 1 })).toBe("outdated");
    fs.rmSync(path.join(destination, "mi-compatibility.json"));
    expect(state("revit")).toBe("optional-update"); // Older installs have no marker to read.
    fs.rmSync(path.join(destination, "Mi.Revit.dll"));
    expect(state("revit")).toBe("missing");
  }));
  it("holds agent lessons for a person's approval before agents receive them", () => fixture(root => {
    const lessons = require("./lessons");
    const file = path.join(root, "lessons.json");
    expect(lessons.guide(file)).toContain("create_leader");
    const { pending } = lessons.propose(file, "Keep   leaders\nfrom crossing.");
    expect(pending[0].text).toBe("Keep leaders from crossing.");
    expect(lessons.guide(file)).not.toContain("Keep leaders from crossing.");
    expect(lessons.propose(file, "Keep leaders from crossing.").pending).toHaveLength(1);
    lessons.review(file, pending[0].id, true);
    expect(lessons.guide(file)).toContain("Keep leaders from crossing.");
    lessons.remove(file, lessons.read(file).accepted[0].id);
    expect(lessons.guide(file)).not.toContain("Keep leaders from crossing.");
    expect(() => lessons.propose(file, "x".repeat(501))).toThrow();
    expect(() => lessons.review(file, "missing", true)).toThrow();
  }));
  it("gives the guide without a binding and never lets an agent accept a lesson", () => fixture(async root => {
    const lessonsFile = path.join(root, "lessons.json");
    const handle = createHandler({ workspace: "projects/test", lessonsFile, call: async () => { throw new Error("unexpected"); } });
    await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const call = (name: string, args: object) => handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
    expect((await call("cad_drawing_guide", {})).result.content[0].text).toContain("Mi CAD drawing guide");
    await call("cad_propose_lesson", { lesson: "A proposal." });
    expect((await call("cad_drawing_guide", {})).result.content[0].text).not.toContain("A proposal.");
    expect(() => validateArguments("cad_propose_lesson", { lesson: "x", accepted: true })).toThrow();
  }));
  it("hash verifies payloads and preserves unrelated add-ins", () => fixture(root => {
    const payload = path.join(root, "payload"); fs.mkdirSync(payload);
    fs.writeFileSync(path.join(payload, "Mi.Revit.dll"), "fixture dll");
    const sha256 = crypto.createHash("sha256").update("fixture dll").digest("hex");
    fs.writeFileSync(path.join(payload, "payload.json"), JSON.stringify({ year: "2026", apiVersion: "26.5.0.0", framework: "net10.0-windows", version: "0.1.0", files: [{ name: "Mi.Revit.dll", sha256 }] }));
    const options = { payloadDirectory: payload, localAppData: path.join(root, "local"), appData: path.join(root, "roaming"), checkRunning: false, apiVersion: "26.5.0.0" };
    const manifest = path.join(options.appData, "Autodesk/Revit/Addins/2026/Mi.Native.addin");
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    const unrelated = path.join(path.dirname(manifest), "Other.addin"); fs.writeFileSync(unrelated, "original");
    installNative(options); expect(fs.readFileSync(manifest, "utf8")).toContain(ADDIN_ID);
    installNative(options); expect(fs.readFileSync(unrelated, "utf8")).toBe("original");
    fs.writeFileSync(path.join(payload, "Mi.Revit.dll"), "tampered");
    expect(() => installNative(options)).toThrow("verification failed");
    installNative({ ...options, action: "uninstall" }); expect(fs.existsSync(manifest)).toBe(false);
    fs.writeFileSync(manifest, "user owned"); expect(() => installNative({ ...options, action: "uninstall" })).toThrow("unrelated");
  }));
});

describe("Reviewing CAD edits in Mi", () => {
  const token = "d".repeat(32);
  const request = { workspace: "projects/test", application: "autocad", token };
  function broker(overrides: object = {}) {
    const shown: { id: string; summary: string }[] = [], closed: string[] = [], applied: string[] = [];
    const instance = createReviewBroker({ describe: async () => ({ title: "A.dwg", summary: "Create a line" }), apply: async (_w: string, _a: string, t: string) => { applied.push(t); return { outcome: "committed" }; },
      notify: (review: { id: string; summary: string }) => shown.push(review), close: (id: string) => closed.push(id), shownMs: 20, reviewMs: 200, ...overrides });
    return { instance, shown, closed, applied };
  }
  const settled = () => new Promise(resolve => setTimeout(resolve, 0));

  it("applies only after a person approves, showing the add-in's summary", async () => {
    const { instance, shown, closed, applied } = broker();
    const outcome = instance.request(request);
    await settled();
    expect(shown[0].summary).toBe("Create a line"); expect(applied).toEqual([]);
    instance.shown(shown[0].id);
    expect(instance.answer(shown[0].id, true)).toBe(true);
    expect(await outcome).toEqual({ handled: true, response: { outcome: "committed" } });
    expect(applied).toEqual([token]); expect(closed).toEqual([shown[0].id]);
    expect(instance.answer(shown[0].id, true)).toBe(false);
  });
  it("declines, times out, or cancels without applying", async () => {
    const first = broker();
    const declined = first.instance.request(request);
    await settled(); first.instance.shown(first.shown[0].id); first.instance.answer(first.shown[0].id, false);
    expect((await declined).response).toMatchObject({ outcome: "declined", changed: false });
    const second = broker({ reviewMs: 40 });
    const timedOut = second.instance.request(request);
    await settled(); second.instance.shown(second.shown[0].id);
    expect((await timedOut).response.reason).toContain("timed out");
    const third = broker();
    let cancel = () => {};
    const cancelled = third.instance.request(request, (run: () => void) => { cancel = run; });
    await settled(); third.instance.shown(third.shown[0].id); cancel();
    expect((await cancelled).response.outcome).toBe("declined");
    expect([...first.applied, ...second.applied, ...third.applied]).toEqual([]);
  });
  it("leaves the decision to the application's dialog when no person can see the review", async () => {
    const unseen = broker();
    expect(await unseen.instance.request(request)).toEqual({ handled: false });
    expect(unseen.applied).toEqual([]); expect(unseen.closed).toHaveLength(1);
    const unknown = broker({ describe: async () => null });
    expect(await unknown.instance.request(request)).toEqual({ handled: false });
    const old = broker({ describe: async () => { throw new Error("Unknown native operation."); } });
    expect(await old.instance.request(request)).toEqual({ handled: false });
    for (const bad of [{ ...request, token: "x" }, { ...request, workspace: "../x" }, { ...request, application: "fusion" }]) expect(await broker().instance.request(bad)).toEqual({ handled: false });
  });
  it("reports a failed apply as handled, so it can never run a second time", async () => {
    const { instance, shown } = broker({ apply: async () => { throw new Error("Outcome unknown"); } });
    const outcome = instance.request(request);
    await settled(); instance.shown(shown[0].id); instance.answer(shown[0].id, true);
    expect(await outcome).toEqual({ handled: true, error: "Outcome unknown" });
  });
  it("calls the application only when Mi did not handle the review", () => fixture(async root => {
    const file = path.join(root, "autocad.json"); fs.writeFileSync(file, JSON.stringify({ "projects/test": acadBinding }));
    let calls = 0, reviewed: unknown = { handled: false };
    const handle = createHandler({ workspace: "projects/test", autocadBindingsFile: file, call: async () => { calls++; return { outcome: "committed" }; }, review: async () => reviewed });
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const apply = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "acad_apply_edit", arguments: { preview_token: token } } };
    await handle(apply); expect(calls).toBe(1);
    reviewed = { handled: true, response: { outcome: "declined", changed: false } };
    expect((await handle(apply)).result.content[0].text).toContain("declined"); expect(calls).toBe(1);
    reviewed = { handled: true, error: "Outcome unknown" };
    expect((await handle(apply)).result.isError).toBe(true); expect(calls).toBe(1);
  }));
  it("never gives an agent the approval secret", () => fixture(async root => {
    let settings: Record<string, unknown> = { cadBindings: {}, autocadBindings: {}, codexBin: null };
    const sent: { method: string; approval?: string }[] = [];
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => false,
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      discover: () => [{ session, pipe: acadPipe, pid: process.pid }],
      request: async (_p: string, args: { method: string; approval?: string }) => { sent.push(args); return args.method === "describe" ? { title: "A.dwg", summary: "Line" } : args.method === "query" ? {} : args.method === "discover" ? { documents: [] } : { id: document, title: "A.dwg" }; } });
    expect(await service.describeReview("projects/test", "autocad", token)).toBeNull();
    const status = await service.bind("projects/test", "autocad", session, document);
    expect(status.reviewsInMi).toBe(true);
    const secret = sent.find(item => item.method === "bind")!.approval!;
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    const launcher = service.launcher("projects/test");
    for (const file of [launcher, path.join(root, "cad/autocad-bindings.json")]) expect(fs.readFileSync(file, "utf8")).not.toContain(secret);
    expect(JSON.stringify(settings)).not.toContain(secret);
    await service.describeReview("projects/test", "autocad", token);
    expect(sent.at(-1)).not.toHaveProperty("approval");
    await service.applyReviewed("projects/test", "autocad", token);
    expect(sent.at(-1)).toMatchObject({ method: "apply", approval: secret });
    await service.disconnect("projects/test", "autocad");
    await expect(service.applyReviewed("projects/test", "autocad", token)).rejects.toThrow("Nothing was applied");
  }));
  it("reports a busy application as connected and a lost one as needing to reconnect", () => fixture(async root => {
    let failure = "AutoCAD is busy with a command or dialog. Nothing was read or changed; finish it and try again.";
    const settings = { cadBindings: {}, autocadBindings: { "projects/test": acadBinding }, codexBin: null };
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => true,
      configStore: { getSettings: () => settings, updateSettings: () => {} }, validateWorkspace: () => {}, discover: () => [], request: async () => { throw new Error(failure); } });
    expect((await service.status("projects/test", "autocad")).health).toBe("Connected");
    failure = "Native AutoCAD connection is unavailable.";
    expect((await service.status("projects/test", "autocad")).health).toContain("Reconnect required");
  }));
  it("treats a closed Mi as unhandled but a dropped review as uncertain", () => fixture(async root => {
    class Socket extends EventEmitter { setEncoding() {} write() {} destroy() {} }
    const file = path.join(root, "review.json");
    expect(await requestReview(file, request)).toEqual({ handled: false });
    fs.writeFileSync(file, JSON.stringify({ pipe: `mi-cad-review-${"a".repeat(32)}` }));
    const absent = new Socket(); const refused = requestReview(file, request, { connect: () => absent }); absent.emit("error", new Error("ENOENT"));
    expect(await refused).toEqual({ handled: false });
    const taken = new Socket(); const dropped = requestReview(file, request, { connect: () => taken }); taken.emit("connect"); taken.emit("close");
    await expect(dropped).rejects.toThrow("Inspect");
  }));
});
