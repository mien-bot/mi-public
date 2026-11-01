using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using AcApp = Autodesk.AutoCAD.ApplicationServices.Application;

namespace Mi.AutoCad;

internal sealed class DocumentState
{
    internal string Id = Guid.NewGuid().ToString("N");
    internal long Revision;
}
internal sealed record Binding(string Document, string Name, string? Approval);
internal sealed record Proposal(string Workspace, string Document, long Revision, DateTime Expires, JsonObject Arguments, string Summary);

internal sealed class Operations
{
    // Keyed by the native document pointer: the entry is dropped when AutoCAD destroys the
    // document, so a reopened file always receives a new identity and needs a new pairing.
    private readonly Dictionary<IntPtr, DocumentState> documents = new();
    private readonly Dictionary<string, Binding> bindings = new();
    private readonly Dictionary<string, Proposal> proposals = new();
    private bool subscribed;
    internal void Reset() { bindings.Clear(); proposals.Clear(); }
    private void Subscribe()
    {
        if (subscribed) return;
        subscribed = true;
        AcApp.DocumentManager.DocumentToBeDestroyed += (_, e) =>
        {
            if (!documents.Remove(e.Document.UnmanagedObject, out var state)) return;
            foreach (var key in bindings.Where(p => p.Value.Document == state.Id).Select(p => p.Key).ToArray()) bindings.Remove(key);
            foreach (var key in proposals.Where(p => p.Value.Document == state.Id).Select(p => p.Key).ToArray()) proposals.Remove(key);
        };
    }
    private DocumentState State(Document doc)
    {
        Subscribe();
        if (documents.TryGetValue(doc.UnmanagedObject, out var state)) return state;
        state = new DocumentState();
        documents.Add(doc.UnmanagedObject, state);
        var captured = state;
        void Changed(DBObject value) { if (value is not ViewportTableRecord) captured.Revision++; } // Zoom and pan rewrite the active viewport record.
        doc.Database.ObjectAppended += (_, e) => Changed(e.DBObject);
        doc.Database.ObjectModified += (_, e) => Changed(e.DBObject);
        doc.Database.ObjectErased += (_, e) => Changed(e.DBObject);
        return state;
    }
    private Document? Find(string id) => AcApp.DocumentManager.Cast<Document>().FirstOrDefault(d => State(d).Id == id);

    private static JsonNode J(object value) => JsonSerializer.SerializeToNode(value)!;
    private static string Text(JsonObject a, string key) => a[key]?.GetValue<string>() ?? throw new ArgumentException($"{key} is required.");
    private static double[] P(Point3d p) => [p.X, p.Y, p.Z];
    private static double[] V(Vector3d v) => [v.X, v.Y, v.Z];
    private static object DocumentInfo(Document doc, DocumentState state) => new
    {
        id = state.Id, revision = state.Revision, title = Path.GetFileName(doc.Name), path = doc.IsNamedDrawing ? doc.Name : null,
        isReadOnly = doc.IsReadOnly, isActive = doc == AcApp.DocumentManager.MdiActiveDocument
    };
    private static bool Busy(Document doc) => !string.IsNullOrEmpty(doc.CommandInProgress) || Convert.ToInt32(AcApp.GetSystemVariable("CMDACTIVE")) != 0;

    internal JsonNode Run(Work work)
    {
        var request = work.Request;
        var method = Text(request, "method");
        var manager = AcApp.DocumentManager;
        if (method == "discover")
            return J(new { version = AcApp.Version.ToString(), documents = manager.Cast<Document>().Select(d => new { info = DocumentInfo(d, State(d)), busy = Busy(d) }).Select(d => d.info).ToArray() });
        var workspace = Text(request, "workspace");
        if (!Regex.IsMatch(workspace, @"^projects/[a-z0-9]+(?:-[a-z0-9]+)*$")) throw new ArgumentException("Invalid project workspace.");
        var documentId = Text(request, "document");
        var doc = Find(documentId) ?? throw new InvalidOperationException("The drawing was closed or reopened. Rebind it in Mi.");
        // Commands, dialogs and scripts pump messages, so this can run mid-command. Nothing touches the drawing then.
        if (Busy(doc)) throw new InvalidOperationException("AutoCAD is busy with a command or dialog. Nothing was read or changed; finish it and try again.");
        if (method == "bind")
        {
            work.Check();
            var text = $"Connect {Path.GetFileName(doc.Name)} to {workspace}?\n\nDrawing: {(doc.IsNamedDrawing ? doc.Name : "Unsaved drawing")}\n\nAnswer Yes only if you just pressed Connect in Mi. This grants read access to this drawing for that project and lets Mi show you each edit for review in its terminal window. Every edit still needs your approval. Any previous project binding for this drawing is revoked.";
            if (!Confirm.Ask("Bind drawing to Mi project", text, 50)) throw new InvalidOperationException("Connection declined. Nothing changed.");
            work.Check();
            foreach (var key in bindings.Where(p => p.Value.Document == documentId).Select(p => p.Key).ToArray()) bindings.Remove(key);
            var approval = request["approval"]?.GetValue<string>();
            bindings[workspace] = new Binding(documentId, doc.Name, approval != null && Regex.IsMatch(approval, "^[a-f0-9]{64}$") ? approval : null);
            proposals.Clear();
            return J(DocumentInfo(doc, State(doc)));
        }
        if (!bindings.TryGetValue(workspace, out var bound) || bound.Document != documentId) throw new InvalidOperationException("This project is not paired with this drawing. Use Set up MCP in Mi.");
        if (!string.Equals(bound.Name, doc.Name, StringComparison.OrdinalIgnoreCase))
        {
            bindings.Remove(workspace);
            throw new InvalidOperationException("The drawing was saved under another name. Rebind it in Mi.");
        }
        if (method == "unbind") { bindings.Remove(workspace); proposals.Clear(); return J(new { disconnected = true }); }
        var args = request["arguments"] as JsonObject ?? new JsonObject();
        return method switch
        {
            "query" => Read(doc, args),
            "preview" => Preview(doc, workspace, args),
            "describe" => DescribeProposal(doc, workspace, args, work),
            "apply" => Apply(doc, workspace, args, work, ApprovedInMi(request, bound)),
            _ => throw new ArgumentException("Unknown native operation.")
        };
    }

