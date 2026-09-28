using System.Text.Json;
using System.Text.Json.Serialization;

namespace Brawl.Core;

/// <summary>
/// The one JSON setup of the port: content is read with it, and state and events are
/// written with it for the parity tests, so both look exactly like the TypeScript ones.
/// camelCase names, absent optional fields left out, unknown fields refused.
/// </summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = Create();

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            ReadCommentHandling = JsonCommentHandling.Disallow,
        };
        options.Converters.Add(new DiscriminatedConverter<Effect>("type", EffectTypes.ByName));
        options.Converters.Add(new DiscriminatedConverter<Shape>("type", ShapeTypes.ByName));
        options.Converters.Add(new DiscriminatedConverter<ArenaRules>("kind", ArenaRuleTypes.ByName));
        options.Converters.Add(new DiscriminatedConverter<BattleAction>("type", ActionTypes.ByName));
        options.Converters.Add(new DiscriminatedConverter<BattleEvent>("type", EventTypes.ByName));
        options.Converters.Add(new OrderedMapConverterFactory());
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }

    public static T Parse<T>(string text) =>
        JsonSerializer.Deserialize<T>(text, Options) ?? throw new JsonException($"{typeof(T).Name}: null");

    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);
}

/// <summary>An OrderedMap is a JSON object whose keys keep their order.</summary>
public sealed class OrderedMapConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) =>
        typeToConvert.IsGenericType && typeToConvert.GetGenericTypeDefinition() == typeof(OrderedMap<>);

    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
        (JsonConverter)Activator.CreateInstance(typeof(OrderedMapConverter<>).MakeGenericType(typeToConvert.GetGenericArguments()[0]))!;

    private sealed class OrderedMapConverter<TValue> : JsonConverter<OrderedMap<TValue>>
    {
        public override OrderedMap<TValue> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.StartObject) throw new JsonException("expected an object");
            var pairs = new List<KeyValuePair<string, TValue>>();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                string key = reader.GetString()!;
                reader.Read();
                var value = JsonSerializer.Deserialize<TValue>(ref reader, options)!;
                pairs.Add(new(key, value));
            }
            return OrderedMap<TValue>.From(pairs);
        }

        public override void Write(Utf8JsonWriter writer, OrderedMap<TValue> value, JsonSerializerOptions options)
        {
            writer.WriteStartObject();
            foreach (var (key, item) in value)
            {
                writer.WritePropertyName(key);
                JsonSerializer.Serialize(writer, item, options);
            }
            writer.WriteEndObject();
        }
    }
}
