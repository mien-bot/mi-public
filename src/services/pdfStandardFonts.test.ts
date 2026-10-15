import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemBinaryDataFactory, standardFontOptions } from "./pdfStandardFonts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("pdf.js standard font data", () => {
  it("points pdf.js at a real font directory, with the trailing slash it validates", () => {
    const options = standardFontOptions();
    expect(options.standardFontDataUrl?.endsWith("/")).toBe(true);
    expect(options.BinaryDataFactory).toBe(FilesystemBinaryDataFactory);
    expect(fs.existsSync(path.join(options.standardFontDataUrl ?? "", "LiberationSans-Regular.ttf"))).toBe(true);
  });

  it("reads font data straight off disk, whatever pdf.js thinks it is running under", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-fonts-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "Some-Regular.ttf"), Buffer.from([1, 2, 3]));
    const factory = new FilesystemBinaryDataFactory({ standardFontDataUrl: `${root}/` });
    await expect(factory.fetch({ kind: "standardFontDataUrl", filename: "Some-Regular.ttf" }))
      .resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it("keeps a data-derived file name inside the font directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-fonts-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "secret.txt"), "not a font");
    const factory = new FilesystemBinaryDataFactory({ standardFontDataUrl: `${path.join(root, "fonts")}/` });
    await expect(factory.fetch({ kind: "standardFontDataUrl", filename: "../secret.txt" }))
      .rejects.toThrow(/Unable to load/);
  });

  it("reports an unconfigured kind rather than inventing a path", async () => {
    const factory = new FilesystemBinaryDataFactory({ standardFontDataUrl: "/fonts/" });
    await expect(factory.fetch({ kind: "wasmUrl", filename: "jbig2.wasm" }))
      .rejects.toThrow(/`wasmUrl` API parameter is provided/);
  });
});
