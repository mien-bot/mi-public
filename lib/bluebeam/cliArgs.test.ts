import { describe, expect, it } from "vitest";
import { parseCliArgs, parseStatusMapArg } from "./cliArgs";

describe("parseStatusMapArg", () => {
  it("parses a comma-separated raw=schema list", () => {
    expect(parseStatusMapArg("Open=open,Void=addressed,ToDo=open")).toEqual({
      Open: "open",
      Void: "addressed",
      ToDo: "open",
    });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseStatusMapArg(" Open = open , Void = addressed ")).toEqual({
      Open: "open",
      Void: "addressed",
    });
  });

  it("ignores empty segments", () => {
    expect(parseStatusMapArg("Open=open,,Void=addressed")).toEqual({ Open: "open", Void: "addressed" });
  });
});

describe("parseCliArgs", () => {
  it("parses --flag=value and --flag value forms identically", () => {
    const a = parseCliArgs(["--project=SampleStudio", "--csv=export.csv"]);
    const b = parseCliArgs(["--project", "SampleStudio", "--csv", "export.csv"]);
    expect(a.project).toBe("SampleStudio");
    expect(b.project).toBe("SampleStudio");
    expect(a.csv).toBe("export.csv");
    expect(b.csv).toBe("export.csv");
  });

  it("treats --apply as a boolean with no following value consumed", () => {
    const args = parseCliArgs(["--apply", "--project", "SampleStudio"]);
    expect(args.apply).toBe(true);
    expect(args.project).toBe("SampleStudio");
  });

  it("no longer recognizes --skip-unresolved as a known flag (partial apply is not supported)", () => {
    const args = parseCliArgs(["--apply", "--skip-unresolved", "--project", "SampleStudio"]);
    expect(args).not.toHaveProperty("skipUnresolved");
    // Unknown --flag tokens are still consumed by the generic tokenizer
    // (it doesn't reject unrecognized flags), but must not disturb other,
    // known flags around them.
    expect(args.apply).toBe(true);
    expect(args.project).toBe("SampleStudio");
  });

  it("builds a fixed-value mapping field from --<field>", () => {
    const args = parseCliArgs(["--discipline", "architectural", "--revision", "3"]);
    expect(args.mapping.discipline).toEqual({ value: "architectural" });
    expect(args.mapping.revision).toEqual({ value: "3" });
  });

  it("builds a column mapping field from --map-<field>", () => {
    const args = parseCliArgs(["--map-sheet", "Page Label"]);
    expect(args.mapping.sheet).toEqual({ column: "Page Label" });
  });

  it("builds a status mapping with column + status-map", () => {
    const args = parseCliArgs(["--map-status", "Status", "--status-map", "Open=open,Void=addressed"]);
    expect(args.mapping.status).toEqual({
      column: "Status",
      statusMap: { Open: "open", Void: "addressed" },
    });
  });

  it("recognizes -h and --help", () => {
    expect(parseCliArgs(["-h"]).help).toBe(true);
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["--project", "x"]).help).toBe(false);
  });

  it("parses --confirm-project", () => {
    const args = parseCliArgs(["--apply", "--confirm-project", "SampleStudio"]);
    expect(args.confirmProject).toBe("SampleStudio");
  });

  it("passes a fixed --status value through as typed, unnormalized (case normalization happens in mapping.ts)", () => {
    const args = parseCliArgs(["--status", "Open"]);
    expect(args.mapping.status).toEqual({ value: "Open" });
  });
});
