import { describe, expect, it } from "vitest";
import { terminalClipboardAction } from "./terminalClipboard";

function key(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    type: "keydown",
    ...overrides,
  } as KeyboardEvent;
}

describe("terminal clipboard shortcuts", () => {
  it("copies selected text with Ctrl+C but leaves Ctrl+C available for shell interrupts otherwise", () => {
    expect(terminalClipboardAction(key({ ctrlKey: true, key: "c" }), true, false)).toBe("copy");
    expect(terminalClipboardAction(key({ ctrlKey: true, key: "c" }), false, false)).toBeNull();
  });

  it("supports Windows terminal and standard paste shortcuts", () => {
    expect(terminalClipboardAction(key({ ctrlKey: true, key: "v" }), false, false)).toBe("paste");
    expect(terminalClipboardAction(key({ ctrlKey: true, shiftKey: true, key: "c" }), false, false)).toBe("copy");
    expect(terminalClipboardAction(key({ shiftKey: true, key: "Insert" }), false, false)).toBe("paste");
  });

  it("uses Command+C and Command+V on Apple platforms", () => {
    expect(terminalClipboardAction(key({ metaKey: true, key: "c" }), false, true)).toBe("copy");
    expect(terminalClipboardAction(key({ metaKey: true, key: "v" }), false, true)).toBe("paste");
  });

  it("ignores keyup, Alt-modified input, and unrelated keys", () => {
    expect(terminalClipboardAction(key({ ctrlKey: true, key: "v", type: "keyup" }), false, false)).toBeNull();
    expect(terminalClipboardAction(key({ altKey: true, ctrlKey: true, key: "v" }), false, false)).toBeNull();
    expect(terminalClipboardAction(key({ ctrlKey: true, key: "x" }), true, false)).toBeNull();
  });
});
