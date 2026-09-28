using System.Text.Json;
using System.Text.Json.Serialization;

namespace Brawl.Core;

/// <summary>
/// Reads a family of records told apart by one field ("type" of an effect, "kind" of an
/// arena rule), as Zod's discriminatedUnion does. The derived record keeps the field as a
/// plain property, so unknown fields can still be refused.
/// </summary>
public sealed class DiscriminatedConverter<TBase>(string field, IReadOnlyDictionary<string, Type> types) : JsonConverter<TBase>
    where TBase : class
{
    public override bool CanConvert(Type typeToConvert) => typeToConvert == typeof(TBase);

    public override TBase? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var root = document.RootElement;
        if (!root.TryGetProperty(field, out var tag) || tag.ValueKind != JsonValueKind.String)
            throw new JsonException($"{typeof(TBase).Name}: missing \"{field}\"");
        string name = tag.GetString()!;
        if (!types.TryGetValue(name, out var concrete))
            throw new JsonException($"{typeof(TBase).Name}: unknown {field} \"{name}\"");
        return (TBase?)root.Deserialize(concrete, options);
    }

    public override void Write(Utf8JsonWriter writer, TBase value, JsonSerializerOptions options) =>
        JsonSerializer.Serialize(writer, value, value.GetType(), options);
}
