// Hegemonia Battle Odds Probability Calculator (HEGEM-154 Doctrine & Tech Aware)
import type { DoctrineId, UnitCounts } from "@hegemonia/shared";

export interface CombatOddsModifiers {
  attackerDoctrine?: DoctrineId | null;
  defenderDoctrine?: DoctrineId | null;
  attackerUnits?: Partial<UnitCounts>;
  defenderUnits?: Partial<UnitCounts>;
  attackerHasFuel?: boolean;
  isFirstRoundOnTarget?: boolean;
  defenderTerritoryCount?: number;
  fortificationLevel?: number;
  isDefenderCapital?: boolean;
  hasCasBonus?: boolean;
  coastalBombardment?: boolean;
  encircledPenalty?: number;
}

export interface CombatOddsBadge {
  label: string;
  kind: "buff" | "debuff" | "neutral";
}

/**
 * Returns human-readable tactical badges summarizing the active modifiers
 * reflected in the Win Odds simulation.
 */
export function describeCombatOddsModifiers(
  modifiers?: CombatOddsModifiers
): CombatOddsBadge[] {
  if (!modifiers) return [];
  const badges: CombatOddsBadge[] = [];
  const attUnits = modifiers.attackerUnits ?? {};
  const defUnits = modifiers.defenderUnits ?? {};
  const tanks = attUnits.tank ?? 0;
  const artillery = attUnits.artillery ?? 0;

  if (modifiers.attackerDoctrine === "extermination") {
    badges.push({ label: "Extermínio: +1 ATK (dados)", kind: "buff" });
  } else if (
    modifiers.attackerDoctrine === "blitzkrieg" &&
    modifiers.isFirstRoundOnTarget !== false &&
    tanks > 0 &&
    modifiers.attackerHasFuel !== false
  ) {
    badges.push({ label: "Blitzkrieg: +1 maior ATK", kind: "buff" });
  }

  if (tanks > 0) {
    if (modifiers.attackerHasFuel === false) {
      badges.push({ label: "Sem Petróleo: sem re-roll blindado", kind: "debuff" });
    } else if (tanks >= 3) {
      badges.push({ label: `${tanks} Tanques: re-rola 1-2`, kind: "buff" });
    } else {
      badges.push({ label: `${tanks} Tanque(s): re-rola 1`, kind: "buff" });
    }
    if (tanks >= 5 && tanks > (defUnits.tank ?? 0)) {
      badges.push({ label: "Superioridade Blindada (+1 2º ATK)", kind: "buff" });
    }
  }

  if (artillery >= 6) {
    badges.push({ label: "6+ Artilharias: Saturação (+1 ATK)", kind: "buff" });
  } else if (artillery >= 4 && (modifiers.fortificationLevel ?? 0) >= 2) {
    badges.push({ label: "4+ Artilharias: anula Fortaleza", kind: "buff" });
  } else if (artillery >= 2 && (modifiers.fortificationLevel ?? 0) >= 1) {
    badges.push({ label: "2+ Artilharias: suprime Casamata", kind: "buff" });
  }

  if (modifiers.hasCasBonus) {
    badges.push({ label: "CAS Aéreo (+1 dado ATK)", kind: "buff" });
  }
  if (modifiers.coastalBombardment) {
    badges.push({ label: "Bombardeio Naval (+1 ATK)", kind: "buff" });
  }

  if (
    modifiers.defenderDoctrine === "tall_sovereign" ||
    modifiers.defenderDoctrine === "defense_in_depth"
  ) {
    if ((modifiers.defenderTerritoryCount ?? 0) > 5) {
      badges.push({ label: "Defensor Overextended (-1 DEF)", kind: "buff" });
    } else if ((defUnits.infantry ?? 0) > 0 || (modifiers.defenderUnits === undefined)) {
      badges.push({ label: "Bastião Defensor (+1 DEF)", kind: "debuff" });
    }
  }

  const fortLevel = modifiers.fortificationLevel ?? 0;
  if (fortLevel >= 1 && artillery < 2) {
    badges.push({ label: "Casamata (+1 DEF)", kind: "debuff" });
  }
  if (fortLevel >= 2 && artillery < 4) {
    badges.push({ label: "Fortaleza Nv.2 (-1 ATK)", kind: "debuff" });
  }
  if (modifiers.isDefenderCapital) {
    badges.push({ label: "Capital Inimiga", kind: "neutral" });
  }
  if ((modifiers.encircledPenalty ?? 0) > 0) {
    badges.push({
      label: `Inimigo Cercado (-${modifiers.encircledPenalty} DEF)`,
      kind: "buff",
    });
  }
  if ((defUnits.artillery ?? 0) > 0 && (defUnits.infantry ?? 0) === 0 && (defUnits.tank ?? 0) === 0) {
    badges.push({ label: "Artilharia sem Escolta (-1 DEF)", kind: "buff" });
  }

  return badges;
}

