# Start here

Mi combines a Next.js interface, an Electron desktop shell, local Markdown/YAML records,
optional Notion/Dropbox integrations, and optional CLI agents. This public repository starts
with empty content directories and synthetic test fixtures.

1. Read [repository instructions](../AGENTS.md) and [known limitations](public-review.md).
2. Use the [README setup](../README.md#run-locally): Node.js 22.13.0 or newer, `npm ci`, then
   either browser development or the desktop shell. Do not run both in the same checkout.
3. Read [architecture](code-structure-guide.md) before selecting files to change.
4. Review [connections](connections.md) before using any real integration.
5. For agent instructions, edit [canonical harness templates](harness-maintenance.md), not
   generated workspace files.

No private checkout, historical project folder, or internal installer is needed to develop
this edition. Optional missing memory is not permission to import private playbooks.

The dependency, installer, and licensing limitations in the review remain open. This
documentation update does not upgrade dependencies or establish a verified desktop release.
