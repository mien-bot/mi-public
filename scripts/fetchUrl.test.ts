import { describe, expect, it } from "vitest";
import { formatProvenance, parseFetchUrlArgs } from "./fetchUrl";

describe("mi fetch argument parsing", () => {
  it("defaults to auto mode and no side effects", () => {
    expect(parseFetchUrlArgs(["https://www.chicago.gov/sbif"])).toEqual({
      help: false,
      url: "https://www.chicago.gov/sbif",
      mode: "auto",
      refresh: false,
      json: false,
      outPath: "",
    });
  });

  it("accepts mode, refresh, json, and an output path in any order", () => {
    expect(parseFetchUrlArgs(["--refresh", "--mode", "browser", "https://studio.work", "--out", "page.json"]))
      .toEqual({
        help: false,
        url: "https://studio.work",
        mode: "browser",
        refresh: true,
        json: false,
        outPath: "page.json",
      });
  });

  it("shows help with no arguments or an explicit flag", () => {
    expect(parseFetchUrlArgs([]).help).toBe(true);
    expect(parseFetchUrlArgs(["--help"]).help).toBe(true);
    expect(parseFetchUrlArgs(["-h"]).help).toBe(true);
  });

  it("refuses an unknown mode, an unknown flag, and a second URL", () => {
    expect(() => parseFetchUrlArgs(["https://example.org", "--mode", "psychic"])).toThrow(/auto, http, or browser/i);
    expect(() => parseFetchUrlArgs(["https://example.org", "--sudo"])).toThrow(/Unknown option/i);
    expect(() => parseFetchUrlArgs(["https://a.example", "https://b.example"])).toThrow(/exactly one URL/i);
    expect(() => parseFetchUrlArgs(["https://example.org", "--out"])).toThrow(/--out needs a file path/i);
  });
});

describe("provenance reporting", () => {
  it("states the tier, status, final URL, and retrieval time so a fact can be dated", () => {
    const text = formatProvenance({
      final_url: "https://www.chicago.gov/city/en/depts/dcd/sbif.html",
      status: 200,
      tier: "http",
      content_type: "text/html; charset=utf-8",
      retrieved_at: "2026-08-06T12:00:00.000Z",
      from_cache: false,
      text_characters: 8_412,
      link_count: 88,
      tier_notes: ["Tier 1 (local HTTP client) returned 200."],
    });
    expect(text).toContain("Tier 1 (local HTTP client) returned 200.");
    expect(text).toContain("Tier: http · HTTP 200 · text/html; charset=utf-8");
    expect(text).toContain("Final URL: https://www.chicago.gov/city/en/depts/dcd/sbif.html");
    expect(text).toContain("Retrieved at: 2026-08-06T12:00:00.000Z");
    expect(text).toContain("Extracted 8412 character(s) and 88 link(s).");
  });

  it("says plainly that a rendered page carries no HTTP status", () => {
    const text = formatProvenance({
      final_url: "https://studio.work/",
      status: null,
      tier: "browser",
      content_type: "text/html",
      retrieved_at: "2026-08-06T12:00:00.000Z",
      from_cache: true,
      text_characters: 3_100,
      link_count: 12,
      tier_notes: [],
    });
    expect(text).toContain("no HTTP status (rendered DOM)");
    expect(text).toContain("(from cache)");
  });
});
