import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import asar from "@electron/asar";
import { describe, expect, it } from "vitest";

import scan from "./afterPack.cjs";

describe("packaged-output scanner", () => {
  it("accepts safe runtime files and rejects project or credential material", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-package-scan-"));
    try {
      const appRoot = path.join(root, "resources", "app");
      fs.mkdirSync(path.join(appRoot, "electron"), { recursive: true });
      fs.writeFileSync(path.join(appRoot, "electron", "main.js"), "require('./desktopMain')\n");
      await expect(scan({ appOutDir: root })).resolves.toBeUndefined();

      fs.mkdirSync(path.join(appRoot, "projects", "private-client"), { recursive: true });
      fs.writeFileSync(path.join(appRoot, "projects", "private-client", "project.yaml"), "name: Private");
      await expect(scan({ appOutDir: root })).rejects.toThrow(/Forbidden content/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an encoded developer-specific absolute path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-package-path-scan-"));
    try {
      const appRoot = path.join(root, "resources", "app");
      fs.mkdirSync(appRoot, { recursive: true });
      fs.writeFileSync(
        path.join(appRoot, "runtime.json"),
        JSON.stringify({ root: "C:\\Users\\Example User\\Documents\\Projects\\Mi" }),
      );
      await expect(scan({ appOutDir: root })).rejects.toThrow(/Forbidden content/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows the reviewed editable config template while still scanning it for secrets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-package-config-scan-"));
    try {
      const appRoot = path.join(root, "resources", "app");
      fs.mkdirSync(appRoot, { recursive: true });
      fs.writeFileSync(path.join(appRoot, "mi.config.yaml"), "schema_version: 1\nnotion: {}\n");
      await expect(scan({ appOutDir: root })).resolves.toBeUndefined();

      fs.writeFileSync(path.join(appRoot, "mi.config.yaml"), "NOTION_API_KEY=secret_abcdefghijklmnopqrstuvwxyz\n");
      await expect(scan({ appOutDir: root })).rejects.toThrow(/Forbidden content/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans ASAR-packaged application contents with the same policy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-package-asar-scan-"));
    try {
      const source = path.join(root, "source");
      const resources = path.join(root, "resources");
      const archive = path.join(resources, "app.asar");
      fs.mkdirSync(path.join(source, "electron"), { recursive: true });
      fs.mkdirSync(resources, { recursive: true });
      fs.writeFileSync(path.join(source, "electron", "main.js"), "require('./desktopMain')\n");
      await asar.createPackage(source, archive);
      await expect(scan({ appOutDir: root })).resolves.toBeUndefined();

      fs.rmSync(archive);
      fs.mkdirSync(path.join(source, "projects", "private-client"), { recursive: true });
      fs.writeFileSync(
        path.join(source, "projects", "private-client", "project.yaml"),
        "name: Private",
      );
      await asar.createPackage(source, archive);
      await expect(scan({ appOutDir: root })).rejects.toThrow(/Forbidden content/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("also scans the unpacked standalone server runtime", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-package-runtime-scan-"));
    try {
      const appRoot = path.join(root, "resources", "app");
      const runtimeRoot = path.join(root, "resources", "app-runtime");
      fs.mkdirSync(appRoot, { recursive: true });
      fs.mkdirSync(runtimeRoot, { recursive: true });
      fs.writeFileSync(path.join(appRoot, "main.js"), "require('./desktopMain')\n");
      fs.writeFileSync(path.join(runtimeRoot, "server.js"), "require('next')\n");
      await expect(scan({ appOutDir: root })).resolves.toBeUndefined();

      fs.writeFileSync(
        path.join(runtimeRoot, "runtime.json"),
        JSON.stringify({ root: "C:\\Users\\Example User\\Documents\\Projects\\Mi" }),
      );
      await expect(scan({ appOutDir: root })).rejects.toThrow(/Forbidden content/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
