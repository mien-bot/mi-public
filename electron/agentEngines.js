// Per-engine config for the chat widget's one-shot (non-interactive) CLI
// invocations — separate from the persistent-shell terminal feature in
// main.js. Flags and JSONL event shapes below were verified against the
// actual installed `claude`/`codex` binaries on 2026-07-25 (claude-code
// 2.1.220), not guessed from docs — re-verify with `--help` if either CLI
// is upgraded and this breaks.
//
// Claude: we generate the session id ourselves (a fresh UUID) and pass it
// via --session-id on the first turn, --resume on every turn after — so we
// always know the id in advance. Codex assigns its own thread id and only
// reports it in the first turn's `thread.started` event, so we must read it
// back out of that engine's own stdout instead.
//
// Prompt delivery: BOTH engines' `prompt` is a positional argv argument per
// `--help` (claude: `[prompt]`, codex: `exec [PROMPT]`), never an `-p`/`-m`
// *value* — but buildArgs() below never puts the prompt on argv at all.
// Once project/codes context got stitched into the prompt (see
// electron/agentContext.js), prompts became large multi-line blocks, and
// passing that through argv on Windows (spawn's shell:true concatenates
// everything into one command-line string handed to cmd.exe) broke —
// embedded newlines and command-line length limits made the CLI exit
// immediately. Same fix scripts/agent.ts already uses: write the prompt to
// the child's stdin instead (both CLIs read the prompt from stdin when no
// positional prompt/`-` is given — see main.js's agent:send handler).
const crypto = require("node:crypto");

function extractJsonLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const claudeEngine = {
  command: "claude",
  // Claude requires a real UUID up front for --session-id; codex doesn't
  // need this (it mints its own), so this hook only does something here.
  prepareSessionId(existingSessionId) {
    return existingSessionId || crypto.randomUUID();
  },
  // model: e.g. "claude-sonnet-5" / "claude-opus-5" / an alias like "sonnet"
  // — verified against `claude --help`'s --model flag (2026-07-25). No
  // `images` support here — claude has no --image flag; main.js instead
  // notes attached file paths in the prompt text for claude's own Read tool.
  buildArgs({ sessionId, isNewSession, model, readOnly = false }) {
    const args = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose"];
    if (readOnly) args.push("--permission-mode", "plan", "--tools", "Read,Glob,Grep");
    if (model) args.push("--model", model);
    args.push(isNewSession ? "--session-id" : "--resume", sessionId);
    return args;
  },
  // Called with each raw stdout chunk. Chunks aren't guaranteed to align
  // with line boundaries, so the caller must line-buffer before calling
  // this (see main.js) — assume `line` is always one complete JSON line.
  extractDelta(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return "";
    }
    if (
      obj.type === "stream_event" &&
      obj.event?.type === "content_block_delta" &&
      obj.event.delta?.type === "text_delta"
    ) {
      return obj.event.delta.text || "";
    }
    return "";
  },
  parseFinalOutput(stdout) {
    const events = extractJsonLines(stdout);
    const result = [...events].reverse().find((e) => e.type === "result");
    if (!result) return { text: "", sessionId: null, isError: true };
    return {
      text: typeof result.result === "string" ? result.result : "",
      sessionId: result.session_id || null,
      isError: !!result.is_error,
    };
  },
};

const codexEngine = {
  command: "codex",
  prepareSessionId(existingSessionId) {
    return existingSessionId || null; // codex assigns its own on first turn
  },
  // model: e.g. "gpt-5.1-codex" — verified against `codex exec --help`'s
  // -m/--model flag (also present on `codex exec resume`, 2026-07-25).
  // images: absolute file paths already written to disk by main.js — codex
  // natively attaches these via repeated -i flags (verified via --help,
  // present on both `codex exec` and `codex exec resume`).
  buildArgs({ sessionId, model, images, readOnly = false, skipGitRepoCheck = false }) {
    const sandboxMode = readOnly ? "read-only" : "workspace-write";
    const fastModeArgs = [
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
    ];
    const args = sessionId
      ? [
          "exec",
          "resume",
          "-c",
          `sandbox_mode="${sandboxMode}"`,
          "-c",
          'approval_policy="never"',
          ...fastModeArgs,
        ]
      : ["--sandbox", sandboxMode, "--ask-for-approval", "never", "exec"];
    if (!sessionId) args.push(...fastModeArgs);
    if (skipGitRepoCheck) args.push("--skip-git-repo-check");
    if (model) args.push("--model", model);
    for (const imagePath of images || []) args.push("-i", imagePath);
    if (sessionId) args.push(sessionId);
    // "-" (not omitted) makes the PROMPT positional explicit even though
    // stdin-by-default would do the same — keeps intent obvious.
    args.push("-", "--json");
    return args;
  },
  // Codex reports the full reply in one `item.completed` event per turn
  // (not token-by-token), so this "delta" is really the whole message —
  // the chat bubble will pop in at once rather than stream in gradually.
  extractDelta(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return "";
    }
    if (obj.type === "item.completed" && obj.item?.type === "agent_message") {
      return obj.item.text || "";
    }
    return "";
  },
  parseFinalOutput(stdout) {
    const events = extractJsonLines(stdout);
    let sessionId = null;
    let text = "";
    let isError = false;
    for (const event of events) {
      if (event.type === "thread.started") sessionId = event.thread_id || null;
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        text = event.item.text || "";
      }
      if (event.type === "error" || event.type === "turn.failed") isError = true;
    }
    return { text, sessionId, isError };
  },
};

const ENGINES = { claude: claudeEngine, codex: codexEngine };

function getEngine(name) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`Unknown agent engine: ${name}`);
  return engine;
}

module.exports = { getEngine };
