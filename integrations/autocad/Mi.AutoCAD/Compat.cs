#if NETFRAMEWORK
global using Mi.AutoCad.Json;
#else
global using System.Text.Json;
global using System.Text.Json.Nodes;
#endif
using System.IO.Pipes;

namespace Mi.AutoCad
{
    /// <summary>The release this build targets. The loaded API version is read at runtime instead.</summary>
    internal static class Target
    {
        internal const string AddinVersion = "0.2.0";
#if NETFRAMEWORK
        internal const string Year = "2024";
        internal const string Framework = "net48";
#else
        internal const string Year = "2027";
        internal const string Framework = "net10.0-windows";
#endif
        internal static string ApiVersion => typeof(Autodesk.AutoCAD.ApplicationServices.Document).Assembly.GetName().Version?.ToString() ?? "unknown";
    }

    // One place for every difference between .NET 10 (AutoCAD 2027) and .NET Framework 4.8 (AutoCAD 2024).
    // Operation logic calls these helpers and stays identical on both targets.
    internal static class Compat
    {
        internal static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

        internal static int ProcessId
        {
            get
            {
#if NETFRAMEWORK
                using var process = System.Diagnostics.Process.GetCurrentProcess();
                return process.Id;
#else
                return Environment.ProcessId;
#endif
            }
        }

        /// <summary>Compares secrets without leaking, through timing, how much of a guess was right.</summary>
        internal static bool FixedTimeEquals(byte[] left, byte[] right)
        {
#if NETFRAMEWORK
            if (left.Length != right.Length) return false;
            var difference = 0;
            for (var i = 0; i < left.Length; i++) difference |= left[i] ^ right[i];
            return difference == 0;
#else
            return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(left, right);
#endif
        }

        /// <summary>
        /// A pipe only this Windows user can open, and never from the network. .NET 10 provides this as
        /// CurrentUserOnly. On Framework 4.8 the same protection is an explicit, non-inherited ACL.
        /// </summary>
        internal static NamedPipeServerStream CreatePipeServer(string name, int maxInstances)
        {
#if NETFRAMEWORK
            var user = System.Security.Principal.WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("Cannot identify the current Windows user.");
            var security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.SetOwner(user);
            security.AddAccessRule(new PipeAccessRule(user, PipeAccessRights.FullControl, System.Security.AccessControl.AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new System.Security.Principal.SecurityIdentifier(System.Security.Principal.WellKnownSidType.NetworkSid, null),
                PipeAccessRights.FullControl, System.Security.AccessControl.AccessControlType.Deny));
            return new NamedPipeServerStream(name, PipeDirection.InOut, maxInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security);
#else
            return new NamedPipeServerStream(name, PipeDirection.InOut, maxInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
#endif
        }

        /// <summary>Reads one character, giving up when the token is cancelled.</summary>
        internal static async Task<int> ReadAsync(StreamReader reader, char[] buffer, CancellationToken cancellation)
        {
#if NETFRAMEWORK
            // Framework's reader takes no token. Abandoning the read is safe: the caller disposes the pipe.
            return await reader.ReadAsync(buffer, 0, buffer.Length).WaitAsync(cancellation).ConfigureAwait(false);
#else
            return await reader.ReadAsync(buffer.AsMemory(), cancellation).ConfigureAwait(false);
#endif
        }

        internal static async Task WriteLineAsync(StreamWriter writer, string line, CancellationToken cancellation)
        {
#if NETFRAMEWORK
            await writer.WriteLineAsync(line).WaitAsync(cancellation).ConfigureAwait(false);
#else
            await writer.WriteLineAsync(line.AsMemory(), cancellation).ConfigureAwait(false);
#endif
        }
    }

#if NETFRAMEWORK
    /// <summary>Framework 4.8 lacks these .NET Core members. Instance members win on .NET 10, so these only bind here.</summary>
    internal static class FrameworkExtensions
    {
        internal static bool Remove<TKey, TValue>(this Dictionary<TKey, TValue> dictionary, TKey key, out TValue value) where TKey : notnull
        {
            if (!dictionary.TryGetValue(key, out value!)) return false;
            dictionary.Remove(key);
            return true;
        }

        internal static bool Contains(this string text, string value, StringComparison comparison) => text.IndexOf(value, comparison) >= 0;

        internal static IEnumerable<(TFirst First, TSecond Second)> Zip<TFirst, TSecond>(this IEnumerable<TFirst> first, IEnumerable<TSecond> second) =>
            first.Zip(second, (a, b) => (a, b));

        internal static string ReplaceLineEndings(this string text, string replacement) =>
            text.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", replacement);

        internal static async Task<T> WaitAsync<T>(this Task<T> task, CancellationToken cancellation)
        {
            await WaitAsync((Task)task, cancellation).ConfigureAwait(false);
            return await task.ConfigureAwait(false);
        }

        internal static async Task WaitAsync(this Task task, CancellationToken cancellation)
        {
            if (task.IsCompleted) { await task.ConfigureAwait(false); return; }
            var cancelled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using (cancellation.Register(() => cancelled.TrySetResult(true)))
            {
                if (await Task.WhenAny(task, cancelled.Task).ConfigureAwait(false) != task) throw new OperationCanceledException(cancellation);
            }
            await task.ConfigureAwait(false);
        }
    }
#endif
}

#if NETFRAMEWORK
namespace System.Runtime.CompilerServices
{
    // Lets positional records compile for Framework 4.8; the compiler needs only the type's existence.
    internal static class IsExternalInit { }
}
#endif
