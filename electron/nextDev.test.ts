import { describe, expect, it } from "vitest";

// CommonJS module used by Electron's main process.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { desktopPort, nextDevArgs } = require("./nextDev");

describe("Electron Next.js development launch", () => {
  it("uses Next's Webpack fallback so the desktop window does not hang on first compile", () => {
    expect(nextDevArgs("3050")).toEqual([
      "run",
      "dev",
      "--",
      "--webpack",
      "-p",
      "3050",
    ]);
  });

  it("keeps development separate from an installed Mi already serving port 3050", () => {
    expect(desktopPort({ packaged: false })).toBe("3051");
    expect(desktopPort({ packaged: true })).toBe("3050");
    expect(desktopPort({ packaged: false, override: "4010" })).toBe("4010");
  });
});
