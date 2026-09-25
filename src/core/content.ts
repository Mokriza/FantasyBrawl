/**
 * Content loading and validation. See docs/ai/content-schema.md.
 *
 * Abilities, statuses, classes and balance numbers are data, never code. Core knows
 * only the closed set of effect atoms, targeting shapes and conditions below; every
 * ability is assembled from them in JSON.
 *
 * Core receives a ContentRegistry as a parameter and never imports JSON directly, so
 * tests can swap the content out.
 */

import { z } from 'zod';
import type { AbilityId, ClassId, StatusId } from './types.js';

// --- conditions --------------------------------------------------------------

export const effectConditionSchema = z
  .object({
    targetHas: z.string().optional(),
    targetHpBelowPct: z.number().optional(),
    casterHpBelowPct: z.number().optional(),
    wasCrit: z.boolean().optional(),
    killed: z.boolean().optional(),
    /** True: only on the caster's allies (the caster included); false: only on enemies. */
    targetIsAlly: z.boolean().optional(),
    /** Nothing has hurt the caster since the end of its previous turn ("Убийство из тени"). */
    casterUndamagedSinceLastTurn: z.boolean().optional(),
  })
  .strict();

export type EffectCondition = z.infer<typeof effectConditionSchema>;

const withCondition = { if: effectConditionSchema.optional() };

// --- effect atoms ------------------------------------------------------------
// Closed list. A new atom needs a new file in battle/effects, a schema entry and a
// test, and it is not added without agreeing it with the user first.

export const damageEffectSchema = z
  .object({
    type: z.literal('damage'),
    school: z.enum(['physical', 'magic', 'pure']),
    scale: z.enum(['attack', 'magic']),
    k: z.number(),
    /** Independent spread and crit rolls, with a death check after each. */
    hits: z.number().int().positive().optional(),
    critBonus: z.number().optional(),
    noCrit: z.boolean().optional(),
    /** Always a crit, frozen dice or not: it is not a roll, so the AI may count on it. */
    alwaysCrit: z.boolean().optional(),
    /** Fraction of the defence stat ignored, 0..1. */
    armorPierce: z.number().min(0).max(1).optional(),
    bonusVsLowHp: z.object({ belowPct: z.number(), mul: z.number() }).strict().optional(),
    /** Damage grows by this share for every hex between attacker and target. */
    perHexBonus: z.number().optional(),
    ...withCondition,
  })
  .strict();

export const healEffectSchema = z
  .object({
    type: z.literal('heal'),
    scale: z.enum(['attack', 'magic']).optional(),
    k: z.number().optional(),
    missingHpPct: z.number().optional(),
    full: z.boolean().optional(),
    /** A fixed amount, no spread: "heals 15 on a kill". */
    flat: z.number().int().positive().optional(),
    /** A share of the target's maximum health, in percent, no spread ("Талисман жизни"). */
    pctMaxHp: z.number().positive().optional(),
    ...withCondition,
  })
  .strict();

export const statusEffectSchema = z
  .object({
    type: z.literal('status'),
    status: z.string(),
    turns: z.number().int().nonnegative(),
    /** Flat for slow, fraction for weaken. See docs/ai/game-rules.md section 7. */
    value: z.number().optional(),
    stacks: z.number().int().positive().optional(),
    ...withCondition,
  })
  .strict();

export const barrierEffectSchema = z
  .object({
    type: z.literal('barrier'),
    scale: z.enum(['attack', 'magic']),
    k: z.number(),
    turns: z.number().int().positive(),
    /**
     * Inside a trigger: the barrier is this share of the event instead of k × stat
     * ("Кубок целителя": a fifth of the healing).
     */
    pctOfEvent: z.number().positive().optional(),
    ...withCondition,
  })
  .strict();

export const moveEffectSchema = z
  .object({
    type: z.literal('move'),
    to: z.enum(['target', 'adjacentToTarget']),
    ...withCondition,
  })
  .strict();

export const pushEffectSchema = z
  .object({
    type: z.literal('push'),
    distance: z.number().int().positive(),
    from: z.enum(['caster', 'center']),
    ...withCondition,
  })
  .strict();

export const atbEffectSchema = z
  .object({
    type: z.literal('atb'),
    delta: z.number(),
    ...withCondition,
  })
  .strict();

export const cleanseEffectSchema = z
  .object({
    type: z.literal('cleanse'),
    what: z.union([z.enum(['debuffs', 'all']), z.array(z.string())]),
    /** How many to remove, oldest first. Absent means all that match. */
    count: z.number().int().positive().optional(),
    ...withCondition,
  })
  .strict();

/**
 * Heals the caster by a share of the damage the previous atom dealt, or, inside a
 * trigger, the damage of the event that fired it.
 */
export const lifestealEffectSchema = z
  .object({
    type: z.literal('lifesteal'),
    pct: z.number().positive(),
    ...withCondition,
  })
  .strict();

/**
 * Passes a share of the amount that fired a trigger on to the target as damage, such
 * as the priest's healing that also burns the nearest enemy. Only meaningful inside a
 * trigger, where there is an amount to pass on.
 */
export const relayEffectSchema = z
  .object({
    type: z.literal('relay'),
    pct: z.number().positive(),
    school: z.enum(['physical', 'magic', 'pure']),
    ...withCondition,
  })
  .strict();

