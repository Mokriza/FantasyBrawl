/** The public surface of core. Everything outside imports from here and nowhere else. */

export * from './hex.js';
export * from './rng.js';
export * from './types.js';
export * from './content.js';

export { allHexes, blocksLos, blocksMovement, inBounds, isHigh, isPit, terrainAt } from './arena/terrain.js';
export { centreHex, holdToWin } from './arena/modifiers.js';
export { GUARDIAN_ID } from './arena/guardian.js';
export { emptyArena, generateArena } from './arena/generate.js';

export { createBattle } from './battle/state.js';
export type { CreateBattleOptions } from './battle/state.js';
export { applyAction, isOver, startBattle } from './battle/apply.js';
export type { ApplyOptions } from './battle/apply.js';
export {
  abilitiesOf,
  abilityAvailability,
  abilityApCost,
  abilityCooldown,
  abilityLegality,
  abilityRange,
  abilityReach,
  abilityTargets,
  hasNoTarget,
  cooldownLeft,
  legalActions,
  moveBudget,
  moveLegality,
  reachableFor,
} from './battle/legal.js';
export { advanceToNextTurn, predictTurnOrder, readyHeroes } from './battle/atb.js';
export { checkOutcome } from './battle/victory.js';
export { computeBarrier, computeDamage, computeHeal, FIXED_ROLLS, RANDOM_ROLLS } from './battle/formulas.js';
export type { DamageResult, HealResult, RollMode } from './battle/formulas.js';
export { describeAbility } from './battle/describe.js';
export { previewAbility } from './battle/preview.js';
export type { AbilityPreview, TargetPreview } from './battle/preview.js';
export { reachableHexes, isPassable, pathCost, stepCost } from './battle/pathing.js';
export type { Reachable } from './battle/pathing.js';
export { basicAttackOf, holdsZoneOfControl, reactorsForPath, reactorsForStep } from './battle/opportunity.js';
export { hasLineOfSight, resolveShape, resolveTargets } from './battle/targeting.js';
export type { ResolvedTarget, ShapeHit } from './battle/targeting.js';
export {
  BARRIER,
  DOT,
  ROOT,
  SILENCE,
  SLOW,
  STUN,
  barrierAmount,
  dotAmount,
  hasAnyBuff,
  hasAnyDebuff,
  hasStatus,
  statusesOf,
} from './battle/statuses.js';
export {
  activeHero,
  allHeroes,
  alliesOf,
  enemiesOf,
  heroAt,
  heroById,
  heroesOfSide,
  isOccupied,
  livingHeroes,
  updateHero,
} from './battle/query.js';

export { toBattleHero } from './battle/state.js';

export {
  STAT_NAMES,
  abilityCost,
  applyRace,
  classPool,
  generateHero,
  generatePool,
  statValue,
} from './draft/generate.js';
export { itemFits, itemsFor } from './draft/items.js';
export {
  applyPick,
  availableHeroes,
  createDraft,
  draftTurn,
  isTaken,
  legalPicks,
  teamOf,
} from './draft/draft.js';
export { growthOf, statsAtLevel } from './run/levels.js';
export {
  applyPlace,
  createPlacement,
  isPlaced,
  legalPlacementHexes,
  placementTurn,
  startZone,
} from './run/placement.js';
export {
  applyRunAction,
  battleSeed,
  createRun,
  createRunBattle,
  heroLevel,
  otherSide,
  placementPreview,
  previewBattle,
  previewHero,
  runWinner,
} from './run/run.js';
export type { CreateRunOptions } from './run/run.js';

export {
  critMultiplier,
  dealtFactor,
  healFactor,
  modifierSum,
  statInBattle,
  statsInBattle,
  takenFactor,
  traitsOf,
} from './battle/modifiers.js';
export type { Trait } from './battle/modifiers.js';
export { reactTo } from './battle/triggers.js';
export {
  applyCancelSwap,
  applyChoosePerk,
  applyChooseUnlock,
  applySwapHero,
  awaitingPerk,
  awaitingReward,
  awaitingUnlock,
  applyChooseReward,
  commitUpgrade,
  createUpgrade,
  perkTargets,
  teamAfterSwap,
  trailingSide,
  withPerkHealth,
} from './run/upgrade.js';
