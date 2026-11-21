import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  CORE_DOCTRINE_LIST,
  DOCTRINES,
  RULES_PRESETS,
  type CustomRulesConfig,
  type DoctrineId,
  type OfficialLobbyPresetId,
  type PlayerColor,
} from "@hegemonia/shared";
import {
  applyAction,
  createGame,
  createSeededRng,
} from "./index.js";
import { planNextBotAction } from "./bot.js";

export const ALL_DOCTRINE_IDS: DoctrineId[] = CORE_DOCTRINE_LIST.map((d) => d.id);

const BOT_COLORS: PlayerColor[] = [
  "blue",
  "red",
  "green",
  "yellow",
  "purple",
  "orange",
];

export type MatchVictoryKind =
  | "wonder_countdown"
  | "elimination"
  | "objective_or_domination"
  | "timeout";

export interface HeadlessMatchResult {
  seed: string;
  presetId: OfficialLobbyPresetId;
  combatMode: CustomRulesConfig["combatMode"];
  rounds: number;
  steps: number;
  winnerId: string | null;
  winnerDoctrine: DoctrineId | null;
  victoryKind: MatchVictoryKind;
  wonderStarts: number;
  wonderCompletions: number;
  coalitionsFormed: number;
  participants: Array<{
    id: string;
    doctrineId: DoctrineId;
    won: boolean;
    eliminated: boolean;
    finalTerritories: number;
    combatsWon: number;
  }>;
}

export interface DoctrineBalanceStats {
  doctrineId: DoctrineId;
  namePt: string;
  appearances: number;
  wins: number;
  winRatePct: number;
  avgFinalTerritories: number;
  wonderWins: number;
  objectiveWins: number;
}

export interface BalanceBatchReport {
  presetId: OfficialLobbyPresetId;
  gamesPlayed: number;
  completedGames: number;
  timedOutGames: number;
  avgRounds: number;
  medianRounds: number;
  minRounds: number;
  maxRounds: number;
  victoryBreakdown: Record<MatchVictoryKind, number>;
  wonderStartRatePct: number;
  wonderCompletionRatePct: number;
  avgCoalitionsPerGame: number;
  doctrineStats: DoctrineBalanceStats[];
}

export function runHeadlessMatch(opts: {
  seed: string;
  doctrines: DoctrineId[];
  presetId?: OfficialLobbyPresetId;
  maxSteps?: number;
  maxRounds?: number;
}): HeadlessMatchResult {
  const presetId = opts.presetId ?? "total_war";
  const rulesConfig = RULES_PRESETS[presetId].config;
  const rng = createSeededRng(opts.seed);
  const maxSteps = opts.maxSteps ?? 12000;
  const maxRounds = opts.maxRounds ?? 65;

  let state = createGame({
    id: `sim_${opts.seed}`,
    seed: opts.seed,
    rulesConfig,
    players: opts.doctrines.map((docId, idx) => ({
      id: `bot_${idx + 1}`,
      name: `Bot ${idx + 1} (${DOCTRINES[docId]?.namePt ?? docId})`,
      color: BOT_COLORS[idx % BOT_COLORS.length],
      isBot: true,
      doctrineId: docId,
    })),
  });

  let steps = 0;
  while (state.phase !== "game_over" && steps < maxSteps && state.round <= maxRounds) {
    steps++;
    const current = state.players[state.turnIndex];
    if (!current || current.eliminated) break;

    let action = planNextBotAction(state, current.id, CLASSIC_MAP);
    if (!action) {
      action =
        state.phase === "deploy"
          ? state.round > 1
            ? { type: "end_deploy" }
            : { type: "end_turn" }
          : state.phase === "attack"
            ? { type: "end_attack" }
            : { type: "end_turn" };
    }

    try {
      state = applyAction(state, current.id, action, rng, CLASSIC_MAP);
    } catch {
      const firstOwned = Object.values(state.territories).find(
        (t) => t.ownerId === current.id
      );
      const fallback =
        state.pendingConquest
          ? { type: "occupy" as const, armies: state.pendingConquest.minMove }
          : state.phase === "deploy" && current.unplacedArmies > 0 && firstOwned
            ? ({
                type: "deploy" as const,
                territoryId: firstOwned.id,
                armies: current.unplacedArmies,
              })
            : state.phase === "deploy"
              ? state.round > 1
                ? ({ type: "end_deploy" } as const)
                : ({ type: "end_turn" } as const)
              : state.phase === "attack"
                ? ({ type: "end_attack" } as const)
                : ({ type: "end_turn" } as const);
      state = applyAction(state, current.id, fallback, rng, CLASSIC_MAP);
    }
  }

  const events = state.dramaticEvents ?? [];
  const wonderStarts = events.filter((e) => e.kind === "wonder_started").length;
  const wonderCompletions = events.filter((e) => e.kind === "wonder_completed").length;
  const coalitionsFormed = events.filter((e) => e.kind === "coalition_formed").length;

  const winner = state.winnerId
    ? state.players.find((p) => p.id === state.winnerId) ?? null
    : null;
  const aliveCount = state.players.filter((p) => !p.eliminated).length;

  let victoryKind: MatchVictoryKind = "timeout";
  if (winner) {
    if (winner.wonderStatus === "countdown" && (winner.wonderCountdownLeft ?? 1) <= 0) {
      victoryKind = "wonder_countdown";
    } else if (aliveCount <= 1) {
      victoryKind = "elimination";
    } else {
      victoryKind = "objective_or_domination";
    }
  }

  const participants = state.players.map((p) => ({
    id: p.id,
    doctrineId: (p.doctrineId ?? "standard") as DoctrineId,
    won: p.id === state.winnerId,
    eliminated: Boolean(p.eliminated),
    finalTerritories: Object.values(state.territories).filter((t) => t.ownerId === p.id).length,
    combatsWon: p.analytics?.combatsWon ?? 0,
  }));

  return {
    seed: opts.seed,
    presetId,
    combatMode: rulesConfig.combatMode,
    rounds: state.round,
    steps,
    winnerId: state.winnerId,
    winnerDoctrine: (winner?.doctrineId ?? null) as DoctrineId | null,
    victoryKind,
    wonderStarts,
    wonderCompletions,
    coalitionsFormed,
    participants,
  };
}

