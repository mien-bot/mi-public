# Public repository review

Reviewed on 2026-10-14, starting from commit `06b0e89`.

## Remaining findings

1. **Critical: dependencies require security updates.** `npm audit --omit=dev` reports 15 affected production dependency entries: 1 critical, 10 high, and 4 moderate. These are dependency findings, not proof that every issue is exploitable through Mi. The pinned Next.js 16.2.11 is affected by the [Windows server remote-code-execution advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36), among other findings. PDF.js 6.1.200 is affected by the [malicious PDF execution advisory](https://github.com/advisories/GHSA-hq66-cqwq-w95j). The audit recommends Next.js 16.4.1; PDF.js needs at least 6.2.108 for the cited advisory. Upgrade and test the full dependency tree before deployment or untrusted document processing. This review does not apply untested dependency upgrades.
2. **Medium: inherited desktop distribution assumptions.** Packaged builds still use the Mi product name, familiar default ports, automatic startup behavior, and installer upgrade hooks. A public build has not been verified to coexist with another installed Mi edition. Use a separate `--user-data-dir` or `MI_USER_DATA_DIR` and a free `STUDIO_ELECTRON_PORT` for evaluation. Do not treat the source as a tested distributable installer.
3. **Medium: integration and agent setup remain studio-specific.** Notion adapters expect particular database titles and property names; the source includes two example per-person hours fields. Some developer comments and agent prompts reference internal documentation or root instructions that are deliberately absent. These references are not bundled private content, but the public onboarding and agent guidance need a complete standalone pass.
4. **Low: no software license or CI workflow.** The source is public, but no new reuse license was selected. Automated repository checks are not configured. Third-party font licenses are retained.

## Corrections made during review

- Desktop Notion sync now defaults to disabled, matching the public configuration and README. Explicitly saved opt-in settings remain enabled.
- The generated `docs/notion-project-map.md` report is ignored because it can contain private Notion metadata. The `notion/` cache was already ignored.
- The README and package metadata now require Node.js 22.13.0 or newer, matching PDF.js requirements.
- The README uses the desktop's Webpack development fallback and explains that browser and desktop development servers must not run simultaneously in one checkout.
- Both `npm run dev` and `npm start` now bind explicitly to `127.0.0.1`; the desktop development shell inherits this restriction. Previously the scripts relied on Next.js's default network binding. Loopback binding does not repair the dependency vulnerabilities.
- The environment example now includes the supported OpenAI API key field, with an empty value.

## Privacy review

The published branch began with a fresh root commit, with no inherited private repository history. Original project/client/lead records, private libraries, and internal documents are absent. Metadata comparisons and manual source searches found no additional confirmed client identities or credentials. Gitleaks reported nine findings; all nine were reviewed as source identifiers or browser-storage key names, not secrets. This is a bounded review, not a guarantee that automated scans can recognize every form of private information.

Generated private records must remain untracked. Do not copy internal docs or workspace snapshots into this repository to repair missing documentation links.

## Validation

- A fresh checkout of the published files completed normal `npm ci` and a production build on Windows with Node.js 24.
- The full suite passed: 1,771 tests. The revised sync opt-in/restart test also passed in a focused 14-test run.
- Lint, empty-content validation, and `git diff --check` passed.
- The build still reports a PDF.js worker externalization warning. PDF preview behavior in a packaged desktop window was not retested in this review.
- The public repository alone was changed; no private project data or external Notion/Dropbox records were modified.
