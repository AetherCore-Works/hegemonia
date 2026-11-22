import { CLASSIC_MAP, isSeaLink } from "@hegemonia/maps";
import type { GameAction, GameMapDef, GameState, PlayerState, UnitCounts } from "@hegemonia/shared";
import {
  BUILDING_COSTS,
  checkNavalBlockade,
  findAirMissionTargets,
  findValidTradeTriplet,
  getPartisanRelocationStatus,
  getReachableManeuverDistances,
  getTerritoryMaxBuildingSlots,
  getWonderCost,
  hasTerritoryBuilding,
  INDUSTRY_LEVEL_2_COST,
  FORTIFICATION_LEVEL_2_COST,
  selectMaritimeAttackUnits,
  UNIT_COSTS,
} from "./index.js";
import {
  emptyUnitCounts,
  getMovedInUnits,
  getTerritoryUnits,
  selectUnits,
  subtractUnits,
  totalUnits,
} from "./units.js";

function isTallDoctrine(player: PlayerState): boolean {
  return player.doctrineId === "tall_sovereign" || player.doctrineId === "defense_in_depth";
}

function isAggressiveDoctrine(player: PlayerState): boolean {
  return player.doctrineId === "extermination" || player.doctrineId === "blitzkrieg";
}

function hasActiveTreatyBetween(state: GameState, playerA: string, playerB: string): boolean {
  return Boolean(
    state.treaties?.some(
      (t) =>
        t.status === "active" &&
        ((t.fromPlayerId === playerA && t.toPlayerId === playerB) ||
          (t.fromPlayerId === playerB && t.toPlayerId === playerA))
    )
  );
}

function pickDoctrineObjectiveId(player: PlayerState): string {
  const choices = player.availableObjectives ?? [];
  if (choices.length === 0) return player.objective.id;

  if (isTallDoctrine(player)) {
    const tallPref = choices.find(
      (o) =>
        o.rule.type === "fortified_bastion" ||
        o.rule.type === "economic_hegemony" ||
        o.rule.type === "diplomatic_pax"
    );
    if (tallPref) return tallPref.id;
  }
  if (player.doctrineId === "extermination") {
    const extPref = choices.find((o) => o.rule.type === "eliminate_players");
    if (extPref) return extPref.id;
  }
  if (player.doctrineId === "guerrilla" || player.doctrineId === "guerrilla_warfare") {
    const islandPref = choices.find(
      (o) => o.id === "roleplay_island_empire" || o.id.includes("island")
    );
    if (islandPref) return islandPref.id;
  }
  return choices[0].id;
}

function getScaledMoneyCost(state: GameState, baseMoney: number): number {
  const mult = state.rulesConfig?.buildingCostMultiplier ?? 1;
  return mult === 1 ? baseMoney : Math.max(1, Math.round(baseMoney * mult));
}

