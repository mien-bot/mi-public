const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const SESSION = /^[a-f0-9]{32}$/;
const PIPE = /^mi-(revit|autocad)-[1-9][0-9]*-[a-f0-9]{32}$/;
// Each application owns its pipe prefix, discovery record, and wording. A Revit binding can
// never route to AutoCAD or the reverse, because the prefix is checked against this entry.
const APPLICATIONS = {
  revit: { label: "Revit", prefix: "mi-revit", noun: "model" },
  autocad: { label: "AutoCAD", prefix: "mi-autocad", noun: "drawing" },
};
const applicationOf = pipe => APPLICATIONS[PIPE.exec(pipe)?.[1]];
const WORKSPACE = /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YEAR = /^20\d\d$/;

const MAX_DRAWINGS = 12;
function normalizeDrawing(value, application) {
  const { label, noun, prefix } = APPLICATIONS[application];
  if (!value || !SESSION.test(value.session) || !SESSION.test(value.document)
    || !PIPE.test(value.pipe) || !value.pipe.startsWith(`${prefix}-`) || !value.pipe.endsWith(`-${value.session}`)) return null;
  return { session: value.session, pipe: value.pipe, document: value.document,
    title: typeof value.title === "string" ? value.title.slice(0, 300) : `${label} ${noun}`, ...(YEAR.test(value.year) ? { year: value.year } : {}) };
}
/**
 * One entry per project. Its top-level fields are the current file, which every tool call uses by
 * default. An AutoCAD project also lists every drawing connected to it in `drawings`, current one
 * included, so an agent can read the others by name.
 */
function normalizeBindings(input, application = "revit") {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const [workspace, value] of Object.entries(input).slice(0, 500)) {
    const current = WORKSPACE.test(workspace) && normalizeDrawing(value, application);
    if (!current) continue;
    if (application !== "autocad") { result[workspace] = current; continue; }
    const drawings = [current];
    for (const item of Array.isArray(value.drawings) ? value.drawings.slice(0, 50) : []) {
      const drawing = normalizeDrawing(item, application);
      if (drawing && drawings.length < MAX_DRAWINGS && !drawings.some(known => known.session === drawing.session && known.document === drawing.document)) drawings.push(drawing);
    }
    // Each CAD agent window (terminal slot 1-4) can pin its own current drawing, so one window
    // switching files never moves another. A pin to a drawing that is no longer connected is dropped.
    const pins = {};
    const given = value.pins && typeof value.pins === "object" && !Array.isArray(value.pins) ? value.pins : {};
    for (const slot of ["1", "2", "3", "4"]) if (drawings.some(drawing => drawing.document === given[slot])) pins[slot] = given[slot];
    result[workspace] = { ...current, drawings, ...(Object.keys(pins).length ? { pins } : {}) };
  }
  return result;
}

const SLOT = /^[1-4]$/;
/** A project's binding as one agent window sees it: its pinned drawing is current, the rest stay reachable by name. */
function forSlot(binding, slot) {
  const id = binding && SLOT.test(slot ?? "") ? binding.pins?.[slot] : undefined;
  const drawing = id && binding.drawings?.find(item => item.document === id);
  return drawing && drawing.document !== binding.document ? { ...binding, ...drawing } : binding;
}

function discoverSessions(directory, application = "revit") {
  const { label, prefix } = APPLICATIONS[application];
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => /^[a-f0-9]{32}\.json$/.test(name)).slice(0, 100).flatMap(name => {
    try {
      const file = path.join(directory, name);
      if (fs.statSync(file).size > 4096) return [];
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value.schema !== 1 || value.application !== label || !SESSION.test(value.session)
        || !Number.isSafeInteger(value.pid) || value.pid < 1 || value.pipe !== `${prefix}-${value.pid}-${value.session}`
        || name !== `${value.session}.json`) return [];
      try { process.kill(value.pid, 0); } catch { return []; }
      // Release details are display data only; routing never depends on them. Add-ins from before
      // 2024 support recorded only the year.
      return [{ session: value.session, pipe: value.pipe, pid: value.pid, version: String(value.version).slice(0, 40),
        year: YEAR.test(value.year) ? value.year : null, apiVersion: /^\d+(?:\.\d+){1,3}$/.test(value.apiVersion) ? value.apiVersion : null }];
    } catch { return []; }
  });
}

function requestNative(pipe, request, { timeoutMs = 65_000, connect = net.createConnection } = {}) {
  if (!PIPE.test(pipe)) return Promise.reject(new Error("Invalid native connection."));
  const { label, noun } = applicationOf(pipe);
  const encoded = JSON.stringify(request) + "\n";
  if (Buffer.byteLength(encoded) > 1_048_576) return Promise.reject(new Error("CAD request too large."));
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = connect(`\\\\.\\pipe\\${pipe}`);
    let pending = "";
    // ETIMEDOUT tells a live application that is waiting on a dialog apart from one that is gone.
    const timer = setTimeout(() => finish(Object.assign(new Error(`${label} did not respond. An edit's outcome may be unknown: inspect the ${noun} before retrying.`), { code: "ETIMEDOUT" })), timeoutMs);
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result);
    }
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(encoded));
    socket.on("data", chunk => {
      pending += chunk;
      if (Buffer.byteLength(pending) > 4_194_304) return finish(new Error("Native response exceeds 4 MB."));
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      try {
        const envelope = JSON.parse(pending.slice(0, newline));
        if (envelope.ok !== true) return finish(new Error(typeof envelope.error === "string" ? envelope.error : "Native operation failed."));
        finish(null, envelope.result);
      } catch { finish(new Error("Invalid native response.")); }
    });
    socket.on("error", () => finish(new Error(`Native ${label} connection is unavailable. Open ${label} and reconnect in Mi.`)));
    socket.on("close", () => finish(new Error(`${label} disconnected. Inspect the ${noun} before retrying an edit.`)));
  });
}

module.exports = { normalizeBindings, forSlot, SLOT, MAX_DRAWINGS, discoverSessions, requestNative, WORKSPACE, SESSION, PIPE, APPLICATIONS };
