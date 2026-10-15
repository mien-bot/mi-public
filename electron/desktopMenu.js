const { nextZoomLevel } = require("./desktopZoom");

function zoomMenuItem(label, accelerator, action) {
  return {
    label,
    accelerator,
    click(_menuItem, window) {
      if (!window || window.isDestroyed()) return;
      const current = window.webContents.getZoomLevel();
      const next = nextZoomLevel(current, action);
      if (next !== current) window.webContents.setZoomLevel(next);
    },
  };
}

function createApplicationMenuTemplate({
  openMainWindow,
  openNewChatWindow,
  openProjectChatWindow,
  quitApp,
  platform = process.platform,
  appName = "Mi",
}) {
  const isMac = platform === "darwin";
  const fileSubmenu = [
    { label: "Open Mi", click: openMainWindow },
    { label: "New Chat Window", accelerator: "CommandOrControl+N", click: openNewChatWindow },
    { label: "Open Compact Chat", click: openProjectChatWindow },
    { type: "separator" },
    { label: "Close Window", role: "close" },
  ];
  if (!isMac) {
    fileSubmenu.push({ label: "Quit Mi", click: quitApp });
  }

  const template = [
    {
      label: "File",
      submenu: fileSubmenu,
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", role: "undo" },
        { label: "Redo", role: "redo" },
        { type: "separator" },
        { label: "Cut", role: "cut" },
        { label: "Copy", role: "copy" },
        { label: "Paste", role: "paste" },
        { type: "separator" },
        { label: "Select All", role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        zoomMenuItem("Actual Size", "CommandOrControl+0", "reset"),
        zoomMenuItem("Zoom In", "CommandOrControl+=", "in"),
        zoomMenuItem("Zoom Out", "CommandOrControl+-", "out"),
        { type: "separator" },
        {
          label: "Full Screen",
          role: "togglefullscreen",
          accelerator: isMac ? "Control+Command+F" : "F11",
        },
      ],
    },
  ];

  if (isMac) {
    template.unshift({
      label: appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { label: `Quit ${appName}`, accelerator: "Command+Q", click: quitApp },
      ],
    });
    template.push({
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    });
  }

  return template;
}

module.exports = { createApplicationMenuTemplate };
