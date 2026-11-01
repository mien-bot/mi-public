# Mi native AutoCAD bridge

Native C# add-in and Mi terminal MCP integration for **full AutoCAD 2027**. It is a separate
adapter from [the Revit bridge](../revit/README.md): it shares Mi's project pairing, preview
and confirmation rules, but none of Revit's API calls or threading.

## Compatibility, as verified

Installed product: AutoCAD 2027, update 26.0.118 (`ACAD-A101`). `accoremgd`, `acdbmgd`, and
`acmgd` are assembly version 26.0.0.0 and reference System.Runtime 10.0, so the add-in targets
`net10.0-windows`. `acad.exe` was observed hosting CoreCLR 10.0.9. Autodesk's
[AutoCAD 2027 SDK notes](https://blog.autodesk.io/autocad-2027-sdk-what-every-plugin-developer-needs-to-know/)
agree, and state that ObjectARX access is single-threaded.

Not supported or not tested: AutoCAD LT (no .NET API), releases before 2027, and vertical
toolsets. `PackageContents.xml` declares `Platform="AutoCAD"` for series `R26.0` only; loading in a
vertical has not been tried. All testing ran under an Education entitlement; the commercial
sign-in Alex intends to use has not been tested yet.

## Autodesk's bundled MCP server is not used

AutoCAD 2027 ships `AutoCAD-MCP-Server-2027.bundle`. Inspection of its assemblies shows an
HTTP server on `localhost` that acts on the active document, with no authentication strings,
and a reference to `ModelContextProtocol.AspNetCore`, which the bundle does not contain.
It cannot provide Mi's exact project/document routing, native confirmation, or stale-preview
rejection. Mi leaves it untouched and depends on nothing in it.

## Build and install

Developer prerequisites: AutoCAD 2027, .NET 10 SDK, and the existing STUDIO signing certificate
in the local Windows store. `npm run build:autocad` compiles, signs, and hashes the payload
into ignored `integrations/autocad/artifacts/2027/`. No Autodesk assembly is copied.
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
3. Connect the exact drawing and answer the dialog in AutoCAD, once per drawing.
4. Claude opens in a terminal window for the project, briefed and ready. Ask for what you want.
   A running agent is reused, and it reaches a reconnected drawing on its next call. **More
   options** has Codex and Claude launch commands to paste into the project terminal, or run
   `tools/cad.ps1 -Engine codex` (`claude`) from a new shell.

Launches allow Mi's CAD tools without the CLI's own per-tool prompt (`--allowedTools mcp__mi_cad`,
Codex `default_tools_approval_mode`), because Mi's review decides each edit. That covers only these
tools; the agent's shell and file tools keep their normal prompts. If the connection ends, the
terminal window offers **Reconnect** for an open file of the same name, which still needs one Yes.

A project can hold one Revit model and one AutoCAD drawing at once, and one agent sees both
tool families. All four terminal sessions of a project share the pairing. A drawing belongs
to one project at a time per pairing.

## Identity and routing

Every open document receives a random session identity from the bridge. File names are not
identity. Requests name the document, so activating another drawing never changes the target:
reads continue against the paired drawing, and an edit is refused until that drawing is active
so its review can be seen. Close, reopen, or Save As ends the pairing, and restarting AutoCAD
or stopping the bridge ends all of them. Mi then reports that a reconnect is required.

Requests are serialized through a dispatcher on AutoCAD's main thread. Anything arriving while
a command, dialog, or script is running is refused, reads included.

## Tools

`acad_query` kinds: `status` (units, UCS, extents, current layer), `selection`, `layers`,
`layouts`, `blocks`, `entities` (filters: `space`, `layer`, `type`, `text`), and `entity`.
Lists page at up to 200 items; `entities` scans at most 100,000 per space. Geometry details exist
for line, polyline (first 200 vertices), circle, arc, text, mtext, dimension, hatch, and block
reference with attributes (hatch is implemented but has not been exercised on a live hatch).
Other entity types return common properties only.

`acad_preview_edit` operations: `create_layer`, `create_line`, `create_polyline` (2–500 points
with one elevation, optional bulges for curved segments), `create_circle`, `create_arc`,
`create_text`, `create_mtext`, `create_leader` (a real multileader: arrow, landing, height, text),
`move`, `copy`, `erase`, `set_layer`, and `batch` (1–200 of the
others under one review; all or nothing, one `U`, and a layer created earlier in the batch can be
used later in it). Angles are degrees counterclockwise from +X. Text is literal. Coordinates
and offsets are **WCS drawing units**. `status` reports `INSUNITS` and the UCS, and each review
states the units. Targets are 1–50 explicit handles directly in model or paper space. Viewports,
xref inserts, entities on locked layers, and contents of block definitions are refused.

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

The application's dialog takes over when Mi is closed, no window has this project's terminal open,
the add-in predates this, or Mi restarted since pairing. Connecting again restores review in Mi.
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
