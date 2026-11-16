#if NETFRAMEWORK || MI_JSON_SHIM
using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text;

// AutoCAD 2024 hosts .NET Framework 4.8 with fixed versions of System.Runtime.CompilerServices.Unsafe
// and Newtonsoft.Json in its own folder, and its acad.exe.config has no binding redirects for the
// packages System.Text.Json needs. Shipping those packages would risk a FileLoadException inside
// AutoCAD, so this target uses this small dependency-free subset with the same member names.
// It covers only what the add-in calls. The .NET 10 target keeps System.Text.Json.
namespace Mi.AutoCad.Json
{
    internal abstract class JsonNode
    {
        private protected JsonNode() { }
        public virtual T GetValue<T>() => throw new InvalidOperationException($"A JSON {Kind} cannot be read as {typeof(T).Name}.");
        public abstract JsonNode DeepClone();
        internal abstract string Kind { get; }
        internal abstract void Write(StringBuilder output);
        public string ToJsonString() { var output = new StringBuilder(); Write(output); return output.ToString(); }
        public override string ToString() => ToJsonString();
        public static JsonNode? Parse(string json) => new JsonReader(json).ReadDocument();

        public static implicit operator JsonNode(bool value) => new JsonValue(value);
        public static implicit operator JsonNode(int value) => JsonValue.Number(value.ToString(CultureInfo.InvariantCulture));
        public static implicit operator JsonNode(long value) => JsonValue.Number(value.ToString(CultureInfo.InvariantCulture));
        public static implicit operator JsonNode(double value) => JsonValue.Number(JsonValue.FormatDouble(value));
        public static implicit operator JsonNode?(string? value) => value == null ? null : new JsonValue(value);
    }

    internal sealed class JsonValue : JsonNode
    {
        private readonly object value; // string, bool, or a number's JSON text
        private readonly bool isNumber;
        internal JsonValue(string text) { value = text; }
        internal JsonValue(bool flag) { value = flag; }
        private JsonValue(string text, bool number) { value = text; isNumber = number; }
        internal static JsonValue Number(string text) => new(text, true);
        internal override string Kind => isNumber ? "Number" : value is bool ? "Boolean" : "String";

        public override T GetValue<T>()
        {
            var type = typeof(T);
            if (type == typeof(string) && value is string text && !isNumber) return (T)(object)text;
            if (type == typeof(bool) && value is bool flag) return (T)(object)flag;
            if (isNumber)
            {
                var raw = (string)value;
                const NumberStyles integer = NumberStyles.AllowLeadingSign;
                if (type == typeof(double))
                {
                    double number;
                    try { number = double.Parse(raw, NumberStyles.Float, CultureInfo.InvariantCulture); }
                    catch (OverflowException) { throw new FormatException("The JSON value is not a finite Double."); }
                    if (double.IsNaN(number) || double.IsInfinity(number)) throw new FormatException("The JSON value is not a finite Double.");
                    return (T)(object)number;
                }
                if (type == typeof(int) && int.TryParse(raw, integer, CultureInfo.InvariantCulture, out var i32)) return (T)(object)i32;
                if (type == typeof(long) && long.TryParse(raw, integer, CultureInfo.InvariantCulture, out var i64)) return (T)(object)i64;
                if (type == typeof(short) && short.TryParse(raw, integer, CultureInfo.InvariantCulture, out var i16)) return (T)(object)i16;
                if (type == typeof(int) || type == typeof(long) || type == typeof(short)) throw new FormatException($"The JSON value is not a valid {type.Name}.");
            }
            return base.GetValue<T>();
        }
        public override JsonNode DeepClone() => isNumber ? Number((string)value) : value is bool flag ? new JsonValue(flag) : new JsonValue((string)value);
        // Like System.Text.Json, a string value prints without quotes and anything else prints as JSON.
        public override string ToString() => value is string text && !isNumber ? text : ToJsonString();
        internal override void Write(StringBuilder output)
        {
            if (isNumber) output.Append((string)value);
            else if (value is bool flag) output.Append(flag ? "true" : "false");
            else WriteString(output, (string)value);
        }

