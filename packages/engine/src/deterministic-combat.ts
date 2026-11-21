import type { PlayerState, TerritoryState, UnitCounts } from "@hegemonia/shared";
import type { SeededRng } from "./rng";
import { totalUnits } from "./units";

export interface DeterministicCombatInput {
  attackerUnits: UnitCounts;
  defenderUnits: UnitCounts;
  attacker: PlayerState;
  defender: PlayerState | undefined;
  fromTerritory: TerritoryState;
  toTerritory: TerritoryState;
  attackerHasOil: boolean;
  defenderHasOil: boolean;
  fortLevel: number;
  isDefendingCapital: boolean;
  wonderConstructing: boolean;
  hasCasBonus: boolean;
  coastalBombardment: boolean;
  reconSpotted: boolean;
  /** Last Stand / Coalition modifiers */
  defenderVsCoalitionSize: number;
  attackerIsCoalitionMember: boolean;
  /** Number of territories owned by defender (for tall_sovereign / defense_in_depth) */
  defenderTerritoryCount: number;
  isFirstCombatRoundOnTarget: boolean;
  rng: SeededRng;
}

export interface DeterministicCombatResult {
  baseAttackPower: number;
  baseDefensePower: number;
  effectiveAttackPower: number;
  effectiveDefensePower: number;
  attackerDamageDealt: number;
  defenderDamageDealt: number;
  attackerWonRound: boolean;
  artillerySuppressionBonus: boolean;
  artillerySiegeBonus: boolean;
  artillerySaturationBonus: boolean;
  tankSuperiorityBonus: boolean;
  unescortedArtilleryPenalty: boolean;
  encircledDefenderPenalty?: number;
}

/**
 * HEGEM-178: Resolves one round of deterministic combined-arms combat with
 * +/-12% tactical luck fluctuation applied to Attack and Defense power.
 */
