const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 5;

function hasCommandModifier(input) {
  if (input?.control || input?.meta) return true;
  const modifiers = Array.isArray(input?.modifiers)
    ? input.modifiers.map((modifier) => String(modifier).toLowerCase())
    : [];
  return modifiers.some((modifier) => (
    modifier === "control"
    || modifier === "ctrl"
    || modifier === "meta"
    || modifier === "command"
    || modifier === "cmd"
  ));
}

function keyboardZoomAction(input) {
  if (input?.type !== "keyDown" || !hasCommandModifier(input) || input.alt) return null;
  const key = String(input.key || "").toLowerCase();
  const code = String(input.code || "").toLowerCase();

  if (key === "+" || key === "=" || key === "add" || code === "numpadadd") return "in";
  if (key === "-" || key === "subtract" || code === "numpadsubtract") return "out";
  if (key === "0" || code === "numpad0") return "reset";
  return null;
}

/**
 * Ctrl/Cmd + wheel is handled in the renderer (components/ZoomGesture.tsx), not here.
 * `before-mouse-event` lists `mouseWheel` among its types but never delivered one in practice,
 * so the gesture silently did nothing. The renderer's own `wheel` listener calls back through
 * the "zoom:step" IPC, which lands on applyZoomAction below. Keyboard zoom still uses
 * `before-input-event`, which works.
 */
function applyZoomAction(webContents, action) {
  if (action !== "in" && action !== "out" && action !== "reset") return null;
  const current = webContents.getZoomLevel();
  const next = nextZoomLevel(current, action);
  if (next !== current) webContents.setZoomLevel(next);
  return next;
}

function nextZoomLevel(currentLevel, action) {
  const current = Number.isFinite(Number(currentLevel)) ? Number(currentLevel) : 0;
  if (action === "reset") return 0;
  const change = action === "in" ? 1 : action === "out" ? -1 : 0;
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, current + change));
}

function installZoomControls(webContents) {
  function onKeyboard(event, input) {
    const action = keyboardZoomAction(input);
    if (!action) return;
    event.preventDefault();
    applyZoomAction(webContents, action);
  }

  webContents.on("before-input-event", onKeyboard);

  return () => {
    webContents.removeListener("before-input-event", onKeyboard);
  };
}

module.exports = {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  applyZoomAction,
  installZoomControls,
  keyboardZoomAction,
  nextZoomLevel,
};
