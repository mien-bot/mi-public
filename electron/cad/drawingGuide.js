// Shipped working guidance for agents using the CAD tools. Facts here come from live drawing
// sessions; a person's accepted lessons are appended by lessons.js.
const GUIDE = `# Mi CAD drawing guide

## Start
- Query status first. State INSUNITS and whether the UCS is world before using coordinates.
- Query layers, blocks, and extents. Place new work clear of existing extents unless asked otherwise.
- Pair the exact model or drawing. Mi targets AutoCAD 2027 only, and other installed releases do not
  load the bridge. An AutoCAD title bar showing Education is not for firm work: say so.

## Plan the drawing before sending it
- Choose real size first. Draw at 1:1 in drawing units. Annotation height follows plot scale: for
  1/2" = 1'-0" (factor 24), 3/32" text is 2.25" in the model.
- Tracing an image: calibrate from a dimension shown in it. Measure pixels across that dimension,
  derive one scale, and report the result. Define one transform and route every point through it.
- Say what is traced, simplified, or left out. Do not imply accuracy the source cannot support.
- Separate work by layer: frame, glazing, concrete, insulation, metal, membrane, annotation. Use
  distinct colors, because color is what distinguishes materials until fills and linetypes exist.

## Sending edits
- Use one batch for related work: 1-200 edits, all or nothing, one review, one U reverses it.
- Put create_layer first in the batch; later edits may use those layers.
- Split a large drawing into logical batches of about 150 or fewer so each can be reviewed.
- Tell the person a review is coming before applying. It appears at the top of Mi's terminal
  window, or in the CAD application if Mi cannot show it, and declines itself if left unanswered.
  If it times out while the application is still starting, send a fresh preview once it is ready.
- A preview goes stale on any drawing change, so preview and apply together.
- Never retry an uncertain apply. Inspect the drawing first.

## Annotation
- Use create_leader for every callout, never a line beside text. It makes a real multileader the
  person can move and restyle. Give arrow (the thing named) and landing (where the text starts).
- Put multi-line wording in one leader using a newline, not stacked text objects.
- Keep landings in aligned columns, roughly even vertical spacing, and leaders from crossing.
- Point the arrow at the object itself, not at empty space near it.
- Use create_text only for labels with no target, such as titles and INTERIOR or EXTERIOR.

## Current limits: say these plainly
- No hatch: show insulation with crossing lines and leave concrete unfilled. Mention both.
- No linetypes: dashed flashing is a solid colored line. Mention it.
- No dimension objects: lines plus text are not associative. Mention it.
- No view of the drawing: you read coordinates, not the picture. Say the result was not visually
  checked and ask the person to run ZOOM then E and review it.
- No save, plot, or undo tool. The person saves, and one U reverses the last edit. U removes the
  most recent batch first, so warn before asking for undo after several batches.

## After applying
- Read back and count: layers plus entities should equal the committed handles.
- Check a sample of geometry, not just the outcome field.
- Report what was verified and what was not. The reply must not claim it looks right.

## Improving this guide
Call cad_propose_lesson with one specific, reusable finding when a session teaches something, such
as a refusal, a limit, or a correction from the person. It waits for the person's approval in
Set up MCP. Propose nothing about project data, client names, or credentials.`;

module.exports = { GUIDE };
