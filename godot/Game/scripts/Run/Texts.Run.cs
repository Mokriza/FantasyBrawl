using Brawl.Core;

namespace Brawl.Game;

/// <summary>The run's strings: draft, placement, upgrade and the series, as in src/ui/strings.ru.ts.</summary>
public static partial class Texts
{
    public const string NewRun = "Новый забег";
    public const string NewRunHint = "Драфт из 10 героев, расстановка и серия матчей до трёх побед";
    public const string Passive = "Пассивка";
    public const string Item = "Артефакт";
    public const string Modifier = "Модификатор арены";
    public const string Hold = "Удержание точки";
    public const string HoldHint = "Раунды, в начале которых ваш герой (слева) или герой противника (справа) стоял на центральном гексе. Кто наберёт нужное число, побеждает";
    public const string OncePerMatch = "раз за бой";
    public const string RangeLong = "дальность";
    public const string Level = "Уровень";
    public const string Score = "Счёт";

    public static string MatchTitle(int match) => $"Матч {match}";

    public static string RoundsText(int rounds)
    {
        int ten = rounds % 10, hundred = rounds % 100;
        string word = ten == 1 && hundred != 11 ? "раунд"
            : ten >= 2 && ten <= 4 && (hundred < 10 || hundred >= 20) ? "раунда"
            : "раундов";
        return $"{rounds} {word}";
    }

    public static string StatName(StatName stat) => stat switch
    {
        Brawl.Core.StatName.MaxHp => "Здоровье",
        Brawl.Core.StatName.Attack => "Атака",
        Brawl.Core.StatName.Magic => "Магия",
        Brawl.Core.StatName.Armor => "Броня",
        Brawl.Core.StatName.Resist => "Сопротивление",
        Brawl.Core.StatName.Speed => "Скорость",
        _ => "Шанс крита",
    };

    /// <summary>A stat as a card shows it: crit chance in percent, the rest whole.</summary>
    public static string StatValue(StatName stat, double value) =>
        stat == Brawl.Core.StatName.CritChance ? $"{JsMath.Round(value * 100)}%" : $"{JsMath.Round(value)}";

    /// <summary>What each stat does, and what this very number works out to (src/ui/panels/statRows.ts).</summary>
    public static string StatHelp(StatName stat, Stats stats, ContentRegistry content)
    {
        var f = content.Config.Formulas;
        string Reduction(double defence) => $"Сейчас: −{JsMath.Round(defence / (defence + f.DefenseConstant) * 100)}% входящего урона";
        double ticks = Math.Ceiling(content.Config.Battle.AtbThreshold / Math.Max(1, stats.Speed));
        return stat switch
        {
            Brawl.Core.StatName.MaxHp => $"Запас жизни. На нуле герой выбывает до конца боя.\n\nСейчас: {JsMath.Round(stats.MaxHp)} единиц здоровья",
            Brawl.Core.StatName.Attack => $"Множитель физического урона: урон способности = её коэффициент × Атака.\n\nСейчас: удар с коэффициентом 1.0 наносит {JsMath.Round(stats.Attack)} до защиты",
            Brawl.Core.StatName.Magic => $"Множитель магического урона и лечения: эффект = коэффициент × Магия.\n\nСейчас: эффект с коэффициентом 1.0 даёт {JsMath.Round(stats.Magic)}",
            Brawl.Core.StatName.Armor => $"Снижает физический урон по формуле Броня / (Броня + {f.DefenseConstant}).\n\n{Reduction(stats.Armor)}",
            Brawl.Core.StatName.Resist => $"Снижает магический урон по той же формуле, что и Броня.\n\n{Reduction(stats.Resist)}",
            Brawl.Core.StatName.Speed => $"Скорость набора шкалы инициативы: чем выше, тем чаще ходит герой.\n\nСейчас: ход примерно раз в {ticks} тиков шкалы",
            _ => $"Вероятность критического удара.\n\nСейчас: крит умножает урон на {f.CritMult}",
        };
    }

    /// <summary>"тир 2 · 2 ОД · дальность 3 · КД 2": the line under an ability's name.</summary>
    public static string AbilityMeta(Ability ability)
    {
        string text = $"тир {ability.Tier} · {ability.Ap} {Ap}";
        if (ability.Range > 0) text += $" · {RangeLong} {ability.Range}";
        if (ability.Cooldown.Once) text += $" · {OncePerMatch}";
        else if (ability.Cooldown.Turns > 0) text += $" · {Cooldown} {ability.Cooldown.Turns}";
        return text;
    }