function buildBalancedRoster(gameIndex: number, playersPerGame: number): DoctrineId[] {
  const roster: DoctrineId[] = [];
  let cursor = gameIndex % ALL_DOCTRINE_IDS.length;
  let attempts = 0;

  while (roster.length < playersPerGame && attempts < ALL_DOCTRINE_IDS.length * 3) {
    const candidate = ALL_DOCTRINE_IDS[cursor % ALL_DOCTRINE_IDS.length];
    cursor += 1;
    attempts += 1;
    const limit = DOCTRINES[candidate]?.maxPerLobby;
    const existing = roster.filter((d) => d === candidate).length;
    if (limit !== null && limit !== undefined && existing >= limit) {
      continue;
    }
    roster.push(candidate);
  }
  return roster;
}

export function runBalanceBatch(opts?: {
  games?: number;
  playersPerGame?: number;
  presetId?: OfficialLobbyPresetId;
  seedPrefix?: string;
  maxRounds?: number;
}): BalanceBatchReport {
  const games = opts?.games ?? 21;
  const playersPerGame = Math.min(6, Math.max(3, opts?.playersPerGame ?? 4));
  const presetId = opts?.presetId ?? "total_war";
  const seedPrefix = opts?.seedPrefix ?? "hegem-bal";

  const results: HeadlessMatchResult[] = [];
  for (let i = 0; i < games; i++) {
    const doctrines = buildBalancedRoster(i, playersPerGame);
    results.push(
      runHeadlessMatch({
        seed: `${seedPrefix}-${presetId}-${i + 1}`,
        doctrines,
        presetId,
        maxRounds: opts?.maxRounds ?? 65,
      })
    );
  }

  const completed = results.filter((r) => r.winnerId !== null);
  const roundList = (completed.length > 0 ? completed : results)
    .map((r) => r.rounds)
    .sort((a, b) => a - b);
  const avgRounds = Number(
    (roundList.reduce((acc, n) => acc + n, 0) / Math.max(1, roundList.length)).toFixed(2)
  );
  const medianRounds = roundList[Math.floor(roundList.length / 2)] ?? 0;

  const victoryBreakdown: Record<MatchVictoryKind, number> = {
    wonder_countdown: 0,
    elimination: 0,
    objective_or_domination: 0,
    timeout: 0,
  };
  for (const r of results) {
    victoryBreakdown[r.victoryKind] += 1;
  }

  const docAgg = new Map<
    DoctrineId,
    {
      appearances: number;
      wins: number;
      terrSum: number;
      wonderWins: number;
      objectiveWins: number;
    }
  >();
  for (const docId of ALL_DOCTRINE_IDS) {
    docAgg.set(docId, {
      appearances: 0,
      wins: 0,
      terrSum: 0,
      wonderWins: 0,
      objectiveWins: 0,
    });
  }

  for (const r of results) {
    for (const p of r.participants) {
      const agg = docAgg.get(p.doctrineId);
      if (!agg) continue;
      agg.appearances += 1;
      agg.terrSum += p.finalTerritories;
      if (p.won) {
        agg.wins += 1;
        if (r.victoryKind === "wonder_countdown") agg.wonderWins += 1;
        else if (r.victoryKind === "objective_or_domination") agg.objectiveWins += 1;
      }
    }
  }

  const doctrineStats: DoctrineBalanceStats[] = ALL_DOCTRINE_IDS.map((docId) => {
    const agg = docAgg.get(docId)!;
    return {
      doctrineId: docId,
      namePt: DOCTRINES[docId]?.namePt ?? docId,
      appearances: agg.appearances,
      wins: agg.wins,
      winRatePct:
        agg.appearances > 0
          ? Number(((agg.wins / agg.appearances) * 100).toFixed(1))
          : 0,
      avgFinalTerritories:
        agg.appearances > 0
          ? Number((agg.terrSum / agg.appearances).toFixed(1))
          : 0,
      wonderWins: agg.wonderWins,
      objectiveWins: agg.objectiveWins,
    };
  }).sort((a, b) => b.winRatePct - a.winRatePct || b.avgFinalTerritories - a.avgFinalTerritories);

  const gamesWithWonderStart = results.filter((r) => r.wonderStarts > 0).length;
  const gamesWithWonderComplete = results.filter((r) => r.wonderCompletions > 0).length;
  const totalCoalitions = results.reduce((acc, r) => acc + r.coalitionsFormed, 0);

  return {
    presetId,
    gamesPlayed: results.length,
    completedGames: completed.length,
    timedOutGames: results.length - completed.length,
    avgRounds,
    medianRounds,
    minRounds: roundList[0] ?? 0,
    maxRounds: roundList[roundList.length - 1] ?? 0,
    victoryBreakdown,
    wonderStartRatePct: Number(((gamesWithWonderStart / Math.max(1, results.length)) * 100).toFixed(1)),
    wonderCompletionRatePct: Number(
      ((gamesWithWonderComplete / Math.max(1, results.length)) * 100).toFixed(1)
    ),
    avgCoalitionsPerGame: Number((totalCoalitions / Math.max(1, results.length)).toFixed(2)),
    doctrineStats,
  };
}

