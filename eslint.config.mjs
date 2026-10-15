import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested git worktree for a concurrent session — not this project's code.
    ".claude/**",
    ".tmp/**",
    ".tmp-agent-*",
    // Electron main/preload are plain CommonJS Node scripts, not part of the
    // Next.js TypeScript app.
    "electron/**",
    // electron-builder output — a packaged copy of the app, not source.
    "dist-installer/**",
  ]),
]);

export default eslintConfig;