        internal static string FormatDouble(double number)
        {
            if (double.IsNaN(number) || double.IsInfinity(number)) throw new ArgumentException("NaN and infinity cannot be written as JSON.");
            // The shortest of G15-G17 that reads back exactly; Framework's "R" format has known round-trip bugs.
            foreach (var format in new[] { "G15", "G16" })
            {
                var text = number.ToString(format, CultureInfo.InvariantCulture);
                // Rounding can pass double.MaxValue, which Framework's parser rejects rather than returning infinity.
                if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var back) && back == number) return text;
            }
            return number.ToString("G17", CultureInfo.InvariantCulture);
        }

        internal static void WriteString(StringBuilder output, string text)
        {
            output.Append('"');
            foreach (var c in text)
            {
                switch (c)
                {
                    case '"': output.Append("\\\""); break;
                    case '\\': output.Append("\\\\"); break;
                    case '\n': output.Append("\\n"); break;
                    case '\r': output.Append("\\r"); break;
                    case '\t': output.Append("\\t"); break;
                    default:
                        // Control characters and line/paragraph separators never reach the line-delimited pipe raw.
                        if (c < 0x20 || c == 0x2028 || c == 0x2029) output.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else output.Append(c);
                        break;
                }
            }
            output.Append('"');
        }
    }

    internal sealed class JsonObject : JsonNode, IEnumerable<KeyValuePair<string, JsonNode?>>
    {
        private readonly Dictionary<string, JsonNode?> values = new(StringComparer.Ordinal);
        private readonly List<string> order = new();
        internal override string Kind => "Object";
        public int Count => order.Count;
        public JsonNode? this[string key]
        {
            get => values.TryGetValue(key, out var value) ? value : null;
            set { if (!values.ContainsKey(key)) order.Add(key); values[key] = value; }
        }
        internal void AddUnique(string key, JsonNode? value)
        {
            // Ambiguous duplicate names (for example two "approval" fields) are refused, never resolved.
            if (values.ContainsKey(key)) throw new FormatException($"Duplicate JSON property '{key}'.");
            this[key] = value;
        }
        public IEnumerator<KeyValuePair<string, JsonNode?>> GetEnumerator() => order.Select(key => new KeyValuePair<string, JsonNode?>(key, values[key])).GetEnumerator();
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        public override JsonNode DeepClone()
        {
            var copy = new JsonObject();
            foreach (var key in order) copy[key] = values[key]?.DeepClone();
            return copy;
        }
        internal override void Write(StringBuilder output)
        {
            output.Append('{');
            for (var i = 0; i < order.Count; i++)
            {
                if (i > 0) output.Append(',');
                JsonValue.WriteString(output, order[i]);
                output.Append(':');
                WriteNode(output, values[order[i]]);
            }
            output.Append('}');
        }
        internal static void WriteNode(StringBuilder output, JsonNode? node) { if (node == null) output.Append("null"); else node.Write(output); }
    }

    internal sealed class JsonArray : JsonNode, IEnumerable<JsonNode?>
    {
        private readonly List<JsonNode?> items = new();
        internal override string Kind => "Array";
        public int Count => items.Count;
        public JsonNode? this[int index] => items[index];
        public void Add(JsonNode? item) => items.Add(item);
        public IEnumerator<JsonNode?> GetEnumerator() => items.GetEnumerator();
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        public override JsonNode DeepClone()
        {
            var copy = new JsonArray();
            foreach (var item in items) copy.Add(item?.DeepClone());
            return copy;
        }
        internal override void Write(StringBuilder output)
        {
            output.Append('[');
            for (var i = 0; i < items.Count; i++) { if (i > 0) output.Append(','); JsonObject.WriteNode(output, items[i]); }
            output.Append(']');
        }
    }

    /// <summary>Strict RFC 8259 reader: one value, no comments or trailing commas, depth at most 64.</summary>
    internal sealed class JsonReader
    {
        private const int MaxDepth = 64;
        private readonly string text;
        private int position;
        internal JsonReader(string json) { text = json ?? throw new ArgumentNullException(nameof(json)); }

        internal JsonNode? ReadDocument()
        {
            var value = ReadValue(0);
            SkipWhitespace();
            if (position != text.Length) throw Error("Unexpected text after the JSON value.");
            return value;
        }
        private FormatException Error(string message) => new($"Invalid JSON at character {position}: {message}");
        private void SkipWhitespace() { while (position < text.Length && text[position] is ' ' or '\t' or '\n' or '\r') position++; }
        private char Peek() => position < text.Length ? text[position] : throw Error("Unexpected end of input.");

        private JsonNode? ReadValue(int depth)
        {
            if (depth > MaxDepth) throw Error("Nesting is too deep.");
            SkipWhitespace();
            switch (Peek())
            {
                case '{': return ReadObject(depth + 1);
                case '[': return ReadArray(depth + 1);
                case '"': return new JsonValue(ReadString());
                case 't': Expect("true"); return new JsonValue(true);
                case 'f': Expect("false"); return new JsonValue(false);
                case 'n': Expect("null"); return null;
                default: return ReadNumber();
            }
        }
        private void Expect(string literal)
        {
            if (string.CompareOrdinal(text, position, literal, 0, literal.Length) != 0) throw Error($"Expected {literal}.");
            position += literal.Length;
        }
        private JsonObject ReadObject(int depth)
        {
            var result = new JsonObject();
            position++;
            SkipWhitespace();
            if (Peek() == '}') { position++; return result; }
            while (true)
            {
                SkipWhitespace();
                if (Peek() != '"') throw Error("Expected a property name.");
                var key = ReadString();
                SkipWhitespace();
                if (Peek() != ':') throw Error("Expected ':'.");
                position++;
                result.AddUnique(key, ReadValue(depth));
                SkipWhitespace();
                var next = Peek(); position++;
                if (next == '}') return result;
                if (next != ',') throw Error("Expected ',' or '}'.");
            }
        }
        private JsonArray ReadArray(int depth)
        {
            var result = new JsonArray();
            position++;
            SkipWhitespace();
            if (Peek() == ']') { position++; return result; }
            while (true)
            {
                result.Add(ReadValue(depth));
                SkipWhitespace();
                var next = Peek(); position++;
                if (next == ']') return result;
                if (next != ',') throw Error("Expected ',' or ']'.");
            }
        }
        private string ReadString()
        {
            position++; // opening quote
            var output = new StringBuilder();
            while (true)
            {
                var c = Peek(); position++;
                if (c == '"') return output.ToString();
                if (c < 0x20) throw Error("Control character in string.");
                if (c != '\\') { output.Append(c); continue; }
                var escape = Peek(); position++;
                switch (escape)
                {
                    case '"': output.Append('"'); break;
                    case '\\': output.Append('\\'); break;
                    case '/': output.Append('/'); break;
                    case 'b': output.Append('\b'); break;
                    case 'f': output.Append('\f'); break;
                    case 'n': output.Append('\n'); break;
                    case 'r': output.Append('\r'); break;
                    case 't': output.Append('\t'); break;
                    case 'u':
                        if (position + 4 > text.Length || !int.TryParse(text.Substring(position, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var code)) throw Error("Invalid \\u escape.");
                        output.Append((char)code); position += 4; break;
                    default: throw Error("Invalid escape.");
                }
            }
        }
        private JsonValue ReadNumber()
        {
            var start = position;
            if (position < text.Length && text[position] == '-') position++;
            if (position < text.Length && text[position] == '0') position++;
            else if (position < text.Length && text[position] is >= '1' and <= '9') Digits();
            else throw Error("Expected a value.");
            if (position < text.Length && text[position] == '.') { position++; if (!Digits()) throw Error("Expected digits after '.'."); }
            if (position < text.Length && text[position] is 'e' or 'E')
            {
                position++;
                if (position < text.Length && text[position] is '+' or '-') position++;
                if (!Digits()) throw Error("Expected exponent digits.");
            }
            return JsonValue.Number(text.Substring(start, position - start));
        }
        private bool Digits()
        {
            var start = position;
            while (position < text.Length && text[position] is >= '0' and <= '9') position++;
            return position > start;
        }
    }

    /// <summary>Serializes the add-in's result objects the way System.Text.Json's defaults do.</summary>
    internal static class JsonSerializer
    {
        private const int MaxDepth = 64;
        public static string Serialize(object? value) { var output = new StringBuilder(); JsonObject.WriteNode(output, SerializeToNode(value)); return output.ToString(); }
        public static JsonNode? SerializeToNode(object? value) => Convert(value, 0);

        private static JsonNode? Convert(object? value, int depth)
        {
            if (depth > MaxDepth) throw new InvalidOperationException("The object graph is too deep to serialize.");
            switch (value)
            {
                case null: return null;
                case JsonNode node: return node.DeepClone();
                case string text: return new JsonValue(text);
                case bool flag: return new JsonValue(flag);
                case char c: return new JsonValue(c.ToString());
                case double d: return JsonValue.Number(JsonValue.FormatDouble(d));
                case float f:
                    if (float.IsNaN(f) || float.IsInfinity(f)) throw new ArgumentException("NaN and infinity cannot be written as JSON.");
                    return JsonValue.Number(f.ToString("R", CultureInfo.InvariantCulture));
                case decimal m: return JsonValue.Number(m.ToString(CultureInfo.InvariantCulture));
                case DateTime time: return new JsonValue(time.ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss.FFFFFFFK", CultureInfo.InvariantCulture));
                case DateTimeOffset time: return new JsonValue(time.ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss.FFFFFFFzzz", CultureInfo.InvariantCulture));
                case Guid id: return new JsonValue(id.ToString("D"));
                case Enum e: return JsonValue.Number(System.Convert.ToInt64(e, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture)); // Enums are numbers by default.
                case sbyte or byte or short or ushort or int or uint or long or ulong:
                    return JsonValue.Number(((IFormattable)value).ToString(null, CultureInfo.InvariantCulture));
                case IDictionary dictionary:
                    var map = new JsonObject();
                    foreach (DictionaryEntry entry in dictionary) map[System.Convert.ToString(entry.Key, CultureInfo.InvariantCulture) ?? ""] = Convert(entry.Value, depth + 1);
                    return map;
                case IEnumerable sequence:
                    var array = new JsonArray();
                    foreach (var item in sequence) array.Add(Convert(item, depth + 1));
                    return array;
            }
            var result = new JsonObject();
            foreach (var property in value.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!property.CanRead || property.GetIndexParameters().Length != 0) continue;
                result[property.Name] = Convert(property.GetValue(value), depth + 1);
            }
            return result;
        }
    }
}
#endif
