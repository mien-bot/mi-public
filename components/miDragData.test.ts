import { describe, expect, it, vi } from "vitest";
import { hasMiDragKind, MI_DRAG_MIME, readMiDragData, setMiDragData } from "./miDragData";

function transfer() {
  const values = new Map<string, string>();
  return {
    values,
    dataTransfer: {
      effectAllowed: "none",
      get types() { return Array.from(values.keys()); },
      setData: vi.fn((type: string, value: string) => values.set(type, value)),
      getData: vi.fn((type: string) => values.get(type) ?? ""),
    } as unknown as DataTransfer,
  };
}

describe("Mi drag payloads", () => {
  it("adds structured and Chromium-compatible payloads", () => {
    const test = transfer();
    setMiDragData(test.dataTransfer, { kind: "schedule-entry", id: "event-1", mode: "move" });
    expect(test.dataTransfer.effectAllowed).toBe("move");
    expect(test.values.get("text/plain")).toBe("event-1");
    expect(hasMiDragKind(test.dataTransfer, "schedule-entry")).toBe(true);
    expect(hasMiDragKind(test.dataTransfer, "portfolio-project")).toBe(false);
    expect(JSON.parse(test.values.get(MI_DRAG_MIME) ?? "{}")).toEqual({
      kind: "schedule-entry",
      id: "event-1",
      mode: "move",
    });
    expect(readMiDragData(test.dataTransfer)).toEqual({ kind: "schedule-entry", id: "event-1", mode: "move" });
  });

  it("ignores foreign and malformed drops", () => {
    const test = transfer();
    test.values.set(MI_DRAG_MIME, "not-json");
    expect(readMiDragData(test.dataTransfer)).toBeNull();
    test.values.set(MI_DRAG_MIME, JSON.stringify({ kind: "unknown", id: "x" }));
    expect(readMiDragData(test.dataTransfer)).toBeNull();
  });
});
