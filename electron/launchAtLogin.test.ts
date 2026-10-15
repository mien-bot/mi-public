import { describe, expect, it, vi } from "vitest";

const {
  initializeLaunchAtLogin,
  launchAtLoginSupported,
  readLaunchAtLogin,
  setLaunchAtLogin,
} = require("./launchAtLogin");

function fakeApp(openAtLogin = false) {
  let enabled = openAtLogin;
  return {
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: enabled })),
    setLoginItemSettings: vi.fn((settings: { openAtLogin: boolean }) => { enabled = settings.openAtLogin; }),
  };
}

describe("Windows launch at login", () => {
  it.each([
    { isInstalled: false, isolated: false },
    { isInstalled: true, isolated: true },
  ])("does not let unpacked or isolated builds change startup: %j", (options) => {
    const app = fakeApp();
    const store = {
      getSettings: () => ({ launchAtLogin: true, launchAtLoginConfigured: false }),
      updateSettings: vi.fn(),
    };
    const runtime = { platform: "win32", isPackaged: true, ...options };
    expect(initializeLaunchAtLogin(app, store, runtime).supported).toBe(false);
    expect(setLaunchAtLogin(app, true, runtime).supported).toBe(false);
    expect(app.getLoginItemSettings).not.toHaveBeenCalled();
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    expect(store.updateSettings).not.toHaveBeenCalled();
  });

  it("is limited to packaged Windows builds", () => {
    expect(launchAtLoginSupported("win32", true)).toBe(true);
    expect(launchAtLoginSupported("win32", false)).toBe(false);
    expect(launchAtLoginSupported("darwin", true)).toBe(false);
  });

  it("applies and verifies the requested Windows state", () => {
    const app = fakeApp();
    expect(setLaunchAtLogin(app, true, {
      platform: "win32", isPackaged: true, isInstalled: true, executablePath: "C:\\Mi\\Mi.exe",
    })).toEqual({ supported: true, enabled: true });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: "C:\\Mi\\Mi.exe",
    });
    expect(readLaunchAtLogin(app, {
      platform: "win32", isPackaged: true, isInstalled: true, executablePath: "C:\\Mi\\Mi.exe",
    }).enabled).toBe(true);
  });

  it("enables only on the first packaged launch and preserves later user choice", () => {
    const app = fakeApp();
    const updateSettings = vi.fn();
    const firstStore = {
      getSettings: () => ({ launchAtLogin: true, launchAtLoginConfigured: false }),
      updateSettings,
    };
    initializeLaunchAtLogin(app, firstStore, { platform: "win32", isPackaged: true, isInstalled: true });
    expect(app.setLoginItemSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({ launchAtLogin: true, launchAtLoginConfigured: true });

    app.setLoginItemSettings.mockClear();
    const existingStore = {
      getSettings: () => ({ launchAtLogin: false, launchAtLoginConfigured: true }),
      updateSettings: vi.fn(),
    };
    initializeLaunchAtLogin(app, existingStore, { platform: "win32", isPackaged: true, isInstalled: true });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("does not register the development Electron executable", () => {
    const app = fakeApp();
    expect(setLaunchAtLogin(app, true, { platform: "win32", isPackaged: false }))
      .toEqual({ supported: false, enabled: true });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