/**
 * Runs the ability that fired the trigger once more on the same aim, with every
 * scaled number multiplied by mul. Only meaningful in an abilityUsed trigger.
 */
export const echoEffectSchema = z
  .object({
    type: z.literal('echo'),
    mul: z.number().positive(),
    ...withCondition,
  })
  .strict();

/** Moves the caster straight to the aimed hex, through anything in between. */
export const teleportEffectSchema = z.object({ type: z.literal('teleport'), ...withCondition }).strict();

/**
 * Action points. On the hero whose turn it is, now; on anyone else, their next turn
 * (through the apLoss status). "who" picks the caster instead of the target.
 */
export const apEffectSchema = z
  .object({
    type: z.literal('ap'),
    delta: z.number().int(),
    who: z.enum(['target', 'caster']).optional(),
    ...withCondition,
  })
  .strict();

/**
 * Cooldowns. reset: all of them to zero; double: every running one twice as long;
 * resetThis: only the one of the ability being used.
 */
export const cooldownEffectSchema = z
  .object({
    type: z.literal('cooldown'),
    /** reduce: every running cooldown one turn shorter ("Кольцо концентрации"). */
    mode: z.enum(['reset', 'double', 'resetThis', 'reduce']),
    who: z.enum(['target', 'caster']).optional(),
    ...withCondition,
  })
  .strict();

/** Pure damage to the caster itself, as a share of its health. */
export const selfDamageEffectSchema = z
  .object({
    type: z.literal('selfDamage'),
    pctMaxHp: z.number().positive().optional(),
    pctCurrentHp: z.number().positive().optional(),
    ...withCondition,
  })
  .strict();

/** Copies the target's stacks of a status onto every other enemy within radius of it. */
export const spreadEffectSchema = z
  .object({
    type: z.literal('spread'),
    status: z.string(),
    radius: z.number().int().positive(),
    ...withCondition,
  })
  .strict();

/**
 * Temporary terrain on every hex of the shape that is free ground. onEnter runs when
 * an enemy of the caster steps in, then the terrain is gone: that is a trap.
 */
export const terrainEffectSchema = z
  .object({
    type: z.literal('terrain'),
    terrain: z.enum(['ice', 'smoke', 'trap']),
    turns: z.number().int().positive(),
    onEnter: z.array(z.lazy((): z.ZodTypeAny => effectSchema)).optional(),
    ...withCondition,
  })
  .strict();

/**
 * A summoned unit on the aimed hex: it has health and can be hit, never takes a turn
 * of its own, and at the start of each of its owner's turns hits the nearest enemy
 * within radius for k × the owner's stat at the time of summoning.
 */
export const summonEffectSchema = z
  .object({
    type: z.literal('summon'),
    unit: z.string(),
    hp: z.number().int().positive(),
    turns: z.number().int().positive(),
    attack: z
      .object({
        k: z.number().positive(),
        scale: z.enum(['attack', 'magic']),
        school: z.enum(['physical', 'magic', 'pure']),
        radius: z.number().int().positive(),
      })
      .strict(),
    ...withCondition,
  })
  .strict();

export const effectSchema = z.discriminatedUnion('type', [
  damageEffectSchema,
  healEffectSchema,
  statusEffectSchema,
  barrierEffectSchema,
  moveEffectSchema,
  pushEffectSchema,
  atbEffectSchema,
  cleanseEffectSchema,
  lifestealEffectSchema,
  relayEffectSchema,
  echoEffectSchema,
  teleportEffectSchema,
  apEffectSchema,
  cooldownEffectSchema,
  selfDamageEffectSchema,
  spreadEffectSchema,
  terrainEffectSchema,
  summonEffectSchema,
]);

export type Effect = z.infer<typeof effectSchema>;
export type DamageEffect = z.infer<typeof damageEffectSchema>;
export type HealEffect = z.infer<typeof healEffectSchema>;
export type StatusEffect = z.infer<typeof statusEffectSchema>;
export type BarrierEffect = z.infer<typeof barrierEffectSchema>;
export type MoveEffect = z.infer<typeof moveEffectSchema>;
export type PushEffect = z.infer<typeof pushEffectSchema>;
export type AtbEffect = z.infer<typeof atbEffectSchema>;
export type CleanseEffect = z.infer<typeof cleanseEffectSchema>;
export type LifestealEffect = z.infer<typeof lifestealEffectSchema>;
export type RelayEffect = z.infer<typeof relayEffectSchema>;
export type EchoEffect = z.infer<typeof echoEffectSchema>;
export type TeleportEffect = z.infer<typeof teleportEffectSchema>;
export type ApEffect = z.infer<typeof apEffectSchema>;
export type CooldownEffect = z.infer<typeof cooldownEffectSchema>;
export type SelfDamageEffect = z.infer<typeof selfDamageEffectSchema>;
export type SpreadEffect = z.infer<typeof spreadEffectSchema>;
export type TerrainEffect = z.infer<typeof terrainEffectSchema>;
export type SummonEffect = z.infer<typeof summonEffectSchema>;

// --- modifiers and triggers --------------------------------------------------
// The shared vocabulary of passives, races and perks. See content-schema.md.

