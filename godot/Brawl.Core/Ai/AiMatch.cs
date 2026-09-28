namespace Brawl.Core;

/// <summary>
/// A battle played to the end, AI against AI: a port of src/sim/match.ts playBattle. The
/// parity tests use it to check that the C# AI picks the very moves the TypeScript one did.
/// </summary>
public static class AiMatch
{
    public static BattleState PlayBattle(
        BattleState initial,
        ContentRegistry content,
        AiProfile profileA,
        AiProfile profileB,
        Action<BattleAction, BattleState>? onAction = null,
        int maxActions = 5000)
    {
        var started = BattleRules.StartBattle(initial, content);
        var state = started.State;
        // The AI draws from its own stream, kept apart from the battle's.
        var aiRng = Rng.Create(JsMath.ToInt32(initial.Seed) ^ unchecked((int)0x9e3779b9));

        for (int step = 0; step < maxActions && state.Outcome is null;)
        {
            string? activeId = state.ActiveHeroId;
            if (activeId is null) break;

            var side = state.Heroes.Get(activeId)?.Side ?? Side.A;
            var decision = BattleAi.ChooseActions(state, content, aiRng, side == Side.A ? profileA : profileB);
            aiRng = decision.Rng;

            foreach (var action in decision.Actions)
            {
                if (state.Outcome is not null) break;
                // A trigger may have changed things since the plan was made.
                if (!Legal.IsLegalAction(state, action, content)) break;
                state = BattleRules.ApplyAction(state, action, content).State;
                onAction?.Invoke(action, state);
                step++;
                if (state.ActiveHeroId != activeId) break;
            }

            if (state.ActiveHeroId == activeId && state.Outcome is null)
            {
                // The plan ran out without ending the turn; close it so the clock moves on.
                var close = new EndTurnAction { HeroId = activeId };
                state = BattleRules.ApplyAction(state, close, content).State;
                onAction?.Invoke(close, state);
                step++;
            }
        }
        return state;
    }
}
