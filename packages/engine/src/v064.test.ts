import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_RULES,
  HEGEMONIA_VERSION,
  RULES_PRESETS,
  normalizeCustomRules,
} from "@hegemonia/shared";
import {
  applyAction,
  checkPlayerVictory,
  createGame,
  createSeededRng,
  recordRoundSnapshot,
} from "./index.js";
import { runBalanceBatch } from "./sim.js";

const players = [
  { id: "p1", name: "General 1", color: "blue" as const, doctrineId: "blitzkrieg" as const },
  { id: "p2", name: "General 2", color: "red" as const, doctrineId: "tall_sovereign" as const },
  { id: "p3", name: "General 3", color: "green" as const, doctrineId: "superior_firepower" as const },
];

describe("v0.6.4 — HEGEM-182 Timelapse, HEGEM-183 Presets & HEGEM-184 Balance Sim", () => {
  it("synchronizes HEGEMONIA_VERSION to 0.6.4", () => {
    expect(HEGEMONIA_VERSION).toBe("0.6.4");
  });

  it("HEGEM-183: exposes the 3 official 1-click lobby presets with Blitz using deterministic combat", () => {
    const keys = Object.keys(RULES_PRESETS);
    expect(keys).toEqual(["classic_war", "blitz", "total_war"]);

    expect(RULES_PRESETS.classic_war.config.classicMode).toBe(true);
    expect(RULES_PRESETS.classic_war.config.combatMode).toBe("dice");

    expect(RULES_PRESETS.blitz.config.classicMode).toBe(false);
    expect(RULES_PRESETS.blitz.config.combatMode).toBe("deterministic");
    expect(RULES_PRESETS.blitz.config.economyMultiplier).toBe(1.5);
    expect(RULES_PRESETS.blitz.config.turnTimerSeconds).toBe(60);

    expect(RULES_PRESETS.total_war.config.classicMode).toBe(false);
    expect(RULES_PRESETS.total_war.config.combatMode).toBe("dice");
    expect(RULES_PRESETS.total_war.config.doctrineLimitEnabled).toBe(true);

    expect(DEFAULT_CUSTOM_RULES.preset).toBe("total_war");
    expect(normalizeCustomRules({ preset: "standard" }).preset).toBe("total_war");
    expect(normalizeCustomRules({ preset: "custom", turnTimerSeconds: 90 }).preset).toBe("custom");
  });

  it("HEGEM-182: records compact territoryOwners per round, updates game_over frame, and logs coalition_formed event", () => {
    const rng = createSeededRng("v064-timelapse-seed");
    let state = createGame({
      id: "timelapse-1",
      seed: "v064-timelapse-seed",
      players,
    });

    const round1Snap = state.roundHistory?.find((s) => s.round === 1);
    expect(round1Snap).toBeDefined();
    expect(round1Snap?.territoryOwners).toBeDefined();
    expect(Object.keys(round1Snap!.territoryOwners!).length).toBe(
      Object.keys(state.territories).length
    );

    // Trigger coalition formation dramatic event
    state.players.find((p) => p.id === "p1")!.infamy = 60;
    state = applyAction(
      state,
      "p2",
      { type: "form_coalition", targetPlayerId: "p1" },
      rng
    );
    expect(state.dramaticEvents?.some((e) => e.kind === "coalition_formed")).toBe(true);

    // Mutate border on round 2 and test overwrite on game_over snapshot
    state.round = 2;
    recordRoundSnapshot(state, 2);
    const anyP2Terr = Object.values(state.territories).find((t) => t.ownerId === "p2")!;
    anyP2Terr.ownerId = "p1";
    recordRoundSnapshot(state, 2, true);

    const round2Snap = state.roundHistory?.find((s) => s.round === 2);
    expect(round2Snap?.territoryOwners?.[anyP2Terr.id]).toBe("p1");
    expect(typeof checkPlayerVictory(state, "p1")).toBe("boolean");
  });

  it("HEGEM-184: executes headless Bot vs Bot balance batch across total_war and blitz without stalling", () => {
    const totalWar = runBalanceBatch({
      games: 4,
      playersPerGame: 4,
      presetId: "total_war",
      seedPrefix: "vitest-bal",
      maxRounds: 45,
    });
    expect(totalWar.gamesPlayed).toBe(4);
    expect(totalWar.completedGames).toBeGreaterThanOrEqual(2);
    expect(totalWar.doctrineStats.length).toBeGreaterThanOrEqual(7);

    const blitz = runBalanceBatch({
      games: 4,
      playersPerGame: 4,
      presetId: "blitz",
      seedPrefix: "vitest-bal",
      maxRounds: 45,
    });
    expect(blitz.gamesPlayed).toBe(4);
    expect(blitz.completedGames).toBeGreaterThanOrEqual(2);
  }, 30000);
});
