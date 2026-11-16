import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createReviewPopup } = require("./reviewPopup");

type Handler = (event: { sender: unknown }, message?: unknown) => unknown;

function fakeElectron() {
  const on = new Map<string, Handler>(), handle = new Map<string, Handler>();
  const windows: FakeWindow[] = [];
  class FakeWindow {
    options: Record<string, unknown>;
    visible = false; destroyed = false; bounds = { x: 0, y: 0, width: 0, height: 0 };
    sent: Array<[string, unknown]> = [];
    webContents = { send: (channel: string, payload: unknown) => { this.sent.push([channel, payload]); }, setWindowOpenHandler() {}, on() {} };
    constructor(options: Record<string, unknown>) { this.options = options; windows.push(this); }
    isDestroyed() { return this.destroyed; }
    on() {}
    loadFile() {}
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    setAlwaysOnTop() {}
    setBounds(bounds: typeof this.bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds; }
    destroy() { this.destroyed = true; }
  }
  const electron = {
    BrowserWindow: FakeWindow,
    ipcMain: { on: (channel: string, fn: Handler) => on.set(channel, fn), handle: (channel: string, fn: Handler) => handle.set(channel, fn) },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
  };
  return { electron, on, handle, windows };
}

const review = (id: string) => ({ id, workspace: "projects/fixture", application: "autocad", title: "Fixture.dwg", summary: "Add 1 line.", expiresAt: Date.now() + 90_000 });

describe("CAD review popup", () => {
  it("never takes focus, shows only after the page painted the review, and answers only that review", async () => {
    const { electron, on, handle, windows } = fakeElectron();
    const answers: Array<[string, boolean]> = [], shown: string[] = [];
    const popup = createReviewPopup({ electron, answer: (id: string, approved: boolean) => { answers.push([id, approved]); return true; }, shown: (id: string) => shown.push(id) });
    expect(windows).toHaveLength(0); // Nothing is created before there is a review.
    popup.add(review("a"));
    popup.add(review("b"));
    const [window] = windows;
    expect(window.options).toMatchObject({ focusable: true, alwaysOnTop: true, show: false });
    expect(window.options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    const page = { sender: window.webContents }, stranger = { sender: {} };

    on.get("cad-popup:ready")!(page);
    expect(window.sent.at(-1)?.[0]).toBe("cad-popup:state");
    expect(window.sent.at(-1)?.[1]).toMatchObject({ review: { id: "a", title: "Fixture.dwg" }, waiting: 1 });
    expect(window.visible).toBe(false);
    // Before it is on screen, and from any other renderer, nothing can answer.
    expect(await handle.get("cad-popup:answer")!(page, { id: "a", approved: true })).toBe(false);
    on.get("cad-popup:shown")!(stranger, { id: "a", height: 300 });
    expect(window.visible).toBe(false);

    on.get("cad-popup:shown")!(page, { id: "a", height: 5000 });
    expect(window.visible).toBe(true);
    expect(window.bounds.height).toBe(600);
    expect(shown).toEqual(["a"]);
    expect(await handle.get("cad-popup:answer")!(stranger, { id: "a", approved: true })).toBe(false);
    expect(await handle.get("cad-popup:answer")!(page, { id: "b", approved: true })).toBe(false);
    expect(await handle.get("cad-popup:answer")!(page, { id: "a", approved: true })).toBe(true);
    expect(answers).toEqual([["a", true]]);

    popup.remove("a"); // The broker closes the review it answered.
    expect(window.sent.at(-1)?.[1]).toMatchObject({ review: { id: "b" }, waiting: 0 });
    expect(await handle.get("cad-popup:answer")!(page, { id: "b", approved: false })).toBe(false);
    on.get("cad-popup:shown")!(page, { id: "b", height: 250 });
    expect(await handle.get("cad-popup:answer")!(page, { id: "b", approved: false })).toBe(true);
    popup.remove("b");
    expect(window.visible).toBe(false);
    expect(window.sent.at(-1)).toEqual(["cad-popup:state", null]);
  });

  it("creates no window while Mi quits", () => {
    const { electron, windows } = fakeElectron();
    const popup = createReviewPopup({ electron, answer: () => true, shown: () => true });
    popup.destroy();
    popup.add(review("a"));
    popup.remove("a");
    expect(windows).toHaveLength(0);
  });
});
