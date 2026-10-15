const http = require("node:http");

/**
 * How long one probe waits for the first byte of a response.
 *
 * Long enough that a genuinely slow first render is retried rather than failed, short
 * enough that a wedged server still trips the overall deadline.
 */
const SERVER_PROBE_TIMEOUT_MS = 15_000;

/**
 * Resolves once Mi's local server answers, rejects once it clearly will not.
 *
 * The socket timeout is the point of this module. A server that accepts the connection and
 * then never answers is exactly the failure a startup gate exists to catch, and it was the
 * one failure the original loop could not see: with only a `response` and an `error`
 * handler, a connected-but-silent server fires neither, so the promise never settles and
 * the overall deadline is unreachable. Mi sat behind a blank window indefinitely instead of
 * reporting that it could not start. Every probe now has its own deadline, so a stalled
 * server surfaces as an error the caller can show.
 */
function waitForServer(url, options = {}) {
  const {
    timeoutMs = 60_000,
    probeTimeoutMs = SERVER_PROBE_TIMEOUT_MS,
    retryDelayMs = 300,
    // Lets the caller surface a server that already died rather than waiting out the clock.
    failure = () => null,
    get = http.get,
    now = () => Date.now(),
    delay = (fn, ms) => setTimeout(fn, ms),
  } = options;

  const started = now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const known = failure();
      if (known) {
        reject(known);
        return;
      }
      const request = get(url, (response) => {
        response.destroy();
        resolve();
      });
      request.setTimeout(probeTimeoutMs, () => {
        request.destroy(new Error("Mi local server accepted the connection but did not answer."));
      });
      request.on("error", () => {
        if (now() - started > timeoutMs) reject(new Error("Mi local server did not start in time."));
        else delay(check, retryDelayMs);
      });
    };
    check();
  });
}

module.exports = { SERVER_PROBE_TIMEOUT_MS, waitForServer };
