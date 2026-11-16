// Standalone stdio MCP host. Runs in Node or Electron's Node mode; never loads Electron APIs.
const fs = require("node:fs");
const { normalizeBindings, forSlot, requestNative, discoverSessions, WORKSPACE, APPLICATIONS } = require("./nativeClient");
const lessons = require("./lessons");
const { requestReview } = require("./review");

const KINDS = ["status", "selection", "categories", "elements", "element", "types", "instances", "views", "levels", "sheets", "sheet", "schedules", "schedule", "warnings", "rooms", "links", "worksets", "revisions"];
const ACAD_KINDS = ["status", "drawings", "views", "xrefs", "selection", "layers", "layouts", "blocks", "entities", "entity"];
// Edits that reach a second connected drawing, named by source_drawing.
const LINKED = ["copy_from_drawing", "attach_xref"];
// Names one of the project's connected drawings by file name or document id; omitted means the current one.
const drawing = { type: "string", maxLength: 300 };
const integer = { type: "integer" };
const handle = { type: "string", pattern: "^[0-9A-Fa-f]{1,16}$" };
const point = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
// [minX, minY, maxX, maxY] in the queried space: model WCS, or a layout's paper units.
const area = { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 };
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
  { name: "acad_query", description: "Read a connected AutoCAD drawing. Several drawings can be connected to one project: kind drawings lists them, marks the current one, and lists drawings open in AutoCAD but not connected (ask for those with acad_connect_drawings). drawing (a file name from that list) reads another connected drawing without switching. Query status first: it reports INSUNITS and the UCS. All coordinates are WCS drawing units. Entities are identified by handle. " +
      "kind views lists layout viewports (layout, scale, nearbyText such as a view title, paperArea, and modelArea, the WCS rectangle a plan-oriented viewport shows) and named views (area). entities takes area [minX, minY, maxX, maxY] to read only what reaches into that rectangle of its space, such as a viewport's modelArea in space model. kind xrefs lists external references (name, stored path, status, overlay or attachment, and each insert). Follow hasMore/nextOffset. Refused while AutoCAD is running a command or dialog.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ACAD_KINDS }, drawing, handle, area, space: { type: "string", maxLength: 255 }, layer: { type: "string", maxLength: 255 }, type: { type: "string", maxLength: 64 },
      text: { type: "string", maxLength: 200 }, offset: { type: "integer", minimum: 0, maximum: 100000 }, limit: { type: "integer", minimum: 1, maximum: 200 } }, required: ["kind"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "acad_preview_edit", description: "Prepare an exact drawing edit without changing the drawing. Coordinates and offsets are WCS drawing units; points for create_polyline and create_hatch are [x, y] plus one elevation, with optional bulges (one per point) for curved segments. Prefer operation batch with edits, a list of 1-200 of these same edit objects, for anything needing more than one edit: one review, all or nothing, one U reverses it, and later edits may use a layer created earlier in the batch. Angles are degrees, counterclockwise from +X. Text is literal, not formatting codes; mtext, leader, and table text may contain newlines. Use create_leader (arrow, landing, height, text) for every callout. The target layer must exist unlocked; create it first with create_layer. Default space is model; otherwise name a layout. Handles select 1-50 entities directly in model or paper space. color_index (1-255, 256 ByLayer) colors anything this edit creates. " +
      "Text: edit_text (handles of TEXT/MTEXT/MULTILEADER; text replaces all, or find+replace keeps MTEXT formatting; optional height). set_attribute (block reference handles, attributes {TAG: value}). " +
      "Tables: create_table (position = top-left, cells = rows of strings, optional title, header, column_widths, row_height, height = text height). set_table_cells (one table handle; cell_updates [{row, column, text}] counting from 0 including any title row; cells appends rows). Query entity on a table to read its cells. " +
      "Charts: create_chart (chart_type bar, line, or pie; labels and non-negative values; position = lower-left; width, height; optional title, text_height, colors per value) draws native geometry, solid hatches, and text. " +
      "Also create_hatch (closed points; pattern SOLID or a predefined name such as ANSI31, AR-CONC, AR-SAND, INSUL; pattern_scale, pattern_angle_degrees), create_dimension (start, end, location on the dimension line; rotation_degrees makes it linear, otherwise aligned; optional text override), insert_block (name of a block defined in the drawing, position, factor, rotation_degrees, attributes), rotate (center, rotation_degrees), scale (center, factor), mirror (start, end; keep_original default true), and set_color. " +
      "Between drawings (each its own review, never in a batch; both drawings connected and open in the same AutoCAD): copy_from_drawing copies entities natively from source_drawing into this drawing, keeping blocks, hatches, dimensions, layers, and styles " +
      "(source_handles 1-1000, or source_area [minX, minY, maxX, maxY] in source_space, default model; base_point in the source lands at position here, both default origin; space is where they go here). " +
      "attach_xref references source_drawing (it must be saved) as an xref at position, rotation_degrees, on layer; overlay true (default) or false for an attachment; optional name. " +
      "Both scale from the source's INSUNITS to this drawing's automatically and the review states the factor. Units are sometimes wrong: compare INSUNITS of both drawings and a known dimension first; if a drawing has no units or they contradict its geometry, ask the person and pass unit_scale. " +
      "drawing names a connected drawing other than the current one. No arbitrary code, LISP, command strings, or save. Preview expires after two minutes or any drawing change.",
    inputSchema: { type: "object", properties: { operation: { type: "string", enum: ["batch", "create_layer", "create_line", "create_polyline", "create_circle", "create_arc", "create_text", "create_mtext", "create_leader",
        "create_table", "set_table_cells", "create_chart", "create_hatch", "create_dimension", "insert_block", "edit_text", "set_attribute", "move", "copy", "rotate", "scale", "mirror", "erase", "set_layer", "set_color", ...LINKED] },
      drawing, source_drawing: drawing, source_handles: { type: "array", items: handle, minItems: 1, maxItems: 1000 }, source_area: area, source_space: { type: "string", maxLength: 255 },
      base_point: point, unit_scale: { type: "number", exclusiveMinimum: 0, maximum: 1e9 }, overlay: { type: "boolean" }, edits: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 200 },
      center: point, position: point, location: point, arrow: point, landing: point, radius: { type: "number" }, height: { type: "number" }, width: { type: "number" }, text: { type: "string", maxLength: 2000 },
      start_angle_degrees: { type: "number" }, end_angle_degrees: { type: "number" }, rotation_degrees: { type: "number" }, bulges: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 500 },
      name: { type: "string", maxLength: 255 }, color_index: { type: "integer", minimum: 1, maximum: 256 }, layer: { type: "string", maxLength: 255 }, space: { type: "string", maxLength: 255 },
      find: { type: "string", maxLength: 2000 }, replace: { type: "string", maxLength: 2000 }, attributes: { type: "object" }, title: { type: "string", maxLength: 200 }, header: { type: "boolean" },
      cells: { type: "array", items: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, minItems: 1, maxItems: 100 },
      cell_updates: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 500 }, column_widths: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 20 }, row_height: { type: "number" },
      chart_type: { type: "string", enum: ["bar", "line", "pie"] }, labels: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 }, values: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 50 },
      colors: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 50 }, text_height: { type: "number" },
      pattern: { type: "string", maxLength: 31 }, pattern_scale: { type: "number" }, pattern_angle_degrees: { type: "number" }, factor: { type: "number" }, keep_original: { type: "boolean" },
      start: point, end: point, offset: point, elevation: { type: "number" }, closed: { type: "boolean" },
      points: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, minItems: 2, maxItems: 500 },
      handles: { type: "array", items: handle, minItems: 1, maxItems: 50 } }, required: ["operation"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "acad_apply_edit", description: "Ask the PERSON to confirm this exact preview. The review appears in Mi's terminal window, or in an AutoCAD dialog if Mi is not showing this project. It applies to the drawing the preview was made in. The drawing must be active in AutoCAD. This tool cannot approve its own change. Tell the person a review is coming before calling. An unanswered review declines itself. A declined result changed nothing. Do not retry on timeout: inspect the drawing. No save. The person can reverse a committed edit with one U.",
    inputSchema: { type: "object", properties: { preview_token: { type: "string", pattern: "^[a-f0-9]{32}$" }, drawing }, required: ["preview_token"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "acad_connect_drawings", description: "Ask the PERSON to connect drawings that are open in AutoCAD but not connected to this project, so you can read them. Name every drawing you need in one call, by file name or document id from acad_query kind drawings (its notConnected list), with a short reason they will see. They approve them together in a bar at the top of Mi's window, so tell them in one line first. Your current drawing does not change, and edits still need their approval. A drawing that is not open in AutoCAD cannot be connected: ask them to open it.",
    inputSchema: { type: "object", properties: { drawings: { type: "array", items: { type: "string", maxLength: 300 }, minItems: 1, maxItems: 11 }, reason: { type: "string", maxLength: 200 } }, required: ["drawings"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "acad_open_drawing", description: "Ask the PERSON to open a drawing file that is not open in AutoCAD yet, and connect it to this project, when you need it. path is the .dwg file's full path, or its path relative to the project folder, which is the parent of your working directory; find it with your shell. Only files inside the project folder can be opened. Give a short reason they will see. They approve in a bar at the top of Mi's window, so tell them in one line first. read_only opens it read-only, for reading only. AutoCAD makes the opened drawing active; your current drawing does not change. A drawing that is already open is connected instead.",
    inputSchema: { type: "object", properties: { path: { type: "string", maxLength: 1000 }, read_only: { type: "boolean" }, reason: { type: "string", maxLength: 200 } }, required: ["path"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "acad_switch_drawing", description: "Make another connected drawing this window's current one, so calls without drawing use it. No approval is needed, and other agent windows keep their own current drawings. Reading or editing a drawing once does not need a switch: pass drawing instead.",
    inputSchema: { type: "object", properties: { drawing }, required: ["drawing"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
const ROUTES = {
  revit_query: ["revit", "query"], revit_preview_edit: ["revit", "preview"], revit_apply_edit: ["revit", "apply"],
  acad_query: ["autocad", "query"], acad_preview_edit: ["autocad", "preview"], acad_apply_edit: ["autocad", "apply"],
  // Answered with Mi, never sent to the add-in as such.
  acad_connect_drawings: ["autocad", "connect"], acad_switch_drawing: ["autocad", "switch"], acad_open_drawing: ["autocad", "open"],
};

function validItem(item, spec) {
  if (spec.type === "object") return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  if (spec.type === "array") return Array.isArray(item) && item.length >= spec.minItems && item.length <= spec.maxItems && item.every(value => validItem(value, spec.items));
  if (spec.type === "integer") return Number.isSafeInteger(item);
  if (spec.type === "string") return typeof item === "string" && item.length <= (spec.maxLength ?? 4000) && new RegExp(spec.pattern).test(item);
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

/** The connected drawing a call names, by document id or file name; the current one when none is named. */
function pickDrawing(binding, name) {
  if (!name) return binding;
  const drawings = binding.drawings ?? [binding];
  const bare = value => value.toLowerCase().replace(/\.dwg$/, "");
  const byId = drawings.find(item => item.document === name);
  if (byId) return byId;
  const matches = drawings.filter(item => bare(item.title) === bare(name));
  if (matches.length === 1) return matches[0];
  const titles = drawings.map(item => item.title).join(", ");
  if (matches.length > 1) throw new Error(`More than one connected drawing is named ${name}. Use its document id from kind drawings.`);
  throw new Error(`${name} is not connected to this project. Connected: ${titles}. If it is open in AutoCAD, ask for it with acad_connect_drawings; if not, with acad_open_drawing.`);
}

/** An open, not-yet-connected drawing a call names, by document id or file name. */
function pickOpen(open, binding, name) {
  const bare = value => value.toLowerCase().replace(/\.dwg$/, "");
  const connected = (binding?.drawings ?? (binding ? [binding] : [])).find(item => item.document === name || bare(item.title) === bare(name));
  if (connected) throw new Error(`${connected.title} is already connected. Read it with drawing.`);
  const byId = open.find(item => item.document === name);
  if (byId) return byId;
  const matches = open.filter(item => bare(item.title) === bare(name));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`More than one open drawing is named ${name}. Use its document id from kind drawings.`);
  const titles = open.map(item => item.title).join(", ") || "none";
  throw new Error(`${name} is not open in AutoCAD. Open but not connected: ${titles}. Ask the person to open it in AutoCAD.`);
}

function createHandler({ workspace, slot, bindingsFile, autocadBindingsFile, autocadSessions, lessonsFile, reviewFile, call = requestNative, review = reviewFile ? request => requestReview(reviewFile, request) : null, discover = discoverSessions }) {
  if (!WORKSPACE.test(workspace)) throw new Error("A valid Mi project workspace is required.");
  // Names this agent's terminal session in the person's reviews when Mi started it.
  const asker = /^[1-4]$/.test(slot ?? "") ? { slot } : {};
  let initialized = false;
  // Which drawing each preview was made in, so its apply reaches that drawing even when it is no longer current.
  const previews = new Map();
  // This window's own choice of current drawing when Mi cannot record it (a copied launch command, or Mi closed).
  let chosen = null;
  const features = new Map();
  /** Whether the add-in behind a pipe has a feature; an unreachable one is left to answer for itself. */
  async function supports(pipe, feature) {
    if (!features.has(pipe)) {
      const found = await call(pipe, { method: "discover" }, { timeoutMs: 8000 }).catch(() => null);
      if (!found) return true;
      features.set(pipe, Array.isArray(found.features) ? found.features : []);
    }
    return features.get(pipe).includes(feature);
  }
  /** Drawings open in any AutoCAD that are not connected to this project. Each is identified by its add-in. */
  async function openDrawings(binding) {
    if (!autocadSessions) return null;
    const connected = new Set((binding?.drawings ?? (binding ? [binding] : [])).map(item => `${item.session}:${item.document}`));
    const sessions = discover(autocadSessions, "autocad");
    const found = await Promise.all(sessions.map(session => call(session.pipe, { method: "discover" }, { timeoutMs: 8000 }).then(result => ({ session, result }), () => null)));
    return found.filter(Boolean).flatMap(({ session, result }) => (Array.isArray(result?.documents) ? result.documents : [])
      .filter(item => typeof item?.id === "string" && !connected.has(`${session.session}:${item.id}`))
      .map(item => ({ title: String(item.title ?? "Drawing").slice(0, 300), document: item.id, session: session.session, ...(session.year ? { year: session.year } : {}),
        ...(typeof item.path === "string" ? { path: item.path } : {}), ...(item.isActive ? { active: true } : {}), ...(item.isReadOnly ? { readOnly: true } : {}) })));
  }
  /**
   * Asks the person, through Mi, to connect open drawings. This server only names them: Mi looks the
   * files up itself, shows them, and pairs each one after the person approves.
   */
  async function connectDrawings(binding, { drawings, reason }) {
    const open = await openDrawings(binding);
    if (open === null) throw new Error("This agent started before it could connect drawings itself. Ask the person to press Switch drawing in Mi, or to restart this agent.");
    const targets = [];
    for (const name of drawings) {
      const target = pickOpen(open, binding, name);
      if (!targets.includes(target)) targets.push(target);
    }
    if (!review) throw new Error("Mi is not available to ask the person. Ask them to press Switch drawing in Mi's terminal window and connect it.");
    let outcome;
    try { outcome = await review({ kind: "connect", workspace, application: "autocad", drawings: targets.map(({ session, document }) => ({ session, document })), ...(reason ? { reason } : {}), ...asker }); }
    catch { throw new Error("Mi did not finish the request. List the drawings again to see which are connected."); }
    if (!outcome.handled) throw new Error("Mi could not show the request, so nothing was connected. Ask the person to open this project's terminal window in Mi, or to press Switch drawing there.");
    if (outcome.error) throw new Error(outcome.error);
    return outcome.response;
  }
  /** Asks the person, through Mi, to open a drawing file. Mi resolves and checks the path; this server only names it. */
  async function openDrawing({ path, read_only: readOnly, reason }) {
    if (!review) throw new Error("Mi is not available to ask the person. Ask them to open the drawing in AutoCAD.");
    let outcome;
    try { outcome = await review({ kind: "open", workspace, application: "autocad", path, ...(readOnly !== undefined ? { readOnly } : {}), ...(reason ? { reason } : {}), ...asker }); }
    catch { throw new Error("Mi did not finish the request. List the drawings to see whether it opened and connected."); }
    if (!outcome.handled) throw new Error("Mi could not show the request, so nothing was opened. Ask the person to open this project's terminal window in Mi, or to open the drawing in AutoCAD.");
    if (outcome.error) throw new Error(outcome.error);
    return outcome.response;
  }
  /** Changes this window's current drawing. Mi records it for a window it started, so its banner follows. */
  async function switchDrawing(binding, name) {
    const target = pickDrawing(binding, name);
    if (target.document === binding.document) return { current: target.title, changed: false };
    if (slot && review) {
      const outcome = await review({ kind: "select", workspace, application: "autocad", document: target.document, slot }).catch(() => ({ handled: false }));
      if (outcome.handled && outcome.error) throw new Error(outcome.error);
      if (outcome.handled) { chosen = null; return { current: target.title, changed: true }; }
    }
    chosen = target.document;
    return { current: target.title, changed: true, note: "Mi's window may still name the previous drawing; this agent uses the new one." };
  }
  /** This window's view of the project's AutoCAD binding, with a switch Mi could not record applied. */
  function currentOf(binding) {
    if (!binding || !chosen) return binding;
    const drawing = binding.drawings?.find(item => item.document === chosen);
    if (!drawing) { chosen = null; return binding; }
    return { ...binding, ...drawing };
  }
  return async function handle(request) {
    const { id, method, params } = request || {};
    if (typeof method !== "string" || request.jsonrpc !== "2.0") return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request." } };
    if (id === undefined) return null;
    function result(value) { return { jsonrpc: "2.0", id, result: value }; }
    function error(code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
    if (method === "initialize") {
      initialized = true;
      const versions = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
      return result({ protocolVersion: versions.includes(params?.protocolVersion) ? params.protocolVersion : "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "mi-cad", version: "0.2.0" }, instructions: "Call cad_drawing_guide before drawing. Read status first. The person connects the exact Revit model or AutoCAD drawing in Mi. Several AutoCAD drawings can be connected to one project: acad_query kind drawings lists them and the open drawings not yet connected, and the drawing argument reads or edits one by name. acad_connect_drawings asks the person to connect open drawings you need, acad_open_drawing asks them to open and connect a drawing file from the project folder, acad_switch_drawing changes this window's current drawing, and kind views finds viewports and named views with the model area each shows. Other agent windows keep their own drawings. Edits require an exact preview and a person's confirmation, given in Mi or in that application. Never automatically retry uncertain writes." });
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
      const { drawing: named, ...native } = args;
      const file = application === "autocad" ? autocadBindingsFile : bindingsFile;
      if (!file) throw Object.assign(new Error("No binding file."), { code: "ENOENT" });
      if (fs.statSync(file).size > 1_048_576) throw new Error("Invalid binding file.");
      // An agent window started by Mi has its own current drawing; other windows can switch theirs freely.
      const stored = forSlot(normalizeBindings(JSON.parse(fs.readFileSync(file, "utf8")), application)[workspace], slot);
      const binding = application === "autocad" ? currentOf(stored) : stored;
      if (method === "connect") return result({ content: [{ type: "text", text: JSON.stringify(await connectDrawings(binding, args)) }] });
      if (method === "open") return result({ content: [{ type: "text", text: JSON.stringify(await openDrawing(args)) }] });
      if (!binding) throw new Error(`No ${APPLICATIONS[application].noun} is bound to this project. Use Set up MCP in Mi.`);
      if (method === "switch") return result({ content: [{ type: "text", text: JSON.stringify(await switchDrawing(binding, named)) }] });
      if (method === "query" && native.kind === "drawings") {
        const drawings = (binding.drawings ?? [binding]).map(item => ({ title: item.title, document: item.document, ...(item.year ? { year: item.year } : {}), current: item.document === binding.document }));
        const open = await openDrawings(binding);
        const more = open === null ? { note: "Restart this agent to list drawings open in AutoCAD but not connected." }
          : { notConnected: open, ...(open.length ? { note: "Ask for any of notConnected with acad_connect_drawings." } : {}) };
        return result({ content: [{ type: "text", text: JSON.stringify({ current: binding.title, drawings, ...more }) }] });
      }
      const remembered = method === "apply" && previews.get(native.preview_token);
      const target = remembered ? (binding.drawings ?? [binding]).find(item => item.document === remembered) : pickDrawing(binding, named);
      if (!target) throw new Error("The drawing this preview was made in is no longer connected. Nothing was applied.");
      // The source of a linked edit is named like any drawing and resolved here; the add-in checks its pairing again.
      if (method === "preview" && application === "autocad") {
        const { source_drawing: sourceName, ...rest } = native;
        if (LINKED.includes(native.operation)) {
          if (!sourceName) throw new Error("source_drawing is required: name the connected drawing to copy from or reference.");
          const source = pickDrawing(binding, sourceName);
          if (source.document === target.document) throw new Error("source_drawing is the drawing being changed. Use copy or insert_block within one drawing.");
          if (source.session !== target.session) throw new Error(`${source.title} and ${target.title} are open in different AutoCAD windows${source.year && target.year ? ` (${source.year} and ${target.year})` : ""}. Copying and referencing work between drawings in the same AutoCAD: ask the person to open both in one, or use acad_open_drawing there.`);
          if (!await supports(target.pipe, "linked-edits")) throw new Error("This AutoCAD add-in cannot copy or reference between drawings yet. Ask the person to close AutoCAD and install the update under Set up MCP → More options.");
          Object.keys(native).forEach(key => delete native[key]);
          Object.assign(native, rest, { source_document: source.document });
        } else if (sourceName !== undefined) throw new Error("source_drawing applies only to copy_from_drawing and attach_xref.");
      }
      if (application === "autocad" && method === "query" && native.kind === "xrefs" && !await supports(target.pipe, "linked-edits"))
        throw new Error("This AutoCAD add-in cannot list references yet. Ask the person to close AutoCAD and install the update under Set up MCP → More options.");
      if (application === "autocad" && method === "query" && (native.kind === "views" || native.area) && !await supports(target.pipe, "views"))
        throw new Error("This AutoCAD add-in cannot read views or areas yet. Ask the person to close AutoCAD and install the update under Set up MCP → More options.");
      // handled:false means no person can see Mi's review; the application's own dialog then decides.
      if (method === "apply" && review) {
        // Always named: Mi's project default can differ from this window's current drawing.
        const reviewed = await review({ workspace, application, token: native.preview_token, document: target.document, ...asker });
        if (reviewed.handled) {
          if (reviewed.error) throw new Error(reviewed.error);
          return result({ content: [{ type: "text", text: JSON.stringify(reviewed.response) }] });
        }
      }
      const response = await call(target.pipe, { method, workspace, document: target.document, arguments: native });
      if (method === "preview" && typeof response?.previewToken === "string") {
        previews.set(response.previewToken, target.document);
        if (previews.size > 64) previews.delete(previews.keys().next().value);
      }
      return result({ content: [{ type: "text", text: JSON.stringify(response) }] });
    } catch (e) { return result({ isError: true, content: [{ type: "text", text: e.code === "ENOENT" ? "Use Set up MCP in Mi first." : e.message }] }); }
  };
}

function start(argv = process.argv.slice(2)) {
  const read = key => { const index = argv.indexOf(key); return index >= 0 ? argv[index + 1] : undefined; };
  const handle = createHandler({ workspace: read("--workspace"), slot: read("--slot"), bindingsFile: read("--bindings"), autocadBindingsFile: read("--autocad-bindings"), autocadSessions: read("--autocad-sessions"), lessonsFile: read("--lessons"), reviewFile: read("--review") });
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
