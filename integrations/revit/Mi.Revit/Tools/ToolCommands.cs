using System.Reflection;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Mi.Revit.Tools;

/// Native ports of the pyRevit ribbon. A tool moves here only with its behavior intact;
/// see the migration ledger in integrations/revit/README.md.
internal static class ToolRibbon
{
    const string Tab = "Mi Tools";

    public static void Add(UIControlledApplication app)
    {
        app.CreateRibbonTab(Tab);
        var navigation = app.CreateRibbonPanel(Tab, "Navigation");
        Add<GoToSheetCommand>(navigation, "Go To\nSheet", "Open any sheet from a searchable list.");
        Add<ZoomSelectedCommand>(navigation, "Zoom\nSelected", "Zoom the active view to the current selection without touching the section box.");
        var qaqc = app.CreateRibbonPanel(Tab, "QAQC");
        Add<DuplicateMarksCommand>(qaqc, "Duplicate\nMarks", "List duplicate Mark values by category. Read-only.");
        Add<DimOverridesCommand>(qaqc, "Dim\nOverrides", "List dimensions showing manual text instead of the measured value. Read-only.");
        var coordination = app.CreateRibbonPanel(Tab, "Coordination");
        Add<PinLinksCommand>(coordination, "Pin\nLinks", "Pin every Revit link and CAD import. Asks first; one undo reverses it.");
    }

    static void Add<T>(RibbonPanel panel, string label, string tip) where T : IExternalCommand =>
        panel.AddItem(new PushButtonData(typeof(T).Name, label, Assembly.GetExecutingAssembly().Location, typeof(T).FullName) { ToolTip = tip });
}

internal abstract class ToolCommand : IExternalCommand
{
    protected abstract string Title { get; }
    protected abstract void Run(UIApplication app, UIDocument view, Document document);

    public Result Execute(ExternalCommandData data, ref string message, ElementSet elements)
    {
        if (data.Application.ActiveUIDocument is not { } view)
        {
            TaskDialog.Show(Title, "Open a Revit model first.");
            return Result.Cancelled;
        }
        try { Run(data.Application, view, view.Document); return Result.Succeeded; }
        catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }
        catch (Exception ex) { TaskDialog.Show(Title, ex.Message); return Result.Failed; }
    }
}

[Transaction(TransactionMode.ReadOnly)]
internal sealed class ZoomSelectedCommand : ToolCommand
{
    protected override string Title => "Zoom Selected";
    protected override void Run(UIApplication app, UIDocument view, Document document)
    {
        var ids = view.Selection.GetElementIds();
        if (ids.Count == 0) { TaskDialog.Show(Title, "Select one or more elements first."); return; }
        view.ShowElements(ids);
        view.Selection.SetElementIds(ids); // ShowElements clears the selection.
    }
}

[Transaction(TransactionMode.ReadOnly)]
internal sealed class GoToSheetCommand : ToolCommand
{
    protected override string Title => "Go To Sheet";
    protected override void Run(UIApplication app, UIDocument view, Document document)
    {
        var sheets = new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
            .OrderBy(sheet => sheet.SheetNumber, StringComparer.OrdinalIgnoreCase).ToList();
        if (sheets.Count == 0) { TaskDialog.Show(Title, "No sheets in this model."); return; }
        var picker = new PickWindow("Go To Sheet", "Open sheet", sheets.Select(sheet => $"{sheet.SheetNumber} - {sheet.Name}").ToList(), app.MainWindowHandle);
        if (picker.ShowDialog() == true && picker.Picked is { } index) view.ActiveView = sheets[index];
    }
}

