import { describe, it, expect } from "vitest";
import { ALL_OBJECTIVES } from "@hegemonia/maps";
import { DOCTRINES } from "@hegemonia/shared";
import { BUILDING_COSTS, UNIT_COSTS, UNIT_TYPES } from "../../index.js";

describe("HEGEM-172: Cross-Layer Consistency Invariants (Engine <-> Maps <-> Shared)", () => {
  it("validates that every objective rule's critical numbers match its PT and EN descriptions", () => {
    for (const obj of ALL_OBJECTIVES) {
      const rule = obj.rule;
      if (rule.type === "territories") {
        expect(obj.descriptionPt).toContain(String(rule.count));
        expect(obj.descriptionEn).toContain(String(rule.count));
        if ((rule.minArmiesPerTerritory ?? 1) > 1) {
          const n = rule.minArmiesPerTerritory!;
          const ptMatch =
            obj.descriptionPt.includes(String(n)) ||
            (n === 2 && obj.descriptionPt.toLowerCase().includes("dois"));
          const enMatch =
            obj.descriptionEn.includes(String(n)) ||
            (n === 2 && obj.descriptionEn.toLowerCase().includes("two"));
          expect(ptMatch).toBe(true);
          expect(enMatch).toBe(true);
        }
      } else if (rule.type === "economic_hegemony") {
        if (rule.targetMoney !== undefined) {
          expect(obj.descriptionPt).toContain(String(rule.targetMoney));
          expect(obj.descriptionEn).toContain(String(rule.targetMoney));
        }
        if (rule.targetGold !== undefined) {
          expect(obj.descriptionPt).toContain(String(rule.targetGold));
          expect(obj.descriptionEn).toContain(String(rule.targetGold));
        }
        if (rule.minTerritoriesHeld !== undefined) {
          expect(obj.descriptionPt).toContain(String(rule.minTerritoriesHeld));
          expect(obj.descriptionEn).toContain(String(rule.minTerritoriesHeld));
        }
      } else if (rule.type === "sovereign_wonder") {
        // Wonder countdown is 6 rounds after 2 rounds construction
        expect(obj.descriptionPt).toContain("6");
        expect(obj.descriptionEn).toContain("6");
      }
    }
  });

  it("ensures every UnitType has a defined cost in UNIT_COSTS", () => {
    for (const unit of UNIT_TYPES) {
      expect(UNIT_COSTS[unit]).toBeDefined();
      expect(UNIT_COSTS[unit].money).toBeGreaterThan(0);
    }
  });

  it("ensures BUILDING_COSTS and DOCTRINES are complete and non-empty", () => {
    expect(Object.keys(BUILDING_COSTS).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(DOCTRINES).length).toBeGreaterThanOrEqual(7);
    for (const [id, doc] of Object.entries(DOCTRINES)) {
      expect(doc.id).toBe(id);
      expect(doc.namePt.length).toBeGreaterThan(0);
      expect(doc.nameEn.length).toBeGreaterThan(0);
    }
  });
});
