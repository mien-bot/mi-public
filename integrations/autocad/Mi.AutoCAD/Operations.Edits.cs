using System.Globalization;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;

namespace Mi.AutoCad;

// Text editing, tables, charts, hatches, dimensions, transforms, colors, and block inserts. Each
// follows the same contract as the original operations: Describe validates everything and states
// the exact change for the person's review; Perform runs only inside Apply's single transaction,
// so any failure aborts the whole edit and one U reverses a committed one. Nothing here runs
// commands, LISP, or code, and nothing saves.
internal sealed partial class Operations
{
    /// <summary>Operations that create entities through Apply's Add, and so accept color_index.</summary>
    private static readonly HashSet<string> Creates = new(StringComparer.Ordinal)
    {
        "create_line", "create_polyline", "create_circle", "create_arc", "create_text", "create_mtext", "create_leader",
        "create_table", "create_hatch", "create_dimension", "insert_block", "create_chart",
    };
    // Predefined patterns shipped in AutoCAD's acad.pat and acadiso.pat. Names outside this list are refused at preview.
    private static readonly HashSet<string> Patterns = new(StringComparer.OrdinalIgnoreCase)
    {
        "SOLID", "ANSI31", "ANSI32", "ANSI33", "ANSI34", "ANSI35", "ANSI36", "ANSI37", "ANSI38", "AR-B816", "AR-B816C", "AR-B88", "AR-BRELM", "AR-BRSTD",
        "AR-CONC", "AR-HBONE", "AR-PARQ1", "AR-RROOF", "AR-RSHKE", "AR-SAND", "BOX", "BRASS", "BRICK", "BRSTONE", "CLAY", "CORK", "CROSS", "DASH", "DOLMIT",
        "DOTS", "EARTH", "ESCHER", "FLEX", "GRASS", "GRATE", "GRAVEL", "HEX", "HONEY", "HOUND", "INSUL", "LINE", "MUDST", "NET", "NET3", "PLAST", "PLASTI",
        "SACNCR", "SQUARE", "STARS", "STEEL", "SWAMP", "TRANS", "TRIANG", "ZIGZAG",
    };
    private static readonly short[] Palette = { 5, 1, 3, 30, 6, 4, 2, 140, 200, 40, 90, 230 };
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private static string Describe(Database db, Transaction tr, JsonObject args, HashSet<string>? pending = null)
    {
        var operation = Text(args, "operation");
        var summary = DescribeCore(db, tr, args, pending);
        if (args["color_index"] is not null && operation is not ("create_layer" or "set_color"))
        {
            if (!Creates.Contains(operation)) throw new ArgumentException("color_index applies only to entities this edit creates. Use set_color for existing entities.");
            summary += $"\nColor: {ColorName(ColorIndex(args))}" + (operation == "create_chart" ? " (axes and text)" : "");
        }
        return summary;
    }

    private static short ColorIndex(JsonObject args, string key = "color_index")
    {
        var value = args[key]?.GetValue<int>() ?? throw new ArgumentException($"{key} is required.");
        if (value < 1 || value > 256) throw new ArgumentException($"{key} must be 1–255, or 256 for ByLayer.");
        return (short)value;
    }
    private static string ColorName(short index) => index == 256 ? "ByLayer" : $"index {index}";

    /// <summary>Literal text: control characters refused, except newlines where the entity supports them.</summary>
    private static string Literal(JsonObject args, string key, bool lines, int max = 2000, bool allowEmpty = false)
    {
        var value = Text(args, key);
        if (value.Length > max || (!allowEmpty && value.Length == 0)) throw new ArgumentException($"{key} must be {(allowEmpty ? 0 : 1)}–{max} characters.");
        if (value.Any(c => char.IsControl(c) && !(lines && c == '\n'))) throw new ArgumentException($"{key} contains control characters.");
        return value;
    }
    private static string Short(string? text) => text == null ? "(none)" : "\"" + (text.Length > 80 ? text.Substring(0, 77) + "…" : text).Replace("\n", "⏎") + "\"";
    private static double Number(JsonObject args, string key, double fallback, double min, double max)
    {
        var value = args[key]?.GetValue<double>() ?? fallback;
        if (!Compat.IsFinite(value) || value < min || value > max) throw new ArgumentException($"{key} must be between {min} and {max}.");
        return value;
    }
    private static Point3d Pt(double x, double y, double z = 0) => new(x, y, z);

    // ---- Text ----------------------------------------------------------------------------------

    private static string? CurrentText(Entity entity) => entity switch
    {
        DBText text => text.TextString,
        MText mtext => mtext.Text,
        MLeader leader when leader.ContentType == ContentType.MTextContent => leader.MText?.Text,
        _ => null,
    };

