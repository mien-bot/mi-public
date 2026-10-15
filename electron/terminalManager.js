function clampDimension(value, fallback) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 1000) : fallback;
}

const DEFAULT_SCROLLBACK_BYTES = 512_000;

function normalizeSessionKey(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 240 || /[\u0000-\u001f]/.test(value)) {
    throw new Error("Invalid terminal session key.");
  }
  return value;
}

function shellArgsFor(shell, platform = process.platform) {
  if (platform !== "win32" || !/(^|[\\/])cmd(?:\.exe)?$/i.test(shell)) return [];
  // Keep a plain `codex` command in Codex's documented inline TUI mode.
  // Alternate-screen redraws are unstable in xterm.js-based terminals on
  // Windows, while inline mode also makes Mi's scrollback useful.
  return [
    "/Q",
    "/K",
    'doskey codex=codex --no-alt-screen -c service_tier="fast" -c features.fast_mode=true $*',
  ];
}

function appendReplayOutput(current, data, limit) {
  const next = current + data;
  if (next.length <= limit) return next;
  const start = next.length - limit;
  const tail = next.slice(start);
  if (next[start - 1] === "\n") return tail;
  const firstCompleteLine = tail.indexOf("\n");
  return firstCompleteLine >= 0 ? tail.slice(firstCompleteLine + 1) : tail;
}

function createTerminalManager({
  pty,
  resolveCwd,
  send,
  shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : process.env.SHELL || "/bin/bash",
  platform = process.platform,
  env = process.env,
  sessionEnvironment = () => ({}),
  scrollbackBytes = DEFAULT_SCROLLBACK_BYTES,
  history,
  maxTerminals = 24,
}) {
  const terminals = new Map();
  const sessions = new Map();
  let nextId = 1;

  function emit(channel, payload) {
    // A closing renderer must never take down all the other terminals.
    try { send(channel, payload); } catch { /* The next view receives replay. */ }
  }

  function flush(state) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.pendingHistory || !history || !state.sessionKey) return;
    try {
      history.append(state.sessionKey, state.cwd, state.pendingHistory);
      state.pendingHistory = "";
    } catch {
      // Keep a bounded retry buffer and make failure visible without logging output.
      state.pendingHistory = state.pendingHistory.slice(-scrollbackBytes);
      emit("terminal:data", { id: state.id, data: "\r\n[Mi: terminal history could not be saved locally.]\r\n" });
    }
  }

  function operate(state, action) {
    try { action(); } catch {
      emit("terminal:data", { id: state.id, data: "\r\n[Mi: the shell connection failed. Reopen this session if it has stopped responding.]\r\n" });
    }
  }

  function create({ cwd, cols, rows, sessionKey: rawSessionKey }) {
    const sessionKey = normalizeSessionKey(rawSessionKey);
    const resolvedCwd = resolveCwd(cwd);
    const existingId = sessionKey ? sessions.get(sessionKey) : null;
    const existing = existingId ? terminals.get(existingId) : null;
    if (existing) {
      if (existing.workspace !== cwd) {
        throw new Error("Terminal session is already attached to a different workspace.");
      }
      const nextCols = clampDimension(cols, 80);
      const nextRows = clampDimension(rows, 24);
      if (existing.cols !== nextCols || existing.rows !== nextRows) {
        operate(existing, () => existing.terminal.resize(nextCols, nextRows));
        existing.cols = nextCols;
        existing.rows = nextRows;
      }
      const moved = existing.cwd !== resolvedCwd
        ? "\r\n[Mi: this project's confirmed folder has changed. This running shell has not been moved. Finish any running work, then use Restart shell to open the current folder.]\r\n"
        : "";
      return { id: existingId, replay: existing.output + moved, reused: true };
    }

    if (terminals.size >= maxTerminals) {
      throw new Error(`Mi already has ${maxTerminals} running terminal sessions. Exit an unused shell before opening another.`);
    }
    const id = nextId++;
    const agentSessionId = sessionKey || `terminal-${Date.now()}-${id}`;
    const initialCols = clampDimension(cols, 80);
    const initialRows = clampDimension(rows, 24);
    let restored = "";
    if (sessionKey && history) {
      try { restored = history.load(sessionKey, resolvedCwd); }
      catch { restored = "\r\n[Mi: saved terminal history could not be read.]\r\n"; }
    }
    if (restored) restored += "\x1b[0m\r\n[Mi: recovered output. A new shell starts below; previous running commands were not restarted.]\r\n";
    const terminal = pty.spawn(shell, shellArgsFor(shell, platform), {
      name: "xterm-256color",
      cols: initialCols,
      rows: initialRows,
      cwd: resolvedCwd,
      env: {
        ...env,
        ...sessionEnvironment({ cwd, resolvedCwd, sessionKey: agentSessionId }),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        MI_AGENT_SESSION_ID: agentSessionId,
      },
      useConpty: platform === "win32",
    });

    const state = {
      id,
      terminal,
      cwd: resolvedCwd,
      workspace: cwd,
      sessionKey,
      output: restored,
      pendingHistory: "",
      saveTimer: null,
      cols: initialCols,
      rows: initialRows,
    };
    terminals.set(id, state);
    if (sessionKey) sessions.set(sessionKey, id);
    terminal.onData((data) => {
      state.output = appendReplayOutput(state.output, data, scrollbackBytes);
      if (history && sessionKey) {
        state.pendingHistory += data;
        if (state.pendingHistory.length >= 64_000) flush(state);
        else if (!state.saveTimer) {
          state.saveTimer = setTimeout(() => flush(state), 250);
          state.saveTimer.unref?.();
        }
      }
      emit("terminal:data", { id, data });
    });
    terminal.onExit(({ exitCode, signal }) => {
      flush(state);
      terminals.delete(id);
      if (sessionKey && sessions.get(sessionKey) === id) sessions.delete(sessionKey);
      emit("terminal:exit", { id, exitCode, signal });
    });

    return { id, replay: restored, reused: false };
  }

  function write(id, data) {
    const state = terminals.get(id);
    if (state && typeof data === "string") operate(state, () => state.terminal.write(data));
  }

  function resize(id, cols, rows) {
    const state = terminals.get(id);
    if (!state) return;
    const nextCols = clampDimension(cols, 80);
    const nextRows = clampDimension(rows, 24);
    if (state.cols === nextCols && state.rows === nextRows) return;
    operate(state, () => state.terminal.resize(nextCols, nextRows));
    state.cols = nextCols;
    state.rows = nextRows;
  }

  function kill(id) {
    const state = terminals.get(id);
    if (!state) return;
    terminals.delete(id);
    if (state.sessionKey && sessions.get(state.sessionKey) === id) sessions.delete(state.sessionKey);
    flush(state);
    operate(state, () => state.terminal.kill());
  }

  function killAll() {
    for (const id of [...terminals.keys()]) kill(id);
  }

  return { create, write, resize, kill, killAll };
}

module.exports = { appendReplayOutput, createTerminalManager, shellArgsFor };
