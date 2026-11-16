# Mi native AutoCAD bridge

Native C# add-in and Mi terminal MCP integration for **full AutoCAD 2024 and 2027**. It is a separate
adapter from [the Revit bridge](../revit/README.md): it shares Mi's project pairing, preview
and confirmation rules, but none of Revit's API calls or threading.

## Compatibility, as verified

Installed product: AutoCAD 2027, update 26.0.118 (`ACAD-A101`). `accoremgd`, `acdbmgd`, and
`acmgd` are assembly version 26.0.0.0 and reference System.Runtime 10.0, so the add-in targets
`net10.0-windows`. `acad.exe` was observed hosting CoreCLR 10.0.9. Autodesk's
[AutoCAD 2027 SDK notes](https://blog.autodesk.io/autocad-2027-sdk-what-every-plugin-developer-needs-to-know/)
agree, and state that ObjectARX access is single-threaded.

AutoCAD 2024 (`R24.3`, `acad.exe` 24.3.61, `accoremgd` 24.3.0.0) hosts .NET Framework 4.8, so the
same source also builds for `net48`. That build ships no third-party assembly: AutoCAD 2024's process
has no binding redirects for System.Text.Json's dependencies, so `JsonShim.cs` supplies the JSON
subset the add-in uses, and `Compat.cs` holds every other runtime difference, including the
Framework pipe DACL (current user only, network denied). Both builds go into one bundle,
`Contents/R24.3/` and `Contents/R26.0/`, with one manifest component per series, and each release
loads only its own. Verified live on 2026-11-13 with both releases running at once; see
[Verification](#verification).

Not supported or not tested: AutoCAD LT (no .NET API), releases other than 2024 and 2027 (2022 and
2023 are refused by name), and vertical toolsets. Loading in a vertical has not been tried. All testing ran under an Education entitlement; the commercial
sign-in Alex intends to use has not been tested yet.

## Autodesk's bundled MCP server is not used

AutoCAD 2027 ships `AutoCAD-MCP-Server-2027.bundle`. Inspection of its assemblies shows an
HTTP server on `localhost` that acts on the active document, with no authentication strings,
and a reference to `ModelContextProtocol.AspNetCore`, which the bundle does not contain.
It cannot provide Mi's exact project/document routing, native confirmation, or stale-preview
rejection. Mi leaves it untouched and depends on nothing in it.

## Build and install

Developer prerequisites: AutoCAD 2024 and 2027, the .NET 10 SDK (which builds the `net48` target
against the installed Framework 4.8 reference assemblies), and the existing STUDIO signing certificate
in the local Windows store. `npm run build:autocad` compiles both, signs, and hashes the bundle
into ignored `integrations/autocad/artifacts/bundle/`. No Autodesk assembly is copied.
`npm run build:desktop` builds it for every Windows package.

In Mi: open a project's terminal, **Set up MCP**, and follow the numbered steps. The panel chooses
the application in use, rechecks every few seconds, and names the next step. Close AutoCAD before
installing. This writes `%APPDATA%\Autodesk\ApplicationPlugins\Mi.AutoCAD.bundle`.
No administrator rights are needed. The installer checks payload hashes, that the file is intact
and signed by STUDIO's exact certificate (which need not be trusted on that computer), and the
installed API version. **Remove add-in** deletes only a bundle carrying Mi's
`ProductCode`; an unrelated folder of the same name is refused.

The STUDIO-signed bundle autoloaded from that folder without a security prompt on the test
machine, where the signing certificate is already trusted. Mi never edits `TRUSTEDPATHS`,
`SECURELOAD`, or certificate trust. Another computer may show AutoCAD's own prompt.

## Use

1. Open the intended drawing in AutoCAD. `MICAD` shows the bridge state and can stop it;
   stopping revokes all pairings.
2. In Mi, open the project's terminal and **Set up MCP**. Every open drawing in every running
   AutoCAD is listed as soon as it is found.
3. Tick the drawings the work needs and connect them. AutoCAD asks once for each AutoCAD window.
4. Claude or Codex (the switch beside Start) opens in a free session of the project terminal,
   briefed and ready; from a pop-out it opens in a window of its own. Ask for what you want.
   A running agent is reused, and it reaches a reconnected drawing on its next call. **More
   options** has Codex and Claude launch commands that keep your full MCP setup, to paste into
   the project terminal, or run `tools/cad.ps1 -Engine codex` (`claude`) from a new shell.

Launches allow Mi's CAD tools without the CLI's own per-tool prompt (`--allowedTools mcp__mi_cad`,
Codex `default_tools_approval_mode`), because Mi's review decides each edit. That covers only these
tools; the agent's shell and file tools keep their normal prompts. If the connection ends, the
terminal window offers **Reconnect** for an open file of the same name, which still needs one Yes.

A project can hold one Revit model and several AutoCAD drawings (up to 12) at once, and each agent
sees both tool families. Each agent has one current AutoCAD drawing: `acad_query` kind `drawings` lists them,
and the optional `drawing` argument (a file name or document id) reads or edits another without
changing which is current. Mi resolves that argument and never sends it to the add-in, and an apply
always reaches the drawing its preview was made in. **Switch drawing** in the terminal window
connects open files (each still needs one Yes), makes a connected one current with no dialog, and
disconnects one at a time. All four terminal sessions of a project share the pairing, but each CAD
agent window pins its own current drawing by terminal slot, so several agents can work in different
drawings of one project. Set up MCP's **Start agent** starts an agent for a drawing, or shows the
one already working in it; **Switch drawing** in an agent window changes only that window. A
copied launch command has no slot and follows the project's default drawing. A drawing belongs to
one project at a time.

An agent can also work across drawings on its own. `acad_query` kind `drawings` lists the
drawings open in AutoCAD but not connected (`notConnected`), and `acad_connect_drawings` asks the
person to connect any of them, several at once, with a short reason. Mi looks the files up itself
and shows them in the same review bar and popup as an edit, with **Connect** and **Decline**; the
agent's text is only the reason. Connecting keeps the agent's current drawing and every window's
pin, and each drawing reports its own outcome. `acad_switch_drawing` changes the agent window's
current drawing among connected ones with no review, since reading needs none; Mi records it as
that window's pin, so its banner follows. A window Mi did not start keeps the switch in its MCP
server only.

`acad_open_drawing` asks the person to open a drawing file that is not open yet and connect it,
named by full path or by path in the project folder. Mi resolves the path itself
(`fs.realpathSync.native` on both sides) and refuses anything outside the project's confirmed
Dropbox folder, files that are not `.dwg`, links, and projects with no confirmed folder. A file
already open is connected instead. The review (**Open and connect**) names the AutoCAD release, the
path, read-only or editable, and the reason. Mi picks the AutoCAD that already holds this
project's drawings, or the only one running, and otherwise asks the person to open it themselves.
The add-in's `open` method opens the file (`DocumentManager.Open`, read-only when asked) and pairs
it in one step, so the person answers AutoCAD at most once. It runs from AutoCAD's `Idle` event:
called from the request dispatcher, `Open` fails with "Invalid execution context" even though
AutoCAD reports application context (found live). A modal window such as Drawing Recovery holds
`Idle` back, so an open gives up after 45 seconds with that explanation, and nothing opens.

After the person approves a connection or an open in Mi, AutoCAD's own Yes dialog is skipped when
this project already has a drawing paired and still open in the same AutoCAD and the drawing
belongs to no other project. Mi then sends `trust`, the approval secret it was given when that
earlier drawing was connected. When several drawings connect together, the first in each AutoCAD
creates that secret and the rest present it, so AutoCAD asks once per window. A closed drawing's
secret is never sent, because the add-in dropped its pairing. The secret never leaves Mi's main
process, so only a person's answer in Mi can produce it. Any other case still asks in AutoCAD.

The add-in pairs by project and drawing and reports `features` from `discover`:
`multi-drawing` (several drawings per project), `trusted-connect` (the `trust` above),
`views` (kind `views` and the `area` filter), `open-drawing` (the `open` method), and
`linked-edits` (copy and reference between drawings, kind `xrefs`). An add-in without `multi-drawing` keeps one drawing
per project, so Mi replaces the project's drawing within that session and says the update is
needed; without `views`, Mi refuses those reads instead of letting an older add-in ignore `area`.
`ADDIN_COMPATIBILITY` is unchanged, so these are optional updates, not a forced reinstall.

## Identity and routing

Every open document receives a random session identity from the bridge. File names are not
identity. Requests name the document, so activating another drawing never changes the target:
reads continue against the paired drawing, and an edit is refused until that drawing is active
so its review can be seen. Close, reopen, or Save As ends the pairing, and restarting AutoCAD
or stopping the bridge ends all of them. Mi then reports that a reconnect is required.

Requests are serialized through a dispatcher on AutoCAD's main thread. Anything arriving while
a command, dialog, or script is running is refused, reads included. While one of the add-in's own
dialogs is open, later requests wait behind it; Mi reads that timeout as **Busy**, not as a lost
connection.

## Tools

`acad_query` kinds: `status` (units, UCS, extents, current layer), `drawings`, `views`,
`selection`, `layers`, `layouts`, `blocks`, `entities` (filters: `space`, `layer`, `type`, `text`,
and `area`, `[minX, minY, maxX, maxY]`, which keeps anything whose extents reach into it), and
`entity`. `views` lists each layout viewport (layout, scale, paper area, up to six nearby text
strings such as its title, and the WCS `modelArea` it shows when it looks straight down with no
twist) and each named view (`area` in its space). An elevation set up as a 3D view reports its raw
view instead of an area. The layout's own sheet viewport is left out.
Lists page at up to 200 items; `entities` scans at most 100,000 per space. Geometry details exist
for line, polyline (first 200 vertices), circle, arc, text, mtext, dimension, hatch, and block
reference with attributes, multileader, and table (cell text, row heights, column widths).
Other entity types return common properties only.

`acad_preview_edit` operations: `create_layer`, `create_line`, `create_polyline` (2–500 points
with one elevation, optional bulges for curved segments), `create_circle`, `create_arc`,
`create_text`, `create_mtext`, `create_leader` (a real multileader: arrow, landing, height, text),
`edit_text` (replace all, or find and replace keeping MTEXT formatting, optional height),
`set_attribute`, `create_table` and `set_table_cells` (native tables; edit cells, append rows),
`create_chart` (bar, line, or pie, drawn as lines, polylines, solid hatches, and text),
`create_hatch` (SOLID or a predefined pattern), `create_dimension` (aligned or rotated),
`insert_block` (with attribute values), `move`, `copy`, `rotate`, `scale`, `mirror`, `erase`,
`set_layer`, `set_color`, and `batch` (1–200 of the
others under one review; all or nothing, one `U`, and a layer created earlier in the batch can be
used later in it). Angles are degrees counterclockwise from +X. Text is literal. Coordinates
and offsets are **WCS drawing units**. `status` reports `INSUNITS` and the UCS, and each review
states the units. Targets are 1–50 explicit handles directly in model or paper space. Viewports,
xref inserts, entities on locked layers, and contents of block definitions are refused.

Between drawings, two operations each take a review of their own (never a batch). Both drawings
must be connected to the project and open in the same AutoCAD; Mi resolves `source_drawing` by
name and sends the add-in its document id, and the add-in checks that pairing again and refuses if
the source changed since the preview.

- `copy_from_drawing` copies natively with `WblockCloneObjects`, so blocks, hatches, dimensions,
  layers, and styles come along. Choose `source_handles` (1–1000) or `source_area` in
  `source_space`; `base_point` in the source lands at `position` here. Layers, blocks, and styles of
  the same name already in the target keep the target's definitions, and the review lists them.
- `attach_xref` references a saved drawing as an overlay (default) or attachment, at `position`,
  `rotation_degrees`, on `layer`. The path is stored relative to the host drawing when both are on
  one drive. A file already referenced under that name gets another insert of the same definition.
  `acad_query` kind `xrefs` lists references with path, status, and inserts.

Units: both scale from the source's `INSUNITS` to the target's automatically, and the review states
the factor and the selection's size before and after. If either drawing has no units, they refuse
until the agent passes `unit_scale` (after asking the person); an explicit `unit_scale` also
overrides labels that are wrong, and the review says it was given explicitly.

`acad_apply_edit` consumes a one-use preview. It expires after two minutes or on any drawing
change, except zoom and pan. The review shows the add-in's own summary of the exact change at the
top of Mi's terminal windows for the project, and declines itself after 90 seconds. Approving brings the drawing forward if another is
active. See [Reviewing edits in Mi](#reviewing-edits-in-mi). When Mi cannot show it, AutoCAD shows the review
instead, with No as the default, and declines after 50 seconds so it cannot block later requests.
Agent-supplied confirmation fields are rejected. Failures abort the whole transaction. A
committed edit is one undo group: **one `U` in AutoCAD reverses it**. Agents have no undo tool,
because AutoCAD's undo stack also holds the person's own work.

There is no save, plot, purge, arbitrary code, LISP, or command-string tool. IPC uses
current-Windows-user named pipes. This is an application authority boundary, not a sandbox
against other software running as the same Windows user. If a connection fails during an apply,
the outcome is unknown: inspect the drawing, and never retry automatically.

### Reviewing edits in Mi

An agent has a shell, so a prompt inside its terminal, including MCP elicitation, could be answered
or forged by the agent. Mi's review bar is outside it. At pairing, Mi's main process sends the
add-in a random secret and keeps its copy in memory only, never in settings or on disk. Only after
a person presses **Apply edit** does Mi send that secret with the apply. A wrong secret is refused
without spending the preview, and the MCP server never holds it. The bar takes no keyboard focus
and has no shortcut, because keystrokes in that window belong to the agent's shell.

The same review also appears in a small popup that stays on top of AutoCAD, near the pointer, so it
is seen without switching to Mi. Its page has no scripts. It never takes keyboard focus, so typed keys
cannot answer it, and Mi accepts its answer only for the review it is showing. Answering in either
place closes both.

The application's dialog takes over when Mi is closed, neither the popup nor a terminal window shows
the review within 1.5 seconds, the add-in predates this, or Mi restarted since pairing. Connecting again restores review in Mi.
Pairing stays in the application: it is what proves the person is at the intended drawing and
establishes the secret, so it needs one answer per drawing. A person answering Yes to a pairing
they did not start would hand that secret to whoever asked, and the dialog says so.

`cad_drawing_guide` gives agents the shipped working guide in `electron/cad/drawingGuide.js` plus
lessons the person accepted. `cad_propose_lesson` only queues a lesson; **Set up MCP > Improve the
MCP** is where a person accepts, dismisses, removes, or adds one. Lessons are per-user local data
in Mi's `cad/lessons.json`, and they change agent guidance, never the tools or their safety rules.

## Verification

`npm test` covers the contract, routing, validation, and install ownership.
`npm test` also covers the review broker, its fallback, and that the secret reaches no file.
`npm run test:desktop:cad` opens an isolated Electron profile, a session-2 pop-out, and a browser
against the same server. Neither touches a real drawing. Live evidence and limitations for each
build are recorded in its handoff.
