using System.Text.Json;

namespace Brawl.Core.Tests;

/// <summary>The generator, hex geometry and content read the same as in TypeScript.</summary>
public class FoundationTests
{
    [Fact]
    public void RngMatchesTypeScript()
    {
        foreach (var fixture in Parity.FixtureJson("rng.json").EnumerateArray())
        {
            var rng = Rng.Create(fixture.GetProperty("seed").GetDouble());
            foreach (var expected in fixture.GetProperty("floats").EnumerateArray())
            {
                var (v, next) = Rng.NextFloat(rng);
                Assert.Equal(expected.GetDouble(), v);
                rng = next;
            }
            foreach (var expected in fixture.GetProperty("ints").EnumerateArray())
            {
                var (v, next) = Rng.NextInt(rng, -3, 17);
                Assert.Equal(expected.GetInt32(), v);
                rng = next;
            }
            var (shuffled, _) = Rng.Shuffle(rng, ["a", "b", "c", "d", "e", "f", "g", "h"]);
            Assert.Equal(fixture.GetProperty("shuffled").EnumerateArray().Select(e => e.GetString()), shuffled);
        }
    }

    [Theory]
    [InlineData(2.5, 3)]
    [InlineData(-2.5, -2)]
    [InlineData(0.49999999999999994, 0)]
    [InlineData(-0.5, 0)]
    [InlineData(1.4, 1)]
    public void RoundsHalvesUpLikeJavaScript(double x, double expected) => Assert.Equal(expected, JsMath.Round(x));

    [Fact]
    public void HexLinesDirectionsAndRingsMatchTypeScript()
    {
        var hex = Parity.FixtureJson("hex.json");
        foreach (var item in hex.GetProperty("lines").EnumerateArray())
        {
            var line = HexMath.HexLine(ReadHex(item.GetProperty("a")), ReadHex(item.GetProperty("b")));
            Parity.AssertSame(item.GetProperty("line"), Parity.ToJson(line), "hexLine");
        }
        foreach (var item in hex.GetProperty("directions").EnumerateArray())
        {
            var dir = HexMath.NearestDirection(ReadHex(item.GetProperty("a")), ReadHex(item.GetProperty("b")));
            Parity.AssertSame(item.GetProperty("dir"), Parity.ToJson(dir), "nearestDirection");
        }
        foreach (var item in hex.GetProperty("rings").EnumerateArray())
        {
            var ring = HexMath.Ring(new Hex(1, -2), item.GetProperty("radius").GetInt32());
            Parity.AssertSame(item.GetProperty("ring"), Parity.ToJson(ring), "ring");
        }
    }

    [Fact]
    public void ContentReadsLikeTheTypeScriptRegistry()
    {
        var expected = Parity.FixtureJson("content.json");
        Parity.AssertSame(expected, Parity.ToJson(Parity.Content), "content");
    }

    [Fact]
    public void ContentKeepsTheOrderOfTheFiles()
    {
        // Iteration order is part of the rules (Object.values in TypeScript), so ids come
        // out in the same order as in the TypeScript registry.
        var expected = Parity.FixtureJson("content.json");
        Assert.Equal(expected.GetProperty("abilities").EnumerateObject().Select(p => p.Name), Parity.Content.Abilities.Keys);
        Assert.Equal(expected.GetProperty("statuses").EnumerateObject().Select(p => p.Name), Parity.Content.Statuses.Keys);
        Assert.Equal(expected.GetProperty("perks").EnumerateObject().Select(p => p.Name), Parity.Content.Perks.Keys);
        Assert.Equal(expected.GetProperty("items").EnumerateObject().Select(p => p.Name), Parity.Content.Items.Keys);
    }

    [Fact]
    public void UnknownFieldsInContentAreRefused()
    {
        Assert.ThrowsAny<JsonException>(() => Json.Parse<StatGrowth>("{\"hp\":1,\"primary\":1,\"secondary\":1,\"extra\":2}"));
    }

    [Fact]
    public void OrderedMapKeepsInsertionOrder()
    {
        var map = OrderedMap<int>.Empty.Set("b", 1).Set("a", 2).Set("c", 3).Set("b", 9).Remove("a");
        Assert.Equal(["b", "c"], map.Keys);
        Assert.Equal(9, map["b"]);
    }

    private static Hex ReadHex(JsonElement e) => new(e.GetProperty("q").GetInt32(), e.GetProperty("r").GetInt32());
}