    /// <summary>What edit_text will write to one entity, computed identically for review and apply.</summary>
    private static (string Plain, string Stored) NewText(Entity entity, JsonObject args)
    {
        var replaceAll = args["text"] is not null;
        if (replaceAll == (args["find"] is not null)) throw new ArgumentException("Give either text (replace everything) or find and replace.");
        var handle = Handle(entity.ObjectId);
        var multiline = entity is not DBText;
        if (replaceAll)
        {
            var text = Literal(args, "text", multiline);
            return (text, multiline ? MTextContents(text) : text);
        }
        var find = Literal(args, "find", multiline);
        var replacement = args["replace"] is null ? throw new ArgumentException("replace is required with find.") : Literal(args, "replace", multiline, allowEmpty: true);
        switch (entity)
        {
            case DBText text:
                if (!text.TextString.Contains(find)) throw new ArgumentException($"{handle} does not contain {Short(find)}.");
                var replaced = text.TextString.Replace(find, replacement);
                return (replaced, replaced);
            default:
                // Edit the stored contents so the rest of the text keeps its formatting.
                var stored = entity is MText m ? m.Contents : ((MLeader)entity).MText!.Contents;
                var plain = CurrentText(entity) ?? "";
                if (!stored.Contains(MTextContents(find)))
                    throw new ArgumentException(plain.Contains(find) ? $"In {handle} that wording crosses formatting. Replace the whole text instead." : $"{handle} does not contain {Short(find)}.");
                return (plain.Replace(find, replacement), stored.Replace(MTextContents(find), MTextContents(replacement)));
        }
    }

    private static Entity[] TextTargets(Database db, Transaction tr, JsonObject args)
    {
        var targets = Targets(db, tr, args);
        foreach (var target in targets)
            if (CurrentText(target) == null) throw new ArgumentException($"{Handle(target.ObjectId)} is a {target.GetRXClass().DxfName}; edit_text changes TEXT, MTEXT, and MULTILEADER text. Use set_table_cells or set_attribute for tables and attributes.");
        return targets;
    }

    // ---- Tables --------------------------------------------------------------------------------

    private static string[][] Grid(JsonObject args, string key, int maxRows)
    {
        var rows = args[key] as JsonArray ?? throw new ArgumentException($"{key} is required.");
        if (rows.Count < 1 || rows.Count > maxRows) throw new ArgumentException($"{key} needs 1–{maxRows} rows.");
        var grid = rows.Select((row, r) =>
        {
            var cells = row as JsonArray ?? throw new ArgumentException($"{key} row {r + 1} must be a list of strings.");
            if (cells.Count < 1 || cells.Count > 20) throw new ArgumentException($"{key} row {r + 1} needs 1–20 cells.");
            return cells.Select(cell =>
            {
                var text = cell?.GetValue<string>() ?? "";
                if (text.Length > 500 || text.Any(c => char.IsControl(c) && c != '\n')) throw new ArgumentException($"{key} row {r + 1} has a cell over 500 characters or with control characters.");
                return text;
            }).ToArray();
        }).ToArray();
        if (grid.Any(row => row.Length != grid[0].Length)) throw new ArgumentException($"Every {key} row needs the same number of cells.");
        return grid;
    }

    private static double[]? ColumnWidths(JsonObject args, int columns)
    {
        if (args["column_widths"] is not JsonArray values) return null;
        if (values.Count != columns) throw new ArgumentException("column_widths needs one width per column.");
        var widths = values.Select(v => v!.GetValue<double>()).ToArray();
        if (widths.Any(w => !Compat.IsFinite(w) || w <= 0 || w > 1e9)) throw new ArgumentException("Each column width must be positive and finite.");
        return widths;
    }

    private static Table TableTarget(Database db, Transaction tr, JsonObject args)
    {
        var targets = Targets(db, tr, args);
        if (targets.Length != 1 || targets[0] is not Table table) throw new ArgumentException("Give exactly one table handle.");
        return table;
    }

    private static (int Row, int Column, string Text)[] CellUpdates(JsonObject args, Table table)
    {
        if (args["cell_updates"] is not JsonArray values) return [];
        if (values.Count < 1 || values.Count > 500) throw new ArgumentException("cell_updates needs 1–500 cells.");
        return values.Select((value, index) =>
        {
            var item = value as JsonObject ?? throw new ArgumentException($"cell_updates item {index + 1} must be an object with row, column, and text.");
            var row = item["row"]?.GetValue<int>() ?? throw new ArgumentException($"cell_updates item {index + 1} needs row.");
            var column = item["column"]?.GetValue<int>() ?? throw new ArgumentException($"cell_updates item {index + 1} needs column.");
            if (row < 0 || row >= table.Rows.Count || column < 0 || column >= table.Columns.Count)
                throw new ArgumentException($"Cell ({row}, {column}) is outside this {table.Rows.Count}×{table.Columns.Count} table. Rows and columns count from 0, including any title row.");
            return (row, column, Literal(item, "text", true, 500, allowEmpty: true));
        }).ToArray();
    }

    /// <summary>A cell's wording as written: reverses MTextContents' escapes. Other formatting codes stay visible.</summary>
    private static string CellText(Table table, int row, int column)
    {
        var stored = table.Cells[row, column].TextString ?? "";
        var plain = new System.Text.StringBuilder(stored.Length);
        for (var i = 0; i < stored.Length; i++)
        {
            if (stored[i] == '\\' && i + 1 < stored.Length && stored[i + 1] is '\\' or '{' or '}') { plain.Append(stored[++i]); continue; }
            if (stored[i] == '\\' && i + 1 < stored.Length && stored[i + 1] == 'P') { plain.Append('\n'); i++; continue; }
            plain.Append(stored[i]);
        }
        return plain.ToString();
    }

