import { describe, expect, it } from "vitest";
import {
  describeCombatOddsModifiers,
  estimateAttackWinOdds,
  estimateDeterministicCombatForecast,
} from "../odds.js";

describe("HEGEM-154 & HEGEM-178: Doctrine-Aware Attack Odds & Deterministic Forecast", () => {
  it("preserves backwards compatibility for plain army-count estimates", () => {
    expect(estimateAttackWinOdds(1, 5)).toBe(0);
    expect(estimateAttackWinOdds(5, 0)).toBe(100);
    const strongOdds = estimateAttackWinOdds(15, 3);
    const weakOdds = estimateAttackWinOdds(3, 10);
    expect(strongOdds).toBeGreaterThan(80);
    expect(weakOdds).toBeLessThan(20);
  });

  it("reflects Extermination doctrine offense and Fortification Level 2 defense penalties", () => {
    let plainSum = 0;
    let extermSum = 0;
    let fortSum = 0;
    for (let i = 0; i < 6; i++) {
      plainSum += estimateAttackWinOdds(8, 5);
      extermSum += estimateAttackWinOdds(8, 5, { attackerDoctrine: "extermination" });
      fortSum += estimateAttackWinOdds(8, 5, { fortificationLevel: 2 });
    }
    expect(extermSum / 6).toBeGreaterThan(plainSum / 6);
    expect(fortSum / 6).toBeLessThan(plainSum / 6);
  });

  it("emits clear tactical modifier badges for dice and deterministic modes", () => {
    const badges = describeCombatOddsModifiers({
      combatMode: "dice",
      attackerDoctrine: "blitzkrieg",
      attackerUnits: { tank: 3, artillery: 4 },
      defenderDoctrine: "tall_sovereign",
      defenderTerritoryCount: 7,
      fortificationLevel: 2,
      hasCasBonus: true,
    });
    const labels = badges.map((b) => b.label);
    expect(labels.some((l) => l.includes("Blitzkrieg"))).toBe(true);
    expect(labels.some((l) => l.includes("3 Tanques"))).toBe(true);
    expect(labels.some((l) => l.includes("4+ Artilharias"))).toBe(true);
    expect(labels.some((l) => l.includes("CAS"))).toBe(true);
    expect(labels.some((l) => l.includes("Overextended"))).toBe(true);

    const detBadges = describeCombatOddsModifiers({
      combatMode: "deterministic",
      attackerDoctrine: "extermination",
      fortificationLevel: 1,
      reconSpotted: true,
    });
    const detLabels = detBadges.map((b) => b.label);
    expect(detLabels.some((l) => l.includes("+10% DEF"))).toBe(true);
    expect(detLabels.some((l) => l.includes("Extermínio (+15% ATQ)"))).toBe(true);
    expect(detLabels.some((l) => l.includes("Casamata (+25% DEF)"))).toBe(true);
    expect(detLabels.some((l) => l.includes("Recon (+15% ATQ)"))).toBe(true);
  });

  it("computes deterministic pre-attack power, entrenchment advantage, and estimated mutual casualties", () => {
    const equalForecast = estimateDeterministicCombatForecast(6, 5, {
      combatMode: "deterministic",
    });
    // 5 attacking vs 5 entrenched defending (+10%): defense power 5.5 > attack power 5.0
    expect(equalForecast.attackPower).toBe(5);
    expect(equalForecast.defensePower).toBe(5.5);
    expect(equalForecast.estAttackerLosses).toBeGreaterThanOrEqual(2);
    expect(equalForecast.salvos).toBeGreaterThanOrEqual(3);

    const superiorForecast = estimateDeterministicCombatForecast(11, 5, {
      combatMode: "deterministic",
    });
    expect(superiorForecast.winOddsPct).toBeGreaterThan(equalForecast.winOddsPct);
    expect(superiorForecast.estAttackerLosses).toBeGreaterThanOrEqual(2);
    expect(superiorForecast.estDefenderLosses).toBeGreaterThanOrEqual(3);
  });
});
