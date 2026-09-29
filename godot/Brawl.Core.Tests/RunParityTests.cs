using System.IO.Compression;
using System.Text.Json;

namespace Brawl.Core.Tests;

/// <summary>
/// The run recorded in TypeScript (npm run parity, runs.json.gz), replayed through the C#
/// core: draft pools, every run action and the state after it, the starting state of
/// every match, refusals of illegal actions, the run AI's choices and the ability texts
/// on the hero cards.
/// </summary>
public class RunParityTests
{
    private static readonly Lazy<JsonElement> Data = new(() =>
    {
        string path = Path.Combine(Parity.RepoRoot, "godot", "Brawl.Core.Tests", "Fixtures", "runs.json.gz");
        using var file = File.OpenRead(path);
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var document = JsonDocument.Parse(gzip);
        return document.RootElement.Clone();
    });

    private static IEnumerable<JsonElement> Runs => Data.Value.GetProperty("runs").EnumerateArray();

    private static JsonElement Run(string name) => Runs.First(r => r.GetProperty("name").GetString() == name);

    public static IEnumerable<object[]> PoolSeeds() =>
        Data.Value.GetProperty("pools").EnumerateArray().Select(p => new object[] { p.GetProperty("seed").GetInt32() });

    public static IEnumerable<object[]> RunNames() => Runs.Select(r => new object[] { r.GetProperty("name").GetString()! });

    public static IEnumerable<object[]> AiRunNames() =>
        Runs.Where(r => !r.GetProperty("scripted").GetBoolean()).Select(r => new object[] { r.GetProperty("name").GetString()! });

    [Theory]
    [MemberData(nameof(PoolSeeds))]
    public void GeneratesThePoolLikeTypeScript(int seed)
    {
        var expected = Data.Value.GetProperty("pools").EnumerateArray().First(p => p.GetProperty("seed").GetInt32() == seed);
        var (pool, rng) = HeroGenerator.GeneratePool(Parity.Content, Rng.Create(seed));
        Parity.AssertSame(expected.GetProperty("pool"), Parity.ToJson(pool), $"pool {seed}");
        Parity.AssertSame(expected.GetProperty("rng"), Parity.ToJson(rng), $"pool {seed} rng");
    }

    [Theory]
    [MemberData(nameof(RunNames))]
    public void ReplaysLikeTypeScript(string name)
    {
        var content = Parity.Content;
        var recorded = Run(name);
        var initial = recorded.GetProperty("initial").Deserialize<RunState>(Json.Options)!;
        Parity.AssertSame(recorded.GetProperty("initial"), Parity.ToJson(initial), $"{name}: initial run read back");

        var created = RunRules.CreateRun(recorded.GetProperty("seed").GetDouble(), content);
        Parity.AssertSame(recorded.GetProperty("initial"), Parity.ToJson(created), $"{name}: createRun");

        var run = created;
        int index = 0;
        foreach (var step in recorded.GetProperty("steps").EnumerateArray())
        {
            string what = $"{name}: step {index} ({step.GetProperty("action").GetRawText()})";
            var action = step.GetProperty("action").Deserialize<RunAction>(Json.Options)!;
            Parity.AssertSame(step.GetProperty("action"), Parity.ToJson(action), $"{what} read back");
            if (step.TryGetProperty("illegal", out _))
            {
                var before = run;
                Assert.Throws<IllegalActionException>(() => RunRules.ApplyRunAction(before, action, content));
            }
            else
            {
                run = RunRules.ApplyRunAction(run, action, content);
                Parity.AssertSame(step.GetProperty("state"), Parity.ToJson(run), $"{what} state");
            }
            if (step.TryGetProperty("battle", out var battle))
                Parity.AssertSame(battle, Parity.ToJson(RunRules.CreateRunBattle(run, content)), $"{what} createRunBattle");
            index++;
        }
        Assert.Equal(RunPhase.Finished, run.Phase);
    }

    /// <summary>The whole run played by the C# AI, "Обычный" for A and "Новичок" for B, matches included.</summary>
    [Theory]
    [MemberData(nameof(AiRunNames))]
    public void TheAiPlaysTheSameRun(string name)
    {
        var content = Parity.Content;
        var recorded = Run(name);
        var played = new List<RunAction>();
        AiRun.PlayRun(
            recorded.GetProperty("seed").GetDouble(),
            content,
            BattleAi.ProfileByName(content, "normal"),
            BattleAi.ProfileByName(content, "novice"),
            onRunAction: (action, _) => played.Add(action));
        var expected = recorded.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("action")).ToList();
        for (int i = 0; i < Math.Min(expected.Count, played.Count); i++)
            Parity.AssertSame(expected[i], Parity.ToJson(played[i]), $"{name}: run action {i}");
        Assert.Equal(expected.Count, played.Count);
    }

    [Fact]
    public void DescribesAbilitiesLikeTypeScript()
    {
        var content = Parity.Content;
        int count = 0;
        foreach (var entry in Data.Value.GetProperty("described").EnumerateArray())
        {
            var hero = entry.GetProperty("hero").Deserialize<HeroTemplate>(Json.Options)!;
            int level = entry.GetProperty("level").GetInt32();
            string what = $"{hero.Id} ({hero.ClassId}) at level {level}";
            var preview = RunRules.PreviewBattle(hero, level, Side.A, content);
            var asBattleHero = preview.Heroes[hero.Id];
            Parity.AssertSame(entry.GetProperty("stats"), Parity.ToJson(Modifiers.StatsInBattle(preview, asBattleHero, content)), $"{what}: stats");
            foreach (var text in entry.GetProperty("texts").EnumerateObject())
            {
                string actual = Describe.DescribeAbility(content.GetAbility(text.Name), asBattleHero, content, preview);
                Assert.True(text.Value.GetString() == actual, $"{what}, {text.Name}:\n  expected {text.Value.GetString()}\n  actual   {actual}");
                count++;
            }
        }
        Assert.True(count > 1000, $"only {count} texts compared");
    }
}
