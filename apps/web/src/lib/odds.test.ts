import { describe, expect, it } from "vitest";
import { describeCombatOddsModifiers, estimateAttackWinOdds } from "../odds.js";

describe("HEGEM-154: Doctrine-Aware Attack Odds Simulator", () => {
  it("preserves backwards compatibility for plain army-count estimates", () => {
    expect(estimateAttackWinOdds(1, 5)).toBe(0);
    expect(estimateAttackWinOdds(5, 0)).toBe(100);
    const strongOdds = estimateAttackWinOdds(15, 3);
    const weakOdds = estimateAttackWinOdds(3, 10);
    expect(strongOdds).toBeGreaterThan(80);
    expect(weakOdds).toBeLessThan(20);
  });

  it("reflects Extermination doctrine offense and Fortification Level 2 defense penalties", () => {
    // Average across multiple trials to keep stochastic assertions deterministic cleanly
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

  it("emits clear tactical modifier badges for doctrines, armor, artillery, and forts", () => {
    const badges = describeCombatOddsModifiers({
      attackerDoctrine: "blitzkrieg",
      attackerUnits: { tank: 3, artillery: 4 },
      defenderDoctrine: "tall_sovereign",
      defenderTerritoryCount: 3,
      fortificationLevel: 2,
      hasCasBonus: true,
    });
    const labels = badges.map((b) => b.label);
    expect(labels.some((l) => l.includes("Blitzkrieg"))).toBe(true);
    expect(labels.some((l) => l.includes("3 Tanques"))).toBe(true);
    expect(labels.some((l) => l.includes("4+ Artilharias"))).toBe(true);
    expect(labels.some((l) => l.includes("CAS"))).toBe(true);
    expect(labels.some((l) => l.includes("Bastião Defensor"))).toBe(true);
  });
});
