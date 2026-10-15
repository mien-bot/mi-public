import { describe, expect, it, vi } from "vitest";

const { createApplicationMenuTemplate } = require("./desktopMenu");

function template(platform = "win32") {
  return createApplicationMenuTemplate({
    openMainWindow: vi.fn(),
    openNewChatWindow: vi.fn(),
    openProjectChatWindow: vi.fn(),
    quitApp: vi.fn(),
    platform,
    appName: "Mi",
  });
}

describe("desktop application menu", () => {
  it("keeps only Mi-relevant top-level menus and editing actions", () => {
    const menu = template();
    expect(menu.map((item: { label: string }) => item.label)).toEqual(["File", "Edit", "View"]);

    const edit = menu.find((item: { label: string }) => item.label === "Edit");
    expect(edit.submenu.filter((item: { label?: string }) => item.label).map((item: { label: string }) => item.label))
      .toEqual(["Undo", "Redo", "Cut", "Copy", "Paste", "Select All"]);
  });

  it("offers open, close, and explicit quit actions", () => {
    const menu = template();
    const file = menu.find((item: { label: string }) => item.label === "File");
    expect(file.submenu.filter((item: { label?: string }) => item.label).map((item: { label: string }) => item.label))
      .toEqual(["Open Mi", "New Chat Window", "Open Compact Chat", "Close Window", "Quit Mi"]);
  });

  it("offers matching zoom and full-screen actions", () => {
    const menu = template();
    const view = menu.find((item: { label: string }) => item.label === "View");
    expect(view.submenu.filter((item: { label?: string }) => item.label).map((item: { label: string }) => item.label))
      .toEqual(["Actual Size", "Zoom In", "Zoom Out", "Full Screen"]);

    const webContents = { getZoomLevel: vi.fn(() => 0), setZoomLevel: vi.fn() };
    view.submenu.find((item: { label?: string }) => item.label === "Zoom In")
      .click(null, { isDestroyed: () => false, webContents });
    expect(webContents.setZoomLevel).toHaveBeenCalledWith(1);
  });

  it("uses native macOS application and Window menus", () => {
    const menu = template("darwin");
    expect(menu.map((item: { label: string }) => item.label))
      .toEqual(["Mi", "File", "Edit", "View", "Window"]);

    const appMenu = menu[0];
    expect(appMenu.submenu.at(-1)).toMatchObject({
      label: "Quit Mi",
      accelerator: "Command+Q",
    });

    const file = menu.find((item: { label: string }) => item.label === "File");
    expect(file.submenu.some((item: { label?: string }) => item.label === "Quit Mi")).toBe(false);

    const view = menu.find((item: { label: string }) => item.label === "View");
    expect(view.submenu.find((item: { label?: string }) => item.label === "Full Screen"))
      .toMatchObject({ accelerator: "Control+Command+F" });
  });
});
