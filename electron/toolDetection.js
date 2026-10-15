const { spawn } = require("node:child_process");

const UNSAFE_SHELL_CHARACTERS = /["%!\r\n&|<>^()]/;

function validToolCommand(command) {
  return typeof command === "string" && Boolean(command.trim()) && !UNSAFE_SHELL_CHARACTERS.test(command);
}

function runCli(command, args, { env, spawnImpl = spawn, platform = process.platform } = {}) {
  if (!validToolCommand(command)) return Promise.resolve({ available: false, version: null });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawnImpl(command.trim(), args, {
      env,
      windowsHide: true,
      shell: platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, version: null });
    }, 5_000);
    child.stdout?.on("data", (data) => { output += data.toString("utf8"); });
    child.stderr?.on("data", (data) => { output += data.toString("utf8"); });
    child.on("error", () => {
      clearTimeout(timer);
      finish({ available: false, version: null });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      finish({ available: code === 0, version: code === 0 ? output.trim().slice(0, 200) : null });
    });
  });
}

function detectCli(command, options = {}) {
  return runCli(command, ["--version"], options);
}

async function testCliConnection(kind, command, options = {}) {
  const detected = await detectCli(command, options);
  if (!detected.available) {
    return {
      kind,
      ok: false,
      version: null,
      detail: `${kind === "codex-cli" ? "Codex" : "Claude"} CLI was not found. Check the executable in Advanced settings.`,
    };
  }
  const authArgs = kind === "codex-cli" ? ["login", "status"] : ["auth", "status"];
  const authenticated = await runCli(command, authArgs, options);
  return {
    kind,
    ok: authenticated.available,
    version: detected.version,
    detail: authenticated.available
      ? `${kind === "codex-cli" ? "Codex" : "Claude"} CLI is installed and authenticated.`
      : `${kind === "codex-cli" ? "Codex" : "Claude"} CLI is installed but not authenticated. Sign in from a terminal and test again.`,
  };
}

async function detectOptionalTools({
  codexCommand = "codex",
  claudeCommand = "claude",
  detect = detectCli,
  env,
} = {}) {
  const [codex, claude] = await Promise.all([
    detect(codexCommand, { env }),
    detect(claudeCommand, { env }),
  ]);
  return { codex, claude };
}

module.exports = { detectCli, detectOptionalTools, runCli, testCliConnection, validToolCommand };
