import { describe, expect, it } from "vitest";
import { plainTerminalText, terminalColumns } from "./terminalPlainCopy";

// Lays text out the way an agent CLI does: greedy word wrap inside a gutter.
function wrap(text: string, width: number, first: string, rest = " ".repeat(first.length)) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const prefix = lines.length ? rest : first;
    if (line && prefix.length + line.length + 1 + word.length > width) {
      lines.push(prefix + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push((lines.length ? rest : first) + line);
  return lines;
}

const PARAGRAPH =
  "Thanks for sending over the revised drawings for the Example Boulevard project. I reviewed the mechanical layout and have a few comments before we submit.";
const ITEM = "The duct run on level 2 conflicts with the beam at grid line C. Can we drop it below the beam?";

function claudeReply(width: number) {
  return [
    "● Hi Sarah,",
    "",
    ...wrap(PARAGRAPH, width, "  "),
    "",
    ...wrap(ITEM, width, "  - ", "    "),
    "  - Please confirm the RTU weight.",
    "",
    "  Best,",
    "  Alex",
  ].join("\n");
}

const EXPECTED = [
  "Hi Sarah,",
  "",
  PARAGRAPH,
  "",
  `- ${ITEM}`,
  "- Please confirm the RTU weight.",
  "",
  "Best,",
  "Alex",
].join("\n");

describe("plain terminal copy", () => {
  it("removes the reply gutter and rejoins lines the CLI wrapped", () => {
    expect(plainTerminalText(claudeReply(60), 60)).toBe(EXPECTED);
    expect(plainTerminalText(claudeReply(100), 100)).toBe(EXPECTED);
  });

  it("still rejoins after the terminal was widened, such as a pop-out", () => {
    expect(plainTerminalText(claudeReply(60), 140)).toBe(EXPECTED);
    expect(plainTerminalText(claudeReply(60))).toBe(EXPECTED);
  });

  it("keeps short intended lines apart and strips their indent", () => {
    expect(plainTerminalText("  Best,\n  Alex\n", 80)).toBe("Best,\nAlex");
    expect(plainTerminalText("    Regards,\n    Example User\n    STUDIO", 80)).toBe("Regards,\nExample User\nSTUDIO");
  });

  it("keeps nested list indentation relative to the reply", () => {
    const nested = ["  - Level 2", "    - Duct conflicts with the beam", "  - Level 3"].join("\n");
    expect(plainTerminalText(nested, 80)).toBe(["- Level 2", "  - Duct conflicts with the beam", "- Level 3"].join("\n"));
  });

  it("keeps Windows line endings", () => {
    expect(plainTerminalText(claudeReply(60).replace(/\n/g, "\r\n"), 60)).toBe(EXPECTED.replace(/\n/g, "\r\n"));
  });

  it("joins wrapped Chinese text without inserting spaces", () => {
    const sentence = "感谢您发送修订后的图纸。我已经检查了机械布局，在提交之前有几点意见需要讨论。请确认屋顶设备的重量。";
    const chars = Array.from(sentence);
    const lines: string[] = [];
    let line = "  ";
    for (const char of chars) {
      if (terminalColumns(line) + 2 > 44) {
        lines.push(line);
        line = "  ";
      }
      line += char;
    }
    lines.push(line);
    expect(lines.length).toBeGreaterThan(2);
    expect(plainTerminalText(lines.join("\n"), 44)).toBe(sentence);
  });

  it("returns an empty string for a blank selection", () => {
    expect(plainTerminalText("\n   \n", 80)).toBe("");
  });
});
