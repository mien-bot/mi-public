# Mi native Revit bridge

Native C# add-in and Mi terminal MCP integration. No pyRevit, IronPython, Python,
or developer SDK is required on the installation machine. This is the first native
slice of the [migration plan](../../docs/cad-mcp-native-revit-plan.md), not a complete
port of Alex's ribbon library. AutoCAD is a [separate adapter](../autocad/README.md).

## Build and install

The current target is **Revit 2026.5, API 26.5.0.0, .NET 10**. The installed API
assemblies were inspected and compiled against; earlier Revit 2026 builds and
Revit 2022/2025 require separate builds. The original .NET 8 planning assumption
does not apply to this installed 26.5 API.

Developer prerequisites: matching Revit API assemblies, .NET 10 SDK, and the
existing STUDIO internal signing certificate in the local Windows certificate store.
Run `npm run build:revit`. No Autodesk assemblies are copied into the payload.

Outputs (ignored by Git):

- `integrations/revit/artifacts/2026/`: signed DLL, dependency manifest, hashes,
  and standalone installer script.
- `dist-installer/Mi-Revit-0.1.0-api26.5.zip`: standalone per-user installation package.

Close Revit. Extract the ZIP and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-MiRevit.ps1
```

This verifies the payload hashes, installed Revit API version, and STUDIO signature.
The signing identity must already be trusted on the machine; the installer does not
change certificate trust or application security settings. It installs in a
versioned `%LOCALAPPDATA%\Mi\Revit\2026\` directory and registers the application
in `%APPDATA%\Autodesk\Revit\Addins\2026\Mi.Native.addin`.

For removal use the same script with `-Action Uninstall`. This removes only the
owned registration, retaining versioned payloads and the existing pyRevit extension.
Mi's **Set up MCP > Install / repair Revit add-in** performs the same per-user
workflow from a Windows Mi build containing the payload. Windows desktop packaging
now builds and includes the native payload; macOS packaging remains separate.

## Use

1. Start Revit and open the intended model. The native connection is under
   **Add-Ins > Mi CAD > Mi CAD Connection**; Stop revokes all native pairings.
2. In the updated Mi desktop app, open the project's terminal and **Set up MCP**.
3. Select the exact model and confirm the pairing dialog in Revit, once per model.
4. Copy the Codex or Claude launch command into the project's terminal. Newly
   opened project shells can also use `tools/cad.ps1 -Engine codex` or `claude`.
   Run the helper with PowerShell; it reads the per-session `MI_CAD_LAUNCHER` path.
   With the project paired, **Start Claude** instead opens a dedicated window with only Mi's
   CAD tools. Set up MCP shows whether the add-in is installed, missing, or behind this Mi build.
5. Ask the agent to inspect the model. Each edit appears at the top of Mi's terminal window
   to apply or decline, or in a Revit dialog when Mi cannot show it. No model save or sync
   occurs. See [Reviewing edits in Mi](../autocad/README.md#reviewing-edits-in-mi).

Pairings are deliberately invalidated by closing/reopening a document or restarting
the native bridge. Mi remembers the last selection but displays reconnect-required
when the native session is gone. One model can belong to only one Mi project in a
native session. All requests execute serially on the Revit API thread.

The generated launch settings remain in Mi's local user-data directory. They add
one MCP server to that agent launch and preserve existing provider configuration;
they do not edit global `.codex/config.toml` or `.mcp.json`. The stdio host uses Mi's
bundled Electron executable in Node mode, so a separately installed Node runtime is
not required. The optional agent CLI itself still needs to be installed.

## Tools and boundaries

`revit_query` supports status, selection, categories, elements, element parameters,
types, instances, views, levels, sheets/viewports, schedules/cells, warnings, rooms, links,
worksets, and revisions. Lists expose pagination. Schedule cell reads explicitly
report truncation at 50 rows / 20 columns. Bounding boxes and offsets use internal
feet. Element parameters include their storage types and raw values.

`revit_preview_edit` prepares one of:

- Create one straight basic wall with explicit type, level, endpoints, and height.
- Set one writable instance text/integer parameter, selected by parameter ID.
- Move or copy 1–50 explicit unpinned, ungrouped, non-view/non-type/non-link elements.
- Delete explicit elements only; dependency cascades roll back.
- Duplicate an element type without modifying existing instances.

`revit_apply_edit` consumes a single-use preview. It expires after two minutes or
any document change. The Revit dialog shows the model, project, targets, and change;
agent-supplied confirmation flags are rejected. Revit warnings/errors roll back the
transaction rather than silently accepting failure resolutions. Request expiration
is checked again after the dialog and before commit. An interrupted connection can
leave a committed result unknown to the caller: inspect before retrying.

There is no arbitrary code, unrestricted HTTP forwarding, save/sync, or cloud API
write endpoint. IPC uses current-Windows-user named pipes, not a LAN listener.
This is an application authority boundary, not a sandbox against arbitrary code
already running as the same Windows account. Interactive CAD work still requires
professional review.

## Migration ledger

The native API consolidates similar operations rather than copying every old MCP
tool name. "Implemented" below describes source behavior; live evidence is recorded
separately in the handoff. Unsupported tools are not advertised to MCP clients.

| Existing MCP tools | Native disposition |
|---|---|
| status, selection, categories, elements, element | Implemented as query kinds; numeric category and parameter IDs |
| views, schedules, schedule, sheets, sheet | Implemented as query kinds; schedule cells remain explicitly bounded |
| warnings, rooms, find_types, instances_of_type | Implemented as warnings/rooms/types/instances queries |
| links, worksets, revisions | Implemented as query kinds |
| duplicate_type, copy_element, delete_element, move_elements | Implemented as preview/apply operations with narrower guards |
| set_instance_params | One instance text/integer parameter per preview; measured/reference/batch edits pending |
| find_text, keynote_info, wall_panels | Pending native port |
| copy_to_locations, set_type_params, change_family_category | Pending native port |
| set_category_visibility, tag_untagged | Pending native port |
| duplicate_family_as_category, swap_panel | Pending native port |
| remove_schedule_filter, add_grid_lines, add_grid_segments | Pending native port |
| key_schedule_preview, key_schedule_apply | Pending dedicated port preserving source-conflict/receipt semantics |

The additional HTTP-only visibility, crop, view-range, schedule, geometry, and family
handlers remain in the existing pyRevit extension. Native ribbon ports appear on the
**Mi Tools** tab beside the untouched pyRevit tab. Native tools are compiled but not yet
exercised in a live model. The native connection ribbon command is new; existing keyboard
shortcuts are not imported or overwritten.

| Ribbon command | Native status |
|---|---|
| Go To Sheet, Zoom Selected, Pin Links, Duplicate Marks, Dim Overrides | Ported, live test pending |
| MCP Server | Superseded by the native bridge |
| The other 33 commands, including Warnings Report | Pending; pyRevit only |

## Verification

`npm test` includes CAD contract, protocol, installer, project routing, and lifecycle
tests. `npm run test:desktop:cad` opens an isolated Electron profile, a session-2
pop-out, and Edge against the same local server; it uses an owned project fixture
and archives it under `.tmp` after closing the test app. It does not bind or edit a
production Revit model. Native live tests must use a separate disposable model.

Never replace live model verification with a handshake, compile result, or mocked
test. See the current handoff for the exact evidence and remaining acceptance work.
