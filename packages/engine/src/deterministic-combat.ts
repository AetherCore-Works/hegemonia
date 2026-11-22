import type {
  DeterministicMiniRoll,
  PlayerState,
  TerritoryState,
  UnitCounts,
} from "@hegemonia/shared";
import type { SeededRng } from "./rng";
import { totalUnits } from "./units";

/** Baseline +10% defensive terrain/entrenchment advantage in every deterministic battle. */
export const DEFENDER_BASE_ENTRENCHMENT_MULT = 1.1;

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
  defenderEntrenchmentPct: number;
  miniRolls: DeterministicMiniRoll[];
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

  // 2. Combined-Arms & Unit Threshold Multipliers (defender starts with +10% baseline entrenchment)
  let attMult = 1.0;
  let defMult = DEFENDER_BASE_ENTRENCHMENT_MULT;

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

  // 8. Combat-Width Mini-Rolls Exchange (+/-12% tactical micro-rolls per salvo)
  const totalAtt = totalUnits(att);
  const totalDef = totalUnits(def);
  const totalAttHp = totalAtt + (att.tank ?? 0);
  const totalDefHp = totalDef + (def.tank ?? 0);
  const minKillForDef = def.infantry === 0 && def.tank > 0 ? 2 : 1;
  const minKillForAtt = att.infantry === 0 && att.tank > 0 ? 2 : 1;

  const attPowerPerHp = baseAttackPower / Math.max(1, totalAttHp);
  const defPowerPerHp = baseDefensePower / Math.max(1, totalDefHp);
  const numSalvos = Math.min(5, Math.max(3, Math.ceil(Math.min(totalAtt, totalDef) / 2) + 1));
  const SALVO_LETHALITY = 0.22;

  let liveAttHp = totalAttHp;
  let liveDefHp = totalDefHp;
  let accDmgToDef = 0;
  let accDmgToAtt = 0;
  let sumAttFire = 0;
  let sumDefFire = 0;
  const miniRolls: DeterministicMiniRoll[] = [];

  for (let salvo = 1; salvo <= numSalvos; salvo++) {
    if (liveAttHp <= 0.05 || liveDefHp <= 0.05) break;

    // Frontage / combat-width cap: smaller frontline caps active engagement, reserves contribute 25%
    const width = Math.min(liveAttHp, liveDefHp);
    const attEngaged = width + 0.25 * Math.max(0, liveAttHp - width);
    const defEngaged = width + 0.25 * Math.max(0, liveDefHp - width);

    const attRoll = Number((0.88 + rng.nextFloat() * 0.24).toFixed(2));
    const defRoll = Number((0.88 + rng.nextFloat() * 0.24).toFixed(2));

    const attFire = Number((attEngaged * attPowerPerHp * attRoll).toFixed(2));
    const defFire = Number((defEngaged * defPowerPerHp * defRoll).toFixed(2));

    const dmgToDef = Number((attFire * SALVO_LETHALITY).toFixed(2));
    const dmgToAtt = Number((defFire * SALVO_LETHALITY).toFixed(2));

    accDmgToDef += dmgToDef;
    accDmgToAtt += dmgToAtt;
    liveDefHp = Math.max(0, liveDefHp - dmgToDef);
    liveAttHp = Math.max(0, liveAttHp - dmgToAtt);
    sumAttFire += attFire;
    sumDefFire += defFire;

    miniRolls.push({
      salvo,
      attRoll,
      defRoll,
      attFire,
      defFire,
      attDamageDealt: dmgToDef,
      defDamageDealt: dmgToAtt,
    });
  }

  const avgAttRoll =
    miniRolls.length > 0
      ? miniRolls.reduce((sum, r) => sum + r.attRoll, 0) / miniRolls.length
      : 1;
  const avgDefRoll =
    miniRolls.length > 0
      ? miniRolls.reduce((sum, r) => sum + r.defRoll, 0) / miniRolls.length
      : 1;
  const effectiveAttackPower = Number((baseAttackPower * avgAttRoll).toFixed(2));
  const effectiveDefensePower = Number((baseDefensePower * avgDefRoll).toFixed(2));
  const attackerWonRound = sumAttFire >= sumDefFire;

  let attackerDamageDealt = Math.min(
    totalDefHp,
    liveDefHp <= 0.05 ? totalDefHp : Math.round(accDmgToDef)
  );
  let defenderDamageDealt = Math.min(
    totalAttHp,
    liveAttHp <= 0.05 ? totalAttHp : Math.round(accDmgToAtt)
  );

  // Deadlock prevention: an active clash always inflicts at least 1 unit loss on the losing side
  if (attackerDamageDealt < minKillForDef && defenderDamageDealt < minKillForAtt) {
    if (attackerWonRound) {
      attackerDamageDealt = Math.min(totalDefHp, minKillForDef);
    } else {
      defenderDamageDealt = Math.min(totalAttHp, minKillForAtt);
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
    defenderEntrenchmentPct: 10,
    miniRolls,
    artillerySuppressionBonus,
    artillerySiegeBonus,
    artillerySaturationBonus,
    tankSuperiorityBonus,
    unescortedArtilleryPenalty,
    encircledDefenderPenalty,
  };
}
