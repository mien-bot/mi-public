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
const { createCadService, cachedReleases } = require("./service");
const { installNative, ADDIN_ID, installAutocad, AUTOCAD_PRODUCT, AUTOCAD_TARGETS, addinState, autocadReleases,
  readAutocadRegistry, readAutocadRegistryAsync, parseRegistryKey } = require("./install");
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
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["cad_drawing_guide", "cad_propose_lesson", "revit_query", "revit_preview_edit", "revit_apply_edit", "acad_query", "acad_preview_edit", "acad_apply_edit", "acad_connect_drawings", "acad_open_drawing", "acad_switch_drawing"]);
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
    expect(normalizeBindings({ "projects/test": acadBinding }, "autocad")).toEqual({ "projects/test": { ...acadBinding, drawings: [acadBinding] } });
    // The connected list keeps only valid AutoCAD entries, never another application's, and always holds the current one.
    const other = { ...acadBinding, document: "c".repeat(32), title: "Other.dwg" };
    const stored = normalizeBindings({ "projects/test": { ...acadBinding, drawings: [other, binding, other, { ...other, pipe: "bad" }] } }, "autocad");
    expect(stored["projects/test"].drawings).toEqual([acadBinding, other]);
    expect(normalizeBindings({ "projects/test": { ...binding, drawings: [other] } })["projects/test"]).toEqual(binding);
  });
  it("reads several connected drawings by name and applies to the drawing a preview came from", () => fixture(async root => {
    const file = path.join(root, "autocad.json"), token = "f".repeat(32);
    const floor = { ...acadBinding, document: "d".repeat(32), title: "X-FloorPlan.dwg" };
    fs.writeFileSync(file, JSON.stringify({ "projects/test": { ...acadBinding, drawings: [acadBinding, floor] } }));
    const calls: { method: string; document: string; arguments: Record<string, unknown> }[] = [];
    const reviews: unknown[] = [];
    const handle = createHandler({ workspace: "projects/test", autocadBindingsFile: file, review: async (request: unknown) => { reviews.push(request); return { handled: false }; },
      call: async (_p: string, r: { method: string; document: string; arguments: Record<string, unknown> }) => { calls.push(r); return r.method === "preview" ? { previewToken: token } : {}; } });
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const tool = (id: number, name: string, args: object) => handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    const listed = JSON.parse((await tool(1, "acad_query", { kind: "drawings" })).result.content[0].text);
    expect(listed).toEqual({ current: "Fixture.dwg", drawings: [{ title: "Fixture.dwg", document, current: true }, { title: "X-FloorPlan.dwg", document: floor.document, current: false }],
      note: "Restart this agent to list drawings open in AutoCAD but not connected." });
    expect(calls).toHaveLength(0);
    await tool(2, "acad_query", { kind: "status" });
    await tool(3, "acad_query", { kind: "status", drawing: "x-floorplan" });
    expect(calls.map(call => call.document)).toEqual([document, floor.document]);
    expect(calls[1].arguments).toEqual({ kind: "status" }); // The add-in never sees Mi's routing argument.
    const missing = await tool(4, "acad_query", { kind: "status", drawing: "A0-10_SitePlan.dwg" });
    expect(missing.result.isError).toBe(true); expect(missing.result.content[0].text).toContain("Connected: Fixture.dwg, X-FloorPlan.dwg");
    await tool(5, "acad_preview_edit", { operation: "erase", handles: ["1A"], drawing: "X-FloorPlan.dwg" });
    // Apply without naming the drawing still reaches the one the preview was made in.
    await tool(6, "acad_apply_edit", { preview_token: token });
    expect(reviews.at(-1)).toEqual({ workspace: "projects/test", application: "autocad", token, document: floor.document });
    expect(calls.at(-1)).toMatchObject({ method: "apply", document: floor.document });
  }));
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
      { operation: "create_layer", name: "A", color_index: 257 }, { operation: "erase", handles: ["A"], workspace: "projects/other" },
      { operation: "create_chart", chart_type: "radar" }, { operation: "create_table", cells: [[1, 2]] }, { operation: "create_table", cells: [Array(21).fill("x")] },
      { operation: "create_table", cells: Array(101).fill(["x"]) }, { operation: "create_chart", values: Array(51).fill(1) }, { operation: "edit_text", find: "x".repeat(2001) },
      { operation: "set_table_cells", cell_updates: Array(501).fill({}) }, { operation: "mirror", keep_original: "yes" },
    ]) expect(() => validateArguments("acad_preview_edit", args)).toThrow();
    // Text, tables, charts, and the other added operations pass the same typed gate; the add-in validates their contents.
    for (const args of [
      { operation: "edit_text", handles: ["1A"], find: "OLD", replace: "" }, { operation: "edit_text", handles: ["1A", "2B"], text: "New\nwording", height: 2.5 },
      { operation: "set_attribute", handles: ["1A"], attributes: { SHEET: "A-101" } },
      { operation: "create_table", layer: "A", position: [0, 0, 0], cells: [["Door", "Width"], ["D1", "36"]], title: "Schedule", header: true, column_widths: [20, 10], row_height: 4, height: 2 },
      { operation: "set_table_cells", handles: ["1A"], cell_updates: [{ row: 1, column: 0, text: "D2" }], cells: [["D3", "30"]] },
      { operation: "create_chart", layer: "A", chart_type: "pie", labels: ["A", "B"], values: [1, 3], position: [0, 0, 0], width: 100, height: 60, title: "Mix", colors: [1, 3] },
      { operation: "create_hatch", layer: "A", points: [[0, 0], [1, 0], [1, 1]], pattern: "AR-CONC", pattern_scale: 0.5, pattern_angle_degrees: 45, color_index: 256 },
      { operation: "create_dimension", layer: "A", start: [0, 0, 0], end: [10, 0, 0], location: [5, 2, 0], rotation_degrees: 0 },
      { operation: "insert_block", layer: "A", name: "TAG", position: [0, 0, 0], factor: 2, rotation_degrees: 90, attributes: { NO: "1" } },
      { operation: "rotate", handles: ["1A"], center: [0, 0, 0], rotation_degrees: 45 }, { operation: "scale", handles: ["1A"], center: [0, 0, 0], factor: 2 },
      { operation: "mirror", handles: ["1A"], start: [0, 0, 0], end: [0, 1, 0], keep_original: false }, { operation: "set_color", handles: ["1A"], color_index: 1 },
    ]) expect(validateArguments("acad_preview_edit", args)).toEqual(args);
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
  it("installs one hash-verified bundle with a component per release and refuses a folder it does not own", () => fixture(root => {
    const payload = path.join(root, "payload");
    const write = (name: string, text: string) => { fs.mkdirSync(path.dirname(path.join(payload, name)), { recursive: true }); fs.writeFileSync(path.join(payload, name), text); return crypto.createHash("sha256").update(text).digest("hex"); };
    const manifest = write("PackageContents.xml", `<ApplicationPackage ProductCode="${AUTOCAD_PRODUCT}"/>`);
    const targets = AUTOCAD_TARGETS.map((target: { year: string; series: string; apiVersion: string; framework: string; files: string[] }) =>
      ({ year: target.year, series: target.series, apiVersion: target.apiVersion, framework: target.framework, files: target.files.map(name => ({ name, sha256: write(`${target.series}/${name}`, `${target.year} ${name}`) })) }));
    fs.writeFileSync(path.join(payload, "payload.json"), JSON.stringify({ schema: 2, version: "0.1.0", manifest: { name: "PackageContents.xml", sha256: manifest }, targets }));
    const options = { payloadDirectory: payload, appData: path.join(root, "roaming"), checkRunning: false, installedApis: { "2024": "24.3.0.0" } };
    const plugins = path.join(options.appData, "Autodesk/ApplicationPlugins"), bundle = path.join(plugins, "Mi.AutoCAD.bundle");
    const unrelated = path.join(plugins, "Other.bundle"); fs.mkdirSync(unrelated, { recursive: true }); fs.writeFileSync(path.join(unrelated, "keep"), "original");
    expect(installAutocad(options).message).toContain("AutoCAD 2024");
    expect(installAutocad({ ...options, installedApis: { "2024": "24.3.0.0", "2027": "26.0.0.0" } }).message).toContain("AutoCAD 2027 and AutoCAD 2024");
    expect(fs.existsSync(path.join(bundle, "PackageContents.xml"))).toBe(true);
    // Every release's component is installed, so a later AutoCAD install needs no Mi step.
    for (const file of ["R26.0/Mi.AutoCAD.dll", "R26.0/Mi.AutoCAD.deps.json", "R26.0/mi-compatibility.json", "R24.3/Mi.AutoCAD.dll", "R24.3/mi-compatibility.json"]) expect(fs.existsSync(path.join(bundle, "Contents", file))).toBe(true);
    expect(fs.readdirSync(plugins).sort()).toEqual(["Mi.AutoCAD.bundle", "Other.bundle"]);
    expect(() => installAutocad({ ...options, installedApis: { "2027": "25.1.0.0" } })).toThrow("Neither was found");
    expect(() => installAutocad({ ...options, installedApis: {} })).toThrow("AutoCAD LT");
    fs.writeFileSync(path.join(payload, "R24.3/Mi.AutoCAD.dll"), "tampered");
    expect(() => installAutocad(options)).toThrow("verification failed");
    expect(fs.readFileSync(path.join(bundle, "Contents/R24.3/Mi.AutoCAD.dll"), "utf8")).toBe("2024 Mi.AutoCAD.dll"); // A failed install keeps the old bundle.
    write("R24.3/Mi.AutoCAD.dll", "2024 Mi.AutoCAD.dll");
    const json = JSON.parse(fs.readFileSync(path.join(payload, "payload.json"), "utf8"));
    fs.writeFileSync(path.join(payload, "payload.json"), JSON.stringify({ ...json, targets: json.targets.slice(0, 1) }));
    expect(() => installAutocad(options)).toThrow("Unsupported native payload");
    fs.writeFileSync(path.join(payload, "payload.json"), JSON.stringify(json));
    installAutocad({ ...options, action: "uninstall" }); expect(fs.existsSync(bundle)).toBe(false);
    expect(fs.readFileSync(path.join(unrelated, "keep"), "utf8")).toBe("original");
    fs.mkdirSync(bundle); fs.writeFileSync(path.join(bundle, "PackageContents.xml"), "user owned");
    expect(() => installAutocad({ ...options, action: "uninstall" })).toThrow("unrelated");
  }));
  it("tracks the bundle per installed release, including the original 2027-only layout", () => fixture(root => {
    const payload = path.join(root, "payload"), appData = path.join(root, "roaming");
    const contents = path.join(appData, "Autodesk/ApplicationPlugins/Mi.AutoCAD.bundle/Contents");
    for (const series of ["R26.0", "R24.3"]) { fs.mkdirSync(path.join(payload, series), { recursive: true }); fs.writeFileSync(path.join(payload, series, "Mi.AutoCAD.dll"), series); }
    const state = (releases?: string[]) => addinState({ application: "autocad", payloadDirectory: payload, appData, releases });
    expect(state(["2027", "2024"])).toBe("missing");
    fs.mkdirSync(contents, { recursive: true }); fs.writeFileSync(path.join(contents, "Mi.AutoCAD.dll"), "old 2027"); // Before 2024 support.
    expect(state(["2027"])).toBe("outdated"); // It lacks the newer edit operations, even where 2027 is the only release.
    expect(state(["2027", "2024"])).toBe("outdated"); // AutoCAD 2024 would load nothing.
    expect(state(["2024"])).toBe("missing");
    for (const series of ["R26.0", "R24.3"]) { fs.mkdirSync(path.join(contents, series), { recursive: true }); fs.writeFileSync(path.join(contents, series, "Mi.AutoCAD.dll"), series); }
    expect(state(["2027", "2024"])).toBe("installed"); expect(state()).toBe("installed");
    fs.writeFileSync(path.join(contents, "R24.3/mi-compatibility.json"), JSON.stringify({ compatibility: 0 }));
    expect(state(["2024"])).toBe("outdated");
  }));
  it("names supported releases and refuses LT, verticals, and other series by name", () => {
    const products = [
      { family: "AutoCAD", series: "R24.1", productName: "AutoCAD Architecture 2022 - English", location: "C:/A22" },
      { family: "AutoCAD", series: "R24.3", productName: "AutoCAD 2024 - English", location: "C:/A24" },
      { family: "AutoCAD", series: "R24.3", productName: "AutoCAD MEP 2024 - English", location: "C:/M24" },
      { family: "AutoCAD", series: "R26.0", productName: "AutoCAD 2027 - Deutsch", location: "C:/A27" },
      { family: "AutoCAD", series: "R25.1", productName: "AutoCAD 2026 - English", location: "C:/A26" },
      { family: "AutoCAD LT", series: "R30", productName: "AutoCAD LT 2024 - English", location: null },
    ];
    expect(autocadReleases({ registry: () => products, exists: () => true })).toEqual({
      supported: ["2027", "2024"], unsupported: ["AutoCAD 2026", "AutoCAD Architecture 2022", "AutoCAD LT 2024", "AutoCAD MEP 2024"] });
    expect(autocadReleases({ registry: () => products, exists: (file: string) => !file.includes("A24") }).supported).toEqual(["2027"]);
  });
  it("walks the registry only to product keys, never recursively", async () => {
    const H = "HKEY_LOCAL_MACHINE\\SOFTWARE\\Autodesk";
    // Shaped like real non-recursive `reg query` output: own values, a blank line, then direct subkeys.
    // A key without values has no header of its own, so its first line is already a subkey.
    const tree: Record<string, string> = {
      "HKLM\\SOFTWARE\\Autodesk\\AutoCAD": `\r\n${H}\\AutoCAD\\R24.3\r\n${H}\\AutoCAD\\R26.0\r\n${H}\\AutoCAD\\Shared\r\n`,
      [`${H}\\AutoCAD\\R24.3`]: `\r\n${H}\\AutoCAD\\R24.3\r\n    CurVer    REG_SZ    ACAD-7101\r\n\r\n${H}\\AutoCAD\\R24.3\\ACAD-7101:409\r\n${H}\\AutoCAD\\R24.3\\InstalledProducts\r\n`,
      [`${H}\\AutoCAD\\R24.3\\ACAD-7101:409`]: `\r\n${H}\\AutoCAD\\R24.3\\ACAD-7101:409\r\n    ProductName    REG_SZ    AutoCAD 2024 - English\r\n    AcadLocation    REG_SZ    C:\\A24\\\r\n\r\n${H}\\AutoCAD\\R24.3\\ACAD-7101:409\\Applications\r\n`,
      [`${H}\\AutoCAD\\R24.3\\InstalledProducts`]: `\r\n${H}\\AutoCAD\\R24.3\\InstalledProducts\r\n    (Default)    REG_SZ    ACAD-7101:409\r\n`,
      [`${H}\\AutoCAD\\R26.0`]: `\r\n${H}\\AutoCAD\\R26.0\\ACAD-A101:409\r\n`,
      [`${H}\\AutoCAD\\R26.0\\ACAD-A101:409`]: `\r\n${H}\\AutoCAD\\R26.0\\ACAD-A101:409\r\n    ProductName    REG_SZ    AutoCAD 2027 - English\r\n    AcadLocation    REG_SZ    C:\\A27\\\r\n`,
    };
    const asked: string[] = [];
    const query = (key: string) => { asked.push(key); return key in tree ? parseRegistryKey(tree[key], key) : null; };
    const expected = [
      { family: "AutoCAD", series: "R24.3", productName: "AutoCAD 2024 - English", location: "C:\\A24\\" },
      { family: "AutoCAD", series: "R26.0", productName: "AutoCAD 2027 - English", location: "C:\\A27\\" },
    ];
    expect(readAutocadRegistry(query)).toEqual(expected);
    // Subkeys below a product key, and keys that are not a release series, are never opened.
    expect(asked.some(key => key.endsWith("\\Applications") || key.endsWith("\\Shared"))).toBe(false);
    const products = await readAutocadRegistryAsync(async (key: string) => query(key));
    expect([...products].sort((a, b) => a.series.localeCompare(b.series))).toEqual(expected);
  });
  it("serves cached releases without waiting, and refreshes stale ones in the background", async () => {
    let clock = 0, reads = 0;
    let release: (value: { supported: string[]; unsupported: string[] }) => void = () => {};
    const read = () => { reads += 1; return new Promise<{ supported: string[]; unsupported: string[] }>(resolve => { release = resolve; }); };
    const releases = cachedReleases(read, 1000, () => clock);
    const first = releases(), concurrent = releases();
    expect(reads).toBe(1);
    release({ supported: ["2024"], unsupported: [] });
    expect(await first).toEqual({ supported: ["2024"], unsupported: [] });
    expect(await concurrent).toEqual({ supported: ["2024"], unsupported: [] });
    clock = 500;
    expect(await releases()).toEqual({ supported: ["2024"], unsupported: [] });
    expect(reads).toBe(1);
    clock = 1500;
    // Stale: the old answer comes back at once while one new read runs.
    expect(await releases()).toEqual({ supported: ["2024"], unsupported: [] });
    expect(reads).toBe(2);
    release({ supported: ["2024", "2027"], unsupported: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await releases()).toEqual({ supported: ["2024", "2027"], unsupported: [] });
  });
  it("carries the AutoCAD release through discovery and bindings for display only", () => fixture(root => {
    const record = { schema: 1, application: "AutoCAD", pid: process.pid, session, pipe: acadPipe, version: "0.1.0", year: "2024", apiVersion: "24.3.0.0", framework: "net48" };
    fs.writeFileSync(path.join(root, session + ".json"), JSON.stringify(record));
    expect(discoverSessions(root, "autocad")).toEqual([{ session, pipe: acadPipe, pid: process.pid, version: "0.1.0", year: "2024", apiVersion: "24.3.0.0" }]);
    fs.writeFileSync(path.join(root, session + ".json"), JSON.stringify({ ...record, year: "20x4", apiVersion: "evil" }));
    expect(discoverSessions(root, "autocad")[0]).toMatchObject({ year: null, apiVersion: null });
    expect(normalizeBindings({ "projects/test": { ...acadBinding, year: "2024" } }, "autocad")["projects/test"].year).toBe("2024");
    expect(normalizeBindings({ "projects/test": { ...acadBinding, year: "<b>" } }, "autocad")["projects/test"]).not.toHaveProperty("year");
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
    expect(() => service.agentCommand("projects/test", "gemini", "2")).toThrow("Claude or Codex");
    expect(() => service.agentCommand("projects/test", "claude", "5")).toThrow("terminal session");
    // Codex has no strict MCP mode: its own servers are listed and switched off for this launch only.
    expect(service.agentCommand("projects/test", "codex", "3")).toContain("launch-cad-only-3.ps1");
    const codexScript = fs.readFileSync(path.join(path.dirname(service.launcher("projects/test")), "launch-cad-only-3.ps1"), "utf8");
    expect(codexScript).toContain("agent-3.pid"); expect(codexScript).toContain("mcp list --json --disable plugins --disable apps");
    expect(codexScript).toContain("mcp_servers.$name.enabled=false"); expect(codexScript).toContain("'--disable', 'plugins', '--disable', 'apps'");
    // PowerShell doubles each apostrophe of the TOML literals, so Codex receives '''…''' strings.
    expect(codexScript).toContain("''''''--slot'''''',''''''3''''''"); expect(codexScript).toContain("'developer_instructions=''''''You are working in the person''s open CAD file");
    expect(codexScript).toContain("exit 1"); expect(codexScript).not.toContain("claude");
    expect(fs.existsSync(path.join(root, ".codex"))).toBe(false);
    expect(service.agentCommand("projects/test", "claude", "2")).toContain("launch-cad-only-2.ps1");
    const agentScript = fs.readFileSync(path.join(path.dirname(service.launcher("projects/test")), "launch-cad-only-2.ps1"), "utf8");
    expect(agentScript).toContain("claude-mcp-2.json"); expect(agentScript).toContain("agent-2.pid");
    expect(JSON.parse(fs.readFileSync(path.join(path.dirname(service.launcher("projects/test")), "claude-mcp-2.json"), "utf8")).mcpServers.mi_cad.args.slice(-2)).toEqual(["--slot", "2"]);
    expect(agentScript).toContain("--strict-mcp-config"); expect(agentScript).toContain("--allowedTools 'mcp__mi_cad'"); expect(agentScript).toContain("--append-system-prompt-file");
    expect(fs.readFileSync(path.join(path.dirname(service.launcher("projects/test")), "agent-brief.md"), "utf8")).toContain("Apply edit");
    expect(fs.readFileSync(service.launcher("projects/test"), "utf8")).toContain("default_tools_approval_mode");
    const pidFile = path.join(path.dirname(service.launcher("projects/test")), "agent-2.pid");
    expect(service.agentRunning("projects/test", "2")).toBe(false);
    fs.writeFileSync(pidFile, String(process.pid)); expect(service.agentRunning("projects/test", "2")).toBe(true);
    expect(service.agentRunning("projects/test", "3")).toBe(false); // Each window keeps its own agent record.
    fs.writeFileSync(pidFile, "2147483646"); expect(service.agentRunning("projects/test", "2")).toBe(false);
    expect(fs.readFileSync(service.launcher("projects/test"), "utf8")).not.toContain("--strict-mcp-config");
    await service.disconnect("projects/test", "revit"); expect(settings.cadBindings).toEqual({});
    expect(() => service.agentCommand("projects/test", "claude", "2")).toThrow("Connect a Revit model");
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
  it("keeps several drawings connected, switches between them, and disconnects one at a time", () => fixture(async root => {
    const other = "c".repeat(32), otherPipe = `mi-autocad-2-${other}`, floor = "d".repeat(32), site = "e".repeat(32);
    const titles: Record<string, string> = { [document]: "Sheets.dwg", [floor]: "X-FloorPlan.dwg", [site]: "SitePlan.dwg" };
    let settings: Record<string, unknown> = { cadBindings: {}, autocadBindings: {}, codexBin: null };
    let features = ["multi-drawing"];
    const sent: [string, { method: string; document?: string; approval?: string }][] = [];
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => true,
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      discover: () => [{ session, pipe: acadPipe, pid: process.pid }, { session: other, pipe: otherPipe, pid: process.pid }],
      request: async (p: string, args: { method: string; document?: string }) => {
        sent.push([p, args]);
        if (args.method === "bind") return { id: args.document, title: titles[args.document!] };
        if (args.method === "discover") return { features, documents: Object.keys(titles).map(id => ({ id, title: titles[id] })) };
        return {};
      } });
    const stored = () => (settings.autocadBindings as Record<string, { document: string; pipe: string; drawings: { document: string }[] }>)["projects/test"];
    const ids = () => stored().drawings.map(item => item.document);
    await service.bind("projects/test", "autocad", session, document);
    await service.bind("projects/test", "autocad", session, floor);
    expect(stored().document).toBe(floor); expect(ids()).toEqual([floor, document]);
    expect(sent.some(([, args]) => args.method === "unbind")).toBe(false);
    const status = await service.status("projects/test", "autocad");
    expect(status.binding!.drawings!.map(item => item.open)).toEqual([true, true]);
    expect(status.sessions[0].features).toEqual(["multi-drawing"]);
    // Making a connected drawing current needs no dialog in AutoCAD.
    const before = sent.length;
    await service.select("projects/test", "autocad", document);
    expect(stored().document).toBe(document); expect(ids()).toEqual([floor, document]);
    expect(sent.slice(before).some(([, args]) => args.method === "bind")).toBe(false);
    // Each drawing keeps its own Mi review approval.
    const approvalFor = (id: string) => sent.find(([, args]) => args.method === "bind" && args.document === id)![1].approval;
    await service.applyReviewed("projects/test", "autocad", token, floor);
    expect(sent.at(-1)).toMatchObject([acadPipe, { method: "apply", document: floor, approval: approvalFor(floor) }]);
    await expect(service.select("projects/test", "autocad", site)).rejects.toThrow("no longer connected");
    // Disconnecting one drawing leaves the rest; disconnecting the current one promotes the next.
    const left = await service.forget("projects/test", "autocad", document);
    expect(left.revoked).toBe(true); expect(sent.filter(([, args]) => args.method === "unbind")).toEqual([[acadPipe, { method: "unbind", workspace: "projects/test", document }]]);
    expect(stored().document).toBe(floor); expect(ids()).toEqual([floor]);
    await expect(service.applyReviewed("projects/test", "autocad", token, document)).rejects.toThrow("Nothing was applied");
    // A drawing in another release joins the list rather than replacing it.
    await service.bind("projects/test", "autocad", other, site);
    expect(stored().pipe).toBe(otherPipe); expect(ids()).toEqual([site, floor]);
    // Another project that connects a drawing takes it away from this one.
    await service.bind("projects/other", "autocad", session, floor);
    expect(ids()).toEqual([site]);
    // An add-in without multi-drawing support replaces the project's drawing within its session.
    features = [];
    await service.bind("projects/test", "autocad", other, document.replace(/b/g, "f"));
    expect(ids()).toEqual([document.replace(/b/g, "f")]);
    await service.disconnect("projects/test", "autocad");
    expect(stored()).toBeUndefined();
  }));
  it("lets each agent window keep its own drawing while another switches", () => fixture(async root => {
    const floor = "d".repeat(32), site = "e".repeat(32);
    const titles: Record<string, string> = { [document]: "Sheets.dwg", [floor]: "X-FloorPlan.dwg", [site]: "SitePlan.dwg" };
    let settings: Record<string, unknown> = { cadBindings: {}, autocadBindings: {}, codexBin: null };
    const sent: { method: string; document?: string }[] = [];
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => true,
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      discover: () => [{ session, pipe: acadPipe, pid: process.pid }],
      request: async (_p: string, args: { method: string; document?: string }) => {
        sent.push(args);
        if (args.method === "bind") return { id: args.document, title: titles[args.document!] };
        if (args.method === "discover") return { features: ["multi-drawing"], documents: Object.keys(titles).map(id => ({ id, title: titles[id] })) };
        return {};
      } });
    const stored = () => (settings.autocadBindings as Record<string, { document: string; pins?: Record<string, string> }>)["projects/test"];
    await service.bind("projects/test", "autocad", session, document);
    // The first agent window pins the project's current drawing when it starts.
    service.agentCommand("projects/test", "claude", "2");
    expect(service.agentDrawing("projects/test", "2")).toBe(document);
    // Connecting another drawing from setup changes the project's default, not the running window.
    await service.bind("projects/test", "autocad", session, floor);
    expect(stored().document).toBe(floor);
    expect(service.agentDrawing("projects/test", "2")).toBe(document);
    service.agentCommand("projects/test", "claude", "3", floor);
    expect(service.agentDrawing("projects/test", "3")).toBe(floor);
    expect(() => service.agentCommand("projects/test", "claude", "4", "f".repeat(32))).toThrow("no longer connected");
    // Switching inside window 3 moves only window 3, and leaves the project's default where it was.
    const switched = await service.bind("projects/test", "autocad", session, site, "3");
    expect(switched.binding!.document).toBe(site);
    expect(stored().document).toBe(floor); expect(stored().pins).toEqual({ "2": document, "3": site });
    expect((await service.status("projects/test", "autocad", "2")).binding!.document).toBe(document);
    expect((await service.status("projects/test", "autocad")).binding!.document).toBe(floor);
    await service.select("projects/test", "autocad", floor, "2");
    expect(stored().pins).toEqual({ "2": floor, "3": site }); expect(stored().document).toBe(floor);
    // Disconnecting a window's drawing drops its pin, so it falls back to the project's default.
    await service.forget("projects/test", "autocad", site);
    expect(stored().pins).toEqual({ "2": floor });
    expect(service.agentDrawing("projects/test", "3")).toBe(floor);
    // Each window's MCP server reads its own drawing, and a review always names the drawing.
    const file = path.join(root, "cad", "autocad-bindings.json");
    await service.select("projects/test", "autocad", document, "3");
    const reviews: { document?: string }[] = [], calls: { method: string; document: string }[] = [];
    const server = (slot?: string) => createHandler({ workspace: "projects/test", slot, autocadBindingsFile: file, review: async (r: { document?: string }) => { reviews.push(r); return { handled: false }; },
      call: async (_p: string, r: { method: string; document: string }) => { calls.push(r); return {}; } });
    for (const [slot, expected] of [["2", floor], ["3", document], [undefined, floor]] as const) {
      const handle = server(slot);
      await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
      const listed = JSON.parse((await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "acad_query", arguments: { kind: "drawings" } } })).result.content[0].text);
      expect(listed.drawings.find((item: { current: boolean }) => item.current).document).toBe(expected);
      await handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "acad_apply_edit", arguments: { preview_token: token } } });
      expect(reviews.at(-1)).toMatchObject({ document: expected }); expect(calls.at(-1)).toMatchObject({ method: "apply", document: expected });
    }
  }));
  it("asks before connecting drawings an agent names, and switches without asking", async () => {
    const drawings = [{ session, document }];
    const connected: unknown[] = [], selected: unknown[] = [];
    const make = (overrides: object = {}) => broker({
      connect: { describe: async (_w: string, targets: unknown[]) => ({ title: "B.dwg", summary: `${targets.length} drawing` }), apply: async (_w: string, targets: unknown[]) => { connected.push(targets); return [{ drawing: "B.dwg", connected: true }]; } },
      select: async (...args: unknown[]) => { selected.push(args); return { current: "B.dwg", changed: true }; }, ...overrides });
    const approved = make();
    const outcome = approved.instance.request({ kind: "connect", workspace: "projects/test", application: "autocad", drawings, reason: "Read the elevations" });
    await settled();
    expect(approved.shown[0]).toMatchObject({ kind: "connect", title: "B.dwg", summary: "1 drawing" }); expect(connected).toEqual([]);
    approved.instance.shown(approved.shown[0].id); approved.instance.answer(approved.shown[0].id, true);
    expect(await outcome).toEqual({ handled: true, response: { outcome: "answered", drawings: [{ drawing: "B.dwg", connected: true }] } });
    expect(connected).toEqual([drawings]);
    const declined = make();
    const no = declined.instance.request({ kind: "connect", workspace: "projects/test", application: "autocad", drawings });
    await settled(); declined.instance.shown(declined.shown[0].id); declined.instance.answer(declined.shown[0].id, false);
    expect((await no).response).toMatchObject({ outcome: "declined", connected: false });
    expect(connected).toHaveLength(1);
    // Nobody saw it: nothing connects, and the agent is told to ask the person instead.
    expect(await make().instance.request({ kind: "connect", workspace: "projects/test", application: "autocad", drawings })).toEqual({ handled: false });
    const failing = make({ connect: { describe: async () => { throw new Error("That drawing is no longer open in AutoCAD."); }, apply: async () => [] } });
    expect(await failing.instance.request({ kind: "connect", workspace: "projects/test", application: "autocad", drawings })).toEqual({ handled: true, error: "That drawing is no longer open in AutoCAD." });
    for (const bad of [{ drawings: [] }, { drawings: [{ session, document: "x" }] }, { application: "revit" }, { reason: "line\nbreak" }, { reason: "x".repeat(201) }, { drawings: Array(12).fill(drawings[0]) }])
      expect(await make().instance.request({ kind: "connect", workspace: "projects/test", application: "autocad", drawings, ...bad })).toEqual({ handled: false });
    expect(make().shown).toEqual([]);
    // Switching only changes what the window reads by default, so it shows no review.
    const switching = make();
    expect(await switching.instance.request({ kind: "select", workspace: "projects/test", application: "autocad", document, slot: "2" })).toEqual({ handled: true, response: { current: "B.dwg", changed: true } });
    expect(selected).toEqual([["projects/test", document, "2"]]); expect(switching.shown).toEqual([]);
    expect(await make().instance.request({ kind: "select", workspace: "projects/test", application: "autocad", document, slot: "5" })).toEqual({ handled: false });
    expect(await make().instance.request({ kind: "other", workspace: "projects/test", application: "autocad", token })).toEqual({ handled: false });
  });
  it("connects the drawings a person approved, keeping the current one and skipping AutoCAD's dialog only for a trusted project", () => fixture(async root => {
    const other = "c".repeat(32), otherPipe = `mi-autocad-2-${other}`, elevations = "d".repeat(32), details = "e".repeat(32), remote = "f".repeat(32);
    const titles: Record<string, string> = { [document]: "Plan.dwg", [elevations]: "Elevations.dwg", [details]: "Details.dwg", [remote]: "Site.dwg" };
    let settings: Record<string, unknown> = { cadBindings: {}, autocadBindings: {}, codexBin: null };
    const features = ["multi-drawing", "trusted-connect", "views"];
    const sent: [string, { method: string; document?: string; approval?: string; trust?: string }][] = [];
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => true,
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      discover: () => [{ session, pipe: acadPipe, pid: process.pid, year: "2027" }, { session: other, pipe: otherPipe, pid: process.pid }],
      request: async (p: string, args: { method: string; document?: string }) => {
        sent.push([p, args]);
        if (args.method === "bind") return { id: args.document, title: titles[args.document!] };
        if (args.method === "discover") return p === acadPipe
          ? { features, documents: [document, elevations, details].map(id => ({ id, title: titles[id], path: `E:\\Job\\${titles[id]}` })) }
          : { features: ["multi-drawing"], documents: [{ id: remote, title: titles[remote] }] };
        return {};
      } });
    const stored = () => (settings.autocadBindings as Record<string, { document: string; pins?: Record<string, string>; drawings: { document: string }[] }>)["projects/test"];
    await service.bind("projects/test", "autocad", session, document);
    service.agentCommand("projects/test", "claude", "2");
    const secret = sent.find(([, args]) => args.method === "bind")![1].approval;
    const asked = [{ session, document: elevations }, { session, document: details }, { session: other, document: remote }];
    const { title, summary } = await service.describeConnect("projects/test", asked, "Need heights");
    expect(title).toBe("Elevations.dwg, Details.dwg, Site.dwg");
    expect(summary).toContain("AutoCAD 2027 · Elevations.dwg\nE:\\Job\\Elevations.dwg"); expect(summary).toContain("The agent's reason: Need heights");
    // Same AutoCAD and a trusted add-in: no second dialog. Another AutoCAD session has no pairing to vouch for it.
    expect(summary.split("\n\n").filter((part: string) => part.includes("AutoCAD asks you to confirm"))).toHaveLength(1);
    expect(summary).not.toContain(secret);
    const results = await service.attach("projects/test", asked);
    expect(results).toEqual([{ drawing: "Elevations.dwg", connected: true }, { drawing: "Details.dwg", connected: true }, { drawing: "Site.dwg", connected: true }]);
    const binds = sent.filter(([, args]) => args.method === "bind").slice(1);
    expect(binds.map(([, args]) => args.trust)).toEqual([secret, secret, undefined]);
    expect(new Set(binds.map(([, args]) => args.approval)).size).toBe(3);
    // The project's current drawing and the agent window's pin stay where they were.
    expect(stored().document).toBe(document); expect(stored().pins).toEqual({ "2": document });
    expect(stored().drawings.map(item => item.document)).toEqual([document, elevations, details, remote]);
    // Each connected drawing keeps its own approval for edits reviewed in Mi.
    await service.applyReviewed("projects/test", "autocad", token, details);
    expect(sent.at(-1)![1]).toMatchObject({ method: "apply", document: details, approval: binds[1][1].approval });
    await expect(service.describeConnect("projects/test", [{ session, document: elevations }])).rejects.toThrow("already connected");
    await expect(service.describeConnect("projects/test", [{ session, document: "9".repeat(32) }])).rejects.toThrow("no longer open");
    // A drawing another project holds asks in AutoCAD too, since connecting moves it.
    await service.forget("projects/test", "autocad", details);
    await service.bind("projects/other", "autocad", session, "a".repeat(31) + "0").catch(() => {});
    settings = { ...settings, autocadBindings: { ...(settings.autocadBindings as object), "projects/other": { session, pipe: acadPipe, document: details, title: "Details.dwg" } } };
    const moving = await service.describeConnect("projects/test", [{ session, document: details }]);
    expect(moving.summary).toContain("Connected to other now"); expect(moving.summary).toContain("AutoCAD asks you to confirm");
  }));
  it("lists open drawings, asks Mi to connect them by name, switches, and reads views only from an add-in that can", () => fixture(async root => {
    const elevations = "d".repeat(32), sessions = path.join(root, "sessions");
    const file = path.join(root, "autocad.json");
    fs.writeFileSync(file, JSON.stringify({ "projects/test": { ...acadBinding, title: "Plan.dwg", drawings: [{ ...acadBinding, title: "Plan.dwg" }] } }));
    let features = ["multi-drawing", "trusted-connect", "views"];
    const reviews: Record<string, unknown>[] = [], calls: [string, { method: string; document?: string; arguments?: object }][] = [];
    let answer: Record<string, unknown> = { handled: true, response: { outcome: "answered", drawings: [{ drawing: "Elevations.dwg", connected: true }] } };
    const make = (slot?: string, withSessions = true) => createHandler({ workspace: "projects/test", slot, autocadBindingsFile: file, autocadSessions: withSessions ? sessions : undefined,
      discover: () => [{ session, pipe: acadPipe, pid: process.pid, year: "2027" }],
      review: async (r: Record<string, unknown>) => { reviews.push(r); return r.kind === "select" ? { handled: true, response: {} } : answer; },
      call: async (p: string, r: { method: string; document?: string }) => { calls.push([p, r]); return r.method === "discover" ? { features, documents: [{ id: document, title: "Plan.dwg" }, { id: elevations, title: "Elevations.dwg", path: "E:\\Job\\Elevations.dwg", isActive: true }] } : {}; } });
    const tool = async (handle: ReturnType<typeof createHandler>, name: string, args: object) => (await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
    const handle = make("2");
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const listed = JSON.parse((await tool(handle, "acad_query", { kind: "drawings" })).content[0].text);
    expect(listed.notConnected).toEqual([{ title: "Elevations.dwg", document: elevations, session, year: "2027", path: "E:\\Job\\Elevations.dwg", active: true }]);
    const connected = await tool(handle, "acad_connect_drawings", { drawings: ["elevations"], reason: "Heights" });
    expect(connected.isError).toBeUndefined();
    expect(reviews.at(-1)).toEqual({ kind: "connect", workspace: "projects/test", application: "autocad", drawings: [{ session, document: elevations }], reason: "Heights", slot: "2" });
    expect((await tool(handle, "acad_connect_drawings", { drawings: ["Plan"] })).content[0].text).toContain("already connected");
    expect((await tool(handle, "acad_connect_drawings", { drawings: ["Roof.dwg"] })).content[0].text).toContain("not open in AutoCAD");
    answer = { handled: false };
    expect((await tool(handle, "acad_connect_drawings", { drawings: ["Elevations.dwg"] })).content[0].text).toContain("nothing was connected");
    // An agent started before this update cannot list open drawings, and says how to recover.
    const older = make("2", false);
    await older({ jsonrpc: "2.0", id: 0, method: "initialize" });
    expect((await tool(older, "acad_connect_drawings", { drawings: ["Elevations.dwg"] })).content[0].text).toContain("restart this agent");
    // Mi records an agent window's switch; it never reaches the add-in.
    fs.writeFileSync(file, JSON.stringify({ "projects/test": { ...acadBinding, title: "Plan.dwg", drawings: [{ ...acadBinding, title: "Plan.dwg" }, { ...acadBinding, document: elevations, title: "Elevations.dwg" }] } }));
    const before = calls.length;
    expect(JSON.parse((await tool(handle, "acad_switch_drawing", { drawing: "Elevations" })).content[0].text)).toMatchObject({ current: "Elevations.dwg", changed: true });
    expect(reviews.at(-1)).toEqual({ kind: "select", workspace: "projects/test", application: "autocad", document: elevations, slot: "2" });
    expect(calls.slice(before)).toEqual([]);
    // A window Mi did not start keeps its switch to itself.
    const copied = make();
    await copied({ jsonrpc: "2.0", id: 0, method: "initialize" });
    await tool(copied, "acad_switch_drawing", { drawing: "Elevations.dwg" });
    await tool(copied, "acad_query", { kind: "status" });
    expect(calls.at(-1)![1]).toMatchObject({ method: "query", document: elevations });
    // Views and areas need an add-in that reads them; an older one would silently ignore the area.
    expect((await tool(copied, "acad_query", { kind: "views" })).isError).toBeUndefined();
    expect((await tool(copied, "acad_query", { kind: "entities", space: "model", area: [0, 0, 10, 10] })).isError).toBeUndefined();
    expect(calls.at(-1)![1]).toMatchObject({ method: "query", arguments: { kind: "entities", space: "model", area: [0, 0, 10, 10] } });
    features = ["multi-drawing"];
    const old = make();
    await old({ jsonrpc: "2.0", id: 0, method: "initialize" });
    expect((await tool(old, "acad_query", { kind: "views" })).content[0].text).toContain("install the update");
    expect(() => validateArguments("acad_query", { kind: "entities", area: [0, 0, 1] })).toThrow();
    expect(() => validateArguments("acad_connect_drawings", { drawings: ["x".repeat(301)] })).toThrow();
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
  it("reports an AutoCAD that is waiting on a dialog as busy, with its drawings still open", () => fixture(async root => {
    const settings = { cadBindings: {}, autocadBindings: { "projects/test": { ...acadBinding, drawings: [acadBinding, { ...acadBinding, document: "c".repeat(32), title: "B.dwg" }] } }, codexBin: null };
    const timeout = () => Object.assign(new Error("AutoCAD did not respond."), { code: "ETIMEDOUT" });
    let discoverFails = true;
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => true,
      configStore: { getSettings: () => settings, updateSettings: () => {} }, validateWorkspace: () => {}, discover: () => [{ session, pipe: acadPipe, pid: process.pid }],
      request: async (_p: string, args: { method: string }) => { if (args.method === "discover" && !discoverFails) return { documents: [] }; throw timeout(); } });
    const busy = await service.status("projects/test", "autocad");
    expect(busy.health).toBe("Busy"); expect(busy.sessions[0].busy).toBe(true);
    expect(busy.binding!.drawings!.every((item: { open: boolean }) => item.open)).toBe(true);
    // The session answers but the drawing does not: still a live application waiting on something.
    discoverFails = false;
    expect((await service.status("projects/test", "autocad")).health).toBe("Busy");
  }));
  it("asks AutoCAD once per window when several drawings connect, and keeps pins across a reopen", () => fixture(async root => {
    const ids = ["1", "2", "3"].map(digit => digit.repeat(32)), reopened = "4".repeat(32);
    const titles: Record<string, string> = { [ids[0]]: "Plan.dwg", [ids[1]]: "Elevations.dwg", [ids[2]]: "Details.dwg", [reopened]: "Plan.dwg" };
    let settings: Record<string, unknown> = { cadBindings: {}, autocadBindings: {}, codexBin: null };
    let open = [ids[0], ids[1], ids[2]];
    const sent: { method: string; document?: string; approval?: string; trust?: string }[] = [];
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => true,
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      discover: () => [{ session, pipe: acadPipe, pid: process.pid, year: "2024" }],
      request: async (_p: string, args: { method: string; document?: string }) => {
        sent.push(args);
        if (args.method === "bind") return { id: args.document, title: titles[args.document!] };
        if (args.method === "discover") return { features: ["multi-drawing", "trusted-connect", "views"], documents: open.map(id => ({ id, title: titles[id], path: `E:\\Job\\${titles[id]}` })) };
        return {};
      } });
    const stored = () => (settings.autocadBindings as Record<string, { document: string; pins?: Record<string, string>; drawings: { document: string }[] }>)["projects/test"];
    const targets = ids.map(id => ({ session, document: id }));
    const { summary } = await service.describeConnect("projects/test", targets);
    expect(summary.split("\n\n").filter((part: string) => part.includes("AutoCAD asks you to confirm"))).toHaveLength(1);
    expect(await service.attach("projects/test", targets)).toEqual(ids.map(id => ({ drawing: titles[id], connected: true })));
    const binds = sent.filter(item => item.method === "bind");
    // The first drawing creates the project's approval in this AutoCAD; the others use it.
    expect(binds.map(item => item.trust)).toEqual([undefined, binds[0].approval, binds[0].approval]);
    expect(stored().document).toBe(ids[0]);
    service.agentCommand("projects/test", "claude", "2", ids[0]);
    expect(stored().pins).toEqual({ "2": ids[0] });
    // Plan.dwg closes and reopens with a new identity. Reconnecting it keeps window 2 on it, with no dialog.
    open = [reopened, ids[1], ids[2]];
    await service.bind("projects/test", "autocad", session, reopened);
    expect(sent.filter(item => item.method === "bind").at(-1)!.trust).toBe(binds[1].approval);
    expect(stored().pins).toEqual({ "2": reopened });
    expect(stored().drawings.map(item => item.document).sort()).toEqual([reopened, ids[1], ids[2]].sort());
    // The same through attach, which Reconnect all uses.
    const again = "5".repeat(32); titles[again] = "Plan.dwg"; open = [again, ids[1], ids[2]];
    await service.attach("projects/test", [{ session, document: again }]);
    expect(stored().pins).toEqual({ "2": again }); expect(stored().document).toBe(again);
  }));
  it("opens a drawing from the project's folder only, connecting one that is already open", () => fixture(async root => {
    const project = path.join(root, "Job"); fs.mkdirSync(path.join(project, "Drawings"), { recursive: true });
    const sheet = path.join(project, "Drawings", "A-201.dwg"); fs.writeFileSync(sheet, "dwg");
    fs.writeFileSync(path.join(project, "notes.txt"), "x"); fs.writeFileSync(path.join(root, "Outside.dwg"), "dwg");
    let settings: Record<string, unknown> = { cadBindings: {}, autocadBindings: {}, codexBin: null };
    let features = ["multi-drawing", "trusted-connect", "views", "open-drawing"];
    let sessions = [{ session, pipe: acadPipe, pid: process.pid, year: "2027" }];
    let open: { id: string; title: string; path: string }[] = [{ id: document, title: "Plan.dwg", path: path.join(project, "Plan.dwg") }];
    let linked = true;
    const sent: { method: string; path?: string; readOnly?: boolean; approval?: string; trust?: string; document?: string }[] = [];
    const service = createCadService({ userData: root, localAppData: root, appData: root, payloadDirectory: root, autocadPayloadDirectory: root, executable: "Mi.exe", serverScript: "mcp.js", platform: "win32", isInstalled: () => true, isRunning: async () => true,
      configStore: { getSettings: () => settings, updateSettings: (patch: object) => { settings = { ...settings, ...patch }; } }, validateWorkspace: () => {},
      resolveProjectRoot: () => linked ? project : null, discover: () => sessions,
      request: async (_p: string, args: { method: string; document?: string; path?: string }) => {
        sent.push(args);
        if (args.method === "discover") return { features, documents: open };
        if (args.method === "bind") return { id: args.document, title: open.find(item => item.id === args.document)?.title };
        if (args.method === "open") { const opened = { id: "9".repeat(32), title: path.basename(args.path!), path: args.path! }; open = [...open, opened]; return { ...opened, isReadOnly: true }; }
        return {};
      } });
    const stored = () => (settings.autocadBindings as Record<string, { document: string; drawings: { document: string; title: string }[] }>)["projects/test"];
    await service.bind("projects/test", "autocad", session, document);
    const secret = sent.find(item => item.method === "bind")!.approval;
    for (const [requested, message] of [["../Outside.dwg", "inside this project's folder"], [path.join(root, "Outside.dwg"), "inside this project's folder"], ["notes.txt", "Only .dwg"], ["Drawings/Missing.dwg", "was not found"], ["Drawings\nA.dwg", "Name one .dwg"]] as const)
      await expect(service.describeOpen("projects/test", requested, false)).rejects.toThrow(message);
    const { title, summary } = await service.describeOpen("projects/test", "Drawings/A-201.dwg", true, "Need the elevations");
    expect(title).toBe("A-201.dwg"); expect(summary).toContain(`AutoCAD 2027 · ${path.join("Drawings", "A-201.dwg")}`);
    expect(summary).toContain("read-only"); expect(summary).toContain("The agent's reason: Need the elevations"); expect(summary).not.toContain("AutoCAD asks you to confirm");
    expect(await service.openDrawing("projects/test", sheet, true)).toEqual({ opened: true, drawing: "A-201.dwg", connected: true, readOnly: true });
    // Mi sends the canonical path it checked, and this project's approval so AutoCAD does not ask again.
    expect(sent.find(item => item.method === "open")).toMatchObject({ path: fs.realpathSync.native(sheet), readOnly: true, trust: secret });
    expect(stored().document).toBe(document); expect(stored().drawings.map(item => item.title)).toEqual(["Plan.dwg", "A-201.dwg"]);
    // Found live: asking again for a drawing that is open and connected says so, with no review.
    await expect(service.describeOpen("projects/test", "Drawings/A-201.dwg", false)).rejects.toThrow("already connected");
    // Already open but not connected: connect it instead of opening a second copy.
    await service.forget("projects/test", "autocad", "9".repeat(32));
    const opens = sent.filter(item => item.method === "open").length;
    expect((await service.describeOpen("projects/test", "Drawings/A-201.dwg", false)).summary).toContain("Already open");
    expect(await service.openDrawing("projects/test", "Drawings/A-201.dwg", false)).toMatchObject({ opened: false, connected: true });
    expect(sent.filter(item => item.method === "open")).toHaveLength(opens);
    open = open.slice(0, 1);
    // An add-in without the feature, several AutoCAD windows with no preference, and an unlinked project all refuse.
    features = ["multi-drawing", "trusted-connect"];
    await expect(service.describeOpen("projects/test", "Drawings/A-201.dwg", false)).rejects.toThrow("cannot open drawings yet");
    features = [...features, "open-drawing"];
    const other = "c".repeat(32);
    sessions = [...sessions, { session: other, pipe: `mi-autocad-2-${other}`, pid: process.pid, year: "2024" }];
    await expect(service.describeOpen("projects/test", "Drawings/A-201.dwg", false)).resolves.toMatchObject({ title: "A-201.dwg" }); // The window holding this project wins.
    settings = { ...settings, autocadBindings: {} };
    await expect(service.describeOpen("projects/test", "Drawings/A-201.dwg", false)).rejects.toThrow("Several AutoCAD windows");
    linked = false;
    await expect(service.describeOpen("projects/test", "Drawings/A-201.dwg", false)).rejects.toThrow("no confirmed folder");
  }));
  it("asks before opening a drawing an agent names, and labels which session asked", async () => {
    const opened: unknown[] = [];
    const make = () => broker({ open: { describe: async (_w: string, requested: string, readOnly: boolean) => ({ title: "A-201.dwg", summary: `${requested} ${readOnly}` }),
      apply: async (...args: unknown[]) => { opened.push(args); return { opened: true, drawing: "A-201.dwg", connected: true }; } } });
    const approved = make();
    const outcome = approved.instance.request({ kind: "open", workspace: "projects/test", application: "autocad", path: "Drawings/A-201.dwg", readOnly: true, reason: "Elevations", slot: "3" });
    await settled();
    expect(approved.shown[0]).toMatchObject({ kind: "open", title: "A-201.dwg", summary: "Drawings/A-201.dwg true", session: "3" });
    approved.instance.shown(approved.shown[0].id); approved.instance.answer(approved.shown[0].id, true);
    expect(await outcome).toEqual({ handled: true, response: { outcome: "answered", opened: true, drawing: "A-201.dwg", connected: true } });
    expect(opened).toEqual([["projects/test", "Drawings/A-201.dwg", true]]);
    const declined = make();
    const no = declined.instance.request({ kind: "open", workspace: "projects/test", application: "autocad", path: "A.dwg" });
    await settled(); declined.instance.shown(declined.shown[0].id); declined.instance.answer(declined.shown[0].id, false);
    expect((await no).response).toMatchObject({ outcome: "declined", opened: false }); expect(opened).toHaveLength(1);
    expect(await make().instance.request({ kind: "open", workspace: "projects/test", application: "autocad", path: "A.dwg" })).toEqual({ handled: false });
    for (const bad of [{ path: "" }, { path: "a\nb.dwg" }, { path: "x".repeat(1001) }, { readOnly: "yes" }, { application: "revit" }, { reason: "x".repeat(201) }])
      expect(await make().instance.request({ kind: "open", workspace: "projects/test", application: "autocad", path: "A.dwg", ...bad })).toEqual({ handled: false });
    // Edits name the session too; a slot outside 1-4 is simply left off.
    const edit = broker();
    void edit.instance.request({ ...request, slot: "9" }); await settled();
    expect(edit.shown[0]).not.toHaveProperty("session");
  });
  it("resolves the source of a copy or reference by name, in the same AutoCAD only", () => fixture(async root => {
    const file = path.join(root, "autocad.json");
    const other = "c".repeat(32), plan = "d".repeat(32), structure = "e".repeat(32);
    fs.writeFileSync(file, JSON.stringify({ "projects/test": { ...acadBinding, title: "A-101.dwg", drawings: [{ ...acadBinding, title: "A-101.dwg" },
      { ...acadBinding, document: plan, title: "A-201.dwg" }, { session: other, pipe: `mi-autocad-2-${other}`, document: structure, title: "S-101.dwg", year: "2027" }] } }));
    let features = ["multi-drawing", "trusted-connect", "views", "open-drawing", "linked-edits"];
    const calls: { method: string; arguments?: Record<string, unknown> }[] = [];
    const handle = createHandler({ workspace: "projects/test", autocadBindingsFile: file, call: async (_p: string, r: { method: string }) => { calls.push(r); return r.method === "discover" ? { features } : { previewToken: "f".repeat(32) }; } });
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const preview = async (args: object) => (await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "acad_preview_edit", arguments: args } })).result;
    expect((await preview({ operation: "copy_from_drawing", source_drawing: "A-201", source_area: [0, 0, 100, 50], position: [0, 0, 0] })).isError).toBeUndefined();
    // The add-in receives the document id Mi resolved, never the name or anything the agent chose as an id.
    expect(calls.at(-1)).toMatchObject({ method: "preview", arguments: { operation: "copy_from_drawing", source_document: plan, source_area: [0, 0, 100, 50] } });
    expect(calls.at(-1)!.arguments).not.toHaveProperty("source_drawing");
    expect((await preview({ operation: "attach_xref", source_drawing: "S-101.dwg", layer: "XREF" })).content[0].text).toContain("open in different AutoCAD windows");
    expect((await preview({ operation: "attach_xref", layer: "XREF" })).content[0].text).toContain("source_drawing is required");
    expect((await preview({ operation: "copy_from_drawing", source_drawing: "A-101", source_handles: ["1A"] })).content[0].text).toContain("drawing being changed");
    expect((await preview({ operation: "create_line", source_drawing: "A-201", layer: "0", start: [0, 0, 0], end: [1, 0, 0] })).content[0].text).toContain("applies only to");
    expect((await preview({ operation: "copy_from_drawing", source_drawing: "Roof", source_handles: ["1A"] })).content[0].text).toContain("not connected");
    expect(() => validateArguments("acad_preview_edit", { operation: "copy_from_drawing", source_document: plan })).toThrow("Unexpected argument");
    expect(() => validateArguments("acad_preview_edit", { operation: "attach_xref", unit_scale: 0 })).toThrow();
    features = ["multi-drawing"];
    const older = createHandler({ workspace: "projects/test", autocadBindingsFile: file, call: async (_p: string, r: { method: string }) => r.method === "discover" ? { features } : {} });
    await older({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const refused = (await older({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "acad_preview_edit", arguments: { operation: "attach_xref", source_drawing: "A-201", layer: "0" } } })).result;
    expect(refused.content[0].text).toContain("install the update");
  }));
  it("routes acad_open_drawing through Mi's review, naming the agent's session", () => fixture(async root => {
    const file = path.join(root, "autocad.json");
    fs.writeFileSync(file, JSON.stringify({ "projects/test": { ...acadBinding, drawings: [acadBinding] } }));
    const reviews: Record<string, unknown>[] = [];
    let answer: Record<string, unknown> = { handled: true, response: { outcome: "answered", opened: true, drawing: "A-201.dwg", connected: true } };
    const handle = createHandler({ workspace: "projects/test", slot: "4", autocadBindingsFile: file, review: async (r: Record<string, unknown>) => { reviews.push(r); return answer; }, call: async () => ({}) });
    await handle({ jsonrpc: "2.0", id: 0, method: "initialize" });
    const call = async (args: object) => (await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "acad_open_drawing", arguments: args } })).result;
    expect(JSON.parse((await call({ path: "Drawings/A-201.dwg", read_only: true, reason: "Elevations" })).content[0].text)).toMatchObject({ opened: true });
    expect(reviews.at(-1)).toEqual({ kind: "open", workspace: "projects/test", application: "autocad", path: "Drawings/A-201.dwg", readOnly: true, reason: "Elevations", slot: "4" });
    answer = { handled: false };
    expect((await call({ path: "A.dwg" })).content[0].text).toContain("nothing was opened");
    answer = { handled: true, error: "Mi only opens drawings inside this project's folder." };
    expect((await call({ path: "../x.dwg" })).content[0].text).toContain("inside this project's folder");
    expect(() => validateArguments("acad_open_drawing", { path: "x".repeat(1001) })).toThrow();
    expect(() => validateArguments("acad_open_drawing", { path: "a.dwg", read_only: "yes" })).toThrow();
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
