using Brawl.Core;

namespace Brawl.Game;

/// <summary>
/// Every string the player sees that is not part of the content JSON, as in
/// src/ui/strings.ru.ts. The battle log lines follow src/ui/panels/BattleLog.tsx.
/// </summary>
public static partial class Texts
{
    public const string AppTitle = "Арена 3v3";
    public const string QuickBattle = "Быстрый бой";
    public const string QuickBattleHint = "Один бой готовыми командами, без драфта";
    public const string Opponent = "Противник";
    public const string Seed = "Сид";
    public const string SeedRandom = "случайный";
    public const string Quit = "Выход";
    public const string ToMenu = "В меню";
    public const string SoundButton = "Звук";
    public const string NoTargetInReach = "Сейчас некого задеть — выберите, чтобы увидеть дальность";
    public const string SoundHint = "Включить или выключить звуки боя";
    public const string Round = "Раунд";
    public const string YourTurn = "Ваш ход";
    public const string Thinking = "Противник ходит…";
    public const string Playing = "Проигрывается…";
    public const string EndTurn = "Завершить ход";
    public const string Ap = "ОД";
    public const string Cooldown = "КД";
    public const string Range = "дальн.";
    public const string Log = "Ход боя";
    public const string Victory = "Победа";
    public const string Defeat = "Поражение";
    public const string PlayAgain = "Сыграть ещё раз";
    public const string Speed = "Скорость";
    public const string Instant = "мгнов.";
    public const string Queue = "Очередь ходов";
    public const string Hint = "Клик по гексу — идти. 1–3 и Q — способность, Пробел — конец хода, Esc или правый клик — отмена. Правая кнопка с протяжкой — повернуть камеру, колесо — приблизить";

    public static readonly (string Id, string Name)[] Difficulties =
    [
        ("novice", "Новичок"),
        ("normal", "Обычный"),
        ("veteran", "Ветеран"),
        ("nightmare", "Кошмар"),
    ];

    public static string RoleName(Role role) => role switch
    {
        Role.Tank => "Танк",
        Role.Melee => "Ближний бой",
        Role.Ranged => "Дальний бой",
        _ => "Поддержка",
    };

    public static string Reason(IllegalReason reason) => reason switch
    {
        IllegalReason.NotActiveHero => "Сейчас ходит другой герой",
        IllegalReason.HeroDead => "Герой выбыл",
        IllegalReason.NoAp => "Не хватает очков действия",
        IllegalReason.OnCooldown => "На перезарядке",
        IllegalReason.Silenced => "Немота: доступна только базовая атака",
        IllegalReason.Rooted => "Обездвижен: перемещение недоступно",
        IllegalReason.Stunned => "Оглушён",
        IllegalReason.OutOfRange => "Слишком далеко",
        IllegalReason.NoLos => "Обзор закрыт",
        IllegalReason.BadTarget => "Неподходящая цель",
        IllegalReason.BlockedPath => "Некуда встать",
        _ => "Бой окончен",
    };

    public static string TerrainName(TerrainId id) => id switch
    {
        TerrainId.Rock => "Скала",
        TerrainId.Column => "Колонна",
        TerrainId.Thicket => "Заросли",
        TerrainId.High => "Возвышенность",
        TerrainId.Collapse => "Обрушение",
        TerrainId.Pit => "Яма",
        TerrainId.Ice => "Лёд",
        TerrainId.Smoke => "Дым",
        _ => "Капкан",
    };

    public static string VictoryText(VictoryReason reason, bool won) => (reason, won) switch
    {
        (VictoryReason.Elimination, true) => "Команда противника выбита",
        (VictoryReason.Elimination, false) => "Ваша команда выбита",
        (VictoryReason.RoundLimit, true) => "Лимит раундов: у вас осталось больше здоровья",
        (VictoryReason.RoundLimit, false) => "Лимит раундов: у противника осталось больше здоровья",
        (VictoryReason.Hold, true) => "Вы удержали Точку силы",
        _ => "Противник удержал Точку силы",
    };

