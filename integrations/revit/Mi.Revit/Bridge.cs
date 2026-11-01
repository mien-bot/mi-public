using Autodesk.Revit.UI;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Mi.Revit;

internal sealed class Work(JsonObject request, CancellationToken cancellation)
{
    internal readonly JsonObject Request = request;
    internal readonly CancellationToken Cancellation = cancellation;
    internal readonly DateTime Deadline = DateTime.UtcNow.AddSeconds(55);
    internal readonly TaskCompletionSource<JsonObject> Result = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal void Check() { Cancellation.ThrowIfCancellationRequested(); if (DateTime.UtcNow >= Deadline) throw new TimeoutException("Request expired; prepare a new request."); }
}

internal sealed class Bridge : IExternalEventHandler, IDisposable
{
    internal readonly Operations Handler;
    private readonly ExternalEvent externalEvent;
    private readonly ConcurrentQueue<Work> queue = new();
    private CancellationTokenSource? lifetime;
    private string? discoveryFile;
    private readonly SemaphoreSlim clients = new(8);
    internal bool Running => lifetime is { IsCancellationRequested: false };
    internal Bridge(Operations handler) { Handler = handler; externalEvent = ExternalEvent.Create(this); }
    internal void Start()
    {
        if (Running) return;
        Handler.Reset();
        lifetime = new CancellationTokenSource();
        var session = Guid.NewGuid().ToString("N");
        var pipe = $"mi-revit-{Environment.ProcessId}-{session}";
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mi", "Revit", "sessions");
        Directory.CreateDirectory(directory);
        discoveryFile = Path.Combine(directory, session + ".json");
        File.WriteAllText(discoveryFile, JsonSerializer.Serialize(new { schema = 1, application = "Revit", year = "2026", pid = Environment.ProcessId, session, pipe, version = "0.1.0" }), new UTF8Encoding(false));
        _ = Listen(pipe, lifetime.Token);
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
                stream = new NamedPipeServerStream(name, PipeDirection.InOut, 8, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await stream.WaitForConnectionAsync(cancellation);
                _ = Serve(stream, cancellation);
                stream = null; acquired = false; // Serve owns both resources.
            }
            catch (OperationCanceledException) { break; }
            catch (Exception) { if (!cancellation.IsCancellationRequested) await Task.Delay(500, cancellation).ConfigureAwait(false); }
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
                while (await reader.ReadAsync(buffer.AsMemory(), timeout.Token) > 0 && buffer[0] != '\n')
                {
                    if (text.Length >= 1_048_576) throw new InvalidDataException("Request too large.");
                    text.Append(buffer[0]);
                }
                var request = JsonNode.Parse(text.ToString()) as JsonObject ?? throw new InvalidDataException("Expected an object.");
                if (queue.Count >= 16) throw new InvalidOperationException("Revit request queue is full.");
                var work = new Work(request, timeout.Token);
                queue.Enqueue(work);
                if (externalEvent.Raise() == ExternalEventRequest.Denied) throw new InvalidOperationException("Revit is unavailable; try again when idle.");
                JsonObject result;
                try { result = await work.Result.Task.WaitAsync(timeout.Token); }
                catch (OperationCanceledException) { result = new JsonObject { ["ok"] = false, ["error"] = "Revit request expired. Do not automatically retry edits; inspect the model first." }; }
                await writer.WriteLineAsync(result.ToJsonString().AsMemory(), lifetimeToken);
            }
            catch (Exception) { /* Broken connections never log model data or crash Revit. */ }
            finally { clients.Release(); }
        }
    }
    public void Execute(UIApplication app)
    {
        while (queue.TryDequeue(out var work))
        {
            try { work.Check(); work.Result.TrySetResult(new JsonObject { ["ok"] = true, ["result"] = Handler.Run(app, work) }); }
            catch (Exception ex) { work.Result.TrySetResult(new JsonObject { ["ok"] = false, ["error"] = ex.Message }); }
        }
    }
    public string GetName() => "Mi CAD bounded request queue";
    internal void Stop()
    {
        lifetime?.Cancel();
        while (queue.TryDequeue(out var work)) work.Result.TrySetCanceled();
        Handler.Reset();
        if (discoveryFile != null) { try { File.Delete(discoveryFile); } catch (IOException) { } }
        discoveryFile = null;
    }
    public void Dispose() { Stop(); externalEvent.Dispose(); lifetime?.Dispose(); }
}