const baseStatNames = ['maxHp', 'attack', 'magic', 'armor', 'resist', 'speed', 'critChance'] as const;

/**
 * What a modifier moves: one of the seven stats, or a battle quantity.
 *  damageDealt / damageTaken / healDone — shares added to the damage and heal formulas
 *  critMult — added to the crit multiplier
 *  range — added to the range of abilities that reach further than one hex
 *  firstMoveCost — added to the cost of the first move of a turn (negative is a discount)
 *  startAtb — initiative the hero starts the battle with
 *  cooldownRecovery — extra turns every cooldown ticks down at the end of a turn
 *  apPerTurn — action points added at the start of every turn
 */
export const modifierStatSchema = z.enum([
  ...baseStatNames,
  'damageDealt',
  'damageTaken',
  'healDone',
  'critMult',
  'range',
  'firstMoveCost',
  'startAtb',
  'cooldownRecovery',
  'apPerTurn',
  // Anything above zero: a pit costs no extra point and does no harm ("Босые ноги").
  'pitImmune',
  // Anything above zero: enemies cannot move the hero on the bar ("Дисциплина").
  'enemyAtbImmune',
  // Anything above zero: the first move of a turn draws no attack of opportunity.
  'freeDisengage',
  // Anything above zero: push atoms do not move the hero ("Пояс силача").
  'pushImmune',
  // Share of the target's Armor and Resist the hero's hits ignore ("Клинок пустоты").
  'defensePierce',
  // Ability zones grow by this much: aura, line, chain +n, a 3-hex blob becomes 7.
  'zoneSize',
]);

export type ModifierStat = z.infer<typeof modifierStatSchema>;

/**
 * When a modifier holds. "self" is the hero carrying it; "target" is the other hero of
 * a hit or a heal, so target conditions only make sense on damage and heal modifiers.
 */
export const modifierConditionSchema = z
  .object({
    targetHpBelowPct: z.number().optional(),
    /** A status id, or "debuff", "buff" or "control" (stun, root, silence). */
    targetHas: z.string().optional(),
    selfHpAbovePct: z.number().optional(),
    selfHpBelowPct: z.number().optional(),
    targetDistanceAbove: z.number().int().optional(),
    noAdjacentAllies: z.literal(true).optional(),
    /** No living ally of the target stands next to it; summons do not count. */
    targetIsolated: z.literal(true).optional(),
    /** The target is the hero that took the turn right before this one. */
    targetActedLast: z.literal(true).optional(),
    /** Only on hits of abilities of at least this tier ("Гримуар бездны"). */
    abilityTierAtLeast: z.number().int().min(1).max(4).optional(),
  })
  .strict();

export type ModifierCondition = z.infer<typeof modifierConditionSchema>;

export const modifierSchema = z
  .object({
    stat: modifierStatSchema,
    add: z.number().optional(),
    mul: z.number().optional(),
    /** Who gets it: the carrier (default), or heroes around the carrier. */
    scope: z.enum(['self', 'adjacentAllies', 'allAllies', 'adjacentEnemies']).optional(),
    when: modifierConditionSchema.optional(),
    /** Multiplies the value by a count: enemies next to the carrier, or debuffs on the field. */
    per: z.enum(['adjacentEnemy', 'debuffOnField']).optional(),
  })
  .strict()
  .refine((m) => m.add !== undefined || m.mul !== undefined, 'a modifier needs add or mul');

export type Modifier = z.infer<typeof modifierSchema>;

/** Events a trigger can listen to. The carrier is always one side of the event. */
export const triggerEventSchema = z.enum([
  'battleStart',
  'turnStart',
  'turnEnd',
  'damaged',
  'dealtDamage',
  'crit',
  'kill',
  'died',
  'healedAlly',
  'abilityUsed',
  // An enemy standing next to the carrier starts its turn; "other" is that enemy.
  'adjacentEnemyTurnStart',
]);

export type TriggerEvent = z.infer<typeof triggerEventSchema>;

export const triggerSchema = z
  .object({
    on: triggerEventSchema,
    /**
     * Who the effects land on: the carrier, the other hero of the event (the attacker
     * for damaged, the victim for dealtDamage), the nearest enemy, or every enemy
     * within radius of the carrier.
     */
    to: z.enum(['self', 'other', 'nearestEnemy', 'enemiesAround']).optional(),
    radius: z.number().int().positive().optional(),
    /** Fires only on every N-th occurrence, counted over the match. */
    every: z.number().int().positive().optional(),
    oncePerMatch: z.literal(true).optional(),
    /** For damaged and dealtDamage: true only damage over time, false only direct hits. */
    periodic: z.boolean().optional(),
    /** For damaged and dealtDamage: only hits of this school ("Шипастый нагрудник"). */
    school: z.enum(['physical', 'magic', 'pure']).optional(),
    effects: z.array(effectSchema).min(1),
  })
  .strict();

export type Trigger = z.infer<typeof triggerSchema>;

export const passiveSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    class: z.string(),
    name: z.string().min(1),
    description: z.string().min(1),
    /** Budget tier, priced through config.generation.passiveTierCost. */
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    modifiers: z.array(modifierSchema).default([]),
    triggers: z.array(triggerSchema).default([]),
  })
  .strict();

