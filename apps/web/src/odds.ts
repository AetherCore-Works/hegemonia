// Hegemonia Battle Odds & Deterministic Combat Forecast Calculator (HEGEM-154, HEGEM-178)
import type { DoctrineId, UnitCounts } from "@hegemonia/shared";

export interface CombatOddsModifiers {
  combatMode?: "dice" | "deterministic";
  attackerDoctrine?: DoctrineId | null;
  defenderDoctrine?: DoctrineId | null;
  attackerUnits?: Partial<UnitCounts>;
  defenderUnits?: Partial<UnitCounts>;
  attackerHasFuel?: boolean;
  defenderHasFuel?: boolean;
  isFirstRoundOnTarget?: boolean;
  defenderTerritoryCount?: number;
  fortificationLevel?: number;
  isDefenderCapital?: boolean;
  wonderConstructing?: boolean;
  hasCasBonus?: boolean;
  coastalBombardment?: boolean;
  reconSpotted?: boolean;
  encircledPenalty?: number;
}

export interface CombatOddsBadge {
  label: string;
  kind: "buff" | "debuff" | "neutral";
}

export interface DeterministicCombatForecast {
  winOddsPct: number;
  attackPower: number;
  defensePower: number;
  estAttackerLosses: number;
  estDefenderLosses: number;
  salvos: number;
}

/**
 * Returns human-readable tactical badges summarizing the active modifiers
 * reflected in the battle estimate (mode-aware for dice vs deterministic).
 */
export function describeCombatOddsModifiers(
  modifiers?: CombatOddsModifiers
): CombatOddsBadge[] {
  if (!modifiers) return [];
  const badges: CombatOddsBadge[] = [];
  const isDet = modifiers.combatMode === "deterministic";
  const attUnits = modifiers.attackerUnits ?? {};
  const defUnits = modifiers.defenderUnits ?? {};
  const tanks = attUnits.tank ?? 0;
  const artillery = attUnits.artillery ?? 0;

  if (isDet) {
    badges.push({ label: "Entrincheiramento (+10% DEF)", kind: "debuff" });
  }

  if (modifiers.attackerDoctrine === "extermination") {
    badges.push({
      label: isDet ? "Extermínio (+15% ATQ)" : "Extermínio: +1 ATK (dados)",
      kind: "buff",
    });
  } else if (
    modifiers.attackerDoctrine === "blitzkrieg" &&
    modifiers.isFirstRoundOnTarget !== false &&
    tanks > 0 &&
    modifiers.attackerHasFuel !== false
  ) {
    badges.push({
      label: isDet ? "Blitzkrieg (+15% ATQ)" : "Blitzkrieg: +1 maior ATK",
      kind: "buff",
    });
  }

  if (tanks > 0) {
    if (modifiers.attackerHasFuel === false) {
      badges.push({
        label: isDet ? "Sem Petróleo (Blindado 1.0)" : "Sem Petróleo: sem re-roll blindado",
        kind: "debuff",
      });
    } else if (!isDet) {
      if (tanks >= 3) {
        badges.push({ label: `${tanks} Tanques: re-rola 1-2`, kind: "buff" });
      } else {
        badges.push({ label: `${tanks} Tanque(s): re-rola 1`, kind: "buff" });
      }
    }
    if (tanks >= 5 && tanks > (defUnits.tank ?? 0)) {
      badges.push({
        label: isDet ? "Superioridade Blindada (+15% ATQ)" : "Superioridade Blindada (+1 2º ATK)",
        kind: "buff",
      });
    }
  }

  if (artillery >= 6) {
    badges.push({
      label: isDet ? "6+ Artilharias (+15% ATQ)" : "6+ Artilharias: Saturação (+1 ATK)",
      kind: "buff",
    });
  } else if (artillery >= 4 && (modifiers.fortificationLevel ?? 0) >= 2) {
    badges.push({ label: "4+ Artilharias: anula Fortaleza", kind: "buff" });
  } else if (artillery >= 2 && (modifiers.fortificationLevel ?? 0) >= 1) {
    badges.push({ label: "2+ Artilharias: suprime Casamata", kind: "buff" });
  }

  if (modifiers.hasCasBonus || (isDet && (attUnits.aircraft ?? 0) > 0)) {
    const squadrons = isDet
      ? Math.min(3, (attUnits.aircraft ?? 0) + (modifiers.hasCasBonus ? 1 : 0))
      : 1;
    badges.push({
      label: isDet ? `CAS Aéreo (+${squadrons * 15}% ATQ)` : "CAS Aéreo (+1 dado ATK)",
      kind: "buff",
    });
  }
  if (modifiers.coastalBombardment) {
    badges.push({
      label: isDet ? "Bombardeio Naval (+15% ATQ)" : "Bombardeio Naval (+1 ATK)",
      kind: "buff",
    });
  }
  if (modifiers.reconSpotted) {
    badges.push({
      label: isDet ? "Alvo Marcado Recon (+15% ATQ)" : "Alvo Marcado Recon (+1 menor ATK)",
      kind: "buff",
    });
  }

  if (
    (modifiers.defenderDoctrine === "tall_sovereign" ||
      modifiers.defenderDoctrine === "defense_in_depth") &&
    (modifiers.defenderTerritoryCount ?? 0) > 5
  ) {
    badges.push({
      label: isDet ? "Defensor Overextended (-10% DEF)" : "Defensor Overextended (-1 DEF)",
      kind: "buff",
    });
  }

  const fortLevel = modifiers.fortificationLevel ?? 0;
  if (fortLevel >= 2 && artillery < 4) {
    badges.push({
      label: isDet ? "Fortaleza Nv.2 (+50% DEF)" : "Fortaleza Nv.2 (-1 ATK)",
      kind: "debuff",
    });
  } else if (fortLevel >= 1 && artillery < 2) {
    badges.push({
      label: isDet ? "Casamata (+25% DEF)" : "Casamata (+1 DEF)",
      kind: "debuff",
    });
  }
  if (modifiers.wonderConstructing) {
    badges.push({
      label: isDet ? "Maravilha em Obra (+25% DEF)" : "Maravilha em Obra (+1 DEF)",
      kind: "debuff",
    });
  }
  if (modifiers.isDefenderCapital) {
    badges.push({
      label: isDet ? "Capital Inimiga (+25% DEF)" : "Capital Inimiga",
      kind: isDet ? "debuff" : "neutral",
    });
  }
  if ((modifiers.encircledPenalty ?? 0) > 0) {
    const pct = (modifiers.encircledPenalty ?? 1) >= 2 ? "-40% DEF" : "-25% DEF";
    badges.push({
      label: isDet
        ? `Inimigo Cercado (${pct})`
        : `Inimigo Cercado (-${modifiers.encircledPenalty} DEF)`,
      kind: "buff",
    });
  }
  if ((defUnits.artillery ?? 0) > 0 && (defUnits.infantry ?? 0) === 0 && (defUnits.tank ?? 0) === 0) {
    badges.push({
      label: isDet ? "Artilharia sem Escolta (0.5)" : "Artilharia sem Escolta (-1 DEF)",
      kind: "buff",
    });
  }

  return badges;
}

