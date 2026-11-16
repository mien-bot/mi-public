using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using AcApp = Autodesk.AutoCAD.ApplicationServices.Application;

namespace Mi.AutoCad;

// Edits that reach a second drawing: copying entities from it, and referencing it as an xref. The
// source must be another drawing open in this AutoCAD and connected to the same project, which Mi
// resolves by name; the add-in checks the pairing again here. Units are converted from each
// drawing's INSUNITS, and a drawing with no units refuses unless the agent passes unit_scale after
// asking the person, because a silently wrong factor is the error that is hardest to see.
internal sealed partial class Operations
{
    internal static readonly HashSet<string> Linked = new(StringComparer.Ordinal) { "copy_from_drawing", "attach_xref" };
    private const int MaxCopied = 5000;

    /// <summary>The connected source drawing a linked edit names, checked against this project's pairings.</summary>
    private Document LinkedSource(Document doc, string workspace, JsonObject args)
    {
        var id = Text(args, "source_document");
        var source = Find(id) ?? throw new InvalidOperationException("The source drawing was closed. Nothing was changed.");
        if (source == doc) throw new ArgumentException("The source is the drawing being changed. Use copy or insert_block within one drawing.");
        if (!bindings.TryGetValue(Key(workspace, id), out var bound) || !string.Equals(bound.Name, source.Name, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The source drawing is not connected to this project. Nothing was changed.");
        if (Busy(source)) throw new InvalidOperationException("AutoCAD is busy with a command or dialog. Nothing was changed.");
        return source;
    }

    /// <summary>Source units to this drawing's units, or an explicit factor the person confirmed.</summary>
    private static (double Factor, string Text) UnitScale(Database from, Database to, JsonObject args)
    {
        string Name(UnitsValue units) => units == UnitsValue.Undefined ? "no units (INSUNITS 0)" : units.ToString();
        if (args["unit_scale"] is not null)
        {
            var given = Number(args, "unit_scale", 1, 1e-9, 1e9);
            return (given, $"Scale ×{given:G} given explicitly. INSUNITS: source {Name(from.Insunits)}, this drawing {Name(to.Insunits)}.");
        }
        if (from.Insunits == UnitsValue.Undefined || to.Insunits == UnitsValue.Undefined)
            throw new ArgumentException($"{(from.Insunits == UnitsValue.Undefined ? "The source drawing" : "This drawing")} has no units set (INSUNITS 0), so Mi cannot tell how to scale. Ask the person what units each drawing is drawn in, then pass unit_scale.");
        var factor = UnitsConverter.GetConversionFactor(from.Insunits, to.Insunits);
        return (factor, Math.Abs(factor - 1) < 1e-12 ? $"Units: both {Name(to.Insunits)}, no scaling." : $"Units: source {Name(from.Insunits)} → this drawing {Name(to.Insunits)}, scaled ×{factor:G}.");
    }

    private static double[] FourNumbers(JsonObject args, string key)
    {
        var values = args[key] as JsonArray ?? throw new ArgumentException($"{key} is required.");
        if (values.Count != 4) throw new ArgumentException($"{key} must be [minX, minY, maxX, maxY].");
        var numbers = values.Select(v => v!.GetValue<double>()).ToArray();
        if (numbers.Any(n => !Compat.IsFinite(n)) || numbers[0] >= numbers[2] || numbers[1] >= numbers[3]) throw new ArgumentException($"{key} must be [minX, minY, maxX, maxY] with min below max.");
        return numbers;
    }

    /// <summary>The source entities to copy: explicit handles, or everything reaching into an area of one space.</summary>
    private static Entity[] SourceSelection(Database db, Transaction tr, JsonObject args)
    {
        var byHandles = args["source_handles"] is JsonArray;
        if (byHandles == (args["source_area"] is not null)) throw new ArgumentException("Give either source_handles or source_area.");
        List<Entity> chosen;
        if (byHandles)
        {
            var values = (JsonArray)args["source_handles"]!;
            if (values.Count is < 1 or > 1000) throw new ArgumentException("Choose 1–1000 source handles.");
            chosen = values.Select(v => v!.GetValue<string>()).Distinct(StringComparer.OrdinalIgnoreCase).Select(handle =>
            {
                var entity = tr.GetObject(Resolve(db, handle), OpenMode.ForRead) as Entity ?? throw new ArgumentException($"{handle} is not an entity in the source drawing.");
                if (!((BlockTableRecord)tr.GetObject(entity.OwnerId, OpenMode.ForRead)).IsLayout) throw new ArgumentException($"{handle} is inside a block definition in the source drawing.");
                return entity;
            }).ToList();
        }
        else
        {
            var area = FourNumbers(args, "source_area");
            var space = (BlockTableRecord)tr.GetObject(Space(db, tr, args["source_space"]?.GetValue<string>()), OpenMode.ForRead);
            chosen = space.Cast<ObjectId>().Take(100_000).Select(id => (Entity)tr.GetObject(id, OpenMode.ForRead)).Where(e => e is not Viewport && Overlaps(e, area)).Take(MaxCopied + 1).ToList();
            if (chosen.Count > MaxCopied) throw new ArgumentException($"More than {MaxCopied} entities reach into that area. Narrow it, or copy in parts.");
        }
        if (chosen.Count == 0) throw new ArgumentException("Nothing in the source drawing matches. Query it first.");
        if (chosen.Any(e => e is Viewport)) throw new ArgumentException("Viewports cannot be copied between drawings.");
        if (chosen.Select(e => e.OwnerId).Distinct().Count() > 1) throw new ArgumentException("Copy from one space at a time: model, or one layout.");
        return chosen.ToArray();
    }

    private static Extents3d? Bounds(IEnumerable<Entity> entities)
    {
        Extents3d? total = null;
        foreach (var box in entities.Select(e => e.Bounds).Where(b => b.HasValue).Select(b => b!.Value))
        {
            if (total is { } sum) { sum.AddExtents(box); total = sum; } else total = box;
        }
        return total;
    }

    private static string RelativePath(string hostFile, string targetFile)
    {
        var hostDirectory = Path.GetDirectoryName(Path.GetFullPath(hostFile))!;
        if (!string.Equals(Path.GetPathRoot(hostDirectory), Path.GetPathRoot(targetFile), StringComparison.OrdinalIgnoreCase)) return targetFile;
        var relative = Uri.UnescapeDataString(new Uri(hostDirectory.TrimEnd('\\') + "\\").MakeRelativeUri(new Uri(Path.GetFullPath(targetFile))).ToString()).Replace('/', '\\');
        return relative.StartsWith("..", StringComparison.Ordinal) ? relative : ".\\" + relative;
    }

    private static string XrefName(JsonObject args, Document source)
    {
        var name = args["name"]?.GetValue<string>() ?? Path.GetFileNameWithoutExtension(source.Name);
        try { SymbolUtilityServices.ValidateSymbolName(name, false); }
        catch (Autodesk.AutoCAD.Runtime.Exception) { throw new ArgumentException($"{name} is not a valid reference name. Pass name."); }
        return name;
    }

    /// <summary>An xref of this name already pointing at the same file is reused; any other block of that name is a conflict.</summary>
    private static ObjectId? ExistingXref(Database db, Transaction tr, string name, string sourceFile)
    {
        var table = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
        if (!table.Has(name)) return null;
        var block = (BlockTableRecord)tr.GetObject(table[name], OpenMode.ForRead);
        if (!block.IsFromExternalReference) throw new ArgumentException($"This drawing already has a block named {name}. Pass another name.");
        var stored = block.PathName;
        var resolved = Path.IsPathRooted(stored) ? stored : Path.GetFullPath(Path.Combine(Path.GetDirectoryName(db.Filename) ?? "", stored));
        if (!string.Equals(Path.GetFullPath(resolved), Path.GetFullPath(sourceFile), StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"This drawing already references another file as {name} ({stored}). Pass another name.");
        return block.ObjectId;
    }

    private string DescribeLinked(Document doc, string workspace, JsonObject args)
    {
        var source = LinkedSource(doc, workspace, args);
        var db = doc.Database;
        using var sourceLock = source.LockDocument(DocumentLockMode.Read, null, null, false);
        using var str = source.Database.TransactionManager.StartOpenCloseTransaction();
        using var tr = db.TransactionManager.StartOpenCloseTransaction();
        var (factor, unitsText) = UnitScale(source.Database, db, args);
        var into = $"Into: {args["space"]?.GetValue<string>() ?? "model"}";
        _ = Space(db, tr, args["space"]?.GetValue<string>());
        var title = Path.GetFileName(source.Name);
        var position = args["position"] is null ? Point3d.Origin : Point(args, "position");
        if (Text(args, "operation") == "copy_from_drawing")
        {
            var chosen = SourceSelection(source.Database, str, args);
            var basePoint = args["base_point"] is null ? Point3d.Origin : Point(args, "base_point");
            var tally = string.Join(", ", chosen.GroupBy(e => e.GetRXClass().DxfName).OrderByDescending(g => g.Count()).Select(g => $"{g.Count()} {g.Key}"));
            var from = ((BlockTableRecord)str.GetObject(chosen[0].OwnerId, OpenMode.ForRead)).Name;
            var size = Bounds(chosen) is { } box ? box.MaxPoint - box.MinPoint : (Vector3d?)null;
            var sizeText = size is { } s ? $"\nSize: {s.X:G6} × {s.Y:G6} source units → {s.X * factor:G6} × {s.Y * factor:G6} here. Check this against a known dimension." : "";
            var targetLayers = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
            var layers = chosen.Select(e => e.Layer).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var existing = layers.Where(targetLayers.Has).ToArray();
            var targetBlocks = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
            var blocks = chosen.OfType<BlockReference>().Select(b => ((BlockTableRecord)str.GetObject(b.BlockTableRecord, OpenMode.ForRead))).Where(b => !b.IsAnonymous).Select(b => b.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var sharedBlocks = blocks.Where(targetBlocks.Has).ToArray();
            var lockedHere = existing.Where(name => ((LayerTableRecord)tr.GetObject(targetLayers[name], OpenMode.ForRead)).IsLocked).ToArray();
            if (lockedHere.Length > 0) throw new ArgumentException($"Layers locked in this drawing: {string.Join(", ", lockedHere)}. Ask the person to unlock them first.");
            return $"COPY FROM {title} ({from}): {chosen.Length} entities, {tally}\n{unitsText}{sizeText}\n" +
                $"Placement: source point {basePoint} lands at {position}. {into}\n" +
                $"Layers: {layers.Length - existing.Length} added, {existing.Length} already here keep this drawing's settings{(existing.Length > 0 ? $" ({string.Join(", ", existing.Take(10))}{(existing.Length > 10 ? ", …" : "")})" : "")}." +
                (blocks.Length > 0 ? $"\nBlocks: {blocks.Length - sharedBlocks.Length} added, {sharedBlocks.Length} already here keep this drawing's definition{(sharedBlocks.Length > 0 ? $" ({string.Join(", ", sharedBlocks.Take(10))})" : "")}." : "") +
                $"\nNative copies keep blocks, hatches, dimensions, and styles. {title} is not changed.";
        }
        // attach_xref
        if (!source.IsNamedDrawing || !File.Exists(source.Name)) throw new ArgumentException($"{title} has never been saved, so it cannot be referenced. Ask the person to save it first.");
        var name = XrefName(args, source);
        var reuse = ExistingXref(db, tr, name, source.Name) is not null;
        var layer = LayerName(db, tr, Text(args, "layer"), null);
        var stored = doc.IsNamedDrawing ? RelativePath(doc.Name, source.Name) : source.Name;
        var overlay = args["overlay"]?.GetValue<bool>() ?? true;
        var rotation = Radians(args, "rotation_degrees", 0);
        return $"REFERENCE {title} as xref {name} ({(overlay ? "overlay: not carried into drawings that reference this one" : "attachment: carried into drawings that reference this one")})" +
            (reuse ? "\nThis drawing already references it under that name; one more insert of it is added." : $"\nPath stored: {stored}{(Path.IsPathRooted(stored) ? " (absolute)" : " (relative to this drawing)")}") +
            $"\nInsert at {position}, rotation {args["rotation_degrees"]?.GetValue<double>() ?? 0} degrees ({rotation:F4} rad), scale ×{factor:G}, on layer {layer}. {into}\n{unitsText}\n" +
            $"It shows {title} as last saved: changes not yet saved there appear after it is saved and the reference reloaded. {title} is not changed.";
    }

    /// <summary>The source must be unchanged since the preview, like the drawing being edited.</summary>
    private void CheckLinkedSource(Document doc, string workspace, JsonObject args)
    {
        var source = LinkedSource(doc, workspace, args);
        if (args["source_revision"]?.GetValue<long>() != State(source).Revision) throw new InvalidOperationException("The source drawing changed since the preview. Nothing was applied; create a new preview.");
    }

    private JsonNode ApplyLinked(Document doc, string workspace, JsonObject args, Work work)
    {
        var source = LinkedSource(doc, workspace, args);
        var db = doc.Database;
        var changed = new List<string>();
        var position = args["position"] is null ? Point3d.Origin : Point(args, "position");
        // Named lock: AutoCAD records one undo group in this drawing, so a single U reverses the edit.
        using var targetLock = doc.LockDocument(DocumentLockMode.Write, "MIEDIT", "MIEDIT", false);
        using var sourceLock = source.LockDocument(DocumentLockMode.Read, null, null, false);
        var factor = UnitScale(source.Database, db, args).Factor;
        if (Text(args, "operation") == "copy_from_drawing")
        {
            ObjectId[] ids;
            using (var str = source.Database.TransactionManager.StartOpenCloseTransaction()) ids = SourceSelection(source.Database, str, args).Select(e => e.ObjectId).ToArray();
            var basePoint = args["base_point"] is null ? Point3d.Origin : Point(args, "base_point");
            using var tr = doc.TransactionManager.StartTransaction();
            var space = Space(db, tr, args["space"]?.GetValue<string>());
            var map = new IdMapping();
            // Existing layers, blocks, and styles of the same name are kept as they are here.
            source.Database.WblockCloneObjects(new ObjectIdCollection(ids), space, map, DuplicateRecordCloning.Ignore, false);
            var scale = Matrix3d.Scaling(factor, basePoint);
            var move = Matrix3d.Displacement(position - basePoint);
            foreach (IdPair pair in map)
            {
                if (!pair.IsPrimary || !pair.IsCloned || tr.GetObject(pair.Value, OpenMode.ForWrite) is not Entity clone) continue;
                clone.TransformBy(scale); clone.TransformBy(move);
                changed.Add(Handle(clone.ObjectId));
            }
            work.Check(); // An exception here disposes the transaction, which aborts the copy.
            tr.Commit();
        }
        else
        {
            using var tr = doc.TransactionManager.StartTransaction();
            var name = XrefName(args, source);
            var xref = ExistingXref(db, tr, name, source.Name) ?? ((args["overlay"]?.GetValue<bool>() ?? true) ? db.OverlayXref(source.Name, name) : db.AttachXref(source.Name, name));
            if (doc.IsNamedDrawing)
            {
                var stored = RelativePath(doc.Name, source.Name);
                var block = (BlockTableRecord)tr.GetObject(xref, OpenMode.ForRead);
                if (!string.Equals(block.PathName, stored, StringComparison.OrdinalIgnoreCase)) { block.UpgradeOpen(); block.PathName = stored; }
            }
            var insert = new BlockReference(position, xref);
            insert.SetDatabaseDefaults(db);
            insert.Layer = Text(args, "layer");
            insert.ScaleFactors = new Scale3d(factor);
            insert.Rotation = Radians(args, "rotation_degrees", 0);
            var owner = (BlockTableRecord)tr.GetObject(Space(db, tr, args["space"]?.GetValue<string>()), OpenMode.ForWrite);
            owner.AppendEntity(insert);
            tr.AddNewlyCreatedDBObject(insert, true);
            changed.Add(Handle(xref)); changed.Add(Handle(insert.ObjectId));
            work.Check();
            tr.Commit();
        }
        return J(new { outcome = "committed", operation = Text(args, "operation"), handles = changed, saved = false, undo = "One U in AutoCAD reverses this edit." });
    }

    private static object Xrefs(Database db, Transaction tr) =>
        ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead)).Cast<ObjectId>().Select(id => (BlockTableRecord)tr.GetObject(id, OpenMode.ForRead))
            .Where(b => b.IsFromExternalReference).Select(b => new
            {
                handle = Handle(b.ObjectId), name = b.Name, path = b.PathName, status = b.XrefStatus.ToString(), overlay = b.IsFromOverlayReference, unloaded = b.IsUnloaded,
                inserts = b.GetBlockReferenceIds(true, false).Cast<ObjectId>().Take(50).Select(rid => (BlockReference)tr.GetObject(rid, OpenMode.ForRead)).Select(r => new
                {
                    handle = Handle(r.ObjectId), space = ((BlockTableRecord)tr.GetObject(r.OwnerId, OpenMode.ForRead)).Name, layer = r.Layer, position = P(r.Position),
                    scale = V(new Vector3d(r.ScaleFactors.X, r.ScaleFactors.Y, r.ScaleFactors.Z)), rotationRadians = r.Rotation,
                }).ToArray(),
            }).ToArray();
}
