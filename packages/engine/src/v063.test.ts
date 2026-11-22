import { describe, it, expect } from "vitest";
import {
  applyAction,
  createGame,
  createPlayerView,
  createSeededRng,
  resolveDeterministicCombat,
  removeCasualtiesWithArmorAbsorption,
} from "./index.js";
import { CLASSIC_MAP } from "@hegemonia/maps";
import { emptyUnitCounts } from "./units.js";

describe("v0.6.3 — HEGEM-180 Tactical Air Recon & HEGEM-178 Deterministic Combat", () => {
  it("HEGEM-180: aerial recon marks territory for 1 round, grants 2-round resource intel, and keeps secret objective hidden", () => {
    const rng = createSeededRng("recon_test_seed");
    let state = createGame({
      id: "recon_game",
      seed: "recon_seed",
      players: [
        { id: "p1", name: "Eagle", color: "blue", doctrineId: "standard" },
        { id: "p2", name: "Bear", color: "red", doctrineId: "guerrilla" },
      ],
    });

    let p1Terr = Object.values(state.territories).find((t) => t.ownerId === "p1")!;
    let p2Terr = Object.values(state.territories).find((t) => t.ownerId === "p2")!;
    for (const def of CLASSIC_MAP.territories) {
      if (state.territories[def.id].ownerId !== "p1") continue;
      const adj = def.neighbors.find((n) => state.territories[n].ownerId === "p2");
      if (adj) {
        p1Terr = state.territories[def.id];
        p2Terr = state.territories[adj];
        break;
      }
    }

    // Setup airfield + aircraft + oil for p1
    p1Terr.buildings = [{ type: "airfield", level: 1 }];
    p1Terr.units = { infantry: 2, tank: 0, artillery: 0, aircraft: 1, navy: 0 };
    p1Terr.armies = 3;

    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.resources = { money: 20, steel: 10, oil: 5, gold: 2 };
    const p2 = state.players.find((p) => p.id === "p2")!;
    p2.resources = { money: 42, steel: 17, oil: 9, gold: 4 };

    state.round = 2;
    state.phase = "attack";

    state = applyAction(
      state,
      "p1",
      {
        type: "air_mission",
        missionType: "recon",
        fromTerritoryId: p1Terr.id,
        toTerritoryId: p2Terr.id,
      },
      rng
    );

    expect(state.territories[p2Terr.id].reconSpottedRound).toBe(2);
    expect(state.territories[p2Terr.id].reconSpottedByPlayerId).toBe("p1");

    const updatedP1 = state.players.find((p) => p.id === "p1")!;
    expect(updatedP1.reconIntelByTargetPlayer?.["p2"]).toBe(3); // valid for round 2 & 3

    // Verify createPlayerView still masks p2's secret objective
    const viewForP1 = createPlayerView(state, "p1");
    const maskedP2 = viewForP1.players.find((p) => p.id === "p2")!;
    expect(maskedP2.objective.id).toBe("hidden");
    expect(maskedP2.resources.money).toBe(42);
  });

  it("HEGEM-178: tank armor absorption requires 2 HP per tank and absorbs 1 odd residual damage", () => {
    const units = { ...emptyUnitCounts(), infantry: 2, tank: 3 };
    // 3 damage -> kills 2 infantry (2 dmg) + 1 residual absorbed by tank armor (0 tanks lost)
    const res1 = removeCasualtiesWithArmorAbsorption(units, 3);
    expect(res1.losses.infantry).toBe(2);
    expect(res1.losses.tank).toBe(0);
    expect(res1.absorbedDamage).toBe(1);
    expect(res1.remaining.tank).toBe(3);

    // 4 damage -> kills 2 infantry + 1 tank (2 dmg)
    const res2 = removeCasualtiesWithArmorAbsorption(units, 4);
    expect(res2.losses.infantry).toBe(2);
    expect(res2.losses.tank).toBe(1);
    expect(res2.absorbedDamage).toBe(0);
    expect(res2.remaining.tank).toBe(2);
  });

  it("HEGEM-178: deterministic combat guarantees clear superiority wins and resolves via applyAction", () => {
    const rng = createSeededRng("det_combat_seed");
    let state = createGame({
      id: "det_game",
      seed: "det_seed",
      rulesConfig: { combatMode: "deterministic" },
      players: [
        { id: "p1", name: "Alpha", color: "blue", doctrineId: "standard" },
        { id: "p2", name: "Beta", color: "red", doctrineId: "standard" },
      ],
    });

    const p1 = state.players.find((p) => p.id === "p1")!;
    const p2 = state.players.find((p) => p.id === "p2")!;
    p1.resources.oil = 10;

    // Find an adjacent pair p1 -> p2
    let fromId = "";
    let toId = "";
    for (const def of CLASSIC_MAP.territories) {
      if (state.territories[def.id].ownerId !== "p1") continue;
      const adj = def.neighbors.find((n) => state.territories[n].ownerId === "p2");
      if (adj) {
        fromId = def.id;
        toId = adj;
        break;
      }
    }
    expect(fromId).not.toBe("");

    state.territories[fromId].units = {
      infantry: 6,
      tank: 5,
      artillery: 2,
      aircraft: 1,
      navy: 0,
    };
    state.territories[fromId].armies = 14;
    state.territories[toId].units = {
      infantry: 2,
      tank: 0,
      artillery: 0,
      aircraft: 0,
      navy: 0,
    };
    state.territories[toId].armies = 2;

    state.round = 2;
    state.phase = "attack";

    const detCheck = resolveDeterministicCombat({
      attackerUnits: state.territories[fromId].units!,
      defenderUnits: state.territories[toId].units!,
      attacker: p1,
      defender: p2,
      fromTerritory: state.territories[fromId],
      toTerritory: state.territories[toId],
      attackerHasOil: true,
      defenderHasOil: false,
      fortLevel: 0,
      isDefendingCapital: false,
      wonderConstructing: false,
      hasCasBonus: false,
      coastalBombardment: false,
      reconSpotted: false,
      defenderVsCoalitionSize: 0,
      attackerIsCoalitionMember: false,
      defenderTerritoryCount: 10,
      isFirstCombatRoundOnTarget: true,
      rng: createSeededRng("det_unit_check"),
    });

    expect(detCheck.attackerWonRound).toBe(true);
    expect(detCheck.tankSuperiorityBonus).toBe(true);
    expect(detCheck.artillerySuppressionBonus).toBe(true);
    expect(detCheck.attackerDamageDealt).toBeGreaterThanOrEqual(2);

    state = applyAction(
      state,
      "p1",
      {
        type: "attack",
        fromTerritoryId: fromId,
        toTerritoryId: toId,
        units: { infantry: 5, tank: 5, artillery: 2, aircraft: 1, navy: 0 },
      },
      rng
    );

    expect(state.lastCombat).not.toBeNull();
    expect(state.lastCombat?.conquered).toBe(true);
  });
});
