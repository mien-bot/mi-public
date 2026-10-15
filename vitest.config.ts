import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // The default 5s is not enough for the PDF.js-backed tests when the whole suite runs at
    // once: importing pdfjs-dist dominates a full run, and under that load extraction tests
    // that pass in ~1s on their own intermittently time out. They then fail for a reason that
    // has nothing to do with what they assert, which trains everyone to ignore a red suite.
    testTimeout: 30_000,
    // Exclude nested git worktrees (e.g. .claude/worktrees/*) used by
    // concurrent sessions — not this project's own test files.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.claude/**",
      "**/dist-installer/**",
      "**/.tmp/**",
      "**/.tmp-agent-*",
    ],
  },
});
