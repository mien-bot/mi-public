using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Grid = System.Windows.Controls.Grid;
using TextBox = System.Windows.Controls.TextBox;
using Window = System.Windows.Window;

namespace Mi.Revit.Tools;

internal sealed record ReportRow(string Text, IReadOnlyCollection<ElementId> Ids)
{
    public override string ToString() => Text;
}

/// Searchable single choice, returning the index into the list it was given.
internal sealed class PickWindow : Window
{
    public int? Picked { get; private set; }

    public PickWindow(string title, string action, IReadOnlyList<string> labels, IntPtr owner)
    {
        Title = $"{title} (type to filter)"; Width = 480; Height = 560; WindowStartupLocation = WindowStartupLocation.CenterOwner;
        new WindowInteropHelper(this).Owner = owner;
        var filter = new TextBox { Margin = new Thickness(8) };
        var list = new ListBox { Margin = new Thickness(8, 0, 8, 0) };
        var open = new Button { Content = action, Margin = new Thickness(8), Padding = new Thickness(12, 4, 12, 4), HorizontalAlignment = HorizontalAlignment.Right, IsDefault = true };
        void Apply()
        {
            var terms = filter.Text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            list.ItemsSource = labels.Select((label, index) => (label, index)).Where(item => terms.All(term => item.label.Contains(term, StringComparison.OrdinalIgnoreCase))).Select(item => new ReportChoice(item.label, item.index)).ToList();
            list.SelectedIndex = list.Items.Count > 0 ? 0 : -1;
        }
        void Accept()
        {
            if (list.SelectedItem is not ReportChoice choice) return;
            Picked = choice.Index; DialogResult = true;
        }
        filter.TextChanged += (_, _) => Apply();
        filter.PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.Down && list.SelectedIndex < list.Items.Count - 1) { list.SelectedIndex++; list.ScrollIntoView(list.SelectedItem); e.Handled = true; }
            if (e.Key == Key.Up && list.SelectedIndex > 0) { list.SelectedIndex--; list.ScrollIntoView(list.SelectedItem); e.Handled = true; }
        };
        list.MouseDoubleClick += (_, _) => Accept();
        open.Click += (_, _) => Accept();
        Apply();
        Content = Stack(filter, list, open);
        Loaded += (_, _) => filter.Focus();
    }

    sealed record ReportChoice(string Label, int Index)
    {
        public override string ToString() => Label;
    }

    static Grid Stack(UIElement top, UIElement middle, UIElement bottom)
    {
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition());
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(middle, 1); Grid.SetRow(bottom, 2);
        grid.Children.Add(top); grid.Children.Add(middle); grid.Children.Add(bottom);
        return grid;
    }
}

/// Modeless results list. Selecting a row zooms through an ExternalEvent, the only route
/// back onto Revit's API thread once the command that opened this window has returned.
internal sealed class ReportWindow : Window
{
    sealed class Zoom(Document document, Action<string> report) : IExternalEventHandler
    {
        public IReadOnlyCollection<ElementId> Ids = [];
        public string GetName() => "Mi Tools report zoom";
        public void Execute(UIApplication app)
        {
            if (app.ActiveUIDocument is not { } view || !view.Document.Equals(document)) { report("Switch back to this report's model to zoom."); return; }
            var live = Ids.Where(id => document.GetElement(id) is not null).ToList();
            if (live.Count == 0) { report("Those elements are no longer in the model."); return; }
            try { view.ShowElements(live); view.Selection.SetElementIds(live); report(""); }
            catch (Exception ex) { report(ex.Message); }
        }
    }

    public static void Open(UIApplication app, Document document, string title, string summary, IReadOnlyList<ReportRow> rows) =>
        new ReportWindow(app, document, title, summary, rows).Show();

    ReportWindow(UIApplication app, Document document, string title, string summary, IReadOnlyList<ReportRow> rows)
    {
        Title = title; Width = 720; Height = 520;
        new WindowInteropHelper(this).Owner = app.MainWindowHandle;
        var heading = new TextBlock { Text = summary, Margin = new Thickness(8), FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap };
        var status = new TextBlock { Margin = new Thickness(8), TextWrapping = TextWrapping.Wrap };
        var handler = new Zoom(document, text => status.Text = text);
        var zoom = ExternalEvent.Create(handler);
        var list = new ListBox { ItemsSource = rows, Margin = new Thickness(8, 0, 8, 0) };
        list.SelectionChanged += (_, _) =>
        {
            if (list.SelectedItem is not ReportRow row) return;
            handler.Ids = row.Ids;
            zoom.Raise();
        };
        Closed += (_, _) => zoom.Dispose();
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition());
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(list, 1); Grid.SetRow(status, 2);
        grid.Children.Add(heading); grid.Children.Add(list); grid.Children.Add(status);
        Content = grid;
    }
}