    /// <summary>A passive, perk, artifact, class or race by the id its trait carries.</summary>
    public static string TraitName(string id, ContentRegistry content) =>
        content.Items.Get(id)?.Name ?? content.Passives.Get(id)?.Name ?? content.Perks.Get(id)?.Name ?? id;

    private static string Name(BattleState state, string? id) => id is null ? "—" : state.Heroes.Get(id)?.Name ?? id;

    private static string Signed(double value) => value > 0 ? $"+{value}" : $"{value}";

    /// <summary>One line per event, or null for events that only show on the board.</summary>
    public static string? EventText(BattleEvent e, BattleState state, ContentRegistry content) => e switch
    {
        BattleStartedEvent s => $"Бой начался. Первым ходит {Name(state, s.FirstHeroId)}.",
        TurnStartedEvent t => $"{Name(state, t.HeroId)} — {t.Ap} {Ap}",
        TurnSkippedEvent t => $"{Name(state, t.HeroId)} пропускает ход: {content.GetStatus(t.Cause).Name.ToLowerInvariant()}",
        OpportunityAttackEvent o => $"{Name(state, o.AttackerId)} бьёт вслед: {Name(state, o.TargetId)} разрывает контакт",
        AbilityUsedEvent u => $"{Name(state, u.HeroId)}: «{content.GetAbility(u.AbilityId).Name}»",
        DamagedEvent d => $"{Name(state, d.TargetId)} получает {d.Amount} урона{(d.Crit ? " — крит!" : "")}",
        BarrierAbsorbedEvent b => $"Барьер поглощает {b.Amount}, осталось {b.Left}",
        HealedEvent h => $"{Name(state, h.TargetId)} вылечен на {h.Amount}",
        PassiveTriggeredEvent p => content.Items.Get(p.PassiveId) is { } item
            ? $"{Name(state, p.HeroId)}: артефакт «{item.Name}»"
            : $"{Name(state, p.HeroId)}: пассивка «{TraitName(p.PassiveId, content)}»",
        StatusAppliedEvent s => $"{Name(state, s.TargetId)}: {content.GetStatus(s.Status).Name}"
            + (s.Turns > content.Config.Battle.MaxRounds ? " до конца боя" : $" ({s.Turns} х.)"),
        StatusResistedEvent s => $"{Name(state, s.TargetId)} сопротивляется: {content.GetStatus(s.Status).Name} не накладывается повторно",
        StatusExpiredEvent s => $"{Name(state, s.TargetId)}: {content.GetStatus(s.Status).Name} спадает",
        StatusCleansedEvent s => $"{Name(state, s.TargetId)}: снят эффект {content.GetStatus(s.Status).Name}",
        AtbChangedEvent a => $"{Name(state, a.HeroId)}: инициатива {Signed(a.Delta)}",
        PushedEvent p => $"{Name(state, p.HeroId)} отброшен",
        DiedEvent d => $"{Name(state, d.HeroId)} выбывает из боя",
        MatchEndedEvent m => $"Бой окончен. Побеждает сторона {m.Winner}.",
        TeleportedEvent t => $"{Name(state, t.HeroId)} телепортируется",
        ApChangedEvent a => $"{Name(state, a.HeroId)}: {Signed(a.Delta)} {Ap}",
        CooldownsChangedEvent c => $"{Name(state, c.HeroId)}: {(c.Mode == CooldownMode.Double ? "перезарядка удвоена" : "перезарядка сброшена")}",
        TerrainChangedEvent t => t.Terrain switch
        {
            TerrainId.Collapse => "Край арены обрушивается",
            null => null,
            var terrain => $"На поле появляется: {TerrainName(terrain.Value).ToLowerInvariant()}",
        },
        SummonedEvent s => $"{Name(state, s.OwnerId)} призывает: {Name(state, s.HeroId)}",
        AbilityDelayedEvent a => $"{Name(state, a.HeroId)}: «{content.GetAbility(a.AbilityId).Name}» обрушится через {a.Turns} х.",
        ItemGainedEvent i => $"{Name(state, i.HeroId)} получает легендарный артефакт «{content.Items.Get(i.ItemId)?.Name ?? i.ItemId}»",
        _ => null,
    };
}
