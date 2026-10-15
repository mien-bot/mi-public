# Mi

**A local-first workspace for architecture project operations.**

Mi brings project information, schedules, meeting notes, documents, review tasks, and optional AI assistance into one workspace. It is built for the day-to-day coordination work around architectural projects: keeping decisions findable, tracking deliverables, preparing reviews, and turning notes into actions that a person can inspect and approve.

This repository is a sanitized source edition. It starts with empty data folders and contains no original project records, client files, private workspace configuration, or original Git history.

## What you can do

- **Organize projects:** maintain project details, milestones, budgets, checklists, questions, decisions, site reports, and deliverables.
- **Manage incoming work:** track leads, meeting notes, draft proposals, and permit QA/QC engagements.
- **Review documents:** work with PDF previews, drawing indexes, markup records, and document review workflows.
- **Keep knowledge together:** maintain local Markdown/YAML records and searchable project context.
- **Plan your work:** use project schedules, a personal workspace, and review inboxes for proposed changes.
- **Connect optional services:** link explicitly selected Notion records and locally synced Dropbox folders.
- **Use optional AI tools:** draft summaries, plans, and proposed edits with supported agent connections. The Electron desktop also provides project terminals and pop-out workspaces.

AI proposals and external writes use review and confirmation boundaries. Project identities and external folder/page mappings must be supplied by the user.

## How it works

The React interface runs in Next.js. Server routes read and validate local records and handle bounded operations. The Electron shell adds native windows, local settings, encrypted credential storage, terminals, and CLI-agent processes. Many pages also work in a browser; native desktop features require Electron.

| Directory | Purpose |
| --- | --- |
| `app/` | Pages and API routes |
| `components/` | User interface and workspace controls |
| `lib/` | Content validation, project operations, AI proposals, themes, and documents |
| `electron/` | Desktop lifecycle, secure settings, terminal sessions, and agent execution |
| `src/` | CLI domain logic, adapters, policies, and services |
| `scripts/`, `bin/` | Development tools and command-line entry points |
| `installer/` | Packaging hooks and agent-workspace templates |
| `public/`, `assets/` | App icons, fonts, and static assets |

The stack includes TypeScript, Next.js 16, React 19, Electron, Tailwind CSS, Zod, Vitest, and xterm.js.

## Run locally

Use Node.js 22 or newer and npm. Native desktop dependencies may need platform build tools. Windows is the primary development target; the presence of macOS packaging scripts does not establish a tested macOS release.

```bash
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. The public copy starts without projects or connections. Create your own records through the app. Optional configuration keys are documented in `.env.example`; save your values in an untracked `.env.local` or use desktop Settings.

To start the desktop development shell:

```bash
npm run electron:dev
```

The desktop shell manages its own local server. Native features such as terminal sessions and agent processes are available there. Codex and Claude CLI integrations require their respective tools to be installed and authenticated separately.

## Connections and data

Notion and Dropbox are optional. There are no bundled Notion database IDs, credentials, or project-folder mappings. Configure your own integrations and confirm each link. The public configuration disables automatic Notion sync and includes explicit external-write allowlists; retain only the operations you intend to use after reviewing `mi.config.yaml` and the adapter schemas.

Some adapters expect particular Notion property names and studio-oriented database titles. Review `src/adapters/notion/` before connecting an existing workspace. This is a source starting point, not a universal migration tool.

Project/client/lead records, local state, credentials, generated documents, and build output are ignored by Git. Keep private working data outside any public repository. The optional remote-access configuration is disabled by default; local development should stay bound to loopback.

## Development checks

```bash
npm run lint
npm test
npm run validate-content
npm run build
```

Desktop packaging starts with `npm run build:desktop`. Configure your own signing and distribution settings before producing a release; internal signing settings and installers are not included here.

## Public edition scope

Included: application source, sanitized test fixtures, generic templates, static app assets, dependency manifests, and empty content directories. Excluded: live project/client/lead/permit records, internal documentation and handoffs, private reference libraries, logs, chat archives, local settings, credentials, signing metadata, installers, and previous commits.

Contract and compliance workflows produce working drafts for professional review. Bundled third-party fonts retain their original license notices in `public/fonts/`. No additional software license is granted by this repository; choose a license before redistributing or incorporating the source into another product.
