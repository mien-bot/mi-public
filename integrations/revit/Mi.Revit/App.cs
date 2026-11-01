using Autodesk.Revit.UI;
using Autodesk.Revit.DB;
using Autodesk.Revit.Attributes;
using System.Reflection;

namespace Mi.Revit;

public sealed class App : IExternalApplication
{
    internal static Bridge? Connection;
    public Result OnStartup(UIControlledApplication app)
    {
        try
        {
            var handler = new Operations();
            Connection = new Bridge(handler);
            app.ControlledApplication.DocumentChanged += handler.DocumentChanged;
            app.ControlledApplication.DocumentClosing += handler.DocumentClosing;
            var panel = app.CreateRibbonPanel("Mi CAD");
            var assembly = Assembly.GetExecutingAssembly().Location;
            panel.AddItem(new PushButtonData("MiConnection", "Mi CAD\nConnection", assembly, typeof(ConnectionCommand).FullName)
            { ToolTip = "Start or stop the native Mi bridge. No pyRevit required." });
            // The bridge stays usable if the tool ribbon cannot be created.
            try { Tools.ToolRibbon.Add(app); }
            catch (Exception ex) { TaskDialog.Show("Mi Tools could not load", ex.Message); }
            Connection.Start();
            return Result.Succeeded;
        }
        catch (Exception ex) { TaskDialog.Show("Mi CAD could not start", ex.Message); return Result.Failed; }
    }
    public Result OnShutdown(UIControlledApplication app)
    {
        if (Connection is { } bridge)
        {
            app.ControlledApplication.DocumentChanged -= bridge.Handler.DocumentChanged;
            app.ControlledApplication.DocumentClosing -= bridge.Handler.DocumentClosing;
            bridge.Dispose();
        }
        Connection = null;
        return Result.Succeeded;
    }
}

[Transaction(TransactionMode.Manual)]
public sealed class ConnectionCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData data, ref string message, ElementSet elements)
    {
        if (App.Connection is not { } bridge) return Result.Failed;
        var dialog = new TaskDialog("Mi CAD native connection")
        {
            MainInstruction = bridge.Running ? "Mi CAD is available to this Windows user" : "Mi CAD is stopped",
            MainContent = "In Mi, open a project's terminal and choose Set up MCP. Connect the exact open model. You approve every edit, in Mi's terminal window or here in Revit.\n\nStopping clears project bindings and pending previews. No save or synchronization is performed.",
            CommonButtons = TaskDialogCommonButtons.Close
        };
        dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, bridge.Running ? "Stop and revoke connections" : "Start connection");
        if (dialog.Show() == TaskDialogResult.CommandLink1)
        {
            if (bridge.Running) bridge.Stop(); else bridge.Start();
        }
        return Result.Succeeded;
    }
}
