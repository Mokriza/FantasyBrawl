using System.IO.Compression;
using System.Text.Json;

namespace Brawl.Core.Tests;

/// <summary>
/// Whole battles recorded in TypeScript (npm run parity), replayed through the C# core:
/// the same starting state, the same events after every action, the same states. The
/// first difference is reported with the battle, the step and the path into the JSON.
/// </summary>
public class BattleParityTests
{
    private static readonly Lazy<List<JsonElement>> Battles = new(() =>
    {
        string path = Path.Combine(Parity.RepoRoot, "godot", "Brawl.Core.Tests", "Fixtures", "battles.json.gz");
        using var file = File.OpenRead(path);
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var document = JsonDocument.Parse(gzip);
        return document.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
    });

    public static IEnumerable<object[]> BattleNames() => Battles.Value.Select(b => new object[] { b.GetProperty("name").GetString()! });

    private static JsonElement Battle(string name) => Battles.Value.First(b => b.GetProperty("name").GetString() == name);

    [Theory]
    [MemberData(nameof(BattleNames))]
    public void ReplaysLikeTypeScript(string name)
    {
        var content = Parity.Content;
        var battle = Battle(name);
        var initial = battle.GetProperty("initial").Deserialize<BattleState>(Json.Options)!;

        // The state read back is the state written: nothing is lost on the way in.
        Parity.AssertSame(battle.GetProperty("initial"), Parity.ToJson(initial), $"{name}: initial state read back");

        if (battle.GetProperty("quick").GetBoolean())
        {
            var teams = ContentLoader.LoadTeams(p => File.ReadAllText(Path.Combine(Parity.ContentFolder, p)));
            var built = BattleSetup.CreateBattle(battle.GetProperty("seed").GetDouble(), teams, content);
            Parity.AssertSame(battle.GetProperty("initial"), Parity.ToJson(built), $"{name}: createBattle");
        }

        var started = BattleRules.StartBattle(initial, content);
        Parity.AssertSame(battle.GetProperty("start").GetProperty("events"), Parity.ToJson(started.Events), $"{name}: startBattle events");
        Parity.AssertSame(battle.GetProperty("start").GetProperty("state"), Parity.ToJson(started.State), $"{name}: startBattle state");

        var state = started.State;
        int index = 0;
        foreach (var step in battle.GetProperty("steps").EnumerateArray())
        {
            var action = step.GetProperty("action").Deserialize<BattleAction>(Json.Options)!;
            var applied = BattleRules.ApplyAction(state, action, content);
            state = applied.State;
            Parity.AssertSame(step.GetProperty("events"), Parity.ToJson(applied.Events), $"{name}: step {index} ({step.GetProperty("action").GetRawText()}) events");
            if (step.TryGetProperty("state", out var expected))
                Parity.AssertSame(expected, Parity.ToJson(state), $"{name}: step {index} state");
            index++;
        }
    }

    /// <summary>The recorded actions were chosen by the TypeScript AI: "Обычный" for A, "Новичок" for B.</summary>
    [Theory]
    [MemberData(nameof(BattleNames))]
    public void TheAiPlaysTheSameMoves(string name)
    {
        var content = Parity.Content;
        var battle = Battle(name);
        var initial = battle.GetProperty("initial").Deserialize<BattleState>(Json.Options)!;
        var played = new List<BattleAction>();
        BattleAi_Play(initial, content, played);
        var expected = battle.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("action")).ToList();
        for (int i = 0; i < Math.Min(expected.Count, played.Count); i++)
            Parity.AssertSame(expected[i], Parity.ToJson(played[i]), $"{name}: AI action {i}");
        Assert.Equal(expected.Count, played.Count);
    }

    private static void BattleAi_Play(BattleState initial, ContentRegistry content, List<BattleAction> played) =>
        AiMatch.PlayBattle(
            initial,
            content,
            BattleAi.ProfileByName(content, "normal"),
            BattleAi.ProfileByName(content, "novice"),
            (action, _) => played.Add(action));
}
