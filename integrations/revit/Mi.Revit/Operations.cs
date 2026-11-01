using System.Security.Cryptography;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mi.Revit;

internal sealed class DocumentState
{
    internal string Id = Guid.NewGuid().ToString("N");
    internal long Revision;
}
internal sealed record Proposal(string Workspace, string Document, long Revision, DateTime Expires, JsonObject Arguments, string Summary);

internal sealed class Operations
{
    // Revit returns distinct managed wrappers for one native document. Dictionary uses
    // Document.Equals/GetHashCode; ConditionalWeakTable/reference equality does not.
    private readonly Dictionary<Document, DocumentState> documents = new();
    private readonly Dictionary<string, string> bindings = new();
    private readonly Dictionary<string, string> approvals = new();
    private readonly Dictionary<string, Proposal> proposals = new();
    internal void Reset() { bindings.Clear(); approvals.Clear(); proposals.Clear(); }
    internal void DocumentChanged(object? sender, DocumentChangedEventArgs e) => State(e.GetDocument()).Revision++;
    internal void DocumentClosing(object? sender, DocumentClosingEventArgs e)
    {
        if (!documents.Remove(e.Document, out var state)) return;
        foreach (var key in bindings.Where(p => p.Value == state.Id).Select(p => p.Key).ToArray()) { bindings.Remove(key); approvals.Remove(key); }
        foreach (var key in proposals.Where(p => p.Value.Document == state.Id).Select(p => p.Key).ToArray()) proposals.Remove(key);
    }
    private DocumentState State(Document doc)
    {
        if (!documents.TryGetValue(doc, out var state)) { state = new DocumentState(); documents.Add(doc, state); }
        return state;
    }
    private static JsonNode J(object value) => JsonSerializer.SerializeToNode(value)!;
    private static string Text(JsonObject a, string key) => a[key]?.GetValue<string>() ?? throw new ArgumentException($"{key} is required.");
    private static long Id(JsonObject a, string key) => a[key]?.GetValue<long>() ?? throw new ArgumentException($"{key} is required.");
    private static Element Element(Document d, long id) => d.GetElement(new ElementId(id)) ?? throw new ArgumentException($"Element {id} no longer exists.");
    private static object Brief(Element e) => new { id = e.Id.Value, uniqueId = e.UniqueId, name = e.Name, category = e.Category?.Name, typeId = e.GetTypeId().Value };
    private object DocumentInfo(Document doc) => new
    {
        id = State(doc).Id, revision = State(doc).Revision, title = doc.Title, path = doc.PathName,
        isWorkshared = doc.IsWorkshared, isReadOnly = doc.IsReadOnly, isFamily = doc.IsFamilyDocument,
        cloud = doc.IsModelInCloud ? new { project = doc.GetCloudModelPath().GetProjectGUID().ToString(), model = doc.GetCloudModelPath().GetModelGUID().ToString() } : null,
        coordinateUnits = "Revit internal feet; angles are radians unless stated otherwise"
    };
    internal JsonNode Run(UIApplication app, Work work)
    {
        var request = work.Request;
        var method = Text(request, "method");
        var doc = app.ActiveUIDocument?.Document;
        if (method == "discover") return J(new { version = app.Application.VersionNumber, document = doc == null ? null : DocumentInfo(doc) });
        if (doc == null) throw new InvalidOperationException("Open the intended model in Revit first.");
        var workspace = Text(request, "workspace");
        if (!Regex.IsMatch(workspace, @"^projects/[a-z0-9]+(?:-[a-z0-9]+)*$")) throw new ArgumentException("Invalid project workspace.");
        var documentId = Text(request, "document");
        if (documentId != State(doc).Id) throw new InvalidOperationException("The active model changed or was reopened. Rebind it in Mi.");
        if (method == "bind")
        {
            work.Check();
            var dialog = new TaskDialog("Bind model to Mi project")
            {
                MainInstruction = $"Connect {doc.Title} to {workspace}?",
                MainContent = $"Model: {doc.PathName}\n\nAnswer Yes only if you just pressed Connect in Mi. This grants read access to this model for that project and lets Mi show you each edit for review in its terminal window. Every edit still needs your approval. Any previous project binding for this model is revoked.",
                CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                DefaultButton = TaskDialogResult.No
            };
            if (dialog.Show() != TaskDialogResult.Yes) throw new InvalidOperationException("Connection declined. Nothing changed.");
            work.Check();
            foreach (var key in bindings.Where(p => p.Value == documentId).Select(p => p.Key).ToArray()) { bindings.Remove(key); approvals.Remove(key); }
            bindings[workspace] = documentId;
            approvals.Remove(workspace);
            var approval = request["approval"]?.GetValue<string>();
            if (approval != null && Regex.IsMatch(approval, "^[a-f0-9]{64}$")) approvals[workspace] = approval;
            proposals.Clear();
            return J(DocumentInfo(doc));
        }
        if (!bindings.TryGetValue(workspace, out var bound) || bound != documentId) throw new InvalidOperationException("This project is not paired with the active model. Use Set up MCP in Mi.");
        if (method == "unbind") { bindings.Remove(workspace); approvals.Remove(workspace); proposals.Clear(); return J(new { disconnected = true }); }
        var args = request["arguments"] as JsonObject ?? new JsonObject();
        return method switch
        {
            "query" => Query(app, doc, args),
            "preview" => Preview(doc, workspace, args),
            "describe" => DescribeProposal(app, doc, workspace, args, work),
            "apply" => Apply(app, doc, workspace, args, work, ApprovedInMi(request, workspace)),
            _ => throw new ArgumentException("Unknown native operation.")
        };
    }
    private JsonNode Page<T>(IEnumerable<T> source, JsonObject args)
    {
        var offset = args["offset"]?.GetValue<int>() ?? 0;
        var limit = args["limit"]?.GetValue<int>() ?? 100;
        if (offset < 0 || offset > 100_000 || limit < 1 || limit > 200) throw new ArgumentException("offset must be 0–100000 and limit 1–200.");
        var values = source.Skip(offset).Take(limit + 1).ToArray();
        var more = values.Length > limit;
        return J(new { items = values.Take(limit), offset, limit, hasMore = more, nextOffset = more ? (int?)(offset + limit) : null });
    }
    private JsonNode Query(UIApplication app, Document doc, JsonObject args)
    {
        var kind = Text(args, "kind");
        IEnumerable<Element> All(bool types = false) => types
            ? new FilteredElementCollector(doc).WhereElementIsElementType()
            : new FilteredElementCollector(doc).WhereElementIsNotElementType();
        switch (kind)
        {
            case "status": return J(DocumentInfo(doc));
            case "selection": return Page(app.ActiveUIDocument.Selection.GetElementIds().Select(id => Brief(Element(doc, id.Value))), args);
            case "categories": return Page(All().Where(e => e.Category != null).GroupBy(e => e.Category.Id.Value).Select(g => new { id = g.Key, name = g.First().Category.Name, count = g.Count() }).OrderBy(c => c.name), args);
            case "elements":
            case "types":
                var source = All(kind == "types");
                if (args["category_id"] != null) { var category = Id(args, "category_id"); source = source.Where(e => e.Category?.Id.Value == category); }
                if (args["text"] != null) { var search = Text(args, "text"); source = source.Where(e => e.Name.Contains(search, StringComparison.OrdinalIgnoreCase)); }
                return Page(source.Select(Brief), args);
            case "element":
                var element = Element(doc, Id(args, "element_id"));
                var box = element.get_BoundingBox(null);
                return J(new { element = Brief(element), pinned = element.Pinned, groupId = element.GroupId.Value,
                    bbox = box == null ? null : new { min = new[] { box.Min.X, box.Min.Y, box.Min.Z }, max = new[] { box.Max.X, box.Max.Y, box.Max.Z } },
                    parameters = element.Parameters.Cast<Parameter>().Take(300).Select(p => new { id = p.Id.Value, name = p.Definition.Name, storage = p.StorageType.ToString(), readOnly = p.IsReadOnly, value = ParameterValue(p), display = p.AsValueString() }) });
            case "instances": return Page(All().Where(e => e.GetTypeId().Value == Id(args, "type_id")).Select(Brief), args);
            case "views": return Page(new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Select(v => new { id = v.Id.Value, name = v.Name, type = v.ViewType.ToString(), template = v.IsTemplate, templateId = v.ViewTemplateId.Value }), args);
            case "levels": return Page(new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).Select(l => new { id = l.Id.Value, name = l.Name, elevationFt = l.Elevation }), args);
            case "sheets": return Page(new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().OrderBy(s => s.SheetNumber).Select(s => new { id = s.Id.Value, number = s.SheetNumber, name = s.Name }), args);
            case "sheet":
                var sheet = Element(doc, Id(args, "element_id")) as ViewSheet ?? throw new ArgumentException("Expected a sheet.");
                return Page(sheet.GetAllViewports().Select(id => (Viewport)doc.GetElement(id)).Select(v => new { id = v.Id.Value, viewId = v.ViewId.Value, detail = v.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER)?.AsString(), center = new[] { v.GetBoxCenter().X, v.GetBoxCenter().Y, v.GetBoxCenter().Z } }), args);
            case "schedules": return Page(new FilteredElementCollector(doc).OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>().Select(v => new { id = v.Id.Value, name = v.Name, categoryId = v.Definition.CategoryId.Value }), args);
            case "schedule":
                var schedule = Element(doc, Id(args, "element_id")) as ViewSchedule ?? throw new ArgumentException("Expected a schedule.");
                var body = schedule.GetTableData().GetSectionData(SectionType.Body);
                return J(new { id = schedule.Id.Value, name = schedule.Name, rows = body.NumberOfRows, columns = body.NumberOfColumns,
                    truncated = body.NumberOfRows > 50 || body.NumberOfColumns > 20,
                    cells = Enumerable.Range(body.FirstRowNumber, Math.Min(50, body.NumberOfRows)).Select(row => Enumerable.Range(body.FirstColumnNumber, Math.Min(20, body.NumberOfColumns)).Select(col => schedule.GetCellText(SectionType.Body, row, col)).ToArray()).ToArray() });
            case "warnings": return Page(doc.GetWarnings().Select(w => new { description = w.GetDescriptionText(), severity = w.GetSeverity().ToString(), elementIds = w.GetFailingElements().Select(id => id.Value) }), args);
            case "rooms": return Page(new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().Cast<Room>().Select(r => new { id = r.Id.Value, number = r.Number, name = r.Name, areaSquareFeet = r.Area, levelId = r.LevelId.Value, placed = r.Location != null }), args);
            case "links": return Page(new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().Select(l => new { id = l.Id.Value, name = l.Name, pinned = l.Pinned, loaded = l.GetLinkDocument() != null, typeId = l.GetTypeId().Value }), args);
            case "worksets":
                if (!doc.IsWorkshared) return Page(Array.Empty<object>(), args);
                return Page(new FilteredWorksetCollector(doc).OfKind(WorksetKind.UserWorkset).Select(w => new { id = w.Id.IntegerValue, name = w.Name, owner = w.Owner, isOpen = w.IsOpen, editable = w.IsEditable }), args);
            case "revisions": return Page(Revision.GetAllRevisionIds(doc).Select(id => (Revision)doc.GetElement(id)).Select(r => new { id = r.Id.Value, sequence = r.SequenceNumber, date = r.RevisionDate, description = r.Description, issued = r.Issued }), args);
            default: throw new ArgumentException("Unsupported query kind.");
        }
    }
    private static object? ParameterValue(Parameter p) => p.StorageType switch
    {
        StorageType.String => p.AsString(), StorageType.Integer => p.AsInteger(),
        StorageType.Double => p.AsDouble(), StorageType.ElementId => p.AsElementId().Value, _ => null
    };
    private static Parameter Parameter(Element e, long id) => e.Parameters.Cast<Parameter>().SingleOrDefault(p => p.Id.Value == id)
        ?? throw new ArgumentException("Parameter ID does not exist on the selected element.");
    private static Element[] Targets(Document doc, JsonObject args)
    {
        var ids = args["element_ids"] as JsonArray ?? throw new ArgumentException("element_ids is required.");
        if (ids.Count < 1 || ids.Count > 50) throw new ArgumentException("Choose 1–50 explicit elements.");
        return ids.Select(n => n!.GetValue<long>()).Distinct().Select(id => Element(doc, id)).ToArray();
    }
    private static XYZ Offset(JsonObject args) => Point(args, "offset_ft");
    private static XYZ Point(JsonObject args, string key)
    {
        var values = args[key] as JsonArray;
        if (values?.Count != 3) throw new ArgumentException($"{key} must contain three numbers in feet.");
        var a = values.Select(v => v!.GetValue<double>()).ToArray();
        if (a.Any(v => !double.IsFinite(v) || Math.Abs(v) > 100_000)) throw new ArgumentException("Offset is not finite or is too large.");
        return new XYZ(a[0], a[1], a[2]);
    }
    private string Describe(Document doc, JsonObject args)
    {
        var operation = Text(args, "operation");
        switch (operation)
        {
            case "create_wall":
                var wallType = Element(doc, Id(args, "type_id")) as WallType ?? throw new ArgumentException("Choose a wall type ID from the types query.");
                if (wallType.Kind != WallKind.Basic) throw new ArgumentException("Only basic straight walls are supported.");
                var level = Element(doc, Id(args, "level_id")) as Level ?? throw new ArgumentException("Choose a level ID from the levels query.");
                var start = Point(args, "start_ft"); var end = Point(args, "end_ft");
                var height = args["height_ft"]?.GetValue<double>() ?? 0;
                if (!double.IsFinite(height) || height <= 0 || height > 1000 || start.DistanceTo(end) < 0.01 || Math.Abs(start.Z - level.Elevation) > 0.0001 || Math.Abs(end.Z - level.Elevation) > 0.0001)
                    throw new ArgumentException("Use a positive height up to 1000 ft, distinct endpoints, and endpoint Z values equal to the selected level elevation.");
                return $"Create a basic wall: {wallType.Name} [{wallType.Id.Value}]\nLevel: {level.Name} [{level.Id.Value}]\nStart (feet): {start}\nEnd (feet): {end}\nHeight: {height} ft\nNonstructural, unconnected height, zero base offset.";
            case "set_parameter":
                var e = Element(doc, Id(args, "element_id"));
                var p = Parameter(e, Id(args, "parameter_id"));
                if (e is ElementType || p.IsReadOnly || p.StorageType is not (StorageType.String or StorageType.Integer))
                    throw new ArgumentException("This tool edits writable instance text/integer parameters only. Type, measured, and reference values require a dedicated tool.");
                if (args["value"] == null) throw new ArgumentException("value is required.");
                if (p.StorageType == StorageType.String && Text(args, "value").Length > 4000) throw new ArgumentException("Text exceeds 4000 characters.");
                if (p.StorageType == StorageType.Integer) _ = args["value"]!.GetValue<int>();
                return $"Set {e.Name} [{e.Id.Value}] / {p.Definition.Name} [{p.Id.Value}]\nBefore: {ParameterValue(p)}\nAfter: {args["value"]}";
            case "move":
            case "copy":
            case "delete":
                var targets = Targets(doc, args);
                if (targets.Any(t => t is ElementType || t is View || t is RevitLinkInstance || t.GroupId != ElementId.InvalidElementId || t.Pinned))
                    throw new ArgumentException("Pinned, grouped, linked, view, and type elements are not supported by this operation.");
                var delta = operation == "delete" ? "" : $"\nOffset (feet): {Offset(args)}";
                return $"{operation.ToUpperInvariant()} {targets.Length} elements: " + string.Join(", ", targets.Select(t => $"{t.Name} [{t.Id.Value}]")) + delta + "\nDependent deletion is refused.";
            case "duplicate_type":
                var type = Element(doc, Id(args, "type_id")) as ElementType ?? throw new ArgumentException("Expected a type.");
                var name = Text(args, "new_name");
                if (string.IsNullOrWhiteSpace(name) || name.Length > 200) throw new ArgumentException("Choose a type name of 1–200 characters.");
                return $"Duplicate type {type.Name} [{type.Id.Value}] as {name}. Existing instances remain unchanged.";
            default: throw new ArgumentException("Unsupported edit. No arbitrary-code execution is available.");
        }
    }
    private JsonNode Preview(Document doc, string workspace, JsonObject args)
    {
        if (doc.IsReadOnly || doc.IsModifiable) throw new InvalidOperationException("Model is read-only or busy.");
        foreach (var key in proposals.Where(p => p.Value.Expires < DateTime.UtcNow).Select(p => p.Key).ToArray()) proposals.Remove(key);
        if (proposals.Count >= 32) throw new InvalidOperationException("Too many pending previews. Wait for them to expire.");
        var summary = Describe(doc, args);
        var state = State(doc);
        var token = Guid.NewGuid().ToString("N");
        var expires = DateTime.UtcNow.AddMinutes(2);
        proposals[token] = new Proposal(workspace, state.Id, state.Revision, expires, (JsonObject)args.DeepClone(), summary);
        return J(new { previewToken = token, expires, document = DocumentInfo(doc), summary, confirmation = "Apply opens an exact review in Revit; the person must choose Yes." });
    }
    // The secret came from Mi's main process at pairing and stands for a person's Apply press there.
    // A wrong value is refused before anything else, so it can neither edit nor spend a preview.
    private bool ApprovedInMi(JsonObject request, string workspace)
    {
        var supplied = request["approval"]?.GetValue<string>();
        if (supplied == null) return false;
        if (!approvals.TryGetValue(workspace, out var expected) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(expected)))
            throw new InvalidOperationException("That approval was not accepted. Nothing was applied.");
        return true;
    }
    private void CheckProposal(UIApplication app, Document doc, string workspace, Proposal proposal, Work work)
    {
        work.Check();
        if (proposal.Workspace != workspace || proposal.Document != State(doc).Id || proposal.Revision != State(doc).Revision || proposal.Expires <= DateTime.UtcNow || app.ActiveUIDocument?.Document.Equals(doc) != true)
            throw new InvalidOperationException("Preview expired or the model changed. Nothing was applied; create a new preview.");
        if (doc.IsReadOnly || doc.IsModifiable) throw new InvalidOperationException("Model is read-only or busy.");
    }
    private JsonNode DescribeProposal(UIApplication app, Document doc, string workspace, JsonObject args, Work work)
    {
        if (!proposals.TryGetValue(Text(args, "preview_token"), out var proposal)) throw new InvalidOperationException("Preview is missing or already consumed. Create a fresh preview.");
        CheckProposal(app, doc, workspace, proposal, work);
        return J(new { title = doc.Title, summary = proposal.Summary });
    }
    private JsonNode Apply(UIApplication app, Document doc, string workspace, JsonObject args, Work work, bool approvedInMi)
    {
        var token = Text(args, "preview_token");
        if (!proposals.Remove(token, out var proposal)) throw new InvalidOperationException("Preview is missing or already consumed. Create a fresh preview.");
        void Validate() => CheckProposal(app, doc, workspace, proposal, work);
        Validate();
        var review = new TaskDialog("Review Mi model change")
        {
            MainInstruction = $"Apply to {doc.Title}?",
            MainContent = $"Project: {workspace}\n\n{proposal.Summary}\n\nThis changes the open model. It does not save or sync. Choose No to decline.",
            CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
            DefaultButton = TaskDialogResult.No
        };
        if (!approvedInMi && review.Show() != TaskDialogResult.Yes) return J(new { outcome = "declined", changed = false });
        Validate();
        var a = proposal.Arguments;
        var operation = Text(a, "operation");
        using var transaction = new Transaction(doc, $"Mi: {operation}");
        transaction.Start();
        var options = transaction.GetFailureHandlingOptions();
        options.SetFailuresPreprocessor(new RejectFailures());
        options.SetClearAfterRollback(true);
        transaction.SetFailureHandlingOptions(options);
        try
        {
            var changed = new List<long>();
            if (operation == "create_wall")
            {
                var wall = Wall.Create(doc, Line.CreateBound(Point(a, "start_ft"), Point(a, "end_ft")), new ElementId(Id(a, "type_id")), new ElementId(Id(a, "level_id")), a["height_ft"]!.GetValue<double>(), 0, false, false);
                changed.Add(wall.Id.Value);
            }
            else if (operation == "set_parameter")
            {
                var e = Element(doc, Id(a, "element_id"));
                var p = Parameter(e, Id(a, "parameter_id"));
                var success = p.StorageType == StorageType.String ? p.Set(Text(a, "value")) : p.Set(a["value"]!.GetValue<int>());
                doc.Regenerate();
                var matches = p.StorageType == StorageType.String ? p.AsString() == Text(a, "value") : p.AsInteger() == a["value"]!.GetValue<int>();
                if (!success || !matches) throw new InvalidOperationException("Parameter verification failed.");
                changed.Add(e.Id.Value);
            }
            else if (operation == "duplicate_type")
                changed.Add(((ElementType)Element(doc, Id(a, "type_id"))).Duplicate(Text(a, "new_name")).Id.Value);
            else
            {
                var targets = Targets(doc, a).Select(e => e.Id).ToArray();
                if (operation == "move") { ElementTransformUtils.MoveElements(doc, targets, Offset(a)); changed.AddRange(targets.Select(id => id.Value)); }
                else if (operation == "copy") changed.AddRange(ElementTransformUtils.CopyElements(doc, targets, Offset(a)).Select(id => id.Value));
                else if (operation == "delete")
                {
                    var deleted = doc.Delete(targets);
                    if (deleted.Any(id => !targets.Contains(id))) throw new InvalidOperationException("This would delete dependent elements. Rolled back.");
                    changed.AddRange(deleted.Select(id => id.Value));
                }
            }
            work.Check();
            if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Revit did not commit the transaction; inspect model state before retrying.");
            return J(new { outcome = "committed", operation, elementIds = changed, saved = false, synchronized = false });
        }
        catch
        {
            if (transaction.GetStatus() == TransactionStatus.Started) transaction.RollBack();
            throw;
        }
    }
    private sealed class RejectFailures : IFailuresPreprocessor
    {
        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor) => accessor.GetFailureMessages().Count > 0
            ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
    }
}