    private static object TableInfo(Table table)
    {
        var rows = Math.Min(table.Rows.Count, 100);
        var columns = Math.Min(table.Columns.Count, 20);
        return new
        {
            position = P(table.Position), rows = table.Rows.Count, columns = table.Columns.Count, width = table.Width, height = table.Height,
            truncated = table.Rows.Count > rows || table.Columns.Count > columns,
            columnWidths = Enumerable.Range(0, columns).Select(c => table.Columns[c].Width).ToArray(),
            rowHeights = Enumerable.Range(0, rows).Select(r => table.Rows[r].Height).ToArray(),
            cells = Enumerable.Range(0, rows).Select(r => Enumerable.Range(0, columns).Select(c => CellText(table, r, c)).ToArray()).ToArray(),
        };
    }

    // ---- Blocks and attributes -----------------------------------------------------------------

    private static Dictionary<string, string> AttributeValues(JsonObject args, bool required)
    {
        if (args["attributes"] is not JsonObject values)
        {
            if (required) throw new ArgumentException("attributes is required: an object of TAG to value.");
            return new Dictionary<string, string>();
        }
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in values)
        {
            var text = pair.Value?.GetValue<string>() ?? "";
            if (text.Length > 255 || text.Any(char.IsControl)) throw new ArgumentException($"Attribute {pair.Key} must be one line of at most 255 characters.");
            result[pair.Key] = text;
        }
        if (required && result.Count == 0) throw new ArgumentException("attributes needs at least one TAG.");
        return result;
    }

    private static BlockTableRecord InsertableBlock(Database db, Transaction tr, string name)
    {
        var table = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
        if (!table.Has(name)) throw new ArgumentException($"Block {name} is not defined in this drawing. Query blocks first.");
        var block = (BlockTableRecord)tr.GetObject(table[name], OpenMode.ForRead);
        if (block.IsLayout || block.IsAnonymous || block.IsFromExternalReference || block.IsDependent) throw new ArgumentException($"{name} is a layout, anonymous, or external-reference block and cannot be inserted.");
        return block;
    }

    private static List<AttributeDefinition> AttributeDefinitions(Transaction tr, BlockTableRecord block) =>
        block.Cast<ObjectId>().Select(id => tr.GetObject(id, OpenMode.ForRead)).OfType<AttributeDefinition>().Where(definition => !definition.Constant).ToList();

    // ---- Hatches -------------------------------------------------------------------------------

    private static (string Name, double Scale, double Angle) HatchPattern(JsonObject args)
    {
        var name = args["pattern"]?.GetValue<string>() ?? "SOLID";
        if (!Patterns.Contains(name)) throw new ArgumentException($"Pattern {name} is not one of the predefined patterns Mi allows: {string.Join(", ", Patterns.OrderBy(p => p))}.");
        return (name.ToUpperInvariant(), Number(args, "pattern_scale", 1, 1e-6, 1e6), Radians(args, "pattern_angle_degrees", 0));
    }

    /// <summary>A non-associative hatch whose boundary is the given closed loop. It must be in the database before its pattern is set.</summary>
    private static void FillLoop(Hatch hatch, Point2d[] points, double[] bulges, double elevation, (string Name, double Scale, double Angle) pattern)
    {
        hatch.Normal = Vector3d.ZAxis;
        hatch.Elevation = elevation;
        // AutoCAD refuses PatternAngle (eInvalidInput) before a pattern is set, and applies scale and
        // angle only when the pattern is set again afterwards. Verified live in AutoCAD 2024.
        hatch.SetHatchPattern(HatchPatternType.PreDefined, pattern.Name);
        hatch.PatternScale = pattern.Scale;
        hatch.PatternAngle = pattern.Angle;
        hatch.SetHatchPattern(HatchPatternType.PreDefined, pattern.Name);
        hatch.Associative = false;
        var loop = new Point2dCollection(points);
        loop.Add(points[0]);
        var arcs = new DoubleCollection(bulges);
        arcs.Add(0);
        hatch.AppendLoop(HatchLoopTypes.External | HatchLoopTypes.Polyline, loop, arcs);
        hatch.EvaluateHatch(true);
    }

    // ---- Charts --------------------------------------------------------------------------------

    private sealed record Chart(string Kind, string[] Labels, double[] Values, short[] Colors, Point3d Origin, double Width, double Height, double TextHeight, string? Title);

    private static Chart ChartSpec(JsonObject args)
    {
        var kind = Text(args, "chart_type");
        if (kind is not ("bar" or "line" or "pie")) throw new ArgumentException("chart_type must be bar, line, or pie.");
        var labels = (args["labels"] as JsonArray ?? throw new ArgumentException("labels is required.")).Select(v => v?.GetValue<string>() ?? "").ToArray();
        var values = (args["values"] as JsonArray ?? throw new ArgumentException("values is required.")).Select(v => v!.GetValue<double>()).ToArray();
        var limit = kind == "pie" ? 20 : 50;
        if (labels.Length < 1 || labels.Length > limit || values.Length != labels.Length) throw new ArgumentException($"Give 1–{limit} labels and exactly one value per label.");
        if (labels.Any(label => label.Length > 100 || label.Any(char.IsControl))) throw new ArgumentException("Each label must be one line of at most 100 characters.");
        if (values.Any(v => !Compat.IsFinite(v) || v < 0 || v > 1e12)) throw new ArgumentException("Chart values must be finite, zero or positive, and at most 1e12.");
        if (kind == "pie" && values.Sum() <= 0) throw new ArgumentException("A pie chart needs at least one positive value.");
        var colors = args["colors"] is JsonArray chosen ? chosen.Select(v => v!.GetValue<int>()).ToArray() : [];
        if (colors.Length > labels.Length || colors.Any(c => c < 1 || c > 255)) throw new ArgumentException("colors holds at most one index (1–255) per value.");
        var palette = Enumerable.Range(0, labels.Length).Select(i => i < colors.Length ? (short)colors[i] : kind == "pie" ? Palette[i % Palette.Length] : colors.Length > 0 ? (short)colors[0] : Palette[0]).ToArray();
        var width = Positive(args, "width");
        var height = Positive(args, "height");
        var textHeight = args["text_height"] is null ? Math.Min(width, height) / 25 : Positive(args, "text_height");
        return new Chart(kind, labels, values, palette, Point(args, "position"), width, height, textHeight, args["title"] is null ? null : Literal(args, "title", false, 200));
    }

    private static string Format(double value) => value.ToString(Math.Abs(value) >= 100 || value == Math.Floor(value) ? "#,0" : "#,0.##", Invariant);

    /// <summary>A round axis maximum: 1, 2, 2.5, or 5 times a power of ten, at or above the largest value.</summary>
    private static double NiceMaximum(double max)
    {
        if (max <= 0) return 1;
        var power = Math.Pow(10, Math.Floor(Math.Log10(max)));
        foreach (var step in new[] { 1, 2, 2.5, 5, 10 }) if (step * power >= max * (1 - 1e-12)) return step * power;
        return 10 * power;
    }

    private static string DescribeChart(Chart chart, string layer, string into, string units)
    {
        var data = string.Join(", ", chart.Labels.Zip(chart.Values, (label, value) => $"{label}={Format(value)}").Take(12)) + (chart.Labels.Length > 12 ? $" … {chart.Labels.Length - 12} more" : "");
        var scale = chart.Kind == "pie" ? $"Total {Format(chart.Values.Sum())}" : $"Value axis 0 to {Format(NiceMaximum(chart.Values.Max()))}";
        return $"Create a {chart.Kind} chart on layer {layer}{(chart.Title != null ? $", titled {Short(chart.Title)}" : "")}\n" +
               $"{chart.Labels.Length} values: {data}\n{scale}. Lower-left corner {chart.Origin}, {Format(chart.Width)} wide by {Format(chart.Height)} tall, text height {Format(chart.TextHeight)}.\n" +
               $"Drawn as lines, polylines, solid hatches, and text, all one U.\n{into}{units}";
    }

    /// <summary>Draws a chart through Apply's Add, so every part shares the edit's layer, transaction, and undo group.</summary>
    private static void DrawChart(Chart chart, Database db, Action<Entity, Action?, Action?> add)
    {
        var (x0, y0, z) = (chart.Origin.X, chart.Origin.Y, chart.Origin.Z);
        var th = chart.TextHeight;
        void Label(string text, double x, double y, double height, TextHorizontalMode horizontal, TextVerticalMode vertical)
        {
            var label = new DBText();
            add(label, () =>
            {
                label.TextString = text; label.Height = height; label.Position = Pt(x, y, z);
                label.HorizontalMode = horizontal; label.VerticalMode = vertical; label.AlignmentPoint = Pt(x, y, z);
            }, () => label.AdjustAlignment(db));
        }
        void Shape(Point2d[] points, double[] bulges, short color, bool fill)
        {
            var outline = new Polyline();
            add(outline, () =>
            {
                for (var i = 0; i < points.Length; i++) outline.AddVertexAt(i, points[i], bulges[i], 0, 0);
                outline.Closed = true; outline.Elevation = z; outline.ColorIndex = color;
            }, null);
            if (!fill) return;
            var hatch = new Hatch();
            add(hatch, () => hatch.ColorIndex = color, () => FillLoop(hatch, points, bulges, z, ("SOLID", 1, 0)));
        }
        if (chart.Title != null)
            Label(chart.Title, x0 + chart.Width / 2, y0 + chart.Height + th * (chart.Kind == "pie" ? 0.5 : 1.5), th * 1.4, TextHorizontalMode.TextCenter, TextVerticalMode.TextBottom);

        if (chart.Kind == "pie")
        {
            var center = new Point2d(x0 + chart.Width / 2, y0 + chart.Height / 2);
            var radius = Math.Min(chart.Width, chart.Height) * 0.35;
            var total = chart.Values.Sum();
            var start = Math.PI / 2; // Twelve o'clock, counterclockwise.
            for (var i = 0; i < chart.Values.Length; i++)
            {
                var sweep = 2 * Math.PI * chart.Values[i] / total;
                if (sweep <= 0) continue;
                // Quarter-turn segments keep every bulge at or below tan(22.5°).
                var segments = Math.Max(1, (int)Math.Ceiling(sweep / (Math.PI / 2) - 1e-9));
                var step = sweep / segments;
                var points = new List<Point2d> { center };
                var bulges = new List<double> { 0 };
                for (var k = 0; k <= segments; k++)
                {
                    var angle = start + step * k;
                    points.Add(new Point2d(center.X + radius * Math.Cos(angle), center.Y + radius * Math.Sin(angle)));
                    bulges.Add(k < segments ? Math.Tan(step / 4) : 0);
                }
                if (segments * step >= 2 * Math.PI - 1e-9) { points.RemoveAt(0); bulges.RemoveAt(0); points.RemoveAt(points.Count - 1); bulges.RemoveAt(bulges.Count - 1); }
                Shape(points.ToArray(), bulges.ToArray(), chart.Colors[i], true);
                var middle = start + sweep / 2;
                var right = Math.Cos(middle) >= 0;
                Label($"{chart.Labels[i]} ({(chart.Values[i] / total * 100).ToString("0.#", Invariant)}%)",
                    center.X + radius * 1.12 * Math.Cos(middle), center.Y + radius * 1.12 * Math.Sin(middle), th,
                    right ? TextHorizontalMode.TextLeft : TextHorizontalMode.TextRight, TextVerticalMode.TextVerticalMid);
                start += sweep;
            }
            return;
        }

        var maximum = NiceMaximum(chart.Values.Max());
        add(new Line(Pt(x0, y0, z), Pt(x0 + chart.Width, y0, z)), null, null);
        add(new Line(Pt(x0, y0, z), Pt(x0, y0 + chart.Height, z)), null, null);
        for (var k = 0; k <= 5; k++)
        {
            var y = y0 + chart.Height * k / 5;
            add(new Line(Pt(x0 - th * 0.5, y, z), Pt(x0, y, z)), null, null);
            Label(Format(maximum * k / 5), x0 - th, y, th, TextHorizontalMode.TextRight, TextVerticalMode.TextVerticalMid);
        }
        var slot = chart.Width / chart.Values.Length;
        var tops = new List<Point2d>();
        for (var i = 0; i < chart.Values.Length; i++)
        {
            var x = x0 + slot * (i + 0.5);
            var top = y0 + chart.Values[i] / maximum * chart.Height;
            tops.Add(new Point2d(x, top));
            if (chart.Kind == "bar" && top - y0 > 1e-9)
            {
                var half = slot * 0.3;
                Shape([new Point2d(x - half, y0), new Point2d(x + half, y0), new Point2d(x + half, top), new Point2d(x - half, top)], new double[4], chart.Colors[i], true);
            }
            Label(Format(chart.Values[i]), x, top + th * 0.4, th * 0.85, TextHorizontalMode.TextCenter, TextVerticalMode.TextBottom);
            Label(chart.Labels[i], x, y0 - th * 0.6, th, TextHorizontalMode.TextCenter, TextVerticalMode.TextTop);
        }
        if (chart.Kind == "line")
        {
            if (tops.Count > 1)
            {
                var trend = new Polyline();
                add(trend, () => { for (var i = 0; i < tops.Count; i++) trend.AddVertexAt(i, tops[i], 0, 0, 0); trend.Elevation = z; trend.ColorIndex = chart.Colors[0]; }, null);
            }
            foreach (var top in tops)
            {
                var marker = new Circle(Pt(top.X, top.Y, z), Vector3d.ZAxis, th * 0.3);
                add(marker, () => marker.ColorIndex = chart.Colors[0], null);
            }
        }
    }

    // ---- Review text ---------------------------------------------------------------------------

    private static string? DescribeMore(Database db, Transaction tr, JsonObject args, HashSet<string>? pending, string operation, string units, string into)
    {
        switch (operation)
        {
            case "edit_text":
            {
                var targets = TextTargets(db, tr, args);
                var changes = targets.Select(t => $"{t.GetRXClass().DxfName} {Handle(t.ObjectId)}: {Short(CurrentText(t))} → {Short(NewText(t, args).Plain)}").ToArray();
                var height = args["height"] is null ? "" : $"\nNew text height: {Positive(args, "height")}";
                return $"EDIT TEXT of {targets.Length} entities:\n{string.Join("\n", changes)}{height}";
            }
            case "set_attribute":
            {
                var values = AttributeValues(args, true);
                var lines = new List<string>();
                foreach (var target in Targets(db, tr, args))
                {
                    if (target is not BlockReference reference || target is Table) throw new ArgumentException($"{Handle(target.ObjectId)} is not a block reference.");
                    var current = reference.AttributeCollection.Cast<ObjectId>().Select(id => (AttributeReference)tr.GetObject(id, OpenMode.ForRead))
                        .GroupBy(a => a.Tag, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().TextString, StringComparer.OrdinalIgnoreCase);
                    foreach (var pair in values)
                    {
                        if (!current.TryGetValue(pair.Key, out var old)) throw new ArgumentException($"{Handle(target.ObjectId)} has no attribute {pair.Key}. Query the entity to see its tags.");
                        lines.Add($"{Handle(target.ObjectId)} {pair.Key}: {Short(old)} → {Short(pair.Value)}");
                    }
                }
                return $"SET ATTRIBUTES:\n{string.Join("\n", lines)}";
            }
            case "create_table":
            {
                var cells = Grid(args, "cells", 100);
                var widths = ColumnWidths(args, cells[0].Length);
                var title = args["title"] is null ? null : Literal(args, "title", false, 200);
                var rowHeight = args["row_height"] is null ? (double?)null : Positive(args, "row_height");
                var textHeight = args["height"] is null ? (double?)null : Positive(args, "height");
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                var header = args["header"]?.GetValue<bool>() ?? false;
                return $"Create a table on layer {LayerName(db, tr, Text(args, "layer"), pending)}: {cells.Length} rows × {cells[0].Length} columns{(title != null ? $", plus title {Short(title)}" : "")}{(header ? ", first row as header" : "")}\n" +
                       $"Top-left: {Point(args, "position")}\nColumn widths: {(widths == null ? "table style default" : string.Join(", ", widths.Select(Format)))}; row height: {(rowHeight.HasValue ? Format(rowHeight.Value) : "style default")}; text height: {(textHeight.HasValue ? Format(textHeight.Value) : "style default")}\n" +
                       $"First row: {string.Join(" | ", cells[0].Select(c => Short(c)))}\n{into}{units}";
            }
            case "set_table_cells":
            {
                var table = TableTarget(db, tr, args);
                var updates = CellUpdates(args, table);
                var appended = args["cells"] is null ? null : Grid(args, "cells", 100);
                if (appended != null && appended[0].Length != table.Columns.Count) throw new ArgumentException($"Appended rows need {table.Columns.Count} cells each.");
                if (updates.Length == 0 && appended == null) throw new ArgumentException("Give cell_updates, cells to append as new rows, or both.");
                var lines = updates.Take(30).Select(u => $"({u.Row}, {u.Column}): {Short(CellText(table, u.Row, u.Column))} → {Short(u.Text)}").ToList();
                if (updates.Length > 30) lines.Add($"… {updates.Length - 30} more cells");
                if (appended != null) lines.Add($"Append {appended.Length} rows at the bottom; first: {string.Join(" | ", appended[0].Select(c => Short(c)))}");
                return $"EDIT TABLE {Handle(table.ObjectId)} ({table.Rows.Count}×{table.Columns.Count}):\n{string.Join("\n", lines)}";
            }
            case "create_hatch":
            {
                var points = Vertices(args);
                if (points.Length < 3) throw new ArgumentException("A hatch boundary needs at least 3 points.");
                var bulges = Bulges(args, points.Length);
                var pattern = HatchPattern(args);
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                return $"Create a {pattern.Name} hatch on layer {LayerName(db, tr, Text(args, "layer"), pending)}, scale {Format(pattern.Scale)}, angle {args["pattern_angle_degrees"]?.GetValue<double>() ?? 0} degrees\n" +
                       $"Closed boundary of {points.Length} vertices at elevation {Elevation(args)}, {bulges.Count(b => b != 0)} curved segments; not associative.\n{into}{units}";
            }
            case "create_dimension":
            {
                var start = Point(args, "start"); var end = Point(args, "end"); var line = Point(args, "location");
                if (start.DistanceTo(end) < 1e-9) throw new ArgumentException("Dimension points must differ.");
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                var rotated = args["rotation_degrees"] is not null;
                var text = args["text"] is null ? "the measured value" : Short(Literal(args, "text", false, 255));
                return $"Create a {(rotated ? $"linear dimension rotated {args["rotation_degrees"]} degrees" : "aligned dimension")} on layer {LayerName(db, tr, Text(args, "layer"), pending)}\n" +
                       $"From {start} to {end}, dimension line through {line}; text: {text}; current dimension style.\n{into}{units}";
            }
            case "rotate":
                return $"ROTATE {Targets(db, tr, args).Length} entities by {args["rotation_degrees"]?.GetValue<double>() ?? throw new ArgumentException("rotation_degrees is required.")} degrees " +
                       $"(checked: {Radians(args, "rotation_degrees"):F4} rad) counterclockwise about {Point(args, "center")}: {List(Targets(db, tr, args))}{units}";
            case "scale":
            {
                var factor = Number(args, "factor", double.NaN, 1e-6, 1e6);
                return $"SCALE {Targets(db, tr, args).Length} entities by {factor} about {Point(args, "center")}: {List(Targets(db, tr, args))}{units}";
            }
            case "mirror":
            {
                var start = Point(args, "start"); var end = Point(args, "end");
                if (new Vector2d(end.X - start.X, end.Y - start.Y).Length < 1e-9) throw new ArgumentException("The mirror line needs two different points in plan.");
                var keep = args["keep_original"]?.GetValue<bool>() ?? true;
                return $"MIRROR {Targets(db, tr, args).Length} entities across the line {start} to {end}, {(keep ? "keeping the originals (creates mirrored copies)" : "moving the originals")}. Text is mirrored too: {List(Targets(db, tr, args))}{units}";
            }
            case "set_color":
                return $"SET COLOR of {Targets(db, tr, args).Length} entities to {ColorName(ColorIndex(args))}: {List(Targets(db, tr, args))}";
            case "insert_block":
            {
                var name = Text(args, "name");
                var block = InsertableBlock(db, tr, name);
                var values = AttributeValues(args, false);
                var tags = AttributeDefinitions(tr, block).Select(d => d.Tag).ToList();
                var unknown = values.Keys.Where(tag => !tags.Contains(tag, StringComparer.OrdinalIgnoreCase)).ToArray();
                if (unknown.Length > 0) throw new ArgumentException($"Block {name} has no attribute {string.Join(", ", unknown)}. Its tags: {(tags.Count == 0 ? "none" : string.Join(", ", tags))}.");
                var factor = Number(args, "factor", 1, 1e-6, 1e6);
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                return $"Insert block {name} on layer {LayerName(db, tr, Text(args, "layer"), pending)}\nAt: {Point(args, "position")}, scale {factor}, rotation {args["rotation_degrees"]?.GetValue<double>() ?? 0} degrees (checked: {Radians(args, "rotation_degrees", 0):F4} rad)\n" +
                       $"Attributes: {(tags.Count == 0 ? "none" : string.Join(", ", tags.Select(tag => $"{tag}={Short(values.TryGetValue(tag, out var value) ? value : null)}")))} (unset tags keep the block's default)\n{into}{units}";
            }
            case "create_chart":
            {
                var chart = ChartSpec(args);
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                return DescribeChart(chart, LayerName(db, tr, Text(args, "layer"), pending), into, units);
            }
            default: return null;
        }
    }

    // ---- Apply ---------------------------------------------------------------------------------

    private static bool PerformMore(JsonObject a, Database db, Transaction tr, List<string> changed, Action<Entity, Action?, Action?> add)
    {
        switch (Text(a, "operation"))
        {
            case "edit_text":
                foreach (var target in TextTargets(db, tr, a))
                {
                    var stored = NewText(target, a).Stored;
                    var height = a["height"] is null ? (double?)null : Positive(a, "height");
                    target.UpgradeOpen();
                    switch (target)
                    {
                        case DBText text: text.TextString = stored; if (height.HasValue) text.Height = height.Value; break;
                        case MText mtext: mtext.Contents = stored; if (height.HasValue) mtext.TextHeight = height.Value; break;
                        case MLeader leader:
                            var wording = leader.MText!;
                            wording.Contents = stored;
                            if (height.HasValue) { wording.TextHeight = height.Value; leader.TextHeight = height.Value; }
                            leader.MText = wording;
                            break;
                    }
                    changed.Add(Handle(target.ObjectId));
                }
                return true;
            case "set_attribute":
            {
                var values = AttributeValues(a, true);
                foreach (BlockReference reference in Targets(db, tr, a))
                {
                    foreach (ObjectId id in reference.AttributeCollection)
                    {
                        var attribute = (AttributeReference)tr.GetObject(id, OpenMode.ForRead);
                        if (!values.TryGetValue(attribute.Tag, out var value)) continue;
                        attribute.UpgradeOpen(); attribute.TextString = value; changed.Add(Handle(attribute.ObjectId));
                    }
                }
                return true;
            }
            case "create_table":
            {
                var cells = Grid(a, "cells", 100);
                var widths = ColumnWidths(a, cells[0].Length);
                var title = a["title"] is null ? null : Literal(a, "title", false, 200);
                var header = a["header"]?.GetValue<bool>() ?? false;
                var table = new Table();
                add(table, () =>
                {
                    table.TableStyle = db.Tablestyle;
                    var offset = title == null ? 0 : 1;
                    table.SetSize(cells.Length + offset, cells[0].Length);
                    table.Position = Point(a, "position");
                    for (var c = 0; c < cells[0].Length; c++) if (widths != null) table.Columns[c].Width = widths[c];
                    for (var r = 0; r < cells.Length + offset; r++)
                    {
                        if (a["row_height"] is not null) table.Rows[r].Height = Positive(a, "row_height");
                        // Rows are styled explicitly, so a style's title row never merges or restyles data.
                        table.Rows[r].Style = r < offset ? "_TITLE" : header && r == offset ? "_HEADER" : "_DATA";
                    }
                    if (title != null)
                    {
                        if (cells[0].Length > 1) table.MergeCells(CellRange.Create(table, 0, 0, 0, cells[0].Length - 1));
                        table.Cells[0, 0].TextString = MTextContents(title);
                        table.Cells[0, 0].Alignment = CellAlignment.MiddleCenter;
                        if (a["height"] is not null) table.Cells[0, 0].TextHeight = Positive(a, "height") * 1.25;
                    }
                    for (var r = 0; r < cells.Length; r++)
                        for (var c = 0; c < cells[r].Length; c++)
                        {
                            table.Cells[r + offset, c].TextString = MTextContents(cells[r][c]);
                            // The standard style's data rows align top-centre, which looks unbalanced once rows are taller than the text.
                            table.Cells[r + offset, c].Alignment = CellAlignment.MiddleCenter;
                            if (a["height"] is not null) table.Cells[r + offset, c].TextHeight = Positive(a, "height");
                        }
                    table.GenerateLayout();
                }, null);
                return true;
            }
            case "set_table_cells":
            {
                var table = TableTarget(db, tr, a);
                var updates = CellUpdates(a, table);
                var appended = a["cells"] is null ? null : Grid(a, "cells", 100);
                table.UpgradeOpen();
                foreach (var (row, column, text) in updates) table.Cells[row, column].TextString = MTextContents(text);
                if (appended != null)
                {
                    var first = table.Rows.Count;
                    // Plain InsertRows leaves new rows without borders. Inherit the last row's format, then
                    // copy text height and alignment, which are per-cell overrides the format does not carry.
                    table.InsertRowsAndInherit(first, first - 1, appended.Length);
                    for (var r = 0; r < appended.Length; r++)
                        for (var c = 0; c < appended[r].Length; c++)
                        {
                            var above = table.Cells[first - 1, c];
                            var cell = table.Cells[first + r, c];
                            cell.TextString = MTextContents(appended[r][c]);
                            cell.TextHeight = above.TextHeight;
                            cell.Alignment = above.Alignment;
                        }
                }
                table.GenerateLayout();
                // A table that grows after it is in the drawing keeps its old gridline graphics, so
                // appended rows show no borders until its block is rebuilt. Verified live in 2024 and 2027.
                table.RecomputeTableBlock(true);
                changed.Add(Handle(table.ObjectId));
                return true;
            }
            case "create_hatch":
            {
                var points = Vertices(a);
                var bulges = Bulges(a, points.Length);
                var hatch = new Hatch();
                add(hatch, null, () => FillLoop(hatch, points, bulges, Elevation(a), HatchPattern(a)));
                return true;
            }
            case "create_dimension":
            {
                var start = Point(a, "start"); var end = Point(a, "end"); var line = Point(a, "location");
                var text = a["text"] is null ? "" : MTextContents(Literal(a, "text", false, 255));
                Dimension dimension = a["rotation_degrees"] is null
                    ? new AlignedDimension(start, end, line, text, db.Dimstyle)
                    : new RotatedDimension(Radians(a, "rotation_degrees"), start, end, line, text, db.Dimstyle);
                add(dimension, null, null);
                return true;
            }
            case "rotate":
            {
                var matrix = Matrix3d.Rotation(Radians(a, "rotation_degrees"), Vector3d.ZAxis, Point(a, "center"));
                foreach (var e in Targets(db, tr, a)) { e.UpgradeOpen(); e.TransformBy(matrix); changed.Add(Handle(e.ObjectId)); }
                return true;
            }
            case "scale":
            {
                var matrix = Matrix3d.Scaling(Number(a, "factor", double.NaN, 1e-6, 1e6), Point(a, "center"));
                foreach (var e in Targets(db, tr, a)) { e.UpgradeOpen(); e.TransformBy(matrix); changed.Add(Handle(e.ObjectId)); }
                return true;
            }
            case "mirror":
            {
                var start = Point(a, "start"); var end = Point(a, "end");
                // The vertical plane through the line: a plan mirror that keeps objects facing +Z.
                var matrix = Matrix3d.Mirroring(new Plane(start, new Vector3d(end.X - start.X, end.Y - start.Y, 0).CrossProduct(Vector3d.ZAxis)));
                var targets = Targets(db, tr, a);
                if (a["keep_original"]?.GetValue<bool>() ?? true)
                {
                    foreach (var group in targets.GroupBy(e => e.OwnerId))
                    {
                        var map = new IdMapping();
                        db.DeepCloneObjects(new ObjectIdCollection(group.Select(e => e.ObjectId).ToArray()), group.Key, map, false);
                        foreach (IdPair pair in map)
                        {
                            if (!pair.IsPrimary || !pair.IsCloned) continue;
                            var clone = (Entity)tr.GetObject(pair.Value, OpenMode.ForWrite);
                            clone.TransformBy(matrix); changed.Add(Handle(clone.ObjectId));
                        }
                    }
                }
                else foreach (var e in targets) { e.UpgradeOpen(); e.TransformBy(matrix); changed.Add(Handle(e.ObjectId)); }
                return true;
            }
            case "set_color":
            {
                var color = ColorIndex(a);
                foreach (var e in Targets(db, tr, a)) { e.UpgradeOpen(); e.ColorIndex = color; changed.Add(Handle(e.ObjectId)); }
                return true;
            }
            case "insert_block":
            {
                var block = InsertableBlock(db, tr, Text(a, "name"));
                var values = AttributeValues(a, false);
                var reference = new BlockReference(Point(a, "position"), block.ObjectId);
                add(reference, () => { reference.ScaleFactors = new Scale3d(Number(a, "factor", 1, 1e-6, 1e6)); reference.Rotation = Radians(a, "rotation_degrees", 0); }, () =>
                {
                    foreach (var definition in AttributeDefinitions(tr, block))
                    {
                        var attribute = new AttributeReference();
                        attribute.SetAttributeFromBlock(definition, reference.BlockTransform);
                        if (values.TryGetValue(definition.Tag, out var value)) attribute.TextString = value;
                        reference.AttributeCollection.AppendAttribute(attribute);
                        tr.AddNewlyCreatedDBObject(attribute, true);
                    }
                });
                return true;
            }
            case "create_chart":
                DrawChart(ChartSpec(a), db, add);
                return true;
            default: return false;
        }
    }
}