export type Passive = z.infer<typeof passiveSchema>;

/**
 * A race modifier. On one of the seven stats it is applied once, when the hero is
 * generated: mulBase scales the generated number, add is added on top. On a battle
 * quantity (range, critMult) it works in battle, like a passive's modifier.
 */
export const raceModifierSchema = z
  .object({
    stat: modifierStatSchema,
    add: z.number().optional(),
    mulBase: z.number().optional(),
    /** A share of a battle quantity, such as the orc's damageDealt. Not for the seven stats. */
    mul: z.number().optional(),
  })
  .strict()
  .refine(
    (m) => m.add !== undefined || m.mulBase !== undefined || m.mul !== undefined,
    'a race modifier needs add, mulBase or mul',
  );

export type RaceModifier = z.infer<typeof raceModifierSchema>;

export const raceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    modifiers: z.array(raceModifierSchema).min(1),
  })
  .strict();

export type Race = z.infer<typeof raceSchema>;

/**
 * A perk: chosen between matches, one per hero per level. The same modifiers and
 * triggers as a passive, plus an optional change to one ability the player picks.
 */
export const perkSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    category: z.enum(['stats', 'ability', 'rules', 'situational', 'role']),
    /** Offered only to these roles; everyone when absent. */
    roles: z.array(z.enum(['tank', 'melee', 'ranged', 'support'])).optional(),
    /** Offered only to these classes; everyone when absent. */
    classes: z.array(z.string()).optional(),
    /** Never offered to a hero whose teammate already has it. */
    unique: z.literal(true).optional(),
    modifiers: z.array(modifierSchema).default([]),
    triggers: z.array(triggerSchema).default([]),
    /** Changes one ability of the player's choosing. Floors: 1 AP, a cooldown of 1. */
    abilityMod: z
      .object({
        ap: z.number().int().optional(),
        cooldown: z.number().int().optional(),
        range: z.number().int().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Perk = z.infer<typeof perkSchema>;

/**
 * An artifact: one slot per hero. Commons come with a generated hero and cost budget
 * points; rares and legendaries are match rewards. Works in battle like a passive.
 */
export const itemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    tier: z.enum(['common', 'rare', 'legendary']),
    /** Fits only these roles; everyone when absent. */
    roles: z.array(z.enum(['tank', 'melee', 'ranged', 'support'])).optional(),
    /** Fits only these classes; everyone when absent. */
    classes: z.array(z.string()).optional(),
    /** Budget points a common artifact takes from a generated hero. */
    cost: z.number().int().positive().optional(),
    modifiers: z.array(modifierSchema).default([]),
    triggers: z.array(triggerSchema).default([]),
  })
  .strict();

export type Item = z.infer<typeof itemSchema>;

/**
 * An arena modifier: one rule set for a whole match. The kind says which rule in
 * core/arena/modifiers.ts reads it; the numbers are the content's.
 */
export const arenaModifierRulesSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('shrink'), everyRounds: z.number().int().positive(), ringDamage: z.number().int().nonnegative() })
    .strict(),
  z
    .object({ kind: z.literal('manaStorm'), cooldownBonus: z.number().int().nonnegative(), dotMultiplier: z.number().positive() })
    .strict(),
  z
    .object({ kind: z.literal('bloodHarvest'), healMultiplier: z.number().nonnegative(), killAtb: z.number().int().nonnegative() })
    .strict(),
  z.object({ kind: z.literal('fog'), sightRange: z.number().int().positive() }).strict(),
  z
    .object({ kind: z.literal('powerPoint'), damageBonus: z.number().nonnegative(), holdRounds: z.number().int().positive() })
    .strict(),
  z
    .object({
      kind: z.literal('guardian'),
      /** A class with summonOnly, so it is never drafted; it gives the figure and the name. */
      classId: z.string(),
      maxHp: z.number().int().positive(),
      attack: z.number().nonnegative(),
      armor: z.number().nonnegative(),
      resist: z.number().nonnegative(),
      speed: z.number().positive(),
      /** The guardian's strike: k × Attack, physical. */
      k: z.number().positive(),
    })
    .strict(),
]);

export type ArenaModifierRules = z.infer<typeof arenaModifierRulesSchema>;

export const arenaModifierSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    rules: arenaModifierRulesSchema,
  })
  .strict();

export type ArenaModifier = z.infer<typeof arenaModifierSchema>;

/** The seven stats a race changes at generation; anything else acts in battle. */
export const BASE_STAT_NAMES: readonly string[] = baseStatNames;

// --- targeting shapes --------------------------------------------------------
// Geometry is pinned in battle/targeting.ts; see the plan notes on blob, line and
// chain, which docs/ai/content-schema.md left undefined.

const shapeFilter = z.enum(['enemies', 'allies', 'all']).optional();