function planDoctrineDeployPrepAction(
  state: GameState,
  player: PlayerState,
  map: GameMapDef
): GameAction | null {
  if (state.rulesConfig?.classicMode || player.doctrineId === "extermination") {
    return null;
  }

  const res = player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  const owned = Object.values(state.territories).filter((t) => t.ownerId === player.id);
  const mapById = new Map(map.territories.map((t) => [t.id, t]));

  // 1. Tall Sovereign / Fortified Bastion priorities
  if (isTallDoctrine(player) || player.objective?.rule.type === "fortified_bastion") {
    const alreadyHasWonder = owned.some((t) => hasTerritoryBuilding(t, "wonder"));
    if (!alreadyHasWonder) {
      const wonderBase = owned.find(
        (t) =>
          hasTerritoryBuilding(t, "fortification") &&
          (t.buildings?.length ?? 0) < getTerritoryMaxBuildingSlots(state, t.id)
      );
      const wonderCost = getWonderCost(state, player.id);
      if (wonderBase && res.money >= wonderCost.money && res.steel >= wonderCost.steel) {
        return { type: "build_structure", territoryId: wonderBase.id, buildingType: "wonder" };
      }
    }

    if (isTallDoctrine(player)) {
      const indLv1 = owned.find((t) =>
        (t.buildings ?? []).some((b) => b.type === "industry" && b.level < 2)
      );
      if (
        indLv1 &&
        res.money >= INDUSTRY_LEVEL_2_COST.money &&
        res.steel >= INDUSTRY_LEVEL_2_COST.steel
      ) {
        return { type: "build_structure", territoryId: indLv1.id, buildingType: "industry" };
      }
    }

    const fortLv1Cost = getScaledMoneyCost(state, BUILDING_COSTS.fortification.money);
    const unfortifiedCapital =
      player.capitalTerritoryId &&
      state.territories[player.capitalTerritoryId]?.ownerId === player.id &&
      !hasTerritoryBuilding(state.territories[player.capitalTerritoryId], "fortification")
        ? state.territories[player.capitalTerritoryId]
        : null;
    if (
      unfortifiedCapital &&
      (unfortifiedCapital.buildings?.length ?? 0) <
        getTerritoryMaxBuildingSlots(state, unfortifiedCapital.id) &&
      res.money >= fortLv1Cost
    ) {
      return {
        type: "build_structure",
        territoryId: unfortifiedCapital.id,
        buildingType: "fortification",
      };
    }

    const fortToUpgrade = owned.find((t) =>
      (t.buildings ?? []).some((b) => b.type === "fortification" && b.level < 2)
    );
    if (
      fortToUpgrade &&
      res.money >= FORTIFICATION_LEVEL_2_COST.money &&
      res.steel >= FORTIFICATION_LEVEL_2_COST.steel
    ) {
      return {
        type: "build_structure",
        territoryId: fortToUpgrade.id,
        buildingType: "fortification",
      };
    }
  }

  // 2. Blitzkrieg priorities: recruit Tanks & secure Oil
  if (player.doctrineId === "blitzkrieg") {
    const tankBase = owned.find(
      (t) =>
        !t.isEncircled &&
        (hasTerritoryBuilding(t, "industry") || hasTerritoryBuilding(t, "military_factory"))
    );
    if (
      tankBase &&
      res.money >= UNIT_COSTS.tank.money &&
      res.steel >= UNIT_COSTS.tank.steel &&
      res.oil >= 1
    ) {
      return {
        type: "recruit_unit",
        territoryId: tankBase.id,
        unitType: "tank",
        quantity: 1,
      };
    }
    const oilRich = owned.find(
      (t) =>
        mapById.get(t.id)?.resource === "oil" &&
        !hasTerritoryBuilding(t, "oil_well") &&
        (t.buildings?.length ?? 0) < getTerritoryMaxBuildingSlots(state, t.id)
    );
    const wellMoney = getScaledMoneyCost(state, BUILDING_COSTS.oil_well.money);
    if (oilRich && res.money >= wellMoney && res.steel >= BUILDING_COSTS.oil_well.steel) {
      return { type: "build_structure", territoryId: oilRich.id, buildingType: "oil_well" };
    }
  }

  // 3. Naval Supremacy: recruit Aircraft or Navy
  if (player.doctrineId === "naval_supremacy" || player.doctrineId === "fleet_in_being") {
    const airBase = owned.find((t) => !t.isEncircled && hasTerritoryBuilding(t, "airfield"));
    if (
      airBase &&
      res.money >= UNIT_COSTS.aircraft.money &&
      res.steel >= UNIT_COSTS.aircraft.steel &&
      res.oil >= UNIT_COSTS.aircraft.oil
    ) {
      return {
        type: "recruit_unit",
        territoryId: airBase.id,
        unitType: "aircraft",
        quantity: 1,
      };
    }
    const portBase = owned.find(
      (t) => !t.isEncircled && hasTerritoryBuilding(t, "port") && mapById.get(t.id)?.isCoastal !== false
    );
    if (
      portBase &&
      res.money >= UNIT_COSTS.navy.money &&
      res.steel >= UNIT_COSTS.navy.steel &&
      res.oil >= UNIT_COSTS.navy.oil
    ) {
      return {
        type: "recruit_unit",
        territoryId: portBase.id,
        unitType: "navy",
        quantity: 1,
      };
    }
  }

  // 4. Mass Assault: spend surplus money recruiting $2 infantry on frontline
  if (player.doctrineId === "mass_assault" && res.money >= 2) {
    const frontInfBase =
      owned.find(
        (t) =>
          !t.isEncircled &&
          mapById.get(t.id)?.neighbors.some((n) => state.territories[n]?.ownerId !== player.id)
      ) ?? owned.find((t) => !t.isEncircled);
    const totalInf =
      owned.reduce((acc, t) => acc + getTerritoryUnits(t).infantry, 0) +
      player.unplacedArmies;
    const qty = Math.min(3, Math.floor(res.money / 2), Math.max(0, 50 - totalInf));
    if (frontInfBase && qty > 0) {
      return {
        type: "recruit_unit",
        territoryId: frontInfBase.id,
        unitType: "infantry",
        quantity: qty,
      };
    }
  }

  return null;
}