[Transaction(TransactionMode.Manual)]
internal sealed class PinLinksCommand : ToolCommand
{
    protected override string Title => "Pin Links";
    protected override void Run(UIApplication app, UIDocument view, Document document)
    {
        var targets = new FilteredElementCollector(document).OfClass(typeof(RevitLinkInstance)).Cast<Element>()
            .Concat(new FilteredElementCollector(document).OfClass(typeof(ImportInstance))).ToList();
        var unpinned = targets.Where(element => !element.Pinned).ToList();
        if (targets.Count == 0) { TaskDialog.Show(Title, "No links or imports in this model."); return; }
        if (unpinned.Count == 0) { TaskDialog.Show(Title, $"All {targets.Count} links/imports are already pinned."); return; }
        var confirm = new TaskDialog(Title)
        {
            MainContent = $"Pin {unpinned.Count} unpinned link/import instance(s)?\n({targets.Count - unpinned.Count} already pinned.)",
            CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
            DefaultButton = TaskDialogResult.No,
        };
        if (confirm.Show() != TaskDialogResult.Yes) return;
        var failed = new List<string>();
        using var transaction = new Transaction(document, "Pin all links");
        transaction.Start();
        foreach (var element in unpinned)
        {
            try { element.Pinned = true; if (!element.Pinned) failed.Add(element.Id.ToString()); }
            catch (Exception ex) { failed.Add($"{element.Id}: {ex.Message}"); }
        }
        if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Revit did not commit the change. Nothing was pinned.");
        TaskDialog.Show(Title, $"Pinned {unpinned.Count - failed.Count} instance(s). Failed: {failed.Count}.\n{string.Join("\n", failed.Take(10))}\nOne undo reverses committed changes.");
    }
}

[Transaction(TransactionMode.ReadOnly)]
internal sealed class DuplicateMarksCommand : ToolCommand
{
    protected override string Title => "Duplicate Marks";
    protected override void Run(UIApplication app, UIDocument view, Document document)
    {
        var marks = new Dictionary<(string Category, string Mark), List<ElementId>>();
        foreach (var element in new FilteredElementCollector(document).WhereElementIsNotElementType())
        {
            if (element.Category is not { } category) continue;
            if (element.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() is not { Length: > 0 } mark) continue;
            if (!marks.TryGetValue((category.Name, mark), out var ids)) marks[(category.Name, mark)] = ids = [];
            ids.Add(element.Id);
        }
        var rows = marks.Where(entry => entry.Value.Count > 1)
            .OrderBy(entry => entry.Key.Category, StringComparer.OrdinalIgnoreCase).ThenBy(entry => entry.Key.Mark, StringComparer.OrdinalIgnoreCase)
            .Select(entry => new ReportRow($"{entry.Key.Category} / {entry.Key.Mark} x{entry.Value.Count}: {string.Join(" ", entry.Value)}", entry.Value)).ToList();
        ReportWindow.Open(app, document, $"Duplicate Marks - {document.Title}", rows.Count == 0 ? "No duplicate marks found." : $"{rows.Count} duplicated mark values. Select a row to zoom to its elements.", rows);
    }
}

[Transaction(TransactionMode.ReadOnly)]
internal sealed class DimOverridesCommand : ToolCommand
{
    protected override string Title => "Dim Overrides";
    protected override void Run(UIApplication app, UIDocument view, Document document)
    {
        var rows = new List<ReportRow>();
        foreach (var dimension in new FilteredElementCollector(document).OfClass(typeof(Dimension)).WhereElementIsNotElementType().Cast<Dimension>())
        {
            var viewName = (document.GetElement(dimension.OwnerViewId) as View)?.Name ?? "?";
            void Add(string? actual, string shown) => rows.Add(new ReportRow($"{dimension.Id} in {viewName}: shows \"{shown}\" (actual {actual ?? "?"})", [dimension.Id]));
            if (dimension.NumberOfSegments > 0)
            {
                foreach (DimensionSegment segment in dimension.Segments)
                    if (!string.IsNullOrEmpty(segment.ValueOverride)) Add(segment.ValueString, segment.ValueOverride);
            }
            else if (!string.IsNullOrEmpty(dimension.ValueOverride)) Add(dimension.ValueString, dimension.ValueOverride);
        }
        ReportWindow.Open(app, document, $"Dimension Overrides - {document.Title}", rows.Count == 0 ? "No overridden dimension values found." : $"{rows.Count} overridden dimension values. Verify each one is intentional.", rows);
    }
}