export const shapeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('single'), filter: shapeFilter }).strict(),
  z
    .object({
      type: z.literal('targetPlusAdjacent'),
      count: z.number().int().positive(),
      filter: shapeFilter,
    })
    .strict(),
  // Only 1, 3 and 7 are meaningful: the target alone, a triangle facing the caster,
  // or the target plus its whole ring.
  z.object({ type: z.literal('blob'), size: z.union([z.literal(1), z.literal(3), z.literal(7)]), filter: shapeFilter }).strict(),
  // Centred on the caster, not on the target hex. Named aura rather than ring so it
  // is not confused with ring() in hex.ts, which returns a circumference.
  z.object({ type: z.literal('aura'), radius: z.number().int().positive(), filter: shapeFilter }).strict(),
  z.object({ type: z.literal('line'), length: z.number().int().positive(), filter: shapeFilter }).strict(),
  // Three hexes: the one in front and the two flanking it one step further.
  z.object({ type: z.literal('cone'), filter: shapeFilter }).strict(),
  z
    .object({
      type: z.literal('chain'),
      jumps: z.number().int().positive(),
      falloff: z.number().min(0).max(1),
      jumpRange: z.number().int().positive().optional(),
      filter: shapeFilter,
    })
    .strict(),
  z.object({ type: z.literal('allAllies') }).strict(),
  z.object({ type: z.literal('allEnemies') }).strict(),
]);

export type Shape = z.infer<typeof shapeSchema>;

// --- abilities ---------------------------------------------------------------

export const abilitySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    class: z.string(),
    name: z.string().min(1),
    description: z.string().min(1),
    icon: z.string(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    ap: z.number().int().min(0).max(4),
    cooldown: z.union([z.number().int().nonnegative(), z.literal('once')]),
    range: z.number().int().nonnegative(),
    targets: z.enum(['enemy', 'ally', 'self', 'any', 'emptyHex']),
    requiresLos: z.boolean(),
    shape: shapeSchema,
    effects: z.array(effectSchema).min(1),
    /** Movement abilities that do not provoke an opportunity attack. */
    ignoresZoc: z.boolean().optional(),
    /** The free class attack. It occupies no slot and is excluded from pool rules. */
    basic: z.boolean().optional(),
    /** Lands this many of the caster's turns later, at the start of that turn ("Метеор"). */
    delay: z.number().int().positive().optional(),
  })
  .strict();

export type Ability = z.infer<typeof abilitySchema>;

// --- statuses ----------------------------------------------------------------

export const statusDefSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(['debuff', 'buff', 'special']),
    /** stun, root and silence cannot be reapplied on consecutive turns, see section 7. */
    hardControl: z.boolean(),
    maxStacks: z.number().int().positive(),
    /** flat adds a number, fraction adds a share, none carries no value. */
    valueKind: z.enum(['flat', 'fraction', 'none']),
    /** Which stat the value moves, for the statuses that move one. */
    stat: z.enum(['maxHp', 'attack', 'magic', 'armor', 'resist', 'speed', 'critChance']).optional(),
    /** A status may move two stats at once, such as weaken hitting attack and magic. */
    stats: z
      .array(z.enum(['maxHp', 'attack', 'magic', 'armor', 'resist', 'speed', 'critChance']))
      .optional(),
    /**
     * A battle quantity the value moves, such as range or damageTaken. Flat adds,
     * fraction is a share. The sign follows the kind like stats do (a debuff
     * subtracts) unless battleSign says otherwise: "Охота" is a debuff that raises
     * the damage its target takes.
     */
    battleStat: modifierStatSchema.optional(),
    battleSign: z.union([z.literal(1), z.literal(-1)]).optional(),
    /** Stun, root and silence cannot land while this is on. */
    controlImmune: z.literal(true).optional(),
    /** The carrier's abilities ignore line of sight. */
    ignoresLos: z.literal(true).optional(),
    /** Enemies cannot pick the carrier as the single target of an ability. */
    untargetable: z.literal(true).optional(),
    /** Every hit on the carrier does nothing. */
    invulnerable: z.literal(true).optional(),
    /** The next hit that would kill leaves the carrier at 1 instead, and the status goes. */
    deathWard: z.literal(true).optional(),
    /** Goes as soon as the carrier deals damage with an ability or an attack. */
    breaksOnDamageDealt: z.literal(true).optional(),
    /** Every hit the carrier deals while it is on is a crit. */
    critsWhileOn: z.literal(true).optional(),
    /** The first enemy hit is split: this share goes back to the attacker, then it is gone. */
    reflectPct: z.number().min(0).max(1).optional(),
    /** The first time this status would land on the carrier, it does not, and this one goes. */
    blocksStatus: z.string().optional(),
    /** Like deathWard, but the carrier is left with this share of maximum health. */
    reviveAtPct: z.number().positive().max(1).optional(),
    /** A kill by the carrier on its own turn gives it this many AP back. */
    apOnKill: z.number().int().positive().optional(),
    /** After each action an enemy ends within radius, the carrier gains delta ATB. */
    atbOnEnemyAction: z
      .object({ radius: z.number().int().positive(), delta: z.number() })
      .strict()
      .optional(),
    /** Loses this share of maximum health at the start of each of its turns. */
    drainPctMaxHp: z.number().positive().optional(),
  })
  .strict();

export type StatusDef = z.infer<typeof statusDefSchema>;

// --- classes -----------------------------------------------------------------