function planCoalitionDiplomacyAction(
  state: GameState,
  player: PlayerState
): GameAction | null {
  if (state.rulesConfig?.classicMode || state.round <= 1) return null;

  const coalitions = state.coalitions ?? [];
  const activeWonderThreat = state.players.find(
    (p) =>
      p.id !== player.id &&
      !p.eliminated &&
      (p.wonderStatus === "constructing" || p.wonderStatus === "countdown") &&
      (p.infamy ?? 0) >= 50
  );
  const infamyThreat =
    activeWonderThreat ??
    state.players.find(
      (p) =>
        p.id !== player.id &&
        !p.eliminated &&
        (p.infamy ?? 0) >= 50 &&
        Object.values(state.territories).filter((t) => t.ownerId === p.id).length >= 16
    );
  if (!infamyThreat) return null;

  const existing = coalitions.find((c) => c.targetPlayerId === infamyThreat.id);
  if (existing) {
    if (existing.memberPlayerIds.includes(player.id)) return null;
    const maxMembers = (infamyThreat.infamy ?? 0) >= 100 ? 3 : 2;
    if (existing.memberPlayerIds.length >= maxMembers) return null;
    return { type: "join_coalition", coalitionId: existing.id };
  }
  return { type: "form_coalition", targetPlayerId: infamyThreat.id };
}