/**
 * Simulates dice engagements to estimate attacker conquest probability,
 * incorporating Hegemonia doctrine rules, armor, artillery, fortifications and CAS.
 */
export function estimateAttackWinOdds(
  attackerArmies: number,
  defenderArmies: number,
  modifiers?: CombatOddsModifiers
): number {
  if (attackerArmies < 2) return 0;
  if (defenderArmies <= 0) return 100;

  const TRIALS = 600;
  let wins = 0;

  const attTanks = modifiers?.attackerUnits?.tank ?? 0;
  const attArtillery = modifiers?.attackerUnits?.artillery ?? 0;
  const defTanks = modifiers?.defenderUnits?.tank ?? 0;
  const defInfantry = modifiers?.defenderUnits?.infantry;
  const defArtillery = modifiers?.defenderUnits?.artillery ?? 0;
  const hasFuel = modifiers?.attackerHasFuel !== false;
  const fortLevel = modifiers?.fortificationLevel ?? 0;
  const isTallDefender =
    modifiers?.defenderDoctrine === "tall_sovereign" ||
    modifiers?.defenderDoctrine === "defense_in_depth";
  const defTerrCount = modifiers?.defenderTerritoryCount ?? 0;

  for (let t = 0; t < TRIALS; t++) {
    let att = attackerArmies;
    let def = defenderArmies;
    let roundIdx = 0;

    while (att > 1 && def > 0) {
      const isFirstEngagement = roundIdx === 0 && modifiers?.isFirstRoundOnTarget !== false;
      const maxAttDice = modifiers?.hasCasBonus && roundIdx === 0 ? 4 : 3;
      const attDiceCount = Math.min(maxAttDice, att - 1);
      const defDiceCount = Math.min(3, def);

      const attDice: number[] = [];
      for (let i = 0; i < attDiceCount; i++) {
        attDice.push(Math.floor(Math.random() * 6) + 1);
      }
      attDice.sort((a, b) => b - a);

      // Tank re-rolls (approximated while armor would remain present in task force)
      if (attTanks > 0 && hasFuel && att > 1) {
        const minRoll = attTanks >= 3 ? 3 : 2;
        let rerolled = false;
        for (let i = 0; i < attDice.length; i++) {
          if (attDice[i] < minRoll) {
            attDice[i] = Math.floor(Math.random() * 6) + 1;
            rerolled = true;
          }
        }
        if (rerolled) {
          attDice.sort((a, b) => b - a);
        }
        if (attTanks >= 5 && attTanks > defTanks && attDice.length >= 2) {
          attDice[1] += 1;
        }
      }

      const defDice: number[] = [];
      for (let i = 0; i < defDiceCount; i++) {
        defDice.push(Math.floor(Math.random() * 6) + 1);
      }
      defDice.sort((a, b) => b - a);

      // Doctrine modifiers
      if (modifiers?.attackerDoctrine === "extermination") {
        for (let i = 0; i < attDice.length; i++) {
          attDice[i] = Math.min(6, attDice[i] + 1);
        }
      } else if (
        modifiers?.attackerDoctrine === "blitzkrieg" &&
        isFirstEngagement &&
        attTanks > 0 &&
        hasFuel &&
        attDice.length > 0
      ) {
        attDice[0] = Math.min(6, attDice[0] + 1);
      }

      if (isTallDefender && defDice.length > 0) {
        if (defTerrCount > 5) {
          defDice[0] = Math.max(1, defDice[0] - 1);
        } else if (defInfantry === undefined || defInfantry > 0) {
          defDice[0] = Math.min(6, defDice[0] + 1);
        }
      }

      // Coastal bombardment / Artillery saturation / Fortification / Encirclement
      if (modifiers?.coastalBombardment && roundIdx === 0 && attDice.length > 0) {
        attDice[0] += 1;
      }
      if ((modifiers?.encircledPenalty ?? 0) > 0 && defDice.length > 0) {
        defDice[0] = Math.max(1, defDice[0] - (modifiers?.encircledPenalty ?? 0));
      }
      if (
        defArtillery > 0 &&
        (defInfantry ?? 0) === 0 &&
        defTanks === 0 &&
        defDice.length > 0
      ) {
        defDice[0] = Math.max(1, defDice[0] - 1);
      }
      if (fortLevel >= 1 && attArtillery < 2 && defDice.length > 0) {
        defDice[0] += 1;
      }
      if (fortLevel >= 2 && attArtillery < 4 && attDice.length > 0) {
        attDice[0] = Math.max(1, attDice[0] - 1);
      }
      if (attArtillery >= 6 && attDice.length > 0) {
        attDice[0] += 1;
      }

      const comp = Math.min(attDiceCount, defDiceCount);
      for (let c = 0; c < comp; c++) {
        if (attDice[c] > defDice[c]) {
          def--;
        } else {
          att--;
        }
      }
      roundIdx++;
    }

    if (def === 0) wins++;
  }

  return Math.round((wins / TRIALS) * 100);
}