export const heroClassSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    role: z.enum(['tank', 'melee', 'ranged', 'support']),
    primaryStat: z.enum(['attack', 'magic', 'armor', 'speed', 'critChance']),
    secondaryStats: z.array(z.enum(['maxHp', 'attack', 'magic', 'armor', 'resist', 'speed', 'critChance'])),
    baseAttack: z.string(),
    statGrowth: z.object({ hp: z.number(), primary: z.number(), secondary: z.number() }).strict(),
    portrait: z.string(),
    color: z.string(),
    /** A class only summons use: never drafted, never generated, no pool rules. */
    summonOnly: z.literal(true).optional(),
  })
  .strict();

export type HeroClass = z.infer<typeof heroClassSchema>;

// --- config ------------------------------------------------------------------

const sideSchema = z.enum(['A', 'B']);
/** An inclusive [min, max] pair. */
const numRange = z.tuple([z.number(), z.number()]).refine(([lo, hi]) => lo <= hi, 'min > max');
const intRange = z
  .tuple([z.number().int(), z.number().int()])
  .refine(([lo, hi]) => lo <= hi, 'min > max');

export const configSchema = z
  .object({
    battle: z
      .object({
        apPerTurn: z.number().int().positive(),
        maxRounds: z.number().int().positive(),
        ticksPerRound: z.number().int().positive(),
        atbThreshold: z.number().positive(),
        moveCost: z.number().int().positive(),
        /** The most range any mix of passives, artifacts, perks and high ground adds. */
        maxRangeBonus: z.number().int().nonnegative(),
        playerSide: z.enum(['A', 'B']),
        /** Zone of control is a free basic attack, not an AP tax. See the plan. */
        /** How deep one trigger may set off another before the chain is cut. */
        maxTriggerDepth: z.number().int().positive(),
        opportunityAttack: z
          .object({
            enabled: z.boolean(),
            /** Only classes whose basic attack has range 1 hold a zone of control. */
            meleeOnly: z.boolean(),
            oncePerEnemyPerTurn: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    formulas: z
      .object({
        spread: z.tuple([z.number(), z.number()]),
        critMult: z.number(),
        defenseConstant: z.number().positive(),
        minDamage: z.number().int().nonnegative(),
        /** Defence is clamped here, otherwise vulnerable stacks divide by zero. */
        minDefense: z.number(),
        /** Speed is clamped here, otherwise slow stacks stop a hero forever. */
        minSpeed: z.number().positive(),
        critChanceCap: z.number().min(0).max(1),
      })
      .strict(),
    arena: z
      .object({
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
        startColumnsA: z.array(z.number().int().nonnegative()),
        startColumnsB: z.array(z.number().int().nonnegative()),
        obstacles: z.object({ min: z.number().int(), max: z.number().int() }).strict(),
        weights: z
          .object({ rock: z.number(), column: z.number(), thicket: z.number(), pit: z.number() })
          .strict(),
        /** "Возвышенность": how many at most, and what standing on one gives. */
        high: z
          .object({
            maxCount: z.number().int().nonnegative(),
            range: z.number().int().nonnegative(),
            damage: z.number().nonnegative(),
          })
          .strict(),
        maxGenerationAttempts: z.number().int().positive(),
        pit: z.object({ damage: z.number().int(), extraApCost: z.number().int() }).strict(),
      })
      .strict(),
    generation: z
      .object({
        budget: z.number().int().positive(),
        abilityTierCost: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        /** A passive's price by its tier, the "Пассивка" column of the design's tier table. */
        passiveTierCost: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        abilityBudget: intRange,
        maxAbilityAttempts: z.number().int().positive(),
        /**
         * Points held back for the passive (stage 3) and the starting artifact
         * (stage 4), which do not exist yet, so a hero's strength does not jump when
         * they arrive. See docs/ai/game-rules.md section 10.
         */
        /** Held back at the draft for the passive and the tier IV ability chosen later. */
        reserve: z
          .object({ passive: z.number().int().nonnegative(), ultimate: z.number().int().nonnegative() })
          .strict(),
        /** Actives a hero is drafted with; tier IV never among them. */
        startingAbilities: z.number().int().positive(),
        /** The level-1 range of every stat. Its bottom is free; the rest costs points. */
        statRanges: z
          .object({
            maxHp: numRange,
            attack: numRange,
            magic: numRange,
            armor: numRange,
            resist: numRange,
            speed: numRange,
            critChance: numRange,
          })
          .strict(),
        /** What the whole range of any one stat costs. The same for every stat. */
        pointsPerRange: z.number().int().positive(),
        primaryMinShare: z.number().min(0).max(1),
        otherMaxShare: z.number().min(0).max(1),
        /** How likely a spare point is to land on each kind of stat. */
        statWeights: z
          .object({ primary: z.number(), secondary: z.number(), other: z.number() })
          .strict(),
      })
      .strict(),
    draft: z
      .object({
        poolSize: z.number().int().positive(),
        /** No class appears in one pool more often than this. */
        maxSameClass: z.number().int().positive(),
        order: z.array(sideSchema).min(2),
        pickSeconds: z.number().int().positive(),
        /** Who places which hero, one at a time. The last word is the compensation. */
        placementOrder: z.array(sideSchema).min(2),
      })
      .strict(),
    run: z
      .object({
        winsToFinish: z.number().int().positive(),
        maxMatches: z.number().int().positive(),
        /** Perks offered to each hero in an upgrade phase. */
        perkChoices: z.number().int().positive(),
        /** Options offered for an unlock: a passive, then a tier IV ability. */
        unlockChoices: z.number().int().positive(),
        /** Artifacts offered as the reward of an upgrade phase. */
        rewardChoices: z.number().int().positive(),
        /** The tier offered after each finished match: [after 1, after 2, ...]. */
        rewardTiers: z.array(z.enum(['rare', 'legendary'])),
        /** After which finished match the passive is chosen, and after which tier IV. */
        passiveAfterMatch: z.number().int().positive(),
        ultimateAfterMatch: z.number().int().positive(),
        /** The matches played with an arena modifier, announced in the upgrade phase before. */
        modifierMatches: z.array(z.number().int().positive()),
        /** Candidates each side is offered to swap one hero for, once per upgrade phase. */
        swapChoices: z.number().int().nonnegative(),
        /** A side this many wins behind sees extraChoices more perks and rewards. */
        catchUp: z
          .object({ deficit: z.number().int().positive(), extraChoices: z.number().int().nonnegative() })
          .strict(),
      })
      .strict(),
    ai: z
      .object({
        maxPlans: z.number().int().positive(),
        /** How many of the best plans lookahead depth 1, 2, ... looks into. */
        lookaheadTopPlans: z.array(z.number().int().positive()),
        weights: z
          .object({
            damageDealt: z.number(),
            kill: z.number(),
            overkill: z.number(),
            hpLost: z.number(),
            healing: z.number(),
            stunTurn: z.number(),
            silenceTurn: z.number(),
            threat: z.number(),
            distanceToTarget: z.number(),
            ultimateSaved: z.number(),
            focusBonus: z.number(),
            summonDamage: z.number(),
            trapNearEnemy: z.number(),
            highGround: z.number(),
            onCollapse: z.number(),
            powerPoint: z.number(),
            neutralDamage: z.number(),
            guardianKill: z.number(),
            dotDamage: z.number(),
            debuffTurn: z.number(),
          })
          .strict(),
        profiles: z.record(
          z
            .object({
              noise: z.number(),
              useThreat: z.boolean(),
              allowUltimates: z.boolean(),
              lookahead: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        /** The simple draft AI from docs/ai/ai-opponent.md. */
        draft: z
          .object({
            statWeight: z.number(),
            abilityWeight: z.number(),
            missingRoleBonus: z.number(),
            duplicateRolePenalty: z.number(),
            noise: z.number().min(0),
            /** A swap candidate must score this share better than the hero it replaces. */
            swapMargin: z.number().min(0),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;

// --- names -------------------------------------------------------------------

/** Names handed to generated heroes. A pool never repeats one. */
export const namesSchema = z.array(z.string().min(1)).min(1);

// --- teams (stage 1 only: rosters are hand written, see docs/ai/roadmap.md) ----

export const teamHeroSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    class: z.string(),
    side: z.enum(['A', 'B']),
    /** Offset coordinates, [col, row]. Axial conversion happens on load. */
    at: z.tuple([z.number().int(), z.number().int()]),
    stats: z
      .object({
        maxHp: z.number().int().positive(),
        attack: z.number().int(),
        magic: z.number().int(),
        armor: z.number().int(),
        resist: z.number().int(),
        speed: z.number().int(),
        critChance: z.number().min(0).max(1),
      })
      .strict(),
    abilities: z.array(z.string()).min(1),
    /** Optional so the hand-made stage 1 rosters keep working without one. */
    passive: z.string().optional(),
    race: z.string().optional(),
    perks: z
      .array(z.object({ perkId: z.string(), abilityId: z.string().optional() }).strict())
      .optional(),
    item: z.string().optional(),
  })
  .strict();

export const teamsSchema = z.object({ heroes: z.array(teamHeroSchema).min(2) }).strict();

export type TeamHero = z.infer<typeof teamHeroSchema>;
export type Teams = z.infer<typeof teamsSchema>;

// --- registry ----------------------------------------------------------------

export interface ContentRegistry {
  readonly config: Config;
  readonly classes: Readonly<Record<string, HeroClass>>;
  readonly abilities: Readonly<Record<string, Ability>>;
  readonly statuses: Readonly<Record<string, StatusDef>>;
  readonly names: readonly string[];
  readonly passives: Readonly<Record<string, Passive>>;
  readonly races: Readonly<Record<string, Race>>;
  readonly perks: Readonly<Record<string, Perk>>;
  readonly items: Readonly<Record<string, Item>>;
  readonly arenaModifiers: Readonly<Record<string, ArenaModifier>>;
}

export interface RawContent {
  readonly config: unknown;
  readonly classes: unknown;
  readonly statuses: unknown;
  readonly abilities: readonly unknown[];
  readonly names: unknown;
  /** One file of passives per class. */
  readonly passives: readonly unknown[];
  readonly races: unknown;
  readonly perks: unknown;
  readonly items: unknown;
  readonly arenaModifiers: unknown;
}

export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentError';
  }
}

function byId<T extends { id: string }>(items: readonly T[], what: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) {
    if (out[item.id] !== undefined) {
      throw new ContentError(`Duplicate ${what} id: ${item.id}`);
    }
    out[item.id] = item;
  }
  return out;
}

function checkEffectRefs(effects: readonly Effect[], owner: string, statuses: Record<string, StatusDef>): void {
  for (const effect of effects) {
    if (effect.type === 'status' && statuses[effect.status] === undefined) {
      throw new ContentError(`${owner} references unknown status ${effect.status}`);
    }
  }
}

function checkPassives(
  passives: Record<string, Passive>,
  classes: Record<string, HeroClass>,
  statuses: Record<string, StatusDef>,
): void {
  for (const passive of Object.values(passives)) {
    if (classes[passive.class] === undefined) {
      throw new ContentError(`Passive ${passive.id} references unknown class ${passive.class}`);
    }
    for (const trigger of passive.triggers) {
      checkEffectRefs(trigger.effects, `Passive ${passive.id}`, statuses);
    }
  }
}

/** Parses and cross-checks every reference. Throws ContentError on the first problem. */
export function buildRegistry(raw: RawContent): ContentRegistry {
  const config = configSchema.parse(raw.config);
  const classes = byId(z.array(heroClassSchema).parse(raw.classes), 'class');
  const statuses = byId(z.array(statusDefSchema).parse(raw.statuses), 'status');
  const abilityList = raw.abilities.flatMap((file) => z.array(abilitySchema).parse(file));
  const abilities = byId(abilityList, 'ability');
  const names = namesSchema.parse(raw.names);
  const passives = byId(
    raw.passives.flatMap((file) => z.array(passiveSchema).parse(file)),
    'passive',
  );
  if (new Set(names).size !== names.length) {
    throw new ContentError('names.json contains a duplicate name');
  }

  for (const ability of Object.values(abilities)) {
    // Basic attacks are shared by several classes, so they carry the pseudo-class "common".
    if (ability.basic !== true && classes[ability.class] === undefined) {
      throw new ContentError(`Ability ${ability.id} references unknown class ${ability.class}`);
    }
    for (const effect of ability.effects) {
      if (effect.type === 'status' && statuses[effect.status] === undefined) {
        throw new ContentError(`Ability ${ability.id} references unknown status ${effect.status}`);
      }
      if (effect.if?.targetHas !== undefined) {
        const has = effect.if.targetHas;
        if (has !== 'debuff' && has !== 'buff' && statuses[has] === undefined) {
          throw new ContentError(`Ability ${ability.id} has condition on unknown status ${has}`);
        }
      }
    }
  }

  for (const heroClass of Object.values(classes)) {
    if (abilities[heroClass.baseAttack] === undefined) {
      throw new ContentError(`Class ${heroClass.id} references unknown baseAttack ${heroClass.baseAttack}`);
    }
  }

  checkPassives(passives, classes, statuses);
  const races = byId(z.array(raceSchema).parse(raw.races), 'race');
  for (const race of Object.values(races)) {
    for (const modifier of race.modifiers) {
      if (modifier.mulBase !== undefined && !BASE_STAT_NAMES.includes(modifier.stat)) {
        throw new ContentError(`Race ${race.id}: mulBase only works on the seven stats, not ${modifier.stat}`);
      }
    }
  }

  const perks = byId(z.array(perkSchema).parse(raw.perks), 'perk');
  for (const perk of Object.values(perks)) {
    for (const cls of perk.classes ?? []) {
      if (classes[cls] === undefined) throw new ContentError(`Perk ${perk.id} names unknown class ${cls}`);
    }
    for (const trigger of perk.triggers) checkEffectRefs(trigger.effects, `Perk ${perk.id}`, statuses);
  }

  const items = byId(z.array(itemSchema).parse(raw.items), 'item');
  for (const item of Object.values(items)) {
    for (const cls of item.classes ?? []) {
      if (classes[cls] === undefined) throw new ContentError(`Item ${item.id} names unknown class ${cls}`);
    }
    if (item.tier === 'common' && item.cost === undefined) {
      throw new ContentError(`Item ${item.id}: a common artifact needs a cost`);
    }
    for (const trigger of item.triggers) checkEffectRefs(trigger.effects, `Item ${item.id}`, statuses);
  }

  const arenaModifiers = byId(z.array(arenaModifierSchema).parse(raw.arenaModifiers), 'arena modifier');
  for (const modifier of Object.values(arenaModifiers)) {
    if (modifier.rules.kind === 'guardian' && classes[modifier.rules.classId]?.summonOnly !== true) {
      throw new ContentError(`Arena modifier ${modifier.id} needs a summonOnly class, not ${modifier.rules.classId}`);
    }
  }
  return { config, classes, abilities, statuses, names, passives, races, perks, items, arenaModifiers };
}

export function getAbility(content: ContentRegistry, id: AbilityId): Ability {
  const ability = content.abilities[id];
  if (ability === undefined) {
    throw new ContentError(`Unknown ability: ${id}`);
  }
  return ability;
}

export function getClass(content: ContentRegistry, id: ClassId): HeroClass {
  const heroClass = content.classes[id];
  if (heroClass === undefined) {
    throw new ContentError(`Unknown class: ${id}`);
  }
  return heroClass;
}

export function getStatus(content: ContentRegistry, id: StatusId): StatusDef {
  const status = content.statuses[id];
  if (status === undefined) {
    throw new ContentError(`Unknown status: ${id}`);
  }
  return status;
}
