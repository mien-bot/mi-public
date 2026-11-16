// Renders the CAD review popup. The page has no scripts; this preload writes text only and sends
// back which review was painted and which button was clicked. It exposes nothing to the page.
const { ipcRenderer } = require("electron");

const LABELS = { autocad: "AutoCAD", revit: "Revit" };
let current = null;
let countdown = null;
let answering = false;

function element(id) { return document.getElementById(id); }

function tick() {
  if (!current) return;
  const seconds = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000));
  element("timer").textContent = `Declines itself in ${seconds}s`;
}

function render(state) {
  clearInterval(countdown);
  countdown = null;
  current = state?.review ?? null;
  answering = false;
  element("apply").disabled = false;
  element("decline").disabled = false;
  if (!current) return;
  // An agent asking to read more drawings, or to open one, rather than to change one.
  const connect = current.kind === "connect";
  const opening = current.kind === "open";
  const label = LABELS[current.application] ?? "CAD";
  element("application").textContent = opening ? `Open ${label} drawing` : connect ? `Connect ${label} drawings` : `Review ${label} edit`;
  // Which agent asked, when several work in one project.
  const asker = /^[1-4]$/.test(current.session ?? "") ? ` · session ${current.session}` : "";
  element("project").textContent = typeof current.workspace === "string" ? `· ${current.workspace.replace(/^projects\//, "")}${asker}` : "";
  element("title").textContent = opening ? `Open ${current.title} for the agent?` : connect ? `Let the agent read ${current.title}?` : `Apply this edit to ${current.title}?`;
  element("apply").textContent = opening ? "Open and connect" : connect ? "Connect" : "Apply edit";
  element("summary").textContent = current.summary ?? "";
  element("summary").scrollTop = 0;
  const note = connect || opening ? "Edits still need your approval." : "Nothing is saved.";
  element("note").textContent = state.waiting > 0 ? `${state.waiting} more waiting. ${note}` : note;
  tick();
  countdown = setInterval(tick, 1000);
  // Report after layout, with the height this review needs, so it is shown fully painted. A hidden
  // window may not run animation frames, so a short timer reports it if a frame does not come first.
  const id = current.id;
  let reported = false;
  const report = () => {
    if (reported || current?.id !== id) return;
    reported = true;
    ipcRenderer.send("cad-popup:shown", { id, height: document.body.scrollHeight });
  };
  requestAnimationFrame(() => requestAnimationFrame(report));
  setTimeout(report, 50);
}

function choose(approved) {
  if (!current || answering) return;
  answering = true;
  element("apply").disabled = true;
  element("decline").disabled = true;
  const id = current.id;
  ipcRenderer.invoke("cad-popup:answer", { id, approved }).then(accepted => {
    // A review that already ended is replaced by the next state; re-enable only if still showing.
    if (!accepted && current?.id === id) { answering = false; element("apply").disabled = false; element("decline").disabled = false; }
  }, () => {
    if (current?.id === id) { answering = false; element("apply").disabled = false; element("decline").disabled = false; }
  });
}

ipcRenderer.on("cad-popup:state", (_event, state) => render(state));
// Only a pointer answers. A button that never takes focus cannot be pressed with Enter or Space, and
// a click with no pointer behind it (detail 0, as a keyboard press makes) is ignored as well.
const pointerOnly = approved => event => { if (event.isTrusted && event.detail > 0) choose(approved); };
window.addEventListener("keydown", event => event.preventDefault(), true);
window.addEventListener("DOMContentLoaded", () => {
  for (const id of ["apply", "decline"]) element(id).addEventListener("mousedown", event => event.preventDefault());
  element("apply").addEventListener("click", pointerOnly(true));
  element("decline").addEventListener("click", pointerOnly(false));
  ipcRenderer.send("cad-popup:ready");
});
