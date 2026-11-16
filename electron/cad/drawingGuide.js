// Shipped working guidance for agents using the CAD tools. Facts here come from live drawing
// sessions; a person's accepted lessons are appended by lessons.js.
const GUIDE = `# Mi CAD drawing guide

## Start
- Query status first. State INSUNITS and whether the UCS is world before using coordinates.
- Query layers, blocks, and extents. Place new work clear of existing extents unless asked otherwise.
- Pair the exact model or drawing. Mi supports full AutoCAD 2024 and 2027; status reports which
  release is connected. LT, verticals, and other releases do not load the bridge. An AutoCAD title
  bar showing Education is not for firm work: say so.

## Units are sometimes wrong
- INSUNITS is a label, not proof. Before trusting it, check one known size: a dimension's
  measurement against its text, a door (about 3' or 900 mm), a sheet border, or a grid spacing.
- INSUNITS 0 (no units) or a label that contradicts the geometry: say what you found and ask the
  person what the drawing is really in. Do not guess.
- Between drawings, copy_from_drawing and attach_xref scale from the source's INSUNITS to the
  target's automatically and state the factor in the review. When either label is missing or
  wrong, pass unit_scale with the factor the person confirmed, and say so in one line.
- Read the review's size line: a 30 m plan arriving as 30 mm means the units are wrong.

## Between drawings
- copy_from_drawing copies natively: blocks, hatches, dimensions, layers, and styles survive.
  Prefer it to redrawing from coordinates. Layers or blocks of the same name already in the
  target keep the target's settings; the review lists them.
- Choose what to copy by handles from a query, or by source_area, such as a viewport's modelArea.
  base_point in the source lands at position in the target.
- attach_xref references a saved drawing instead of copying it: use it for backgrounds that
  change, such as a structural grid under an architectural plan. Overlay (the default) does not
  carry into drawings that reference this one. It shows the file as last saved.
- Both need the two drawings open in the same AutoCAD. Use acad_open_drawing to bring one there.

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

## Editing existing text
- Find it first: query entities with text (matches TEXT, MTEXT, and leader wording) or kind entity.
- edit_text with find and replace changes only that wording and keeps MTEXT formatting; text
  replaces everything and drops formatting. Say which you used.
- Block attributes use set_attribute with the TAG names from an entity query. Table cells use
  set_table_cells.

## Tables
- Use create_table for schedules, legends, and data, never lines plus text. Give a title, set
  header true for column names, and use column_widths sized to the longest entry at the text height.
- Rows and columns count from 0, and a title is row 0. Read the table back with kind entity.
- To add rows later, set_table_cells with cells appends them; cell_updates changes existing cells.

## Charts
- create_chart draws bar, line, or pie charts as plain geometry, hatches, and text: it is a
  picture, not linked data. Put the numbers in a table beside it when the person needs them.
- Values must be zero or positive. Size the chart in drawing units for its plot scale, and leave
  room below and left of the position for labels. Give a distinct color per pie slice.

## Hatches, dimensions, blocks
- create_hatch fills a closed boundary (SOLID or a predefined pattern) and is not associative:
  it does not follow later boundary edits. Pattern scale follows plot scale like text height.
- create_dimension uses the drawing's current dimension style and measures the real geometry.
  Use it instead of lines plus text. Rotated (rotation_degrees) is linear; otherwise aligned.
- insert_block needs a block already defined in the drawing; query blocks for names and tags.
- mirror keeps the originals by default and mirrors text too; check readability after.

## Current limits: say these plainly
- No linetypes: dashed flashing is a solid colored line. Mention it.
- No new text or dimension styles, and no external block files: only what the drawing has.
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
