using System.Text.Json;
using System.Text.Json.Serialization;

namespace Brawl.Core;

/// <summary>An enum written in JSON as its camelCase name ("physical", "resetThis").</summary>
public sealed class CamelEnumConverter<T>() : JsonStringEnumConverter<T>(JsonNamingPolicy.CamelCase, allowIntegerValues: false)
    where T : struct, Enum;

/// <summary>
/// A team, or N for a neutral monster such as "Древний страж", an enemy of both. In
/// TypeScript Side is 'A' | 'B' and BattleSide adds 'N'; one enum serves both here, and
/// the run only ever uses A and B.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<Side>))]
public enum Side { A, B, N }

[JsonConverter(typeof(CamelEnumConverter<Role>))]
public enum Role { Tank, Melee, Ranged, Support }

[JsonConverter(typeof(CamelEnumConverter<DamageSchool>))]
public enum DamageSchool { Physical, Magic, Pure }

[JsonConverter(typeof(CamelEnumConverter<ScaleStat>))]
public enum ScaleStat { Attack, Magic }

[JsonConverter(typeof(CamelEnumConverter<StatName>))]
public enum StatName { MaxHp, Attack, Magic, Armor, Resist, Speed, CritChance }

[JsonConverter(typeof(CamelEnumConverter<TerrainId>))]
public enum TerrainId { Rock, Column, Thicket, Pit, High, Collapse, Ice, Smoke, Trap }

/// <summary>What a modifier moves: one of the seven stats, or a battle quantity. See content.ts.</summary>
[JsonConverter(typeof(CamelEnumConverter<ModifierStat>))]
public enum ModifierStat
{
    MaxHp,
    Attack,
    Magic,
    Armor,
    Resist,
    Speed,
    CritChance,
    DamageDealt,
    DamageTaken,
    HealDone,
    CritMult,
    Range,
    FreeSteps,
    StartAtb,
    CooldownRecovery,
    ApPerTurn,
    PitImmune,
    EnemyAtbImmune,
    FreeDisengage,
    PushImmune,
    DefensePierce,
    ZoneSize,
}

[JsonConverter(typeof(CamelEnumConverter<AbilityTargets>))]
public enum AbilityTargets { Enemy, Ally, Self, Any, EmptyHex }

[JsonConverter(typeof(CamelEnumConverter<ShapeFilter>))]
public enum ShapeFilter { Enemies, Allies, All }

[JsonConverter(typeof(CamelEnumConverter<StatusKind>))]
public enum StatusKind { Debuff, Buff, Special }

[JsonConverter(typeof(CamelEnumConverter<ValueKind>))]
public enum ValueKind { Flat, Fraction, None }

[JsonConverter(typeof(CamelEnumConverter<TriggerEvent>))]
public enum TriggerEvent
{
    BattleStart,
    TurnStart,
    TurnEnd,
    Damaged,
    DealtDamage,
    Crit,
    Kill,
    Died,
    HealedAlly,
    AbilityUsed,
    AdjacentEnemyTurnStart,
}

[JsonConverter(typeof(CamelEnumConverter<TriggerTarget>))]
public enum TriggerTarget { Self, Other, NearestEnemy, EnemiesAround }

[JsonConverter(typeof(CamelEnumConverter<ModifierScope>))]
public enum ModifierScope { Self, AdjacentAllies, AllAllies, AdjacentEnemies }

[JsonConverter(typeof(CamelEnumConverter<ModifierPer>))]
public enum ModifierPer { AdjacentEnemy, DebuffOnField }

[JsonConverter(typeof(CamelEnumConverter<Who>))]
public enum Who { Target, Caster }

[JsonConverter(typeof(CamelEnumConverter<CooldownMode>))]
public enum CooldownMode { Reset, Double, ResetThis, Reduce }

[JsonConverter(typeof(CamelEnumConverter<MoveTo>))]
public enum MoveTo { Target, AdjacentToTarget }

[JsonConverter(typeof(CamelEnumConverter<PushFrom>))]
public enum PushFrom { Caster, Center }

[JsonConverter(typeof(CamelEnumConverter<ItemTier>))]
public enum ItemTier { Common, Rare, Legendary }

[JsonConverter(typeof(CamelEnumConverter<PerkCategory>))]
public enum PerkCategory { Stats, Ability, Rules, Situational, Role }

[JsonConverter(typeof(CamelEnumConverter<RewardTier>))]
public enum RewardTier { Rare, Legendary }