function computeDistanceMapToTargets(
  targetIds: string[],
  map: GameMapDef
): Map<string, number> {
  const dist = new Map<string, number>();
  if (targetIds.length === 0) return dist;
  const mapById = new Map(map.territories.map((t) => [t.id, t]));
  const queue: string[] = [];
  for (const tid of targetIds) {
    dist.set(tid, 0);
    queue.push(tid);
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curD = dist.get(cur)!;
    for (const n of mapById.get(cur)?.neighbors ?? []) {
      if (!dist.has(n)) {
        dist.set(n, curD + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

function getActiveWonderTargetTerritories(
  state: GameState,
  playerId: string
): string[] {
  return state.players
    .filter(
      (p) =>
        p.id !== playerId &&
        !p.eliminated &&
        (p.wonderStatus === "constructing" || p.wonderStatus === "countdown") &&
        Boolean(p.wonderTerritoryId)
    )
    .map((p) => p.wonderTerritoryId!);
}

/**
 * Deterministic doctrine-aware Bot AI planner (HEGEM-152).
 * Evaluates current GameState and emits the single next valid GameAction for `playerId`.
 */
export function planNextBotAction(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): GameAction | null {
  if (state.phase === "game_over") return null;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return null;
  const mapById = new Map(map.territories.map((t) => [t.id, t]));

  // 1. Round 1 secret objective choice
  if (player.pendingObjectiveChoice && player.availableObjectives?.length) {
    return {
      type: "choose_objective",
      objectiveId: pickDoctrineObjectiveId(player),
    };
  }

  // 2. Card trade (in deploy or forced when holding 5+)
  const triplet = findValidTradeTriplet(player.cards);
  if (triplet && (state.phase === "deploy" || player.cards.length >= 5)) {
    return { type: "trade_cards", cardIds: triplet };
  }

  // 2b. Coalition containment vs Wonder builders & runaway warmongers
  const coalitionAction = planCoalitionDiplomacyAction(state, player);
  if (coalitionAction) {
    return coalitionAction;
  }

  // 3. Deploy phase
  if (state.phase === "deploy") {
    // Partisan Nomadic Capital relocation every 2 rounds (HEGEM-150 / HEGEM-152)
    const partisanStatus = getPartisanRelocationStatus(state, playerId, map);
    if (partisanStatus.isDueNow && partisanStatus.eligibleTerritoryIds.length > 0) {
      return {
        type: "select_capital",
        territoryId: partisanStatus.eligibleTerritoryIds[0],
      };
    }

    // Doctrine-aware infrastructure / special unit recruitment while deploying
    if (player.unplacedArmies > 0 || state.round > 1) {
      const prepAction = planDoctrineDeployPrepAction(state, player, map);
      if (prepAction && player.unplacedArmies > 0) {
        return prepAction;
      }
    }

    if (player.unplacedArmies > 0) {
      const owned = Object.values(state.territories).filter((t) => t.ownerId === playerId);
      const nonEncircled = owned.filter((t) => !t.isEncircled);
      const pool = nonEncircled.length > 0 ? nonEncircled : owned;
      const frontline = pool.filter((t) =>
        mapById.get(t.id)?.neighbors.some((n) => state.territories[n]?.ownerId !== playerId)
      );

      let chosen = frontline[0] ?? pool[0];
      const wonderTargets = getActiveWonderTargetTerritories(state, playerId);
      const wonderDist = computeDistanceMapToTargets(wonderTargets, map);
      if (isTallDoctrine(player) && player.capitalTerritoryId) {
        const cap = pool.find((t) => t.id === player.capitalTerritoryId);
        if (cap && cap.armies < 8) {
          chosen = cap;
        }
      } else if (frontline.length > 0) {
        const sortedFront = [...frontline].sort((a, b) => {
          if (wonderDist.size > 0) {
            const da = wonderDist.get(a.id) ?? 99;
            const db = wonderDist.get(b.id) ?? 99;
            if (da !== db) return da - db;
          }
          const minEnemyA = Math.min(
            ...mapById
              .get(a.id)!
              .neighbors.map((n) => state.territories[n])
              .filter((n) => n && n.ownerId !== playerId)
              .map((n) => n.armies)
          );
          const minEnemyB = Math.min(
            ...mapById
              .get(b.id)!
              .neighbors.map((n) => state.territories[n])
              .filter((n) => n && n.ownerId !== playerId)
              .map((n) => n.armies)
          );
          return minEnemyA - minEnemyB;
        });
        chosen = sortedFront[0];
      }

      if (!chosen) {
        return { type: "end_turn" };
      }
      return {
        type: "deploy",
        territoryId: chosen.id,
        armies: player.unplacedArmies,
      };
    }

    if (state.round > 1) {
      return { type: "end_deploy" };
    }
    return { type: "end_turn" };
  }

  // 4. Pending conquest occupation
  if (state.pendingConquest) {
    const pq = state.pendingConquest;
    const isTallHold = isTallDoctrine(player) && pq.maxMove > pq.minMove + 2;
    const moveCount = isTallHold ? Math.ceil((pq.minMove + pq.maxMove) / 2) : pq.maxMove;
    return {
      type: "occupy",
      armies: Math.max(pq.minMove, Math.min(pq.maxMove, moveCount)),
    };
  }

  // 5. Attack phase
  if (state.phase === "attack") {
    // 5a. Tactical Air Recon (HEGEM-180) before ground assaults
    if (state.round > 1 && !state.rulesConfig?.classicMode && (player.resources?.oil ?? 0) >= 1) {
      const airBases = Object.values(state.territories).filter(
        (t) =>
          t.ownerId === playerId &&
          !t.isEncircled &&
          !t.airMissionFlownThisTurn &&
          hasTerritoryBuilding(t, "airfield") &&
          getTerritoryUnits(t).aircraft >= 1
      );
      for (const airBase of airBases) {
        const targets = findAirMissionTargets(state, airBase.id, map)
          .map((tid) => state.territories[tid])
          .filter(
            (t) =>
              t &&
              t.ownerId !== playerId &&
              t.reconSpottedRound !== state.round &&
              t.armies >= 2 &&
              !hasActiveTreatyBetween(state, playerId, t.ownerId)
          );
        if (targets.length > 0) {
          targets.sort((a, b) => {
            const aWonder = state.players.find((p) => p.id === a.ownerId)?.wonderStatus ? 1 : 0;
            const bWonder = state.players.find((p) => p.id === b.ownerId)?.wonderStatus ? 1 : 0;
            return bWonder - aWonder || b.armies - a.armies;
          });
          return {
            type: "air_mission",
            fromTerritoryId: airBase.id,
            toTerritoryId: targets[0].id,
            missionType: "recon",
          };
        }
      }
    }

    const owned = Object.values(state.territories);
    const wonderThreatIds = new Set(
      state.players
        .filter(
          (p) =>
            p.id !== playerId &&
            !p.eliminated &&
            (p.wonderStatus === "constructing" || p.wonderStatus === "countdown")
        )
        .map((p) => p.id)
    );
    const wonderDist = computeDistanceMapToTargets(
      getActiveWonderTargetTerritories(state, playerId),
      map
    );
    const myTerrs = owned
      .filter(
        (t) =>
          t.ownerId === playerId &&
          t.armies >= 3 &&
          !(t.conqueredTurnRound === state.round && !t.blitzkriegAvailable)
      )
      .sort((a, b) => b.armies - a.armies);

    // Tall Sovereign avoids overextension beyond 5 territories unless a rival is building a Wonder
    const tallStopExpansion =
      isTallDoctrine(player) &&
      wonderThreatIds.size === 0 &&
      owned.filter((t) => t.ownerId === playerId).length >= 5 &&
      (player.objective?.rule.type === "fortified_bastion" ||
        player.objective?.rule.type === "economic_hegemony" ||
        player.objective?.rule.type === "diplomatic_pax");

    if (!tallStopExpansion) {
      const minAdvantage = isTallDoctrine(player) ? 2 : 1;
      for (const from of myTerrs) {
        const fromU = getTerritoryUnits(from);
        const isBlitzAdvance = from.conqueredTurnRound === state.round && Boolean(from.blitzkriegAvailable);
        const blitzTankUnits: UnitCounts | null = isBlitzAdvance
          ? fromU.tank >= 1 && from.armies - fromU.tank >= 1
            ? { ...emptyUnitCounts(), tank: fromU.tank }
            : fromU.tank >= 2
              ? { ...emptyUnitCounts(), tank: fromU.tank - 1 }
              : null
          : null;
        if (isBlitzAdvance && !blitzTankUnits) {
          continue;
        }

        const enemies = mapById
          .get(from.id)!
          .neighbors.map((n) => state.territories[n])
          .filter((n) => {
            if (!n || n.ownerId === playerId) return false;
            const sea = isSeaLink(from.id, n.id);
            const taskForce =
              blitzTankUnits ??
              (sea
                ? selectMaritimeAttackUnits(fromU, from.armies - 1)
                : selectUnits(fromU, from.armies - 1));
            const tfGround = taskForce.infantry + taskForce.tank + taskForce.artillery;
            const tfCount = totalUnits(taskForce);
            if (tfGround < 1 || tfCount < 1) return false;
            const reqAdv = wonderThreatIds.has(n.ownerId) ? 0 : minAdvantage;
            if (tfCount + 1 < n.armies + reqAdv && from.armies < n.armies + reqAdv) {
              return false;
            }
            if (from.armies < n.armies + reqAdv) return false;
            if (hasActiveTreatyBetween(state, playerId, n.ownerId)) return false;
            if (sea) {
              const blockade = checkNavalBlockade(state, from.id, n.id, playerId);
              if (blockade.isBlockaded) return false;
              const toU = getTerritoryUnits(n);
              const defAeronaval = toU.navy + toU.aircraft;
              const attAeronaval = taskForce.navy + taskForce.aircraft;
              if (defAeronaval > 0 && (attAeronaval < 1 || tfGround < 1 || from.armies < 3)) {
                return false;
              }
            }
            return true;
          });

        if (enemies.length > 0) {
          enemies.sort((a, b) => {
            const aWonder = wonderThreatIds.has(a.ownerId)
              ? hasTerritoryBuilding(a, "wonder")
                ? 2
                : 1
              : 0;
            const bWonder = wonderThreatIds.has(b.ownerId)
              ? hasTerritoryBuilding(b, "wonder")
                ? 2
                : 1
              : 0;
            if (aWonder !== bWonder) return bWonder - aWonder;
            if (wonderDist.size > 0) {
              const da = wonderDist.get(a.id) ?? 99;
              const db = wonderDist.get(b.id) ?? 99;
              if (da !== db) return da - db;
            }
            return a.armies - b.armies;
          });
          // Aggressive doctrines prefer blitzkrieg spearhead stacks first
          const bestTarget = enemies[0];
          const sea = isSeaLink(from.id, bestTarget.id);
          const taskForce =
            blitzTankUnits ??
            (sea
              ? selectMaritimeAttackUnits(fromU, from.armies - 1)
              : selectUnits(fromU, from.armies - 1));
          return {
            type: "attack",
            fromTerritoryId: from.id,
            toTerritoryId: bestTarget.id,
            units: taskForce,
          };
        }
      }
    }

    return { type: "end_attack" };
  }

  // 6. Phase 3 Maneuver — Multi-hop range aware (Inf/Art 1, Tank 2, Navy 3, Aircraft Airfields)
  if (state.phase === "maneuver") {
    const myTerrs = Object.values(state.territories).filter((t) => t.ownerId === playerId);
    const isFrontline = (tid: string): boolean =>
      Boolean(
        mapById.get(tid)?.neighbors.some((nId) => state.territories[nId]?.ownerId !== playerId)
      );

    for (const from of myTerrs) {
      if (isFrontline(from.id)) continue; // Interior garrisons only
      const available = subtractUnits(getTerritoryUnits(from), getMovedInUnits(from));
      const totalAvail = totalUnits(available);
      const maxMovable = totalAvail - 1;
      if (maxMovable <= 0) continue;

      // Try specialized multi-hop unit categories first, then general 1-hop interior push
      const tryCategories: Array<{ units: UnitCounts; armies: number }> = [];

      if (available.aircraft > 0 && hasTerritoryBuilding(from, "airfield")) {
        const count = Math.min(available.aircraft, maxMovable);
        if (count > 0) {
          tryCategories.push({
            units: { ...emptyUnitCounts(), aircraft: count },
            armies: count,
          });
        }
      }
      if (available.tank > 0) {
        const count = Math.min(available.tank, maxMovable);
        if (count > 0) {
          tryCategories.push({
            units: { ...emptyUnitCounts(), tank: count },
            armies: count,
          });
        }
      }
      if (available.navy > 0) {
        const count = Math.min(available.navy, maxMovable);
        if (count > 0) {
          tryCategories.push({
            units: { ...emptyUnitCounts(), navy: count },
            armies: count,
          });
        }
      }

      const infoAll = getReachableManeuverDistances(state, from.id, playerId, map, available);
      const frontAdjacent = Object.keys(infoAll.landDistances).filter((id) => isFrontline(id));
      if (frontAdjacent.length > 0) {
        // Respect unit composition for selected target
        for (const cat of tryCategories) {
          const catInfo = getReachableManeuverDistances(state, from.id, playerId, map, cat.units);
          const validIds =
            cat.units.aircraft > 0
              ? catInfo.aircraftTargets
              : Object.keys(catInfo.landDistances);
          const frontDest = validIds.find((id) => isFrontline(id));
          if (frontDest) {
            const toTerr = state.territories[frontDest];
            const needsOil =
              isSeaLink(from.id, frontDest) &&
              (cat.units.navy > 0 || !hasTerritoryBuilding(toTerr, "port"));
            if (needsOil && (player.resources?.oil ?? 0) < 1) continue;
            return {
              type: "maneuver",
              fromTerritoryId: from.id,
              toTerritoryId: frontDest,
              armies: cat.armies,
              units: cat.units,
            };
          }
        }
      }

      // Fallback 1-hop move toward frontline or neighbor for infantry/artillery
      const oneHopFront = mapById
        .get(from.id)
        ?.neighbors.find(
          (nId) => state.territories[nId]?.ownerId === playerId && isFrontline(nId)
        );
      if (oneHopFront) {
        const infMove = Math.min(available.infantry, maxMovable);
        const targetUnits: UnitCounts =
          infMove > 0
            ? { ...emptyUnitCounts(), infantry: infMove }
            : { ...emptyUnitCounts(), artillery: Math.min(available.artillery, maxMovable) };
        const count = totalUnits(targetUnits);
        const toTerr = state.territories[oneHopFront];
        const needsOil =
          isSeaLink(from.id, oneHopFront) && !hasTerritoryBuilding(toTerr, "port");
        if (count > 0 && (!needsOil || (player.resources?.oil ?? 0) >= 1)) {
          return {
            type: "maneuver",
            fromTerritoryId: from.id,
            toTerritoryId: oneHopFront,
            armies: count,
            units: targetUnits,
          };
        }
      }
    }

    return { type: "end_turn" };
  }

  return null;
}
