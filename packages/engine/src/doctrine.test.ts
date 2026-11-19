import { describe, expect, it } from "vitest";
import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  CORE_DOCTRINE_LIST,
  DOCTRINES,
  isDoctrineAvailableInLobby,
} from "@hegemonia/shared";
import {
  applyAction,
  canDegradeFortificationInCombat,
  createGame,
  createSeededRng,
  getEffectiveBlitzOilCost,
  getEffectiveBuildingMoneyCost,
  getMaxAirliftsPerTurn,
  getPlayerNativeContinent,
  resolveGuerrillaInsurgencyOnOccupy,
} from "./index.js";

describe("Epic IX — Doutrinas Militares Nacionais (Motor Determinístico)", () => {
  function setupMatch() {
    const rng = createSeededRng("doctrine-epic-ix-seed");
    const state = createGame({
      id: "match-doctrine",
      seed: "doctrine-epic-ix-seed",
      players: [
        { id: "p1", name: "General Azul", color: "blue", doctrineId: "blitzkrieg" },
        { id: "p2", name: "General Vermelho", color: "red", doctrineId: "defense_in_depth" },
      ],
    });
    return { state, rng };
  }

  it("permite escolher e trocar livremente de doutrina na Rodada 1 e bloqueia na Rodada 2+", () => {
    const rng = createSeededRng("select-doc-seed");
    const state = createGame({
      id: "m1",
      seed: "select-doc-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    // 1. Escolhe Frota em Potência na Rodada 1
    const step1 = applyAction(
      state,
      "p1",
      { type: "select_doctrine", doctrineId: "fleet_in_being" },
      rng,
      CLASSIC_MAP
    );
    expect(step1.players.find((p) => p.id === "p1")!.doctrineId).toBe("fleet_in_being");

    // 2. Troca livremente para Blitzkrieg ainda na Rodada 1
    const step2 = applyAction(
      step1,
      "p1",
      { type: "select_doctrine", doctrineId: "blitzkrieg" },
      rng,
      CLASSIC_MAP
    );
    expect(step2.players.find((p) => p.id === "p1")!.doctrineId).toBe("blitzkrieg");

    // 3. Bloqueia se tentar reenviar a mesma doutrina já ativa
    expect(() =>
      applyAction(
        step2,
        "p1",
        { type: "select_doctrine", doctrineId: "blitzkrieg" },
        rng,
        CLASSIC_MAP
      )
    ).toThrow(/já foi estabelecida/i);

    // 4. Bloqueia troca a partir da Rodada 2
    const round2State = structuredClone(step2);
    round2State.round = 2;
    expect(() =>
      applyAction(
        round2State,
        "p1",
        { type: "select_doctrine", doctrineId: "guerrilla_warfare" },
        rng,
        CLASSIC_MAP
      )
    ).toThrow(/Rodada 1/i);
  });

  it("1. Blitzkrieg: reduz em 50% o custo de petróleo no 1.º blitz do turno", () => {
    const { state } = setupMatch();
    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.doctrineId = "blitzkrieg";
    p1.blitzCountThisTurn = 0;

    expect(getEffectiveBlitzOilCost(p1, 1)).toBe(0);
    expect(getEffectiveBlitzOilCost(p1, 2)).toBe(1);

    p1.blitzCountThisTurn = 1;
    expect(getEffectiveBlitzOilCost(p1, 1)).toBe(1);
    expect(getEffectiveBlitzOilCost(p1, 2)).toBe(2);
  });

  it("2. Defesa em Profundidade: identifica continente natal e protege Fortificação Nv. 1 contra infantaria pura", () => {
    const { state } = setupMatch();
    const p2 = state.players.find((p) => p.id === "p2")!;
    p2.doctrineId = "defense_in_depth";
    p2.capitalTerritoryId = "brasil";

    expect(getPlayerNativeContinent(state, p2, CLASSIC_MAP)).toBe("south_america");

    expect(
      canDegradeFortificationInCombat(p2, {
        infantry: 3,
        tank: 0,
        artillery: 0,
        aircraft: 0,
        navy: 0,
      })
    ).toBe(false);

    expect(
      canDegradeFortificationInCombat(p2, {
        infantry: 1,
        tank: 1,
        artillery: 0,
        aircraft: 0,
        navy: 0,
      })
    ).toBe(true);
  });

  it("3. Frota em Potência: reduz custo de Portos e Aeródromos em $1 e libera 2 Pontes Aéreas", () => {
    const { state } = setupMatch();
    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.doctrineId = "fleet_in_being";

    expect(getEffectiveBuildingMoneyCost(p1, "port", 5)).toBe(4);
    expect(getEffectiveBuildingMoneyCost(p1, "airfield", 5)).toBe(4);
    expect(getEffectiveBuildingMoneyCost(p1, "industry", 6)).toBe(6);
    expect(getMaxAirliftsPerTurn(p1)).toBe(2);
  });

  it("4. Guerra de Guerrilha: dispara insurgência partisan quando o conquistador deixa apenas 1 divisão", () => {
    const { state, rng } = setupMatch();
    const occupier = state.players.find((p) => p.id === "p1")!;
    const guerrillaOwner = state.players.find((p) => p.id === "p2")!;
    guerrillaOwner.doctrineId = "guerrilla_warfare";

    const targetId = CLASSIC_MAP.territories[0].id;
    const conquered = state.territories[targetId];
    conquered.ownerId = occupier.id;
    conquered.armies = 1;
    conquered.units = { infantry: 1, tank: 0, artillery: 0, aircraft: 0, navy: 0 };

    resolveGuerrillaInsurgencyOnOccupy({
      state,
      map: CLASSIC_MAP,
      rng,
      occupier,
      previousOwner: guerrillaOwner,
      conqueredTerritory: conquered,
    });

    expect(state.log.some((entry) => entry.includes("[GUERRILHA]"))).toBe(true);
  });
});

describe("HEGEM-139: Doutrinas Militares - Ícone de Capacete Militar na Doutrina Padrão e Posicionamento no Topo do Grid", () => {
  it("positions Classic Command / Standard Doctrine in 1st place in the doctrine grid with military helmet icon", () => {
    // 1. Verifies 1st place in CORE_DOCTRINE_LIST
    const firstDoc = CORE_DOCTRINE_LIST[0];
    expect(firstDoc.id).toBe("superior_firepower");
    expect(firstDoc.icon).toBe("helmet");
    expect(firstDoc.namePt).toContain("Comando Clássico");
    expect(firstDoc.orderIndex).toBe(1);

    // 2. Verifies Mass Assault was swapped to 6th position (orderIndex 6)
    const massAssaultDoc = CORE_DOCTRINE_LIST[5];
    expect(massAssaultDoc.id).toBe("mass_assault");
    expect(massAssaultDoc.icon).toBe("infantry");
    expect(massAssaultDoc.namePt).toContain("Ataque em Massa");
    expect(massAssaultDoc.orderIndex).toBe(6);
  });

  it("supports standard alias pointing to Classic Command with helmet icon and proper lobby normalization", () => {
    expect(DOCTRINES.standard).toBeDefined();
    expect(DOCTRINES.standard.icon).toBe("helmet");
    expect(DOCTRINES.standard.orderIndex).toBe(1);

    // Lobby normalization
    expect(isDoctrineAvailableInLobby("standard", ["superior_firepower"])).toBe(true);
    expect(
      isDoctrineAvailableInLobby("standard", ["superior_firepower", "standard"])
    ).toBe(false);
  });

  it("allows selecting standard / superior_firepower in Round 1 deploy phase", () => {
    const rng = createSeededRng("hegem139-doctrine-seed");
    const state = createGame({
      id: "match-hegem139",
      seed: "hegem139-doctrine-seed",
      players: [
        { id: "p1", name: "ClassicCommander", color: "blue" },
        { id: "p2", name: "Rival", color: "red" },
      ],
    });

    const updated = applyAction(
      state,
      "p1",
      { type: "select_doctrine", doctrineId: "standard" },
      rng,
      CLASSIC_MAP
    );
    expect(updated.players.find((p) => p.id === "p1")!.doctrineId).toBe("standard");
    expect(updated.log.some((l) => l.includes("Comando Clássico"))).toBe(true);
  });
});

describe("HEGEM-177: Limitar doutrina Tall (tall_sovereign e defense_in_depth) a 1 por partida igual Extermínio", () => {
  it("sets maxPerLobby to 1 for both tall_sovereign and defense_in_depth", () => {
    expect(DOCTRINES.tall_sovereign.maxPerLobby).toBe(1);
    expect(DOCTRINES.defense_in_depth.maxPerLobby).toBe(1);
    expect(DOCTRINES.extermination.maxPerLobby).toBe(1);
  });

  it("blocks a second player in the lobby from picking tall_sovereign or defense_in_depth once 1 is selected", () => {
    expect(isDoctrineAvailableInLobby("tall_sovereign", [])).toBe(true);
    expect(isDoctrineAvailableInLobby("defense_in_depth", [])).toBe(true);

    // When 1 player already picked tall_sovereign, neither tall_sovereign nor defense_in_depth is available
    expect(isDoctrineAvailableInLobby("tall_sovereign", ["tall_sovereign"])).toBe(false);
    expect(isDoctrineAvailableInLobby("defense_in_depth", ["tall_sovereign"])).toBe(false);

    // When 1 player already picked defense_in_depth, neither tall_sovereign nor defense_in_depth is available
    expect(isDoctrineAvailableInLobby("tall_sovereign", ["defense_in_depth"])).toBe(false);
    expect(isDoctrineAvailableInLobby("defense_in_depth", ["defense_in_depth"])).toBe(false);

    // When doctrineLimitEnabled is disabled in Custom Sandbox, multiple players can pick it
    expect(isDoctrineAvailableInLobby("tall_sovereign", ["tall_sovereign"], false)).toBe(true);
    expect(isDoctrineAvailableInLobby("defense_in_depth", ["tall_sovereign"], false)).toBe(true);
  });

  it("enforces the 1-player limit during Round 1 select_doctrine action", () => {
    const rng = createSeededRng("hegem177-tall-limit-seed");
    let state = createGame({
      id: "match-hegem177",
      seed: "hegem177-tall-limit-seed",
      players: [
        { id: "p1", name: "BuilderOne", color: "blue" },
        { id: "p2", name: "BuilderTwo", color: "red" },
      ],
    });

    // Clear incompatible objectives so only lobby limit is tested
    for (const p of state.players) {
      p.objective = {
        id: "obj_fortified_bastion",
        descriptionPt: "Bastião Inexpugnável",
        descriptionEn: "Impregnable Bastion",
        rule: {
          type: "fortified_bastion",
          bastionTerritoryCount: 4,
          roundsRequired: 5,
        },
        allowedDoctrines: ["tall_sovereign", "defense_in_depth"],
      };
    }

    // 1st player picks tall_sovereign -> succeeds
    state = applyAction(
      state,
      "p1",
      { type: "select_doctrine", doctrineId: "tall_sovereign" },
      rng,
      CLASSIC_MAP
    );
    expect(state.players.find((p) => p.id === "p1")!.doctrineId).toBe("tall_sovereign");

    // 2nd player tries to pick tall_sovereign or defense_in_depth -> rejected (limit 1 per match)
    expect(() =>
      applyAction(
        state,
        "p2",
        { type: "select_doctrine", doctrineId: "tall_sovereign" },
        rng,
        CLASSIC_MAP
      )
    ).toThrow(/limite de generais com a doutrina/i);

    expect(() =>
      applyAction(
        state,
        "p2",
        { type: "select_doctrine", doctrineId: "defense_in_depth" },
        rng,
        CLASSIC_MAP
      )
    ).toThrow(/limite de generais com a doutrina/i);
  });

  it("re-assigns conflicting bot doctrine in createGame when human and bot both hold tall_sovereign", () => {
    const state = createGame({
      id: "match-hegem177-bots",
      seed: "hegem177-bots-seed",
      players: [
        { id: "human_1", name: "Dicktador GRS", color: "blue", doctrineId: "tall_sovereign" },
        { id: "bot_1", name: "General IA #1", color: "red", doctrineId: "superior_firepower" },
        { id: "bot_2", name: "General IA #2", color: "green", doctrineId: "tall_sovereign" },
        { id: "bot_3", name: "General IA #3", color: "dark_green", doctrineId: "naval_supremacy" },
        { id: "bot_4", name: "General IA #4", color: "yellow", doctrineId: "blitzkrieg" },
        { id: "bot_5", name: "General IA #5", color: "orange", doctrineId: "guerrilla" },
      ],
    });

    const tallPlayers = state.players.filter(
      (p) => p.doctrineId === "tall_sovereign" || p.doctrineId === "defense_in_depth"
    );
    expect(tallPlayers).toHaveLength(1);
    expect(tallPlayers[0].id).toBe("human_1");
    expect(state.players.find((p) => p.id === "bot_2")!.doctrineId).not.toBe("tall_sovereign");
    expect(state.players.find((p) => p.id === "bot_2")!.doctrineId).not.toBe("defense_in_depth");
  });
});