/**
 * Estimates expected outcome and per-engagement casualties for Deterministic Combat v2
 * (combat-width mini-rolls + 10% baseline defender entrenchment).
 */
export function estimateDeterministicCombatForecast(
  attackerArmies: number,
  defenderArmies: number,
  modifiers?: CombatOddsModifiers
): DeterministicCombatForecast {
  const attPool = Math.max(0, attackerArmies - 1);
  if (attPool <= 0) {
    return {
      winOddsPct: 0,
      attackPower: 0,
      defensePower: defenderArmies,
      estAttackerLosses: 0,
      estDefenderLosses: 0,
      salvos: 0,
    };
  }
  if (defenderArmies <= 0) {
    return {
      winOddsPct: 100,
      attackPower: attPool,
      defensePower: 0,
      estAttackerLosses: 0,
      estDefenderLosses: 0,
      salvos: 0,
    };
  }

  const au = modifiers?.attackerUnits;
  const du = modifiers?.defenderUnits;
  const attUnits: UnitCounts = {
    infantry: au?.infantry ?? attPool,
    tank: au?.tank ?? 0,
    artillery: au?.artillery ?? 0,
    aircraft: au?.aircraft ?? 0,
    navy: au?.navy ?? 0,
  };
  const attTotalCheck =
    attUnits.infantry + attUnits.tank + attUnits.artillery + attUnits.aircraft + attUnits.navy;
  if (attTotalCheck <= 0) attUnits.infantry = attPool;

  const defUnits: UnitCounts = {
    infantry: du?.infantry ?? defenderArmies,
    tank: du?.tank ?? 0,
    artillery: du?.artillery ?? 0,
    aircraft: du?.aircraft ?? 0,
    navy: du?.navy ?? 0,
  };

  const attTankWeight = modifiers?.attackerHasFuel !== false ? 2.2 : 1.0;
  const defTankWeight = modifiers?.defenderHasFuel !== false ? 1.8 : 1.2;
  const unescortedDefArt =
    defUnits.artillery > 0 && defUnits.infantry === 0 && defUnits.tank === 0;
  const defArtWeight = unescortedDefArt ? 0.5 : 1.2;

  const baseAtt =
    attUnits.infantry * 1.0 +
    attUnits.tank * attTankWeight +
    attUnits.artillery * 1.6 +
    attUnits.navy * 1.2 +
    attUnits.aircraft * 1.2;
  const baseDef =
    defUnits.infantry * 1.0 +
    defUnits.tank * defTankWeight +
    defUnits.artillery * defArtWeight +
    defUnits.navy * 1.0 +
    defUnits.aircraft * 1.0;

  let attMult = 1.0;
  let defMult = 1.1; // +10% baseline entrenchment

  if (attUnits.tank >= 5 && attUnits.tank > defUnits.tank) attMult *= 1.15;
  if (attUnits.artillery >= 6) attMult *= 1.15;
  const casSquadrons = Math.min(3, attUnits.aircraft + (modifiers?.hasCasBonus ? 1 : 0));
  if (casSquadrons > 0) attMult *= 1 + casSquadrons * 0.15;
  if (modifiers?.coastalBombardment) attMult *= 1.15;
  if (modifiers?.reconSpotted) attMult *= 1.15;
  if (modifiers?.attackerDoctrine === "extermination") attMult *= 1.15;
  if (
    modifiers?.attackerDoctrine === "blitzkrieg" &&
    modifiers?.isFirstRoundOnTarget !== false &&
    attUnits.tank > 0 &&
    modifiers?.attackerHasFuel !== false
  ) {
    attMult *= 1.15;
  }

  const fortLevel = modifiers?.fortificationLevel ?? 0;
  if (fortLevel >= 2 && attUnits.artillery < 4) defMult *= 1.5;
  else if (fortLevel >= 1 && attUnits.artillery < 2) defMult *= 1.25;
  if (modifiers?.wonderConstructing) defMult *= 1.25;
  if (modifiers?.isDefenderCapital) defMult *= 1.25;
  if ((modifiers?.encircledPenalty ?? 0) > 0) {
    defMult *= (modifiers?.encircledPenalty ?? 1) >= 2 ? 0.6 : 0.75;
  }
  if (
    (modifiers?.defenderDoctrine === "tall_sovereign" ||
      modifiers?.defenderDoctrine === "defense_in_depth") &&
    (modifiers?.defenderTerritoryCount ?? 0) > 5
  ) {
    defMult *= 0.9;
  }

  const attackPower = Number((baseAtt * attMult).toFixed(1));
  const defensePower = Number((baseDef * defMult).toFixed(1));

  const totalAtt = attUnits.infantry + attUnits.tank + attUnits.artillery + attUnits.aircraft + attUnits.navy;
  const totalDef = Math.max(1, defenderArmies);
  const totalAttHp = Math.max(1, totalAtt + attUnits.tank);
  const totalDefHp = Math.max(1, totalDef + defUnits.tank);
  const numSalvos = Math.min(5, Math.max(3, Math.ceil(Math.min(totalAtt, totalDef) / 2) + 1));

  const attPerHp = attackPower / totalAttHp;
  const defPerHp = defensePower / totalDefHp;

  let liveAtt = totalAttHp;
  let liveDef = totalDefHp;
  let accDef = 0;
  let accAtt = 0;
  for (let s = 0; s < numSalvos; s++) {
    if (liveAtt <= 0.05 || liveDef <= 0.05) break;
    const width = Math.min(liveAtt, liveDef);
    const attEng = width + 0.25 * Math.max(0, liveAtt - width);
    const defEng = width + 0.25 * Math.max(0, liveDef - width);
    const dDef = attEng * attPerHp * 0.22;
    const dAtt = defEng * defPerHp * 0.22;
    accDef += dDef;
    accAtt += dAtt;
    liveDef = Math.max(0, liveDef - dDef);
    liveAtt = Math.max(0, liveAtt - dAtt);
  }

  const estDefenderLosses = Math.min(totalDef, Math.round(accDef));
  const estAttackerLosses = Math.min(totalAtt, Math.round(accAtt));

  // Conquest / exchange probability via power ratio + live attrition margin
  const advantageScore =
    (attackPower / Math.max(0.5, defensePower) - 1) * 1.4 +
    (liveDef <= 0.05 ? 1.5 : (totalDefHp - liveDef) / totalDefHp - (totalAttHp - liveAtt) / totalAttHp);
  const winOddsPct = Math.max(
    1,
    Math.min(99, Math.round(100 / (1 + Math.exp(-advantageScore * 2.2))))
  );

  return {
    winOddsPct,
    attackPower,
    defensePower,
    estAttackerLosses,
    estDefenderLosses,
    salvos: numSalvos,
  };
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

  if (modifiers?.combatMode === "deterministic") {
    return estimateDeterministicCombatForecast(
      attackerArmies,
      defenderArmies,
      modifiers
    ).winOddsPct;
  }

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

      if (isTallDefender && defDice.length > 0 && defTerrCount > 5) {
        defDice[0] = Math.max(1, defDice[0] - 1);
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
