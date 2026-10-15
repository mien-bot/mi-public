import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // PDF.js resolves its fake worker relative to its own package at runtime. Keeping the package
  // external preserves that relationship in the standalone Electron server instead of bundling
  // the main module without its worker asset.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/projects/*/pdf-inspect": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    // Local fetch extracts fetched PDFs through the same reader, so the packaged
    // standalone server needs the worker asset traced for this route too.
    "/api/local-fetch": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    "/api/projects/*/notion-task": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@napi-rs/canvas/**/*",
      // Replacement data for non-embedded Helvetica/Times/Courier. Without it every such
      // glyph renders as the wrong shape in the page images a person approves a published
      // PDF from -- see src/services/pdfStandardFonts.ts.
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
    ],
  },
  // Electron serves the development UI from the loopback IP rather than localhost.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Keep release builds compatible with restricted Windows environments
    // where Next's default child-process type-check worker cannot spawn.
    workerThreads: true,
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.env*",
      "./.mi/**/*",
      "./.tmp/**/*",
      "./app/**/*",
      "./bin/**/*",
      "./clients/**/*",
      "./codes/**/*",
      "./components/**/*",
      "./docs/**/*",
      "./electron/**/*",
      "./installer/**/*",
      "./leads/**/*",
      "./lib/**/*",
      "./library/**/*",
      "./next.config.*",
      "./notion/**/*",
      "./projects/**/*",
      "./reference/**/*",
      "./scripts/**/*",
      "./src/**/*",
      "./types/**/*",
    ],
  },
  turbopack: {
    // This repository has a parent-directory lockfile on the development machine,
    // so automatic root detection would select the wrong workspace.
    root: __dirname,
  },
};

export default nextConfig;
