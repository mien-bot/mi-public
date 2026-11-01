// Standalone stdio MCP host. Runs in Node or Electron's Node mode; never loads Electron APIs.
const fs = require("node:fs");
const { normalizeBindings, requestNative, WORKSPACE, APPLICATIONS } = require("./nativeClient");
const lessons = require("./lessons");
const { requestReview } = require("./review");

const KINDS = ["status", "selection", "categories", "elements", "element", "types", "instances", "views", "levels", "sheets", "sheet", "schedules", "schedule", "warnings", "rooms", "links", "worksets", "revisions"];
const ACAD_KINDS = ["status", "selection", "layers", "layouts", "blocks", "entities", "entity"];
const integer = { type: "integer" };
const handle = { type: "string", pattern: "^[0-9A-Fa-f]{1,16}$" };
const point = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
const tools = [
  { name: "cad_drawing_guide", description: "Read Mi's working guide for drawing, annotating, and verifying CAD work, including lessons this person approved. Call it once before drawing.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "cad_propose_lesson", description: "Propose one specific, reusable lesson from this session. It waits for the person's approval in Set up MCP and has no effect until then. Never include project data, client names, or credentials.",
    inputSchema: { type: "object", properties: { lesson: { type: "string", maxLength: 500 } }, required: ["lesson"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: "revit_query", description: "Read the explicitly connected Revit model. Query status first. Model coordinates use internal feet. Follow hasMore/nextOffset; schedule cells are capped at 50 rows and 20 columns.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: KINDS }, element_id: integer, type_id: integer, category_id: integer,
      text: { type: "string", maxLength: 200 }, offset: { type: "integer", minimum: 0, maximum: 100000 }, limit: { type: "integer", minimum: 1, maximum: 200 } }, required: ["kind"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "revit_preview_edit", description: "Prepare an exact model edit without changing the model. Text/integer INSTANCE parameters only; use parameter IDs from element query. Move/copy offsets are explicitly in feet. No arbitrary code, save, or sync. Preview expires after two minutes or any model change.",
    inputSchema: { type: "object", properties: { operation: { type: "string", enum: ["set_parameter", "move", "copy", "delete", "duplicate_type", "create_wall"] },
      element_id: integer, parameter_id: integer, value: { type: ["string", "integer"] }, type_id: integer, new_name: { type: "string", maxLength: 200 },
      level_id: integer, height_ft: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
      start_ft: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }, end_ft: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      element_ids: { type: "array", items: integer, minItems: 1, maxItems: 50 }, offset_ft: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 } }, required: ["operation"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "revit_apply_edit", description: "Ask the PERSON to confirm this exact preview. The review appears in Mi's terminal window, or in a Revit dialog if Mi is not showing this project. This tool cannot approve its own change. Tell the person a review is coming before calling. A declined result changed nothing. Do not retry on timeout: inspect model state. No save or sync.",
    inputSchema: { type: "object", properties: { preview_token: { type: "string", pattern: "^[a-f0-9]{32}$" } }, required: ["preview_token"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "acad_query", description: "Read the explicitly connected AutoCAD drawing. Query status first: it reports INSUNITS and the UCS. All coordinates are WCS drawing units. Entities are identified by handle. Follow hasMore/nextOffset. Refused while AutoCAD is running a command or dialog.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ACAD_KINDS }, handle, space: { type: "string", maxLength: 255 }, layer: { type: "string", maxLength: 255 }, type: { type: "string", maxLength: 64 },
      text: { type: "string", maxLength: 200 }, offset: { type: "integer", minimum: 0, maximum: 100000 }, limit: { type: "integer", minimum: 1, maximum: 200 } }, required: ["kind"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "acad_preview_edit", description: "Prepare an exact drawing edit without changing the drawing. Coordinates and offsets are WCS drawing units; points for create_polyline are [x, y] plus one elevation, with optional bulges (one per point) for curved segments. Prefer operation batch with edits, a list of 1-200 of these same edit objects, for anything needing more than one edit: one review, all or nothing, one U reverses it, and later edits may use a layer created earlier in the batch. Arc and rotation angles are degrees, counterclockwise from +X. Text is literal, not formatting codes; create_mtext and create_leader text may contain newlines. Use create_leader (arrow, landing, height, text) for every callout. The target layer must exist unlocked; create it first with create_layer. Default space is model; otherwise name a layout. Handles select 1-50 entities directly in model or paper space. No arbitrary code, LISP, command strings, or save. Preview expires after two minutes or any drawing change.",
    inputSchema: { type: "object", properties: { operation: { type: "string", enum: ["batch", "create_layer", "create_line", "create_polyline", "create_circle", "create_arc", "create_text", "create_mtext", "create_leader", "move", "copy", "erase", "set_layer"] },
      edits: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 200 },
      center: point, position: point, location: point, arrow: point, landing: point, radius: { type: "number" }, height: { type: "number" }, width: { type: "number" }, text: { type: "string", maxLength: 2000 },
      start_angle_degrees: { type: "number" }, end_angle_degrees: { type: "number" }, rotation_degrees: { type: "number" }, bulges: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 500 },
      name: { type: "string", maxLength: 255 }, color_index: { type: "integer", minimum: 1, maximum: 255 }, layer: { type: "string", maxLength: 255 }, space: { type: "string", maxLength: 255 },
      start: point, end: point, offset: point, elevation: { type: "number" }, closed: { type: "boolean" },
      points: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, minItems: 2, maxItems: 500 },
      handles: { type: "array", items: handle, minItems: 1, maxItems: 50 } }, required: ["operation"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "acad_apply_edit", description: "Ask the PERSON to confirm this exact preview. The review appears in Mi's terminal window, or in an AutoCAD dialog if Mi is not showing this project. The drawing must be active in AutoCAD. This tool cannot approve its own change. Tell the person a review is coming before calling. An unanswered review declines itself. A declined result changed nothing. Do not retry on timeout: inspect the drawing. No save. The person can reverse a committed edit with one U.",
    inputSchema: { type: "object", properties: { preview_token: { type: "string", pattern: "^[a-f0-9]{32}$" } }, required: ["preview_token"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
];
const ROUTES = {
  revit_query: ["revit", "query"], revit_preview_edit: ["revit", "preview"], revit_apply_edit: ["revit", "apply"],
  acad_query: ["autocad", "query"], acad_preview_edit: ["autocad", "preview"], acad_apply_edit: ["autocad", "apply"],
};

function validItem(item, spec) {
  if (spec.type === "object") return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  if (spec.type === "array") return Array.isArray(item) && item.length >= spec.minItems && item.length <= spec.maxItems && item.every(value => validItem(value, spec.items));
  if (spec.type === "integer") return Number.isSafeInteger(item);
  if (spec.type === "string") return typeof item === "string" && new RegExp(spec.pattern).test(item);
  return typeof item === "number" && Number.isFinite(item);
}

function validateArguments(name, args) {
  const schema = tools.find(tool => tool.name === name)?.inputSchema;
  if (!schema || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool arguments.");
  for (const key of schema.required) if (!(key in args)) throw new Error(`${key} is required.`);
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties[key];
    if (!spec) throw new Error(`Unexpected argument: ${key}`);
    const types = Array.isArray(spec.type) ? spec.type : [spec.type];
    if (!types.some(type => type === "integer" ? Number.isSafeInteger(value) : type === "array" ? Array.isArray(value) : typeof value === type)) throw new Error(`Invalid ${key}.`);
    if (spec.enum && !spec.enum.includes(value)) throw new Error(`Unsupported ${key}.`);
    if (typeof value === "number" && (!Number.isFinite(value) || value < (spec.minimum ?? -Infinity) || value > (spec.maximum ?? Infinity) || (spec.exclusiveMinimum !== undefined && value <= spec.exclusiveMinimum))) throw new Error(`Invalid ${key}.`);
    if (typeof value === "string" && (value.length > (spec.maxLength ?? 4000) || (spec.pattern && !new RegExp(spec.pattern).test(value)))) throw new Error(`Invalid ${key}.`);
    if (Array.isArray(value) && !validItem(value, spec)) throw new Error(`Invalid ${key}.`);
  }
  return args;
}

function createHandler({ workspace, bindingsFile, autocadBindingsFile, lessonsFile, reviewFile, call = requestNative, review = reviewFile ? request => requestReview(reviewFile, request) : null }) {
  if (!WORKSPACE.test(workspace)) throw new Error("A valid Mi project workspace is required.");
  let initialized = false;
  return async function handle(request) {
    const { id, method, params } = request || {};
    if (typeof method !== "string" || request.jsonrpc !== "2.0") return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request." } };
    if (id === undefined) return null;
    function result(value) { return { jsonrpc: "2.0", id, result: value }; }
    function error(code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
    if (method === "initialize") {
      initialized = true;
      const versions = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
      return result({ protocolVersion: versions.includes(params?.protocolVersion) ? params.protocolVersion : "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "mi-cad", version: "0.2.0" }, instructions: "Call cad_drawing_guide before drawing. Read status first. Bind the exact Revit model or AutoCAD drawing using Mi Set up MCP. Edits require an exact preview and a person's confirmation, given in Mi or in that application. Never automatically retry uncertain writes." });
    }
    if (method === "ping") return result({});
    if (!initialized) return error(-32002, "Initialize first.");
    if (method === "tools/list") return result({ tools });
    if (method !== "tools/call") return error(-32601, "Method not found.");
    if (!tools.some(tool => tool.name === params?.name)) return error(-32602, "Unknown tool.");
    try {
      const args = validateArguments(params.name, params.arguments || {});
      if (params.name.startsWith("cad_")) {
        if (!lessonsFile) throw new Error("Lessons are not available in this launch.");
        if (params.name === "cad_drawing_guide") return result({ content: [{ type: "text", text: lessons.guide(lessonsFile) }] });
        lessons.propose(lessonsFile, args.lesson);
        return result({ content: [{ type: "text", text: "Proposed. It waits for the person's approval in Set up MCP." }] });
      }
      const [application, method] = ROUTES[params.name];
      const file = application === "autocad" ? autocadBindingsFile : bindingsFile;
      if (!file) throw Object.assign(new Error("No binding file."), { code: "ENOENT" });
      if (fs.statSync(file).size > 1_048_576) throw new Error("Invalid binding file.");
      const binding = normalizeBindings(JSON.parse(fs.readFileSync(file, "utf8")), application)[workspace];
      if (!binding) throw new Error(`No ${APPLICATIONS[application].noun} is bound to this project. Use Set up MCP in Mi.`);
      // handled:false means no person can see Mi's review; the application's own dialog then decides.
      if (method === "apply" && review) {
        const reviewed = await review({ workspace, application, token: args.preview_token });
        if (reviewed.handled) {
          if (reviewed.error) throw new Error(reviewed.error);
          return result({ content: [{ type: "text", text: JSON.stringify(reviewed.response) }] });
        }
      }
      const response = await call(binding.pipe, { method, workspace, document: binding.document, arguments: args });
      return result({ content: [{ type: "text", text: JSON.stringify(response) }] });
    } catch (e) { return result({ isError: true, content: [{ type: "text", text: e.code === "ENOENT" ? "Use Set up MCP in Mi first." : e.message }] }); }
  };
}

function start(argv = process.argv.slice(2)) {
  const read = key => { const index = argv.indexOf(key); return index >= 0 ? argv[index + 1] : undefined; };
  const handle = createHandler({ workspace: read("--workspace"), bindingsFile: read("--bindings"), autocadBindingsFile: read("--autocad-bindings"), lessonsFile: read("--lessons"), reviewFile: read("--review") });
  let pending = "";
  let chain = Promise.resolve();
  let queued = 0;
  const send = response => { if (response) process.stdout.write(JSON.stringify(response) + "\n"); };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    pending += chunk;
    if (Buffer.byteLength(pending) > 1_048_576) { process.stderr.write("MCP input exceeds limit.\n"); process.exitCode = 1; process.stdin.destroy(); return; }
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      let request;
      try { request = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }); continue; }
      if (queued >= 32) { if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Request queue full." } }); continue; }
      queued++;
      chain = chain.then(() => handle(request)).then(send).catch(() => send({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32603, message: "Internal error." } })).finally(() => queued--);
    }
  });
}
if (require.main === module) { try { start(); } catch (e) { process.stderr.write(e.message + "\n"); process.exitCode = 1; } }
module.exports = { createHandler, validateArguments, tools, start };
