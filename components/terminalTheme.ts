import type { ITheme } from "@xterm/xterm";

/** Resolve the same surface tokens used by the app; keep ANSI status colors legible. */
export function currentTerminalTheme(): ITheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const dark = root.getAttribute("data-mi-theme") === "dark";
  const background = token("--background", "#07111b");
  const foreground = token("--foreground", "#dbe7ef");
  const accent = token("--accent", "#75aed7");
  return {
    background, foreground, cursor: accent, cursorAccent: background,
    selectionBackground: dark ? "#7f9faf66" : "#50709044",
    selectionInactiveBackground: dark ? "#7f9faf33" : "#50709022",
    black: dark ? "#17212b" : "#171717",
    red: dark ? "#ef8d8a" : "#a51e2c",
    green: dark ? "#9ac7a1" : "#27643c",
    yellow: dark ? "#b7b0f0" : "#655394",
    blue: accent, magenta: dark ? "#b7a6db" : "#704291",
    cyan: dark ? "#7fc6d4" : "#096b7a", white: dark ? "#dbe7ef" : "#565656",
    brightBlack: dark ? "#94a6b4" : "#666666",
    brightRed: dark ? "#f2aaa7" : "#b3261e",
    brightGreen: dark ? "#b5d9ba" : "#28683c",
    brightYellow: dark ? "#cbc6f4" : "#655394",
    brightBlue: token("--link", accent), brightMagenta: dark ? "#ccbde8" : "#704291",
    brightCyan: dark ? "#a2d9e1" : "#096b7a", brightWhite: foreground,
  };
}
