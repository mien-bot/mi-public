const fs = require("node:fs");
const path = require("node:path");

function launchAtLoginSupported(platform = process.platform, isPackaged = false, installed = true) {
  return platform === "win32" && isPackaged === true && installed === true;
}

function readLaunchAtLogin(app, {
  platform = process.platform,
  isPackaged = app.isPackaged,
  executablePath = process.execPath,
  fallbackEnabled = true,
  isInstalled = fs.existsSync(path.join(path.dirname(executablePath), "resources", "mi-installed")),
  isolated = Boolean(app.commandLine?.hasSwitch("user-data-dir") || process.env.MI_USER_DATA_DIR),
} = {}) {
  if (!launchAtLoginSupported(platform, isPackaged, isInstalled && !isolated)) {
    return { supported: false, enabled: fallbackEnabled === true };
  }
  const current = app.getLoginItemSettings({ path: executablePath });
  return { supported: true, enabled: current.openAtLogin === true };
}

function setLaunchAtLogin(app, enabled, {
  platform = process.platform,
  isPackaged = app.isPackaged,
  executablePath = process.execPath,
  isInstalled = fs.existsSync(path.join(path.dirname(executablePath), "resources", "mi-installed")),
  isolated = Boolean(app.commandLine?.hasSwitch("user-data-dir") || process.env.MI_USER_DATA_DIR),
} = {}) {
  if (!launchAtLoginSupported(platform, isPackaged, isInstalled && !isolated)) {
    return { supported: false, enabled: enabled === true };
  }
  app.setLoginItemSettings({
    openAtLogin: enabled === true,
    path: executablePath,
  });
  return readLaunchAtLogin(app, { platform, isPackaged, executablePath, isInstalled, isolated, fallbackEnabled: enabled });
}

function initializeLaunchAtLogin(app, configStore, options = {}) {
  const settings = configStore.getSettings();
  const current = readLaunchAtLogin(app, { ...options, fallbackEnabled: settings.launchAtLogin });
  if (!current.supported) return current;
  if (settings.launchAtLoginConfigured) {
    return readLaunchAtLogin(app, { ...options, fallbackEnabled: settings.launchAtLogin });
  }
  const status = setLaunchAtLogin(app, true, options);
  configStore.updateSettings({ launchAtLogin: status.enabled, launchAtLoginConfigured: true });
  return status;
}

module.exports = {
  initializeLaunchAtLogin,
  launchAtLoginSupported,
  readLaunchAtLogin,
  setLaunchAtLogin,
};