    private static JsonNode Page<T>(IEnumerable<T> source, JsonObject args)
    {
        var offset = args["offset"]?.GetValue<int>() ?? 0;
        var limit = args["limit"]?.GetValue<int>() ?? 100;
        if (offset < 0 || offset > 100_000 || limit < 1 || limit > 200) throw new ArgumentException("offset must be 0–100000 and limit 1–200.");
        var values = source.Skip(offset).Take(limit + 1).ToArray();
        var more = values.Length > limit;
        return J(new { items = values.Take(limit), offset, limit, hasMore = more, nextOffset = more ? (int?)(offset + limit) : null });
    }
    private static string Handle(ObjectId id) => id.Handle.ToString();
    private static ObjectId Resolve(Database db, string handle)
    {
        if (!Regex.IsMatch(handle, "^[0-9A-Fa-f]{1,16}$")) throw new ArgumentException("Invalid handle.");
        if (!db.TryGetObjectId(new Handle(Convert.ToInt64(handle, 16)), out var id) || id.IsNull || id.IsErased) throw new ArgumentException($"Handle {handle} does not exist in this drawing.");
        return id;
    }
    private static IEnumerable<(string Name, ObjectId Block, int Tab)> Layouts(Database db, Transaction tr)
    {
        var dictionary = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);
        foreach (DBDictionaryEntry entry in dictionary)
        {
            var layout = (Layout)tr.GetObject(entry.Value, OpenMode.ForRead);
            yield return (layout.LayoutName, layout.BlockTableRecordId, layout.TabOrder);
        }
    }
    private static ObjectId Space(Database db, Transaction tr, string? name)
    {
        var wanted = string.IsNullOrEmpty(name) || name.Equals("model", StringComparison.OrdinalIgnoreCase) ? "Model" : name;
        foreach (var layout in Layouts(db, tr)) if (layout.Name.Equals(wanted, StringComparison.OrdinalIgnoreCase)) return layout.Block;
        throw new ArgumentException($"Layout {name} does not exist. Query layouts first.");
    }
    private static object? Box(Entity e)
    {
        if (!e.Bounds.HasValue) return null;
        var box = e.Bounds.Value;
        return new { min = P(box.MinPoint), max = P(box.MaxPoint) };
    }
    private static object Brief(Entity e, Transaction tr) => new
    {
        handle = Handle(e.ObjectId), type = e.GetRXClass().DxfName, className = e.GetRXClass().Name, layer = e.Layer, linetype = e.Linetype,
        color = e.Color.ToString(), owner = ((BlockTableRecord)tr.GetObject(e.OwnerId, OpenMode.ForRead)).Name, visible = e.Visible, bounds = Box(e)
    };
    private static object? Geometry(Entity e, Transaction tr)
    {
        switch (e)
        {
            case Line l: return new { start = P(l.StartPoint), end = P(l.EndPoint), length = l.Length };
            case Polyline p:
                var count = Math.Min(p.NumberOfVertices, 200);
                return new { closed = p.Closed, elevation = p.Elevation, length = p.Length, vertexCount = p.NumberOfVertices, truncated = p.NumberOfVertices > 200,
                    vertices = Enumerable.Range(0, count).Select(i => new { point = new[] { p.GetPoint2dAt(i).X, p.GetPoint2dAt(i).Y }, bulge = p.GetBulgeAt(i) }).ToArray() };
            case Circle c: return new { center = P(c.Center), radius = c.Radius };
            case Arc a: return new { center = P(a.Center), radius = a.Radius, startAngleRadians = a.StartAngle, endAngleRadians = a.EndAngle };
            case DBText t: return new { text = t.TextString, position = P(t.Position), height = t.Height, rotationRadians = t.Rotation, style = t.TextStyleName };
            case MText m: return new { text = m.Text, contents = m.Contents, location = P(m.Location), textHeight = m.TextHeight, width = m.Width };
            case Dimension d: return new { measurement = d.Measurement, overrideText = d.DimensionText, style = d.DimensionStyleName, textPosition = P(d.TextPosition) };
            case MLeader m:
                var lines = m.GetLeaderIndexes().Cast<int>().SelectMany(i => m.GetLeaderLineIndexes(i).Cast<int>()).ToArray();
                return new { text = m.MText?.Text, textHeight = m.TextHeight, arrows = lines.Select(i => P(m.GetFirstVertex(i))).ToArray(), landings = lines.Select(i => P(m.GetLastVertex(i))).ToArray() };
            case Hatch h: return new { pattern = h.PatternName, solid = h.IsSolidFill, area = TryArea(h), associative = h.Associative };
            case BlockReference b:
                var definition = (BlockTableRecord)tr.GetObject(b.DynamicBlockTableRecord, OpenMode.ForRead);
                var attributes = b.AttributeCollection.Cast<ObjectId>().Take(100).Select(id => (AttributeReference)tr.GetObject(id, OpenMode.ForRead)).Select(r => new { tag = r.Tag, value = r.TextString, handle = Handle(r.ObjectId) }).ToArray();
                return new { block = definition.Name, position = P(b.Position), rotationRadians = b.Rotation, scale = V(new Vector3d(b.ScaleFactors.X, b.ScaleFactors.Y, b.ScaleFactors.Z)), isDynamic = b.IsDynamicBlock, isXref = definition.IsFromExternalReference, attributes };
            default: return null;
        }
    }
    private static double? TryArea(Hatch h) { try { return h.Area; } catch (Autodesk.AutoCAD.Runtime.Exception) { return null; } }

    private JsonNode Read(Document doc, JsonObject args)
    {
        var kind = Text(args, "kind");
        var db = doc.Database;
        using var _ = doc.LockDocument(DocumentLockMode.Read, null, null, false);
        // An open-close transaction records no undo and leaves the drawing unmodified.
        using var tr = db.TransactionManager.StartOpenCloseTransaction();
        switch (kind)
        {
            case "status":
                var current = (LayerTableRecord)tr.GetObject(db.Clayer, OpenMode.ForRead);
                var active = doc == AcApp.DocumentManager.MdiActiveDocument;
                return J(new
                {
                    document = DocumentInfo(doc, State(doc)), application = AcApp.Version.ToString(),
                    units = new { insunits = db.Insunits.ToString(), lengthFormat = db.Lunits, lengthPrecision = db.Luprec, measurement = db.Measurement.ToString() },
                    coordinateSystem = "All Mi coordinates and offsets are WCS drawing units. Check ucs before comparing with values the person sees.",
                    ucs = new { origin = P(db.Ucsorg), xAxis = V(db.Ucsxdir), yAxis = V(db.Ucsydir), isWorld = db.Ucsorg == Point3d.Origin && db.Ucsxdir == Vector3d.XAxis && db.Ucsydir == Vector3d.YAxis },
                    currentLayer = current.Name, modelSpaceActive = db.TileMode,
                    // An empty drawing reports inverted ±1e20 sentinels, which are not geometry.
                    extents = db.Extmin.X > db.Extmax.X ? null : new { min = P(db.Extmin), max = P(db.Extmax) },
                    selectionAvailable = active, unsavedChanges = active ? Convert.ToInt32(AcApp.GetSystemVariable("DBMOD")) != 0 : (bool?)null
                });
            case "selection":
                if (doc != AcApp.DocumentManager.MdiActiveDocument) throw new InvalidOperationException("Selection is only available while this drawing is active.");
                var implied = doc.Editor.SelectImplied();
                var picked = implied.Status == Autodesk.AutoCAD.EditorInput.PromptStatus.OK ? implied.Value.GetObjectIds() : [];
                return Page(picked.Select(id => (Entity)tr.GetObject(id, OpenMode.ForRead)).Select(e => Brief(e, tr)), args);
            case "layers":
                return Page(((LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead)).Cast<ObjectId>().Select(id => (LayerTableRecord)tr.GetObject(id, OpenMode.ForRead))
                    .Select(l => new { handle = Handle(l.ObjectId), name = l.Name, color = l.Color.ToString(), isOff = l.IsOff, isFrozen = l.IsFrozen, isLocked = l.IsLocked, isPlottable = l.IsPlottable, isDependent = l.IsDependent, isCurrent = l.ObjectId == db.Clayer }), args);
            case "layouts":
                return Page(Layouts(db, tr).OrderBy(l => l.Tab).Select(l => new { name = l.Name, tab = l.Tab, handle = Handle(l.Block), entityCount = ((BlockTableRecord)tr.GetObject(l.Block, OpenMode.ForRead)).Cast<ObjectId>().Take(100_000).Count() }), args);
            case "blocks":
                return Page(((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead)).Cast<ObjectId>().Select(id => (BlockTableRecord)tr.GetObject(id, OpenMode.ForRead))
                    .Where(b => !b.IsLayout && !b.IsAnonymous)
                    .Select(b => new { handle = Handle(b.ObjectId), name = b.Name, isXref = b.IsFromExternalReference, path = b.IsFromExternalReference ? b.PathName : null, hasAttributes = b.HasAttributeDefinitions, references = b.GetBlockReferenceIds(true, false).Count }), args);
            case "entities":
                var layer = args["layer"]?.GetValue<string>();
                var type = args["type"]?.GetValue<string>();
                var search = args["text"]?.GetValue<string>();
                var space = (BlockTableRecord)tr.GetObject(Space(db, tr, args["space"]?.GetValue<string>()), OpenMode.ForRead);
                var entities = space.Cast<ObjectId>().Take(100_000)
                    .Where(id => type == null || id.ObjectClass.DxfName.Equals(type, StringComparison.OrdinalIgnoreCase))
                    .Select(id => (Entity)tr.GetObject(id, OpenMode.ForRead))
                    .Where(e => layer == null || e.Layer.Equals(layer, StringComparison.OrdinalIgnoreCase))
                    .Where(e => search == null || (e is DBText t && t.TextString.Contains(search, StringComparison.OrdinalIgnoreCase)) || (e is MText m && m.Text.Contains(search, StringComparison.OrdinalIgnoreCase)));
                return Page(entities.Select(e => Brief(e, tr)), args);
            case "entity":
                var entity = tr.GetObject(Resolve(db, Text(args, "handle")), OpenMode.ForRead) as Entity ?? throw new ArgumentException("That handle is not an entity.");
                return J(new { entity = Brief(entity, tr), geometry = Geometry(entity, tr) });
            default: throw new ArgumentException("Unsupported query kind.");
        }
    }

    private static Point3d Point(JsonObject args, string key)
    {
        var values = args[key] as JsonArray;
        if (values?.Count != 3) throw new ArgumentException($"{key} must contain three WCS numbers.");
        var a = values.Select(v => v!.GetValue<double>()).ToArray();
        if (a.Any(v => !double.IsFinite(v) || Math.Abs(v) > 1e9)) throw new ArgumentException($"{key} is not finite or is too large.");
        return new Point3d(a);
    }
    private static Point2d[] Vertices(JsonObject args)
    {
        var values = args["points"] as JsonArray ?? throw new ArgumentException("points is required.");
        if (values.Count < 2 || values.Count > 500) throw new ArgumentException("Use 2–500 points.");
        var points = values.Select(v =>
        {
            var pair = v as JsonArray;
            if (pair?.Count != 2) throw new ArgumentException("Each point must be [x, y].");
            var a = pair.Select(n => n!.GetValue<double>()).ToArray();
            if (a.Any(n => !double.IsFinite(n) || Math.Abs(n) > 1e9)) throw new ArgumentException("Point is not finite or is too large.");
            return new Point2d(a);
        }).ToArray();
        if (points.Zip(points.Skip(1)).Any(p => p.First.GetDistanceTo(p.Second) < 1e-9)) throw new ArgumentException("Adjacent points must differ.");
        return points;
    }
    private static double Elevation(JsonObject args)
    {
        var value = args["elevation"]?.GetValue<double>() ?? 0;
        if (!double.IsFinite(value) || Math.Abs(value) > 1e9) throw new ArgumentException("elevation is not finite or is too large.");
        return value;
    }
    private static double[] Bulges(JsonObject args, int count)
    {
        if (args["bulges"] is not JsonArray values) return new double[count];
        if (values.Count != count) throw new ArgumentException("bulges needs one value per point.");
        var bulges = values.Select(v => v!.GetValue<double>()).ToArray();
        if (bulges.Any(b => !double.IsFinite(b) || Math.Abs(b) > 1000)) throw new ArgumentException("A bulge is not finite or is too large.");
        return bulges;
    }
    private static double Positive(JsonObject args, string key)
    {
        var value = args[key]?.GetValue<double>() ?? throw new ArgumentException($"{key} is required.");
        if (!double.IsFinite(value) || value <= 0 || value > 1e9) throw new ArgumentException($"{key} must be positive and finite.");
        return value;
    }
    private static double Radians(JsonObject args, string key, double? fallback = null)
    {
        var value = args[key]?.GetValue<double>() ?? fallback ?? throw new ArgumentException($"{key} is required.");
        if (!double.IsFinite(value) || Math.Abs(value) > 36000) throw new ArgumentException($"{key} is not a usable angle.");
        return value * Math.PI / 180;
    }
    private static string Words(JsonObject args, bool lines)
    {
        var value = Text(args, "text");
        if (value.Length is < 1 or > 2000) throw new ArgumentException("text must be 1–2000 characters.");
        if (value.Any(c => char.IsControl(c) && !(lines && c == '\n'))) throw new ArgumentException("text contains control characters.");
        return value;
    }
    // Text is literal: braces and backslashes are not formatting codes, and only a line break becomes one.
    private static string MTextContents(string value) => value.Replace("\\", "\\\\").Replace("{", "\\{").Replace("}", "\\}").Replace("\n", "\\P");
    private static string LayerName(Database db, Transaction tr, string name, HashSet<string>? pending) =>
        pending?.Contains(name) == true ? name : Layer(db, tr, name).Name;
    private static LayerTableRecord Layer(Database db, Transaction tr, string name)
    {
        var table = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
        if (!table.Has(name)) throw new ArgumentException($"Layer {name} does not exist. Query layers or preview create_layer first.");
        var layer = (LayerTableRecord)tr.GetObject(table[name], OpenMode.ForRead);
        if (layer.IsLocked || layer.IsFrozen || layer.IsDependent) throw new ArgumentException($"Layer {name} is locked, frozen, or xref-dependent.");
        return layer;
    }
    private static Entity[] Targets(Database db, Transaction tr, JsonObject args)
    {
        var values = args["handles"] as JsonArray ?? throw new ArgumentException("handles is required.");
        if (values.Count < 1 || values.Count > 50) throw new ArgumentException("Choose 1–50 explicit entities.");
        var result = new List<Entity>();
        foreach (var handle in values.Select(v => v!.GetValue<string>()).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var entity = tr.GetObject(Resolve(db, handle), OpenMode.ForRead) as Entity ?? throw new ArgumentException($"{handle} is not an entity.");
            var owner = (BlockTableRecord)tr.GetObject(entity.OwnerId, OpenMode.ForRead);
            if (!owner.IsLayout) throw new ArgumentException($"{handle} is inside a block definition.");
            if (entity is Viewport) throw new ArgumentException($"{handle} is a viewport; viewports are not supported.");
            if (entity is BlockReference reference && ((BlockTableRecord)tr.GetObject(reference.BlockTableRecord, OpenMode.ForRead)).IsFromExternalReference) throw new ArgumentException($"{handle} is an external reference.");
            if (((LayerTableRecord)tr.GetObject(entity.LayerId, OpenMode.ForRead)).IsLocked) throw new ArgumentException($"{handle} is on locked layer {entity.Layer}.");
            result.Add(entity);
        }
        return result.ToArray();
    }
    private static Vector3d Offset(JsonObject args)
    {
        var offset = Point(args, "offset").GetAsVector();
        if (offset.Length < 1e-9) throw new ArgumentException("offset must not be zero.");
        return offset;
    }
    private static string List(Entity[] targets) => string.Join(", ", targets.Select(t => $"{t.GetRXClass().DxfName} {Handle(t.ObjectId)} ({t.Layer})"));
    private static string Describe(Database db, Transaction tr, JsonObject args, HashSet<string>? pending = null)
    {
        var operation = Text(args, "operation");
        var units = $"\nCoordinates: WCS, drawing units ({db.Insunits}).";
        var into = $"Into: {args["space"]?.GetValue<string>() ?? "model"}";
        switch (operation)
        {
            case "create_layer":
                var name = Text(args, "name");
                try { SymbolUtilityServices.ValidateSymbolName(name, false); }
                catch (Autodesk.AutoCAD.Runtime.Exception) { throw new ArgumentException($"{name} is not a valid layer name."); }
                if (((LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead)).Has(name) || pending?.Contains(name) == true) throw new ArgumentException($"Layer {name} already exists.");
                var color = args["color_index"]?.GetValue<short>() ?? 7;
                if (color < 1 || color > 255) throw new ArgumentException("color_index must be 1–255.");
                pending?.Add(name);
                return $"Create layer {name}, color {color}. The current layer does not change.";
            case "create_line":
                var start = Point(args, "start"); var end = Point(args, "end");
                if (start.DistanceTo(end) < 1e-9) throw new ArgumentException("Line endpoints must differ.");
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                return $"Create a line on layer {LayerName(db, tr, Text(args, "layer"), pending)}\nStart: {start}\nEnd: {end}\nLength: {start.DistanceTo(end)}\n{into}{units}";
            case "create_polyline":
                var points = Vertices(args);
                var closed = args["closed"]?.GetValue<bool>() ?? false;
                if (closed && points.Length < 3) throw new ArgumentException("A closed polyline needs at least 3 points.");
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                var bulges = Bulges(args, points.Length);
                var shown = string.Join(" ", points.Take(8).Select(p => $"({p.X:G},{p.Y:G})")) + (points.Length > 8 ? $" … {points.Length - 8} more" : "");
                return $"Create a {(closed ? "closed" : "open")} polyline on layer {LayerName(db, tr, Text(args, "layer"), pending)}\n{points.Length} vertices at elevation {Elevation(args)}, {bulges.Count(b => b != 0)} curved segments: {shown}\n{into}{units}";
            case "create_circle":
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                return $"Create a circle on layer {LayerName(db, tr, Text(args, "layer"), pending)}\nCenter: {Point(args, "center")}\nRadius: {Positive(args, "radius")}\n{into}{units}";
            case "create_arc":
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                if (Math.Abs(Radians(args, "start_angle_degrees") - Radians(args, "end_angle_degrees")) < 1e-9) throw new ArgumentException("Arc angles must differ.");
                return $"Create an arc on layer {LayerName(db, tr, Text(args, "layer"), pending)}\nCenter: {Point(args, "center")}\nRadius: {Positive(args, "radius")}\nCounterclockwise from {args["start_angle_degrees"]} to {args["end_angle_degrees"]} degrees\n{into}{units}";
            case "create_text":
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                return $"Create text on layer {LayerName(db, tr, Text(args, "layer"), pending)}\n\"{Words(args, false)}\"\nAt: {Point(args, "position")}\nHeight: {Positive(args, "height")}, rotation {args["rotation_degrees"]?.GetValue<double>() ?? 0} degrees (checked: {Radians(args, "rotation_degrees", 0):F4} rad)\n{into}{units}";
            case "create_leader":
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                if (Point(args, "arrow").DistanceTo(Point(args, "landing")) < 1e-9) throw new ArgumentException("Leader arrow and landing must differ.");
                return $"Create a leader on layer {LayerName(db, tr, Text(args, "layer"), pending)}\n\"{Words(args, true)}\"\nArrow: {Point(args, "arrow")}\nLanding: {Point(args, "landing")}\nHeight: {Positive(args, "height")}\n{into}{units}";
            case "create_mtext":
                _ = Space(db, tr, args["space"]?.GetValue<string>());
                var wrap = args["width"] is null ? 0 : Positive(args, "width");
                return $"Create multiline text on layer {LayerName(db, tr, Text(args, "layer"), pending)}\n\"{Words(args, true)}\"\nAt: {Point(args, "location")}\nHeight: {Positive(args, "height")}, width {(wrap > 0 ? wrap : "unwrapped")}\n{into}{units}";
            case "batch":
                var edits = args["edits"] as JsonArray ?? throw new ArgumentException("edits is required.");
                if (edits.Count is < 1 or > 200) throw new ArgumentException("Use 1–200 edits in one batch.");
                if (pending != null) throw new ArgumentException("A batch cannot contain a batch.");
                var added = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var parts = edits.Select((edit, index) =>
                {
                    if (edit is not JsonObject item) throw new ArgumentException($"Edit {index + 1} must be an object.");
                    try { return $"{index + 1}. {Describe(db, tr, item, added).Replace("\n", "; ")}"; }
                    catch (ArgumentException ex) { throw new ArgumentException($"Edit {index + 1}: {ex.Message}"); }
                }).ToArray();
                var tally = string.Join(", ", edits.GroupBy(edit => Text((JsonObject)edit!, "operation")).Select(group => $"{group.Count()} {group.Key}"));
                return $"BATCH of {edits.Count} edits, all or nothing, one U reverses it: {tally}\n\n{string.Join("\n", parts)}";
            case "move":
                return $"MOVE {Targets(db, tr, args).Length} entities: {List(Targets(db, tr, args))}\nOffset: {Offset(args)}{units}";
            case "copy":
                return $"COPY {Targets(db, tr, args).Length} entities: {List(Targets(db, tr, args))}\nOffset: {Offset(args)}{units}";
            case "erase":
                return $"ERASE {Targets(db, tr, args).Length} entities: {List(Targets(db, tr, args))}\nUse AutoCAD's U to reverse this before closing the drawing.";
            case "set_layer":
                return $"Move {Targets(db, tr, args).Length} entities to layer {LayerName(db, tr, Text(args, "layer"), pending)}: {List(Targets(db, tr, args))}";
            default: throw new ArgumentException("Unsupported edit. No arbitrary-code execution is available.");
        }
    }
    private static void RefuseEditing(Document doc)
    {
        if (doc.IsReadOnly) throw new InvalidOperationException("The drawing is read-only.");
        if (doc == AcApp.DocumentManager.MdiActiveDocument && (Convert.ToInt32(AcApp.GetSystemVariable("BLOCKEDITOR")) != 0 || !string.IsNullOrEmpty(Convert.ToString(AcApp.GetSystemVariable("REFEDITNAME")))))
            throw new InvalidOperationException("Close the Block Editor or reference edit first.");
    }
    private JsonNode Preview(Document doc, string workspace, JsonObject args)
    {
        RefuseEditing(doc);
        foreach (var key in proposals.Where(p => p.Value.Expires < DateTime.UtcNow).Select(p => p.Key).ToArray()) proposals.Remove(key);
        if (proposals.Count >= 32) throw new InvalidOperationException("Too many pending previews. Wait for them to expire.");
        string summary;
        using (doc.LockDocument(DocumentLockMode.Read, null, null, false))
        using (var tr = doc.Database.TransactionManager.StartOpenCloseTransaction()) summary = Describe(doc.Database, tr, args);
        var state = State(doc);
        var token = Guid.NewGuid().ToString("N");
        var expires = DateTime.UtcNow.AddMinutes(2);
        proposals[token] = new Proposal(workspace, state.Id, state.Revision, expires, (JsonObject)args.DeepClone(), summary);
        return J(new { previewToken = token, expires, document = DocumentInfo(doc, state), summary, confirmation = "Apply opens an exact review in AutoCAD; the person must choose Yes." });
    }
    // The secret came from Mi's main process at pairing and stands for a person's Apply press there.
    // A wrong value is refused before anything else, so it can neither edit nor spend a preview.
    private static bool ApprovedInMi(JsonObject request, Binding bound)
    {
        var supplied = request["approval"]?.GetValue<string>();
        if (supplied == null) return false;
        if (bound.Approval == null || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(bound.Approval)))
            throw new InvalidOperationException("That approval was not accepted. Nothing was applied.");
        return true;
    }
    private void CheckProposal(Document doc, string workspace, Proposal proposal, Work work, bool requireActive = true)
    {
        work.Check();
        var state = State(doc);
        if (proposal.Workspace != workspace || proposal.Document != state.Id || proposal.Revision != state.Revision || proposal.Expires <= DateTime.UtcNow)
            throw new InvalidOperationException("Preview expired or the drawing changed. Nothing was applied; create a new preview.");
        if (requireActive && doc != AcApp.DocumentManager.MdiActiveDocument) throw new InvalidOperationException("Make this drawing active in AutoCAD first. Nothing was applied.");
        if (Busy(doc)) throw new InvalidOperationException("AutoCAD is busy. Nothing was applied; create a new preview when it is idle.");
        RefuseEditing(doc);
    }
    private JsonNode DescribeProposal(Document doc, string workspace, JsonObject args, Work work)
    {
        if (!proposals.TryGetValue(Text(args, "preview_token"), out var proposal)) throw new InvalidOperationException("Preview is missing or already consumed. Create a fresh preview.");
        CheckProposal(doc, workspace, proposal, work, requireActive: false); // Mi's review names the drawing, and Apply brings it forward.
        return J(new { title = Path.GetFileName(doc.Name), summary = proposal.Summary });
    }
    private JsonNode Apply(Document doc, string workspace, JsonObject args, Work work, bool approvedInMi)
    {
        var token = Text(args, "preview_token");
        if (!proposals.Remove(token, out var proposal)) throw new InvalidOperationException("Preview is missing or already consumed. Create a fresh preview.");
        void Validate() => CheckProposal(doc, workspace, proposal, work);
        // The person approved this drawing by name in Mi, so show them the drawing being changed.
        if (approvedInMi && doc != AcApp.DocumentManager.MdiActiveDocument) AcApp.DocumentManager.MdiActiveDocument = doc;
        Validate();
        var text = $"Apply to {Path.GetFileName(doc.Name)}?\n\nProject: {workspace}\n\n{proposal.Summary}\n\nThis changes the open drawing. It does not save. This review declines itself after 50 seconds.";
        if (!approvedInMi && !Confirm.Ask("Review Mi drawing change", text, 50)) return J(new { outcome = "declined", changed = false });
        Validate();
        var operation = Text(proposal.Arguments, "operation");
        var db = doc.Database;
        var changed = new List<string>();
        // Named lock: AutoCAD records one undo group, so a single U reverses the whole edit.
        using var _ = doc.LockDocument(DocumentLockMode.Write, "MIEDIT", "MIEDIT", false);
        using var tr = doc.TransactionManager.StartTransaction();
        void Perform(JsonObject a)
        {
        void Add(Entity entity, Action? configure = null)
        {
            var space = (BlockTableRecord)tr.GetObject(Space(db, tr, a["space"]?.GetValue<string>()), OpenMode.ForWrite);
            entity.SetDatabaseDefaults(db);
            entity.Layer = Text(a, "layer");
            configure?.Invoke(); // After defaults, which would otherwise reset text height and style.
            space.AppendEntity(entity);
            tr.AddNewlyCreatedDBObject(entity, true);
            changed.Add(Handle(entity.ObjectId));
        }
        switch (Text(a, "operation"))
        {
            case "create_layer":
                var table = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForWrite);
                var layer = new LayerTableRecord { Name = Text(a, "name"), Color = Autodesk.AutoCAD.Colors.Color.FromColorIndex(Autodesk.AutoCAD.Colors.ColorMethod.ByAci, a["color_index"]?.GetValue<short>() ?? 7) };
                table.Add(layer); tr.AddNewlyCreatedDBObject(layer, true);
                changed.Add(Handle(layer.ObjectId));
                break;
            case "create_line": Add(new Line(Point(a, "start"), Point(a, "end"))); break;
            case "create_polyline":
                var polyline = new Polyline();
                var vertices = Vertices(a);
                var bulges = Bulges(a, vertices.Length);
                for (var i = 0; i < vertices.Length; i++) polyline.AddVertexAt(i, vertices[i], bulges[i], 0, 0);
                polyline.Closed = a["closed"]?.GetValue<bool>() ?? false;
                polyline.Elevation = Elevation(a);
                Add(polyline);
                break;
            case "create_circle": Add(new Circle(Point(a, "center"), Vector3d.ZAxis, Positive(a, "radius"))); break;
            case "create_arc": Add(new Arc(Point(a, "center"), Positive(a, "radius"), Radians(a, "start_angle_degrees"), Radians(a, "end_angle_degrees"))); break;
            case "create_text":
                var label = new DBText();
                Add(label, () => { label.Position = Point(a, "position"); label.Height = Positive(a, "height"); label.Rotation = Radians(a, "rotation_degrees", 0); label.TextString = Words(a, false); });
                break;
            case "create_mtext":
                var note = new MText();
                Add(note, () => { note.Location = Point(a, "location"); note.TextHeight = Positive(a, "height"); if (a["width"] is not null) note.Width = Positive(a, "width"); note.Contents = MTextContents(Words(a, true)); });
                break;
            case "move":
                var move = Matrix3d.Displacement(Offset(a));
                foreach (var e in Targets(db, tr, a)) { e.UpgradeOpen(); e.TransformBy(move); changed.Add(Handle(e.ObjectId)); }
                break;
            case "copy":
                var copy = Matrix3d.Displacement(Offset(a));
                foreach (var group in Targets(db, tr, a).GroupBy(e => e.OwnerId))
                {
                    var map = new IdMapping();
                    db.DeepCloneObjects(new ObjectIdCollection(group.Select(e => e.ObjectId).ToArray()), group.Key, map, false);
                    foreach (IdPair pair in map)
                    {
                        if (!pair.IsPrimary || !pair.IsCloned) continue;
                        var clone = (Entity)tr.GetObject(pair.Value, OpenMode.ForWrite);
                        clone.TransformBy(copy); changed.Add(Handle(clone.ObjectId));
                    }
                }
                break;
            case "erase":
                foreach (var e in Targets(db, tr, a)) { e.UpgradeOpen(); e.Erase(); changed.Add(Handle(e.ObjectId)); }
                break;
            case "set_layer":
                var destination = Text(a, "layer");
                foreach (var e in Targets(db, tr, a)) { e.UpgradeOpen(); e.Layer = destination; changed.Add(Handle(e.ObjectId)); }
                break;
            case "create_leader":
                var leader = new MLeader();
                Add(leader, () =>
                {
                    var arrow = Point(a, "arrow"); var landing = Point(a, "landing"); var size = Positive(a, "height");
                    var leftward = landing.X < arrow.X;
                    var wording = new MText();
                    wording.SetDatabaseDefaults(db);
                    wording.Contents = MTextContents(Words(a, true));
                    wording.TextHeight = size;
                    if (a["width"] is not null) wording.Width = Positive(a, "width");
                    wording.Attachment = leftward ? AttachmentPoint.MiddleRight : AttachmentPoint.MiddleLeft;
                    leader.ContentType = ContentType.MTextContent;
                    leader.MText = wording;
                    leader.TextHeight = size; leader.ArrowSize = size; leader.EnableDogleg = true; leader.DoglegLength = size; leader.LandingGap = size / 2;
                    var cluster = leader.AddLeader();
                    var path = leader.AddLeaderLine(cluster);
                    leader.AddFirstVertex(path, arrow);
                    leader.AddLastVertex(path, landing);
                    leader.SetDogleg(cluster, leftward ? -Vector3d.XAxis : Vector3d.XAxis);
                });
                break;
            case "batch":
                foreach (var edit in (JsonArray)a["edits"]!) Perform((JsonObject)edit!);
                break;
            default: throw new InvalidOperationException("Unsupported edit.");
        }
        }
        Perform(proposal.Arguments);
        work.Check(); // An exception here disposes the transaction, which aborts every change above.
        tr.Commit();
        return J(new { outcome = "committed", operation, handles = changed, saved = false, undo = "One U in AutoCAD reverses this edit." });
    }
}
