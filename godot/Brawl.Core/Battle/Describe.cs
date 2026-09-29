using System.Text.RegularExpressions;

namespace Brawl.Core;

/// <summary>
/// Filling the {0}, {1} placeholders in an ability description with real numbers, a port
/// of src/core/battle/describe.ts. The values are rules-derived, so they are computed in
/// core rather than in the interface. No rolls are made: the figure shown is the one
/// before spread and crit.
/// </summary>
public static partial class Describe
{
    [GeneratedRegex(@"\{(\d+)\}")]
    private static partial Regex Placeholder();

    private static string Percent(double fraction) => JsMath.ToJsString(JsMath.Round(fraction * 100)) + "%";

    /// <summary>The number that belongs in the text for one atom, or null if it has none.</summary>
    private static string? EffectValue(Effect effect, BattleHero hero, ContentRegistry content, BattleState state)
    {
        var stats = Modifiers.StatsInBattle(state, hero, content);
        double Scaled(ScaleStat scale) => scale == ScaleStat.Attack ? stats.Attack : stats.Magic;

        switch (effect)
        {
            case DamageEffect damage:
            {
                double each = Formulas.RoundHalfUp(damage.K * Scaled(damage.Scale));
                int hits = damage.Hits ?? 1;
                return hits > 1 ? $"{hits}×{JsMath.ToJsString(each)}" : JsMath.ToJsString(each);
            }
            case HealEffect heal:
                if (heal.Full == true) return "всё здоровье";
                if (heal.MissingHpPct is { } missing) return $"{JsMath.ToJsString(missing)}% недостающего";
                return JsMath.ToJsString(Formulas.RoundHalfUp((heal.K ?? 0) * Scaled(heal.Scale ?? ScaleStat.Magic)));
            case BarrierEffect barrier:
                return JsMath.ToJsString(Formulas.RoundHalfUp(barrier.K * Scaled(barrier.Scale)));
            case StatusEffect status:
            {
                if (status.Value is not { } value || value == 0) return null;
                var def = content.GetStatus(status.Status);
                // A fraction reads as a percentage; a flat value reads as itself.
                return def.ValueKind == ValueKind.Fraction ? Percent(value) : JsMath.ToJsString(value);
            }
            case AtbEffect atb:
                return JsMath.ToJsString(Math.Abs(atb.Delta));
            case PushEffect push:
                return JsMath.ToJsString(push.Distance);
            case LifestealEffect lifesteal:
                return Percent(lifesteal.Pct);
            case RelayEffect relay:
                return Percent(relay.Pct);
            case EchoEffect echo:
                return Percent(echo.Mul);
            case ApEffect ap:
                return JsMath.ToJsString(Math.Abs(ap.Delta));
            case SelfDamageEffect self:
                return Percent((self.PctCurrentHp ?? 0) + (self.PctMaxHp ?? 0));
            case SummonEffect summon:
                return JsMath.ToJsString(summon.Hp);
            case TerrainEffect terrain:
                return JsMath.ToJsString(terrain.Turns);
            case SpreadEffect spread:
                return JsMath.ToJsString(spread.Radius);
            default:
                // teleport, cooldown, move, cleanse: no number.
                return null;
        }
    }

    /// <summary>
    /// The description with every {N} replaced by the value of effect N for this hero. A
    /// placeholder whose atom carries no number is left as it is.
    /// </summary>
    public static string DescribeAbility(Ability ability, BattleHero hero, ContentRegistry content, BattleState state) =>
        Placeholder().Replace(ability.Description, match =>
        {
            int index = int.Parse(match.Groups[1].Value);
            if (index >= ability.Effects.Count) return match.Value;
            return EffectValue(ability.Effects[index], hero, content, state) ?? match.Value;
        });
}
