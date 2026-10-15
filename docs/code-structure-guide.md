# Architecture and ownership

| Area | Responsibility |
| --- | --- |
| `app/` | Next.js pages and API routes; compose features and validate requests |
| `components/` | UI, review cards, editors, chat, terminals, and browser/desktop capability checks |
| `lib/content/` | Validated local records, scoped paths, scaffolding, previews, and durable writes |
| `lib/schema.ts` | Shared data contracts; omitted patch fields must not clear existing data |
| `lib/theme/preferences.ts` | Theme validation, persistence, contrast, and motion preferences |
| `lib/agentContext.ts`, `electron/agentContext.js` | Synchronized agent context and prompts |
| `electron/` | Native lifecycle, encrypted settings, CLI processes, terminal sessions, harness generation |
| `src/adapters/`, `src/services/`, `src/policies/` | Integration reads/writes, domain operations, confirmation policy |
| `installer/agent-harness/` | Canonical workspace instruction templates and public references |
| `scripts/`, `bin/` | CLI commands, validation, builds, and verification helpers |

The desktop starts a local Next.js server and exposes narrowly scoped native methods through
preload/IPC. Browser callers have no Electron bridge; desktop-only features must check it.
Agent subprocesses receive only the environment and capabilities appropriate to their role.

The source checkout uses ignored content directories by default. Installed runtime storage,
personal records, and confirmed shared folders are separately resolved. Do not use a missing
shared folder as a reason to silently create a second local source of truth. Keep external
Notion identity separate from local slugs and user-entered display names.

Preview and confirmation are part of write authorization. Hashes/fingerprints guard against
stale review, and multi-item external operations can partially succeed. Report each outcome;
do not imply automatic rollback. Shared-folder writes use durable rename/recovery helpers.

For harness updates and PDF policy, see [harness maintenance](harness-maintenance.md).
For known issues and verification limits, see [the review](public-review.md).
