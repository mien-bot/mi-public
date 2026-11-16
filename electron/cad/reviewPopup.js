// A small always-on-top window for CAD edit reviews, so the decision is visible over AutoCAD or
// Revit instead of only in a bar inside Mi's terminal window. It is owned by the main process and
// loads a static page with no scripts of its own, so a busy terminal or page cannot delay it.
//
// The window is shown without taking focus, and its page answers only a pointer click: buttons
// refuse focus and keyboard-made clicks are ignored (see reviewPopupPreload.js). Keystrokes belong
// to the shell where the agent runs, so nothing typed, by a person or a program, can answer it.
// Answers go through the same broker as the terminal bar, and only for the review on screen.
//
// It must stay focusable. On Windows a non-focusable window (WS_EX_NOACTIVATE) gets no mouse input
// at all while another program, such as AutoCAD, owns the foreground, so Apply could not be pressed.
const path = require("node:path");

const WIDTH = 480;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 600;

function createReviewPopup({ answer, shown, icon, electron = require("electron") }) {
  const { BrowserWindow, ipcMain, screen } = electron;
  let window = null;
  let ready = false;
  let visibleId = null;
  const queue = [];

  const live = () => (window && !window.isDestroyed() ? window : null);
  const fromPopup = event => Boolean(live()) && event.sender === window.webContents;

  function ensure() {
    if (live()) return window;
    ready = false;
    visibleId = null;
    window = new BrowserWindow({
      width: WIDTH, height: 320, show: false, frame: false, resizable: false, movable: true,
      minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, focusable: true, skipTaskbar: true, title: "Review CAD edit", icon,
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: path.join(__dirname, "reviewPopupPreload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
        // Hidden between reviews; without this Chromium pauses the page and the next review never paints.
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.on("closed", () => { window = null; ready = false; visibleId = null; });
    window.loadFile(path.join(__dirname, "reviewPopup.html"));
    return window;
  }

  /** Near the person's pointer, which is usually on the drawing they are watching. */
  function place(target, height) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    target.setBounds({
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: Math.round(workArea.y + Math.max(0, (workArea.height - height) / 3)),
      width: WIDTH, height,
    });
  }

  function sync() {
    const review = queue[0] ?? null;
    // Nothing to show never creates a window (and never reopens one while Mi quits).
    if (!review && !live()) { visibleId = null; return; }
    const target = ensure();
    if (!ready) return; // "ready" from the page calls sync again.
    if (!review) {
      visibleId = null;
      target.hide();
      target.webContents.send("cad-popup:state", null);
      return;
    }
    // The page reports "shown" after it has painted this review; only then is it put on screen.
    target.webContents.send("cad-popup:state", { review, waiting: queue.length - 1 });
  }

  ipcMain.on("cad-popup:ready", event => {
    if (!fromPopup(event)) return;
    ready = true;
    sync();
  });
  ipcMain.on("cad-popup:shown", (event, message) => {
    if (!fromPopup(event) || !message || queue[0]?.id !== message.id) return;
    const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(Number(message.height) || 0)));
    if (!window.isVisible() || visibleId === null) place(window, height);
    else window.setBounds({ ...window.getBounds(), height });
    window.setAlwaysOnTop(true, "floating");
    window.showInactive();
    visibleId = message.id;
    shown(message.id);
  });
  ipcMain.handle("cad-popup:answer", (event, message) => {
    // Only a click in this window, on the review it is showing, counts.
    if (!fromPopup(event) || !message || visibleId === null || message.id !== visibleId) return false;
    return answer(message.id, message.approved === true);
  });

  let destroyed = false;
  return {
    add(review) {
      if (destroyed || !review || queue.some(item => item.id === review.id)) return;
      queue.push(review);
      sync();
    },
    remove(id) {
      const index = queue.findIndex(item => item.id === id);
      if (index < 0) return;
      queue.splice(index, 1);
      if (visibleId === id) visibleId = null;
      sync();
    },
    destroy() {
      destroyed = true;
      queue.length = 0;
      live()?.destroy();
      window = null;
    },
  };
}

module.exports = { createReviewPopup };
