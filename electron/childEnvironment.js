const SAFE_KEYS = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "COLORTERM",
  "ComSpec",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "Path",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "windir",
];

function minimizedEnvironment(source = process.env, additions = {}) {
  const result = {};
  const preservedKeys = new Set();
  for (const key of SAFE_KEYS) {
    const normalizedKey = key.toLowerCase();
    if (preservedKeys.has(normalizedKey)) continue;
    if (typeof source[key] === "string") {
      result[key] = source[key];
      preservedKeys.add(normalizedKey);
    }
  }
  for (const [key, value] of Object.entries(additions)) {
    if (value === null || value === undefined || value === "") continue;
    const normalizedKey = key.toLowerCase();
    const existingKey = Object.keys(result).find((candidate) => candidate.toLowerCase() === normalizedKey);
    if (existingKey && existingKey !== key) delete result[existingKey];
    result[key] = String(value);
  }
  return result;
}

function agentEnvironmentForEngine(engine, source = process.env, claudeSubscriptionToken = null, mode = "chat") {
  return minimizedEnvironment(
    source,
    {
      MI_AGENT_MODE: mode,
      ...(engine === "claude" ? { CLAUDE_CODE_OAUTH_TOKEN: claudeSubscriptionToken } : {}),
    },
  );
}

module.exports = { agentEnvironmentForEngine, minimizedEnvironment };
