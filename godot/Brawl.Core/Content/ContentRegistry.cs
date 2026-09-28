namespace Brawl.Core;

/// <summary>
/// All the content, looked up by id: a port of ContentRegistry in content.ts. Core
/// receives it as a parameter and never reads files itself.
/// </summary>
public sealed record ContentRegistry
{
    public required Config Config { get; init; }
    public required OrderedMap<HeroClass> Classes { get; init; }
    public required OrderedMap<Ability> Abilities { get; init; }
    public required OrderedMap<StatusDef> Statuses { get; init; }
    public required IReadOnlyList<string> Names { get; init; }
    public required OrderedMap<Passive> Passives { get; init; }
    public required OrderedMap<Race> Races { get; init; }
    public required OrderedMap<Perk> Perks { get; init; }
    public required OrderedMap<Item> Items { get; init; }
    public required OrderedMap<ArenaModifier> ArenaModifiers { get; init; }

    public Ability GetAbility(string id) =>
        Abilities.Get(id) ?? throw new ContentException($"Unknown ability: {id}");

    public HeroClass GetClass(string id) =>
        Classes.Get(id) ?? throw new ContentException($"Unknown class: {id}");

    public StatusDef GetStatus(string id) =>
        Statuses.Get(id) ?? throw new ContentException($"Unknown status: {id}");
}

public sealed class ContentException(string message) : Exception(message);

/// <summary>
/// Reads the JSON of src/content. The files are shared with the TypeScript game, which
/// validates every cross-reference (npm run validate-content); here each file is read
/// strictly (unknown or missing fields fail) and the ids are checked for duplicates.
/// </summary>
public static class ContentLoader
{
    public static readonly IReadOnlyList<string> AbilityFiles =
        ["basic", "warrior", "paladin", "hunter", "mage", "priest", "warlock", "rogue", "monk"];

    public static readonly IReadOnlyList<string> PassiveFiles =
        ["warrior", "paladin", "hunter", "mage", "priest", "warlock", "rogue", "monk"];

    /// <summary>readFile gets a path relative to the content folder, such as "abilities/mage.json".</summary>
    public static ContentRegistry Load(Func<string, string> readFile)
    {
        var config = Json.Parse<Config>(readFile("config.json"));
        var classes = ById(Json.Parse<List<HeroClass>>(readFile("classes.json")), c => c.Id, "class");
        var statuses = ById(Json.Parse<List<StatusDef>>(readFile("statuses.json")), s => s.Id, "status");
        var abilities = ById(
            AbilityFiles.SelectMany(f => Json.Parse<List<Ability>>(readFile($"abilities/{f}.json"))),
            a => a.Id,
            "ability");
        var names = Json.Parse<List<string>>(readFile("names.json"));
        var passives = ById(
            PassiveFiles.SelectMany(f => Json.Parse<List<Passive>>(readFile($"passives/{f}.json"))),
            p => p.Id,
            "passive");
        var races = ById(Json.Parse<List<Race>>(readFile("races.json")), r => r.Id, "race");
        var perks = ById(Json.Parse<List<Perk>>(readFile("perks.json")), p => p.Id, "perk");
        var items = ById(Json.Parse<List<Item>>(readFile("items.json")), i => i.Id, "item");
        var arenaModifiers = ById(Json.Parse<List<ArenaModifier>>(readFile("arenaModifiers.json")), m => m.Id, "arena modifier");
        return new ContentRegistry
        {
            Config = config,
            Classes = classes,
            Abilities = abilities,
            Statuses = statuses,
            Names = names,
            Passives = passives,
            Races = races,
            Perks = perks,
            Items = items,
            ArenaModifiers = arenaModifiers,
        };
    }

    /// <summary>From a folder on disk, for tests and tools.</summary>
    public static ContentRegistry LoadFrom(string folder) =>
        Load(path => File.ReadAllText(Path.Combine(folder, path)));

    public static Teams LoadTeams(Func<string, string> readFile) => Json.Parse<Teams>(readFile("teams.json"));

    private static OrderedMap<T> ById<T>(IEnumerable<T> items, Func<T, string> id, string what)
    {
        var map = OrderedMap<T>.Empty;
        foreach (var item in items)
        {
            string key = id(item);
            if (map.ContainsKey(key)) throw new ContentException($"Duplicate {what} id: {key}");
            map = map.Set(key, item);
        }
        return map;
    }
}
