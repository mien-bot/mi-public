import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const { waitForServer } = require("./serverProbe.js");

const servers: http.Server[] = [];

/** Starts a loopback server and returns its origin. */
async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("waitForServer", () => {
  it("resolves as soon as the server answers", async () => {
    const url = await listen((_req, res) => res.end("ok"));

    await expect(waitForServer(url, { timeoutMs: 5_000 })).resolves.toBeUndefined();
  });

  it("rejects a server that accepts the connection and never answers", async () => {
    // The regression. Without a per-probe socket timeout neither callback fires, the
    // promise never settles, and Mi waits behind a blank window forever.
    const url = await listen(() => {
      /* accept the request, then hold it open and say nothing */
    });

    await expect(
      waitForServer(url, { timeoutMs: 1_500, probeTimeoutMs: 250, retryDelayMs: 10 }),
    ).rejects.toThrow("Mi local server did not start in time.");
  });

  it("retries a refused connection until the server appears", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const pending = waitForServer(url, { timeoutMs: 5_000, retryDelayMs: 25 });
    // Nothing is listening yet, so the probe must keep retrying rather than give up.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

    await expect(pending).resolves.toBeUndefined();
  });

  it("gives up once the overall deadline passes", async () => {
    await expect(
      waitForServer("http://127.0.0.1:1/", { timeoutMs: 0, retryDelayMs: 5 }),
    ).rejects.toThrow("Mi local server did not start in time.");
  });

  it("surfaces a server that already died instead of waiting out the clock", async () => {
    const cause = new Error("Mi local server exited during startup (code 1).");

    await expect(
      waitForServer("http://127.0.0.1:1/", { failure: () => cause }),
    ).rejects.toThrow("Mi local server exited during startup (code 1).");
  });
});