function formatReport(report: BalanceBatchReport): string {
  const lines: string[] = [
    `\n=== 🎲 HEGEMONIA BALANCE BATCH (${report.presetId.toUpperCase()} | ${report.gamesPlayed} partidas) ===`,
    `Concluídas: ${report.completedGames}/${report.gamesPlayed} (Timeouts: ${report.timedOutGames})`,
    `Duração: média ${report.avgRounds}R | mediana ${report.medianRounds}R | min ${report.minRounds}R | max ${report.maxRounds}R`,
    `Vitórias -> Objetivo/Domínio: ${report.victoryBreakdown.objective_or_domination} | Eliminação: ${report.victoryBreakdown.elimination} | Maravilha: ${report.victoryBreakdown.wonder_countdown} | Timeout: ${report.victoryBreakdown.timeout}`,
    `Maravilha iniciada em ${report.wonderStartRatePct}% das partidas (concluída em ${report.wonderCompletionRatePct}%) | Coalizões/partida: ${report.avgCoalitionsPerGame}`,
    `--- Win-rate por Doutrina ---`,
  ];
  for (const row of report.doctrineStats) {
    lines.push(
      `  • ${row.namePt.padEnd(24)} | ${row.wins}/${row.appearances} (${row.winRatePct}%) | Média territórios: ${row.avgFinalTerritories} | Obj: ${row.objectiveWins} / Maravilha: ${row.wonderWins}`
    );
  }
  return lines.join("\n");
}

const isCliRun = Boolean(
  typeof process !== "undefined" &&
    process.argv[1] &&
    (process.argv[1].endsWith("sim.ts") || process.argv[1].endsWith("sim.js"))
);

if (isCliRun) {
  const gamesArg = process.argv.find((a) => a.startsWith("--games="));
  const presetArg = process.argv.find((a) => a.startsWith("--preset="));
  const games = gamesArg ? Math.max(1, Number(gamesArg.split("=")[1])) : 28;
  const presets: OfficialLobbyPresetId[] = presetArg
    ? [presetArg.split("=")[1] as OfficialLobbyPresetId]
    : ["total_war", "blitz"];

  for (const presetId of presets) {
    const report = runBalanceBatch({ games, playersPerGame: 4, presetId });
    console.log(formatReport(report));
  }
}
