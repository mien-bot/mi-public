using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text;
using System.Windows.Threading;

namespace Mi.AutoCad;

internal sealed class Work(JsonObject request, CancellationToken cancellation)
{
    internal readonly JsonObject Request = request;
    internal readonly CancellationToken Cancellation = cancellation;
    internal readonly DateTime Deadline = DateTime.UtcNow.AddSeconds(55);
    internal readonly TaskCompletionSource<JsonObject> Result = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal void Check() { Cancellation.ThrowIfCancellationRequested(); if (DateTime.UtcNow >= Deadline) throw new TimeoutException("Request expired; prepare a new request."); }
}

// AutoCAD's API is single-threaded. Pipe workers only queue; the dispatcher captured on
// AutoCAD's main thread runs everything. Revit's ExternalEvent has no equivalent here.
internal sealed class Bridge : IDisposable
{
    internal readonly Operations Handler;
    private readonly Dispatcher dispatcher = Dispatcher.CurrentDispatcher;
    private readonly ConcurrentQueue<Work> queue = new();
    private readonly SemaphoreSlim clients = new(8);
    private CancellationTokenSource? lifetime;
    private string? discoveryFile;
    private bool draining;
    internal bool Running => lifetime is { IsCancellationRequested: false };
    internal Bridge(Operations handler) => Handler = handler;
    internal void Start()
    {
        if (Running) return;
        Handler.Reset();
        lifetime = new CancellationTokenSource();
        var session = Guid.NewGuid().ToString("N");
        var pipe = $"mi-autocad-{Compat.ProcessId}-{session}";
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mi", "AutoCAD", "sessions");
        Directory.CreateDirectory(directory);
        discoveryFile = Path.Combine(directory, session + ".json");
        File.WriteAllText(discoveryFile, JsonSerializer.Serialize(new { schema = 1, application = "AutoCAD", year = Target.Year, apiVersion = Target.ApiVersion, framework = Target.Framework, pid = Compat.ProcessId, session, pipe, version = Target.AddinVersion }), new UTF8Encoding(false));
        _ = Task.Run(() => Listen(pipe, lifetime.Token));
    }
    private async Task Listen(string name, CancellationToken cancellation)
    {
        while (!cancellation.IsCancellationRequested)
        {
            NamedPipeServerStream? stream = null;
            var acquired = false;
            try
            {
                await clients.WaitAsync(cancellation); acquired = true;
                stream = Compat.CreatePipeServer(name, 8);
                await stream.WaitForConnectionAsync(cancellation);
                _ = Serve(stream, cancellation);
                stream = null; acquired = false; // Serve owns both resources.
            }
            catch (OperationCanceledException) { break; }
            catch (System.Exception) { if (!cancellation.IsCancellationRequested) await Task.Delay(500, cancellation).ConfigureAwait(false); }
            finally { stream?.Dispose(); if (acquired) clients.Release(); }
        }
    }
    private async Task Serve(NamedPipeServerStream stream, CancellationToken lifetimeToken)
    {
        using (stream)
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetimeToken))
        {
            timeout.CancelAfter(TimeSpan.FromSeconds(60));
            try
            {
                using var reader = new StreamReader(stream, new UTF8Encoding(false, true), false, 4096, true);
                using var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
                var text = new StringBuilder();
                var buffer = new char[1];
                while (await Compat.ReadAsync(reader, buffer, timeout.Token) > 0 && buffer[0] != '\n')
                {
                    if (text.Length >= 1_048_576) throw new InvalidDataException("Request too large.");
                    text.Append(buffer[0]);
                }
                var request = JsonNode.Parse(text.ToString()) as JsonObject ?? throw new InvalidDataException("Expected an object.");
                if (queue.Count >= 16) throw new InvalidOperationException("AutoCAD request queue is full.");
                var work = new Work(request, timeout.Token);
                queue.Enqueue(work);
                // Priorities below Input wait for WPF's own idle check, which AutoCAD's message loop never satisfies.
                _ = dispatcher.BeginInvoke(DispatcherPriority.Normal, Drain);
                JsonObject result;
                try { result = await work.Result.Task.WaitAsync(timeout.Token); }
                catch (OperationCanceledException) { result = new JsonObject { ["ok"] = false, ["error"] = "AutoCAD request expired. Do not automatically retry edits; inspect the drawing first." }; }
                await Compat.WriteLineAsync(writer, result.ToJsonString(), lifetimeToken);
            }
            catch (System.Exception) { /* Broken connections never log drawing data or crash AutoCAD. */ }
            finally { clients.Release(); }
        }
    }
    private void Drain()
    {
        // A review dialog pumps messages, so this can be re-entered while one request is open.
        // The outer loop picks up anything queued meanwhile; requests never interleave.
        if (draining) return;
        draining = true;
        try
        {
            while (queue.TryDequeue(out var work))
            {
                // Opening a file from this dispatcher callback is refused with "Invalid execution
                // context", even though AutoCAD reports application context (found live in 2024).
                // AutoCAD's own Idle event is a point where it accepts it, so an open waits for that.
                // A modal window in AutoCAD, such as Drawing Recovery, holds Idle back; the open then
                // gives up with a clear answer before the request itself expires, and nothing opens.
                if (NeedsApplicationContext(work))
                {
                    var deferred = work;
                    var started = false;
                    EventHandler? onIdle = null;
                    onIdle = (_, _) => { Autodesk.AutoCAD.ApplicationServices.Application.Idle -= onIdle; started = true; Complete(deferred); };
                    Autodesk.AutoCAD.ApplicationServices.Application.Idle += onIdle;
                    _ = Task.Delay(TimeSpan.FromSeconds(45)).ContinueWith(_ => dispatcher.BeginInvoke(DispatcherPriority.Normal, new Action(() =>
                    {
                        if (started) return;
                        Autodesk.AutoCAD.ApplicationServices.Application.Idle -= onIdle;
                        deferred.Result.TrySetResult(new JsonObject { ["ok"] = false, ["error"] = "AutoCAD stayed busy, so the drawing was not opened. A dialog may be open in AutoCAD; ask the person to close it, then try again. Nothing changed." });
                    })), TaskScheduler.Default);
                    continue;
                }
                Complete(work);
            }
        }
        finally { draining = false; }
    }
    // A malformed method must not throw here, outside Complete's error handling.
    private static bool NeedsApplicationContext(Work work)
    {
        try { return work.Request["method"]?.GetValue<string>() == "open"; }
        catch (System.Exception) { return false; }
    }
    private void Complete(Work work)
    {
        try { work.Check(); work.Result.TrySetResult(new JsonObject { ["ok"] = true, ["result"] = Handler.Run(work) }); }
        catch (System.Exception ex) { work.Result.TrySetResult(new JsonObject { ["ok"] = false, ["error"] = ex.Message }); }
    }
    internal void Stop()
    {
        lifetime?.Cancel();
        while (queue.TryDequeue(out var work)) work.Result.TrySetCanceled();
        Handler.Reset();
        if (discoveryFile != null) { try { File.Delete(discoveryFile); } catch (IOException) { } }
        discoveryFile = null;
    }
    public void Dispose() { Stop(); lifetime?.Dispose(); }
}
