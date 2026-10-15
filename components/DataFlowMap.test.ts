import { describe, expect, it } from "vitest";
import { layoutDataFlowNodes } from "./DataFlowMap";

describe("data-flow layout", () => {
  it("lays every source around the center and scales nodes by volume", () => {
    const positioned = layoutDataFlowNodes([
      { id: "small", label: "Small", value: 1 },
      { id: "large", label: "Large", value: 100 },
    ]);
    expect(positioned).toHaveLength(2);
    expect(positioned[1].radius).toBeGreaterThan(positioned[0].radius);
    expect(positioned.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it("handles empty and zero-volume sources without invalid geometry", () => {
    expect(layoutDataFlowNodes([])).toEqual([]);
    expect(layoutDataFlowNodes([{ id: "zero", label: "Zero", value: 0 }])[0].radius).toBe(18);
  });
});
