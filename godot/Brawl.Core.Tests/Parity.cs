using System.Text.Json;

namespace Brawl.Core.Tests;

/// <summary>
/// Helpers for comparing the C# core with the TypeScript one through the fixtures that
/// `npm run parity` writes. JSON is compared as data: object fields in any order,
/// numbers by value, and a field that is null counts as absent (TypeScript writes
/// `null` where C# leaves an optional field out, and the other way round).
/// </summary>
public static class Parity
{
    public static string RepoRoot { get; } = FindRoot();

    public static string ContentFolder => Path.Combine(RepoRoot, "src", "content");

    public static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(RepoRoot, "godot", "Brawl.Core.Tests", "Fixtures", name));

    public static JsonElement FixtureJson(string name) => JsonDocument.Parse(Fixture(name)).RootElement;

    private static ContentRegistry? content;

    public static ContentRegistry Content => content ??= ContentLoader.LoadFrom(ContentFolder);

    private static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "package.json"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repository root not found");
    }

    /// <summary>The C# value as JSON, the way the TypeScript side would write it.</summary>
    public static JsonElement ToJson<T>(T value) => JsonDocument.Parse(Json.Write(value)).RootElement;

    /// <summary>Where the two differ, as a path such as "heroes.a1.hp: 10 vs 12"; null if they agree.</summary>
    public static string? Difference(JsonElement expected, JsonElement actual, string path = "$")
    {
        if (IsNullish(expected) && IsNullish(actual)) return null;
        if (expected.ValueKind != actual.ValueKind)
            return $"{path}: {Show(expected)} vs {Show(actual)}";
        switch (expected.ValueKind)
        {
            case JsonValueKind.Object:
            {
                var keys = expected.EnumerateObject().Where(p => !IsNullish(p.Value)).Select(p => p.Name)
                    .Union(actual.EnumerateObject().Where(p => !IsNullish(p.Value)).Select(p => p.Name));
                foreach (string key in keys)
                {
                    var e = expected.TryGetProperty(key, out var ev) ? ev : default;
                    var a = actual.TryGetProperty(key, out var av) ? av : default;
                    string? diff = Difference(e, a, $"{path}.{key}");
                    if (diff is not null) return diff;
                }
                return null;
            }
            case JsonValueKind.Array:
            {
                int n = expected.GetArrayLength();
                if (n != actual.GetArrayLength())
                    return $"{path}: length {n} vs {actual.GetArrayLength()}\n  expected {Clip(expected.GetRawText())}\n  actual   {Clip(actual.GetRawText())}";
                for (int i = 0; i < n; i++)
                {
                    string? diff = Difference(expected[i], actual[i], $"{path}[{i}]");
                    if (diff is not null) return diff;
                }
                return null;
            }
            case JsonValueKind.Number:
                return expected.GetDouble().Equals(actual.GetDouble()) ? null : $"{path}: {expected} vs {actual}";
            case JsonValueKind.String:
                return expected.GetString() == actual.GetString() ? null : $"{path}: {expected} vs {actual}";
            default:
                return expected.ValueKind == actual.ValueKind ? null : $"{path}: {Show(expected)} vs {Show(actual)}";
        }
    }

    public static void AssertSame(JsonElement expected, JsonElement actual, string what)
    {
        string? diff = Difference(expected, actual);
        Assert.True(diff is null, $"{what} differs from TypeScript at {diff}");
    }

    private static bool IsNullish(JsonElement e) =>
        e.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null;

    private static string Clip(string text) => text.Length <= 1500 ? text : text[..1500] + "…";

    private static string Show(JsonElement e) => e.ValueKind == JsonValueKind.Undefined ? "(absent)" : e.GetRawText();
}
