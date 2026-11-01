// Edit reviews shown in Mi's terminal windows instead of a dialog inside Revit or AutoCAD.
//
// The MCP server is a child of the agent, and the agent has a shell, so nothing the MCP server
// holds or relays can count as a person's answer. Mi's main process is outside that reach: the
// approval secret lives only in its memory (see service.js), and it spends that secret only after
// a person presses Apply in Mi's own window. The summary shown comes from the add-in, keyed by the
// one-use preview token, so an agent cannot show one change and apply another.
//
// Anything short of a visible review returns { handled: false }, and the MCP server falls back to
// the application's own dialog. Nothing here makes an edit easier to apply without a person.
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { WORKSPACE } = require("./nativeClient");

const TOKEN = /^[a-f0-9]{32}$/;
const REVIEW_MS = 90_000;
const SHOWN_MS = 1_500;
const MAX_REQUEST = 4096;

function createReviewBroker({ describe, apply, notify, close, reviewMs = REVIEW_MS, shownMs = SHOWN_MS }) {
  const pending = new Map();
  function finish(id, outcome) {
    const review = pending.get(id);
    if (!review) return false;
    pending.delete(id);
    clearTimeout(review.shownTimer); clearTimeout(review.answerTimer);
    close(id);
    review.resolve(outcome);
    return true;
  }
  async function request({ workspace, application, token }, cancelled) {
    if (!WORKSPACE.test(workspace) || !["revit", "autocad"].includes(application) || !TOKEN.test(token)) return { handled: false };
    const detail = await describe(workspace, application, token).catch(() => null);
    if (!detail) return { handled: false };
    const id = crypto.randomUUID();
    const public_ = { id, workspace, application, title: detail.title, summary: detail.summary, expiresAt: Date.now() + reviewMs };
    const answer = await new Promise(resolve => {
      const review = { resolve, public_, shown: false, token };
      pending.set(id, review);
      review.shownTimer = setTimeout(() => finish(id, "unseen"), shownMs);
      review.answerTimer = setTimeout(() => finish(id, "timeout"), reviewMs);
      cancelled?.(() => finish(id, "cancelled"));
      notify(public_);
    });
    if (answer === "unseen") return { handled: false };
    if (answer !== "approved") {
      const reason = answer === "timeout" ? "The review timed out with no answer." : answer === "cancelled" ? "The request was cancelled." : "The person declined.";
      return { handled: true, response: { outcome: "declined", changed: false, reason } };
    }
    // Past this point the outcome can be unknown, so it is never reported as unhandled.
    try { return { handled: true, response: await apply(workspace, application, token) }; }
    catch (error) { return { handled: true, error: error instanceof Error ? error.message : String(error) }; }
  }
  return {
    request,
    list: () => [...pending.values()].map(review => review.public_),
    /** A window has the review on screen. Until one does, the application's dialog stays the fallback. */
    shown(id) {
      const review = pending.get(id);
      if (!review) return false;
      review.shown = true; clearTimeout(review.shownTimer);
      return true;
    },
    answer(id, approved) { return finish(id, approved === true ? "approved" : "declined"); },
    cancelAll() { for (const id of [...pending.keys()]) finish(id, "cancelled"); },
  };
}

/** Serves one request per connection on a random pipe, and records the name for MCP servers to find. */
function serveReviews({ broker, file, createServer = net.createServer }) {
  const pipe = `mi-cad-review-${crypto.randomBytes(16).toString("hex")}`;
  const server = createServer(socket => {
    let text = "";
    let cancel = null;
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("close", () => cancel?.());
    socket.on("data", async chunk => {
      if (text === null) return;
      text += chunk;
      if (text.length > MAX_REQUEST) { socket.destroy(); return; }
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      const line = text.slice(0, newline);
      text = null;
      let outcome = { handled: false };
      try { outcome = await broker.request(JSON.parse(line), run => { cancel = run; }); } catch { /* Malformed: the application's dialog still applies. */ }
      if (!socket.destroyed) socket.end(JSON.stringify(outcome) + "\n");
    });
  });
  server.on("error", () => {});
  server.listen(`\\\\.\\pipe\\${pipe}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pipe }) + "\n");
  return {
    pipe,
    stop() {
      broker.cancelAll(); server.close();
      try { fs.rmSync(file, { force: true }); } catch { /* A stale file only fails to connect, which falls back. */ }
    },
  };
}

/**
 * Asks Mi for a review. Mi being closed is ordinary: { handled: false }. A connection that drops
 * after Mi took the request is not, because the edit may have run, so that rejects rather than
 * letting the caller fall through to a second attempt.
 */
function requestReview(file, request, { timeoutMs = 120_000, connect = net.createConnection } = {}) {
  let pipe;
  try {
    pipe = JSON.parse(fs.readFileSync(file, "utf8")).pipe;
    if (!/^mi-cad-review-[a-f0-9]{32}$/.test(pipe)) return Promise.resolve({ handled: false });
  } catch { return Promise.resolve({ handled: false }); }
  return new Promise((resolve, reject) => {
    let connected = false, settled = false, text = "";
    const socket = connect(`\\\\.\\pipe\\${pipe}`);
    const timer = setTimeout(() => done(() => reject(new Error("Mi did not answer the review. Its outcome may be unknown: inspect the drawing or model before retrying."))), timeoutMs);
    function done(settle) { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); settle(); }
    socket.setEncoding("utf8");
    socket.once("connect", () => { connected = true; socket.write(JSON.stringify(request) + "\n"); });
    socket.on("data", chunk => {
      text += chunk;
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      try { const outcome = JSON.parse(text.slice(0, newline)); done(() => resolve(outcome)); }
      catch { done(() => reject(new Error("Invalid review response. Inspect the drawing or model before retrying."))); }
    });
    socket.on("error", () => { if (!connected) done(() => resolve({ handled: false })); });
    socket.on("close", () => done(() => connected
      ? reject(new Error("Mi closed during the review. Inspect the drawing or model before retrying."))
      : resolve({ handled: false })));
  });
}

module.exports = { createReviewBroker, serveReviews, requestReview, REVIEW_MS };
