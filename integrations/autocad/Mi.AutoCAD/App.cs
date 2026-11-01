using Autodesk.AutoCAD.Runtime;
using AcApp = Autodesk.AutoCAD.ApplicationServices.Application;

[assembly: ExtensionApplication(typeof(Mi.AutoCad.App))]
[assembly: CommandClass(typeof(Mi.AutoCad.Commands))]

namespace Mi.AutoCad;

public sealed class App : IExtensionApplication
{
    internal static Bridge? Connection;
    public void Initialize()
    {
        try { Connection = new Bridge(new Operations()); Connection.Start(); }
        catch (System.Exception ex) { AcApp.DocumentManager.MdiActiveDocument?.Editor.WriteMessage($"\nMi CAD could not start: {ex.Message}\n"); }
    }
    public void Terminate() { Connection?.Dispose(); Connection = null; }
}

public sealed class Commands
{
    [CommandMethod("MICAD", CommandFlags.Session)]
    public void Connection()
    {
        if (App.Connection is not { } bridge) return;
        var running = bridge.Running;
        var text = (running ? "Mi CAD is available to this Windows user." : "Mi CAD is stopped.")
            + "\n\nIn Mi, open a project's terminal and choose Set up MCP. Connect the exact open drawing. You approve every edit, in Mi's terminal window or here in AutoCAD."
            + "\n\nStopping clears project bindings and pending previews. No save is performed."
            + (running ? "\n\nStop and revoke connections?" : "\n\nStart the connection?");
        if (Confirm.Ask("Mi CAD native connection", text)) { if (running) bridge.Stop(); else bridge.Start(); }
    }
}

internal static class Confirm
{
    // The person's answer comes from AutoCAD's own process; no request argument can supply it.
    // A review left open past its request would block the queue, so it declines itself first.
    internal static bool Ask(string title, string text, int declineAfterSeconds = 0)
    {
        using var form = new System.Windows.Forms.Form { Text = title, ClientSize = new System.Drawing.Size(520, 300), FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false, ShowInTaskbar = false, StartPosition = System.Windows.Forms.FormStartPosition.CenterParent };
        var summary = new System.Windows.Forms.TextBox { Multiline = true, ReadOnly = true, ScrollBars = System.Windows.Forms.ScrollBars.Vertical, Text = text.ReplaceLineEndings("\r\n"), Bounds = new System.Drawing.Rectangle(12, 12, 496, 236), TabStop = false };
        var no = new System.Windows.Forms.Button { Text = "No", DialogResult = System.Windows.Forms.DialogResult.No, Bounds = new System.Drawing.Rectangle(428, 260, 80, 28) };
        var yes = new System.Windows.Forms.Button { Text = "Yes", DialogResult = System.Windows.Forms.DialogResult.Yes, Bounds = new System.Drawing.Rectangle(340, 260, 80, 28) };
        form.Controls.AddRange([summary, yes, no]);
        form.AcceptButton = no; form.CancelButton = no; form.ActiveControl = no;
        using var timer = new System.Windows.Forms.Timer { Interval = Math.Max(1, declineAfterSeconds) * 1000 };
        timer.Tick += (_, _) => { timer.Stop(); form.DialogResult = System.Windows.Forms.DialogResult.No; };
        if (declineAfterSeconds > 0) timer.Start();
        return AcApp.ShowModalDialog(form) == System.Windows.Forms.DialogResult.Yes;
    }
}
