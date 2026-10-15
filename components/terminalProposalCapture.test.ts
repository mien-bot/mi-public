import { describe, expect, it } from "vitest";
import {
  latestTerminalProposalBlock,
  projectSlugFromTerminalCwd,
  terminalBufferText,
} from "./terminalProposalCapture";

describe("terminal proposal capture", () => {
  it("reassembles xterm-wrapped JSON rows", () => {
    const lines = [
      { isWrapped: false, text: '{"version":1,"propo' },
      { isWrapped: true, text: 'sals":[]}' },
      { isWrapped: false, text: "prompt>" },
    ];
    expect(terminalBufferText({
      length: lines.length,
      getLine: (index) => {
        const line = lines[index];
        return line && {
          isWrapped: line.isWrapped,
          translateToString: () => line.text,
        };
      },
    })).toBe('{"version":1,"proposals":[]}\nprompt>');
  });

  it("uses the latest literal proposal block", () => {
    const first = '```mi-proposals\n{"version":1,"proposals":[]}\n```';
    const second = '```mi-proposals\n{"version":1,"proposals":[{"id":"new"}]}\n```';
    expect(latestTerminalProposalBlock(`${first}\nresearch\n${second}`)).toBe(second);
  });

  it("recovers a rendered JSON envelope when Markdown fences are absent", () => {
    const envelope = '{"version":1,"proposals":[{"id":"proposal-one"}]}';
    expect(latestTerminalProposalBlock(`Research complete.\n${envelope}\nprompt>`))
      .toBe(`\`\`\`mi-proposals\n${envelope}\n\`\`\``);
  });

  it("limits capture controls to exact project terminal workspaces", () => {
    expect(projectSlugFromTerminalCwd("projects/studio-marketing")).toBe("studio-marketing");
    expect(projectSlugFromTerminalCwd("projects\\studio-marketing")).toBe("studio-marketing");
    expect(projectSlugFromTerminalCwd("leads/studio-marketing")).toBeNull();
    expect(projectSlugFromTerminalCwd("projects/../other")).toBeNull();
  });
});
