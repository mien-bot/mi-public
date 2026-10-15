# Optional connections

The empty app can be explored without a Notion token or Dropbox folder. Add credentials
through desktop Settings or an ignored `.env.local` using `.env.example` as a starting point.
Never paste credentials into an agent prompt, issue, fixture, or tracked config.

## Notion

Confirm each data source and project page with the user. Desktop sync defaults to off;
enabling it is an explicit choice. Missing snapshots are not evidence that the workspace is
empty. External writes still require an allowed operation in `mi.config.yaml` and the exact
preview/confirmation flow; enabling a connection is not blanket write approval.

The current adapters are not schema-agnostic:

- Project title discovery expects `Studio Projects`; schedule discovery expects `STUDIO Schedule`.
- Explicit project/schedule data source IDs are supported by setup and mapping flows, but not
  every legacy adapter uses the same discovery path. Check the operation you intend to run.
- Lead operations read `NOTION_LEADS_DATABASE_ID`; add it only to your private environment
  when needed. There is no bundled lead database.
- Property names and select options are defined in `src/adapters/notion/` and checked by
  `electron/notionSetup.js`. The example per-person hours fields need adaptation to your schema.

Use read-only probing and review any schema mismatch before enabling writes. Do not rename
or create a real database merely to satisfy an example. `mi notion map --write` creates a
local cache and a Markdown report; both outputs are private and ignored by Git.

## Dropbox and local data

Dropbox here means a locally synced folder selected by the user. Confirm the root and each
relative `dropbox_path`; never infer links by a similar name. Shared-data migration has its
own preview and confirmation. A matching local file hash does not prove cloud sync finished.

Generated agent instructions and context belong to the private workspace, not this public
repository. Read [harness maintenance](harness-maintenance.md) before refreshing them.

## Agent tools and remote access

CLI integrations require separately installed and authenticated tools. Use their private
credential stores, not copied credentials in workspace files. Never silently switch provider.

Remote access is disabled by default. Keep it disabled while the security findings in
[the review](public-review.md) remain unresolved. Loopback binding is not a vulnerability fix.
Public-source availability does not authorize publication of a running private workspace.
