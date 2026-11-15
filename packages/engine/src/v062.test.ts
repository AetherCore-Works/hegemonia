import { describe, expect, it } from "vitest";
import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  DEFAULT_CUSTOM_RULES,
  RULES_PRESETS,
  isDoctrineAvailableInLobby,
  normalizeCustomRules,
} from "@hegemonia/shared";
import {
  applyAction,
  calculateTurnEconomy,
  createGame,
  createSeededRng,
  getPartisanRelocationStatus,
  getReachableManeuverDistances,
  planNextBotAction,
  previewMarketTrade,
} from "./index.js";

const players = [
  { id: "p1", name: "General 1", color: "blue" as const, doctrineId: "blitzkrieg" as const },
  { id: "p2", name: "General 2", color: "red" as const, doctrineId: "tall_sovereign" as const },
  { id: "p3", name: "General 3", color: "green" as const, doctrineId: "guerrilla_warfare" as const },
];

describe("Hegemonia v0.6.2 Features", () => {
  describe("HEGEM-67 & HEGEM-110: Modular Rules, Presets & Classic Mode", () => {
    it("exposes valid presets and normalizes custom rule overrides", () => {
      expect(Object.values(RULES_PRESETS).some((p) => p.id === "classic_war")).toBe(true);
      const custom = normalizeCustomRules({
        economyMultiplier: 1.5,
        turnTimerSeconds: 90,
        supplyCardGoldCost: 3,
      });
      expect(custom.economyMultiplier).toBe(1.5);
      expect(custom.turnTimerSeconds).toBe(90);
      expect(custom.supplyCardGoldCost).toBe(3);
      expect(custom.preset).toBe(DEFAULT_CUSTOM_RULES.preset);
    });

    it("enforces pure War/Risk rules in classicMode and blocks buildings/market/doctrines", () => {
      const state = createGame({
        id: "classic-1",
        seed: "classic-seed",
        players,
        rulesConfig: { classicMode: true },
      });
      const rng = createSeededRng("classic-seed");
      expect(state.players[0].doctrineId).toBeNull();
      expect(state.players[0].resources.money).toBe(0);

      const firstOwned = Object.values(state.territories).find((t) => t.ownerId === "p1")!;
      expect(() =>
        applyAction(
          state,
          "p1",
          { type: "build_structure", territoryId: firstOwned.id, buildingType: "industry" },
          rng,
          CLASSIC_MAP
        )
      ).toThrow();

      expect(() =>
        applyAction(state, "p1", { type: "select_capital", territoryId: firstOwned.id }, rng, CLASSIC_MAP)
      ).toThrow();

      expect(() =>
        applyAction(
          state,
          "p1",
          { type: "market_trade", resource: "steel", operation: "buy", quantity: 1 },
          rng,
          CLASSIC_MAP
        )
      ).toThrow();
    });

    it("applies economyMultiplier, buildingCostMultiplier, and optional doctrineLimitEnabled", () => {
      expect(isDoctrineAvailableInLobby("extermination", ["extermination"], true)).toBe(false);
      expect(isDoctrineAvailableInLobby("extermination", ["extermination"], false)).toBe(true);

      const standard = createGame({ id: "eco-1", seed: "eco-s", players });
      const boosted = createGame({
        id: "eco-2",
        seed: "eco-s",
        players,
        rulesConfig: { economyMultiplier: 2, supplyCardGoldCost: 2 },
      });
      const ecoStd = calculateTurnEconomy(standard, "p1", CLASSIC_MAP);
      const ecoBoost = calculateTurnEconomy(boosted, "p1", CLASSIC_MAP);
      expect(ecoBoost.netMoney).toBeGreaterThanOrEqual(ecoStd.netMoney);
      expect(boosted.rulesConfig?.supplyCardGoldCost).toBe(2);
    });
  });

  describe("HEGEM-149: Maneuver Range Distance Calculation", () => {
    it("separates 1-hop, 2-hop (tanks), 3-hop (navy) and airfield targets", () => {
      const state = createGame({ id: "man-1", seed: "man-seed", players });
      // Chain 4 friendly coastal/land territories from brasil -> venezuela -> mexico -> usa_west (check map chain!)
      const brasilDef = CLASSIC_MAP.territories.find((t) => t.id === "brasil")!;
      const n1 = brasilDef.neighbors[0];
      const n1Def = CLASSIC_MAP.territories.find((t) => t.id === n1)!;
      const n2 = n1Def.neighbors.find((id) => id !== "brasil" && !brasilDef.neighbors.includes(id))!;
      const n2Def = CLASSIC_MAP.territories.find((t) => t.id === n2)!;
      const n3 = n2Def.neighbors.find(
        (id) => id !== n1 && id !== "brasil" && !brasilDef.neighbors.includes(id) && !n1Def.neighbors.includes(id)
      )!;

      state.territories["brasil"].ownerId = "p1";
      state.territories["brasil"].units = {
        infantry: 2,
        tank: 1,
        artillery: 0,
        aircraft: 0,
        navy: 1,
      };
      state.territories["brasil"].armies = 4;
      state.territories[n1].ownerId = "p1";
      state.territories[n2].ownerId = "p1";
      state.territories[n3].ownerId = "p1";

      const reach = getReachableManeuverDistances(state, "brasil", "p1", CLASSIC_MAP);
      expect(reach.landDistances[n1]).toBe(1);
      expect(reach.landDistances[n2]).toBe(2);
      expect(reach.landDistances[n3]).toBe(3);
    });
  });

  describe("HEGEM-150: Partisan Nomadic Capital Relocation Status", () => {
    it("tracks countdown and highlights eligible enemy-adjacent territories when due", () => {
      let state = createGame({ id: "part-1", seed: "part-seed", players });
      const rng = createSeededRng("part-seed");
      const p3Terr = Object.values(state.territories).find((t) => t.ownerId === "p3")!;
      state.turnIndex = 2; // p3
      state.phase = "deploy";
      state = applyAction(state, "p3", { type: "select_capital", territoryId: p3Terr.id }, rng, CLASSIC_MAP);

      const round1Status = getPartisanRelocationStatus(state, "p3", CLASSIC_MAP);
      expect(round1Status.isPartisan).toBe(true);
      expect(round1Status.isDueNow).toBe(false);
      expect(round1Status.roundsRemaining).toBe(2);

      state.round = 3;
      const round3Status = getPartisanRelocationStatus(state, "p3", CLASSIC_MAP);
      expect(round3Status.isDueNow).toBe(true);
      expect(round3Status.roundsRemaining).toBe(0);
      expect(round3Status.eligibleTerritoryIds.length).toBeGreaterThan(0);
    });
  });

  describe("HEGEM-151 & HEGEM-152 & HEGEM-154: Snapshots, Bot AI v2 & Market Quote", () => {
    it("records per-round history snapshots across turns", () => {
      let state = createGame({ id: "hist-1", seed: "hist-seed", players });
      const rng = createSeededRng("hist-seed");
      expect(state.roundHistory?.some((r) => r.round === 1)).toBe(true);

      let guard = 0;
      while (state.round === 1 && guard < 12) {
        guard++;
        const active = state.players[state.turnIndex];
        if (active.pendingObjectiveChoice && active.availableObjectives?.length) {
          state = applyAction(
            state,
            active.id,
            { type: "choose_objective", objectiveId: active.availableObjectives[0].id },
            rng,
            CLASSIC_MAP
          );
          continue;
        }
        const own = Object.values(state.territories).find((t) => t.ownerId === active.id)!;
        if (active.unplacedArmies > 0) {
          state = applyAction(
            state,
            active.id,
            { type: "deploy", territoryId: own.id, armies: active.unplacedArmies },
            rng,
            CLASSIC_MAP
          );
        }
      }

      expect(state.round).toBe(2);
      expect(state.roundHistory?.some((r) => r.round === 2)).toBe(true);
    });

    it("plans doctrine-aware bot actions without invalid targets", () => {
      const state = createGame({ id: "bot-1", seed: "bot-seed", players });
      const action = planNextBotAction(state, "p1", CLASSIC_MAP);
      expect(action).not.toBeNull();

      state.turnIndex = 2; // p3 guerrilla_warfare
      state.round = 3;
      state.phase = "deploy";
      state.players[2].pendingObjectiveChoice = false;
      const p3Owned = Object.values(state.territories).filter((t) => t.ownerId === "p3");
      if (p3Owned.length > 0) {
        state.players[2].capitalTerritoryId = p3Owned[0].id;
        state.players[2].lastCapitalRelocationRound = 1;
      }
      const partisanAction = planNextBotAction(state, "p3", CLASSIC_MAP);
      expect(partisanAction).not.toBeNull();
      if (p3Owned.length > 1) {
        expect(partisanAction?.type).toBe("select_capital");
      }
    });

    it("calculates progressive multi-lot quotes in previewMarketTrade", () => {
      const state = createGame({ id: "mkt-1", seed: "mkt-seed", players });
      const quote1 = previewMarketTrade(state.marketPrices, "steel", "buy", 1);
      const quote5 = previewMarketTrade(state.marketPrices, "steel", "buy", 5);
      expect(quote1.totalMoney).toBe(state.marketPrices.steel.buyPrice);
      expect(quote5.totalMoney).toBeGreaterThan(quote1.totalMoney * 5 - 1);
      expect(quote5.nextBuyPrice).toBeGreaterThanOrEqual(quote1.nextBuyPrice);
    });
  });
});