    public static class Draft
    {
        public const string Title = "Драфт";
        public const string You = "Ваша команда";
        public const string Enemy = "Противник";
        public const string YourPick = "Ваш пик — выберите героя";
        public const string EnemyPick = "Противник выбирает…";
        public const string YouFirst = "Жребий: вы выбираете первым";
        public const string EnemyFirst = "Жребий: противник выбирает первым, зато вы расставляете героев последним";
        public const string Pick = "Взять";
        public const string Empty = "пусто";
        public const string TimerHint = "Когда время выйдет, герой будет выбран случайно";
        public const string Budget = "Бюджет";
        public const string BudgetAbilities = "способности";
        public const string BudgetStats = "характеристики";
        public const string BudgetPassive = "пассивка";
        public const string BudgetUltimate = "тир IV";
        public const string BudgetItem = "артефакт";
        public const string BudgetReserveHint = "Пассивка и тир IV — очки, отложенные под то, что герой выберет между матчами";
        public const string BasicAttack = "Базовая атака";
        public const string Order = "Порядок пиков";

        public static string LockedPassive(int match) => $"Пассивка — выбор из вариантов после {match}-го матча";

        public static string LockedUltimate(int match) => $"Способность тира IV — выбор после {match}-го матча";

        public static string Timer(double seconds) => $"{seconds} с";
    }

    public static class Placement
    {
        public const string Title = "Расстановка";
        public const string YourTurn = "Выберите героя и кликните по подсвеченному гексу своей зоны";
        public const string EnemyTurn = "Противник ставит героя…";
        public const string Placed = "на поле";
        public const string Order = "Ставят по очереди, по одному герою";
    }

    public static class Upgrade
    {
        public const string Title = "Усиление";
        public const string BeforeMatch = "перед матчем";
        public const string Hint = "Каждый герой получает уровень, выбирает один перк из трёх, а после 1-го и 2-го матча — ещё пассивку и способность тира IV. Одного героя можно заменить. Выбор можно поменять до перехода к расстановке";
        public const string CatchUp = "Вы отстаёте на две победы: на выбор на один перк и один артефакт больше";
        public const string EnemyCatchUp = "Противник отстаёт на две победы: у него на выбор на один вариант больше";
        public const string SwapTitle = "Замена героя — по желанию, одного за фазу";
        public const string SwapShow = "Показать кандидатов";
        public const string SwapHide = "Скрыть кандидатов";
        public const string SwapHint = "Кандидат приходит на уровне команды: пассивка, способность тира IV и перки уже выбраны, у него обычный артефакт. Ушедший герой покидает забег";
        public const string SwapInstead = "Вместо:";
        public const string SwapChosen = "Придёт вместо";
        public const string SwapCancel = "Отменить замену";
        public const string Leaving = "Уходит из команды, вместо него —";
        public const string Newcomer = "Новичок";
        public const string NewcomerHint = "Пришёл готовым: выбирать за него нечего";
        public const string EnemySwap = "Замена";
        public const string UnlockPassive = "Открытие: выберите пассивку";
        public const string UnlockUltimate = "Открытие: выберите способность тира IV";
        public const string PerkTitle = "Перк";
        public const string RewardTitle = "Награда за матч: выберите артефакт и героя";
        public const string RewardTitleShort = "Награда";
        public const string RewardWho = "Кому отдать?";
        public const string RewardFor = "→";
        public const string Replaces = "заменит";
        public const string ChooseAbility = "На какую способность?";
        public const string Chosen = "Выбрано";
        public const string ToPlacement = "К расстановке";
        public const string Waiting = "Выберите перк каждому герою";
        public const string Enemy = "Противник выбрал";
        public const string Perks = "Перки";
        public const string NoOffers = "Подходящих перков не осталось";

        public static string ModifierNext(int match) => $"Матч {match} пройдёт с модификатором арены:";

        public static string ItemTier(ItemTier tier) => tier switch
        {
            Brawl.Core.ItemTier.Common => "Обычный",
            Brawl.Core.ItemTier.Rare => "Редкий",
            _ => "Легендарный",
        };

        public static string Category(PerkCategory category) => category switch
        {
            PerkCategory.Stats => "Характеристики",
            PerkCategory.Ability => "Способность",
            PerkCategory.Rules => "Правила",
            PerkCategory.Situational => "Ситуация",
            _ => "Роль",
        };
    }

    public static class MatchOver
    {
        public const string Won = "Матч выигран";
        public const string Lost = "Матч проигран";
        public const string Next = "Далее: усиление";
        public const string LevelUp = "После матча все герои обеих команд получают уровень";
        public const string Healed = "Павшие встают, здоровье восполняется полностью";
    }

    public static class RunOver
    {
        public const string Won = "Забег выигран";
        public const string Lost = "Забег проигран";
        public const string History = "Матчи";
    }
}
