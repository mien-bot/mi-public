import { describe, expect, it } from "vitest";
import { remoteRouteDecision } from "./policy";
describe("remote route policy", () => {
  it("allows only the dedicated read-only viewer and APIs", () => {
    for (const route of ["/", "/remote", "/api/mobile/status", "/api/mobile/projects", "/api/mobile/projects/example", "/api/mobile/projects/example/pdf"]) {
      expect(remoteRouteDecision("GET", route).allowed, route).toBe(true);
      expect(remoteRouteDecision("HEAD", route).allowed, route).toBe(true);
      for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) expect(remoteRouteDecision(method, route).allowed).toBe(false);
    }
  });
  it("blocks private pages, alternate paths, desktop APIs and mutations", () => {
    for (const route of ["/projects/example", "/projects", "/personal", "/leads", "/search", "/settings", "/terminal", "/projects/example/terminal", "/api/dropbox-file/example/file.pdf", "/api/projects/example/files", "/api/chat/history", "/api/mobile/projects/example/other", "/api/mobile/projects/../private", "/_next/data/build/projects.json", "/_next/image"]) expect(remoteRouteDecision("GET", route).allowed, route).toBe(false);
  });
});
