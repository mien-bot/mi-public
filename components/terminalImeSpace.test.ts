import { describe, expect, it } from "vitest";
import { isImeClaimedSpace } from "./terminalImeSpace";

function key(overrides: Partial<KeyboardEvent> = {}) {
  return {
    type: "keydown",
    code: "Space",
    keyCode: 229,
    isComposing: false,
    ...overrides,
  } as Pick<KeyboardEvent, "type" | "code" | "keyCode" | "isComposing">;
}

describe("isImeClaimedSpace", () => {
  it("recognizes the spacebar an IME claimed but did not deliver", () => {
    // What Chromium reports for a key an IME is processing: keyCode 229, key "Process",
    // physical code intact.
    expect(isImeClaimedSpace(key())).toBe(true);
  });

  it("leaves a real composition alone, so space still picks a candidate", () => {
    expect(isImeClaimedSpace(key({ isComposing: true }))).toBe(false);
  });

  it("ignores an ordinary space, which xterm already sends itself", () => {
    expect(isImeClaimedSpace(key({ keyCode: 32 }))).toBe(false);
  });

  it("ignores other IME-claimed keys, which the IME does deliver as text", () => {
    expect(isImeClaimedSpace(key({ code: "KeyA" }))).toBe(false);
    expect(isImeClaimedSpace(key({ code: "Enter" }))).toBe(false);
  });

  it("only acts on keydown", () => {
    expect(isImeClaimedSpace(key({ type: "keyup" }))).toBe(false);
    expect(isImeClaimedSpace(key({ type: "keypress" }))).toBe(false);
  });
});
