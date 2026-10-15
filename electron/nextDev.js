/**
 * Electron's development shell uses Webpack deliberately. On this application, Next 16's
 * Turbopack dev server can remain stuck compiling the first `/` request indefinitely, leaving
 * Electron with a blank window. Webpack is Next's documented development fallback and does not
 * affect production builds or the standalone runtime.
 */
function nextDevArgs(port) {
  return ["run", "dev", "--", "--webpack", "-p", String(port)];
}

/** Keep a source checkout from attaching to an already-running installed Mi on port 3050. */
function desktopPort({ packaged, override }) {
  return override || (packaged ? "3050" : "3051");
}

module.exports = { desktopPort, nextDevArgs };