export function resolveDeterministicCombat(
  input: DeterministicCombatInput
): DeterministicCombatResult {
  const {
    attackerUnits: att,
    defenderUnits: def,
    attacker,
    defender,
    fromTerritory,
    toTerritory,
    attackerHasOil,
    defenderHasOil,
    fortLevel,
    isDefendingCapital,
    wonderConstructing,
    hasCasBonus,
    coastalBombardment,
    reconSpotted,
    defenderVsCoalitionSize,
    attackerIsCoalitionMember,
    defenderTerritoryCount,
    isFirstCombatRoundOnTarget,
    rng,
  } = input;

  // 1. Base Unit Power
  const attTankWeight = attackerHasOil ? 2.2 : 1.0;
  const defTankWeight = defenderHasOil ? 1.8 : 1.2;

  const unescortedArtilleryPenalty =
    def.artillery > 0 && def.infantry === 0 && def.tank === 0;
  const defArtWeight = unescortedArtilleryPenalty ? 0.5 : 1.2;

  let baseAttack =
    att.infantry * 1.0 +
    att.tank * attTankWeight +
    att.artillery * 1.6 +
    att.navy * 1.2 +
    att.aircraft * 1.2;

  let baseDefense =
    def.infantry * 1.0 +
    def.tank * defTankWeight +
    def.artillery * defArtWeight +
    def.navy * 1.0 +
    def.aircraft * 1.0;

  // 2. Combined-Arms & Unit Threshold Multipliers
  let attMult = 1.0;
  let defMult = 1.0;

  const tankSuperiorityBonus = att.tank >= 5 && att.tank > def.tank;
  if (tankSuperiorityBonus) attMult *= 1.15;

  const artillerySuppressionBonus = att.artillery >= 2;
  const artillerySiegeBonus = att.artillery >= 4;
  const artillerySaturationBonus = att.artillery >= 6;
  if (artillerySaturationBonus) attMult *= 1.15;

  // CAS Air Multiplier (+15% per squadron engaged, cap +45%)
  const casSquadrons = Math.min(3, (att.aircraft ?? 0) + (hasCasBonus ? 1 : 0));
  if (casSquadrons > 0) attMult *= 1 + casSquadrons * 0.15;

  if (coastalBombardment) attMult *= 1.15;
  if (reconSpotted) attMult *= 1.15;

  // 3. Fortifications & Wonder
  if (fortLevel >= 2 && !artillerySiegeBonus) {
    defMult *= 1.5;
  } else if (fortLevel >= 1 && !artillerySuppressionBonus) {
    defMult *= 1.25;
  }
  if (wonderConstructing) defMult *= 1.25;

  // 4. Capital & National Morale
  if (isDefendingCapital) defMult *= 1.25;
  if (attacker.isCapitalLost) attMult *= 0.8;
  if (defender?.isCapitalLost) defMult *= 0.85;

  // 5. Logistics & Siege
  if (fromTerritory.isEncircled) attMult *= 0.85;
  let encircledDefenderPenalty: number | undefined;
  if (toTerritory.isEncircled) {
    const rounds = toTerritory.encircledRounds ?? 1;
    encircledDefenderPenalty = rounds >= 2 ? 2 : 1;
    defMult *= rounds >= 2 ? 0.6 : 0.75;
  }

  // 6. Geopolitics: Last Stand vs Coalition (disabled for active Doomsday Wonder builders)
  const defInfamy = defender?.infamy ?? 0;
  const defenderHasActiveWonder =
    defender?.wonderStatus === "constructing" || defender?.wonderStatus === "countdown";
  if (!defenderHasActiveWonder) {
    if (defInfamy >= 100 && defenderVsCoalitionSize >= 3) {
      defMult *= 1.35;
    } else if (defInfamy >= 50 && defenderVsCoalitionSize >= 2) {
      defMult *= 1.2;
    }
  }
  if (attackerIsCoalitionMember) attMult *= 1.15;

  // 7. Doctrines
  if (attacker.doctrineId === "extermination") attMult *= 1.15;
  if (
    attacker.doctrineId === "blitzkrieg" &&
    isFirstCombatRoundOnTarget &&
    att.tank > 0 &&
    !fromTerritory.outOfFuel
  ) {
    attMult *= 1.15;
  }
  if (
    defender &&
    (defender.doctrineId === "tall_sovereign" ||
      defender.doctrineId === "defense_in_depth") &&
    defenderTerritoryCount > 5
  ) {
    defMult *= 0.9;
  }

  const baseAttackPower = Number((baseAttack * attMult).toFixed(2));
  const baseDefensePower = Number((baseDefense * defMult).toFixed(2));

  // 8. Tactical Luck (+/-12%: range 0.88 to 1.12)
  const attLuck = 0.88 + rng.nextFloat() * 0.24;
  const defLuck = 0.88 + rng.nextFloat() * 0.24;
  const effectiveAttackPower = Number((baseAttackPower * attLuck).toFixed(2));
  const effectiveDefensePower = Number((baseDefensePower * defLuck).toFixed(2));

  const totalAtt = totalUnits(att);
  const totalDef = totalUnits(def);
  const totalAttHp = totalAtt + (att.tank ?? 0);
  const totalDefHp = totalDef + (def.tank ?? 0);
  const minKillForDef = def.infantry === 0 && def.tank > 0 ? 2 : 1;
  const minKillForAtt = att.infantry === 0 && att.tank > 0 ? 2 : 1;
  const attackerWonRound = effectiveAttackPower >= effectiveDefensePower;

  let attackerDamageDealt = 0;
  let defenderDamageDealt = 0;

  if (effectiveAttackPower >= effectiveDefensePower * 1.15) {
    // Clear attacker superiority
    const ratio = effectiveDefensePower > 0 ? effectiveAttackPower / effectiveDefensePower : 3;
    attackerDamageDealt = Math.min(
      totalDefHp,
      Math.max(minKillForDef, Math.ceil(totalDefHp * Math.min(1, 0.45 * ratio)))
    );
    defenderDamageDealt = Math.min(
      totalAttHp,
      Math.max(0, Math.floor((Math.min(totalAttHp, totalDefHp) * 0.25) / Math.max(1, ratio)))
    );
  } else if (effectiveDefensePower >= effectiveAttackPower * 1.15) {
    // Clear defender superiority
    const ratio = effectiveAttackPower > 0 ? effectiveDefensePower / effectiveAttackPower : 3;
    defenderDamageDealt = Math.min(
      totalAttHp,
      Math.max(minKillForAtt, Math.ceil(totalAttHp * Math.min(1, 0.45 * ratio)))
    );
    attackerDamageDealt = Math.min(
      totalDefHp,
      Math.max(0, Math.floor((Math.min(totalAttHp, totalDefHp) * 0.25) / Math.max(1, ratio)))
    );
  } else {
    // Tight battle (~1:1, within 15%)
    if (attackerWonRound) {
      attackerDamageDealt = Math.min(
        totalDefHp,
        Math.max(minKillForDef, Math.ceil(totalDefHp * 0.4))
      );
      defenderDamageDealt = Math.min(
        totalAttHp,
        Math.max(0, Math.floor(Math.min(totalAttHp, totalDefHp) * 0.25))
      );
    } else {
      defenderDamageDealt = Math.min(
        totalAttHp,
        Math.max(minKillForAtt, Math.ceil(totalAttHp * 0.4))
      );
      attackerDamageDealt = Math.min(
        totalDefHp,
        Math.max(0, Math.floor(Math.min(totalAttHp, totalDefHp) * 0.25))
      );
    }
  }

  return {
    baseAttackPower,
    baseDefensePower,
    effectiveAttackPower,
    effectiveDefensePower,
    attackerDamageDealt,
    defenderDamageDealt,
    attackerWonRound,
    artillerySuppressionBonus,
    artillerySiegeBonus,
    artillerySaturationBonus,
    tankSuperiorityBonus,
    unescortedArtilleryPenalty,
    encircledDefenderPenalty,
  };
}
