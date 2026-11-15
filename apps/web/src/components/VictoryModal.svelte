<script lang="ts">
  import {
    calculateLevelProgress,
    calculateMatchXp,
    type CompetitionMode,
    type GameState,
    type MatchXpBreakdown,
    type PlayerColor,
    type PlayerState,
  } from "@hegemonia/shared";
  import { i18n, t } from "../i18n/index.svelte";
  import { getFactionName, getObjectiveDescription } from "../i18n/content.svelte";
  import { auth } from "../lib/auth.svelte";
  import { sound } from "../audio.js";
  import FactionFlag from "./FactionFlag.svelte";
  import Icon from "./Icon.svelte";

  let {
    game,
    myPlayerId,
    playerMetrics,
    competitionMode = "custom",
    amIHost = false,
    onReturnRoomToLobby,
    onReturnToLobby,
  }: {
    game: GameState;
    myPlayerId: string | null;
    playerMetrics: {
      player: PlayerState;
      terrCount: number;
      totalArmies: number;
      sharePct: number;
    }[];
    competitionMode?: CompetitionMode;
    amIHost?: boolean;
    onReturnRoomToLobby?: () => void;
    onReturnToLobby: () => void;
  } = $props();

  let minimized = $state(false);
  let activeTab = $state<"summary" | "timeline" | "awards">("summary");
  let timelineMetric = $state<"territories" | "armies" | "economy">("territories");

  function getSnapshotMetricValue(
    snap: { players: Record<string, { territories: number; armies: number; money: number; resourcesTotal: number; combatsWon: number }> },
    playerId: string,
    metric: "territories" | "armies" | "economy"
  ): number {
    const entry = snap.players[playerId];
    if (!entry) return 0;
    if (metric === "territories") return entry.territories;
    if (metric === "armies") return entry.armies;
    return entry.money + entry.resourcesTotal * 2;
  }

  const FACTION_STROKE_COLORS: Record<PlayerColor, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    dark_green: "#22c55e",
    yellow: "#facc15",
    orange: "#f97316",
    pink: "#ec4899",
    purple: "#a855f7",
    black: "#cbd5e1",
    white: "#f8fafc",
  };

  let timelineSnapshots = $derived.by(() => {
    if (game.roundHistory && game.roundHistory.length > 0) {
      return game.roundHistory;
    }
    const playersObj: Record<
      string,
      { territories: number; armies: number; money: number; resourcesTotal: number; combatsWon: number }
    > = {};
    for (const row of playerMetrics) {
      const r = row.player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      playersObj[row.player.id] = {
        territories: row.terrCount,
        armies: row.totalArmies,
        money: r.money,
        resourcesTotal: r.steel + r.oil + r.gold,
        combatsWon: row.player.analytics?.combatsWon ?? 0,
      };
    }
    return [
      {
        round: game.round,
        worldTension: game.worldTension ?? 0,
        players: playersObj,
      },
    ];
  });

  let timelineMaxValue = $derived.by(() => {
    let maxVal = 1;
    for (const snap of timelineSnapshots) {
      for (const p of game.players) {
        const val = getSnapshotMetricValue(snap, p.id, timelineMetric);
        if (val > maxVal) maxVal = val;
      }
    }
    return maxVal;
  });

  let matchAwards = $derived.by(() => {
    if (playerMetrics.length === 0) return [];
    const byTerr = [...playerMetrics].sort((a, b) => b.terrCount - a.terrCount);
    const byArmy = [...playerMetrics].sort((a, b) => b.totalArmies - a.totalArmies);
    const byEcon = [...playerMetrics].sort((a, b) => {
      const ra = a.player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      const rb = b.player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      const na = ra.money + ra.steel * 2 + ra.oil * 2 + ra.gold * 3;
      const nb = rb.money + rb.steel * 2 + rb.oil * 2 + rb.gold * 3;
      return nb - na;
    });
    const topConqueror = byTerr[0];
    const topMilitary = byArmy[0];
    const topMagnate = byEcon[0];
    const econRes = topMagnate.player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
    const topEconScore =
      econRes.money + econRes.steel * 2 + econRes.oil * 2 + econRes.gold * 3;

    return [
      {
        title: "Conquistador Supremo",
        subtitle: "Maior domínio territorial ao fim da guerra",
        player: topConqueror.player,
        stat: `${topConqueror.terrCount} territórios (${topConqueror.sharePct}%)`,
      },
      {
        title: "MVP Militar",
        subtitle: "Maior força armada mobilizada no teatro final",
        player: topMilitary.player,
        stat: `${topMilitary.totalArmies} divisões ativas`,
      },
      {
        title: "Magnata Econômico",
        subtitle: "Maior reserva estratégica acumulada",
        player: topMagnate.player,
        stat: `$${topEconScore} em patrimônio líquido`,
      },
    ];
  });

  let winner = $derived(game.players.find((p) => p.id === game.winnerId) ?? null);
  let isWinnerMe = $derived(Boolean(winner && winner.id === myPlayerId));

  let sortedStandings = $derived(
    [...playerMetrics].sort((a, b) => {
      if (a.player.id === game.winnerId) return -1;
      if (b.player.id === game.winnerId) return 1;
      if (b.terrCount !== a.terrCount) return b.terrCount - a.terrCount;
      return b.totalArmies - a.totalArmies;
    })
  );

  let myStandingIndex = $derived(
    sortedStandings.findIndex((row) => row.player.id === myPlayerId)
  );
  let myPlacement = $derived(myStandingIndex >= 0 ? myStandingIndex + 1 : sortedStandings.length);

  let xpBreakdown = $derived.by<MatchXpBreakdown>(() => {
    const totalHumans = game.players.filter((p) => !p.isBot).length;
    const totalBots = game.players.filter((p) => p.isBot).length;
    const myPlayer = game.players.find((p) => p.id === myPlayerId);

    return calculateMatchXp({
      competitionMode: competitionMode ?? "custom",
      roundsPlayed: game.round,
      placement: myPlacement,
      won: isWinnerMe,
      isBot: Boolean(myPlayer?.isBot),
      hasAuthenticatedUser: Boolean(auth.user),
      totalHumanPlayers: totalHumans,
      totalBotPlayers: totalBots,
      abandoned: false,
    });
  });

  let playedVictoryCue = false;
  let currentLevelProgress = $derived(
    calculateLevelProgress(auth.user?.totalXp ?? 0)
  );

  $effect(() => {
    if (auth.user) {
      auth.refresh();
    }
    if (isWinnerMe && !playedVictoryCue) {
      playedVictoryCue = true;
      sound.playVictoryMatch();
    }
  });
</script>

{#if minimized}
  <div class="victory-minimized-bar">
    <div class="v-min-left">
      <Icon name="laurel" size={20} />
      <span>
        {t("victory_campaign_ended", { name: winner?.name?.toUpperCase() ?? "" })}
      </span>
    </div>
    <div class="v-min-actions">
      <button class="outline-button" onclick={() => { sound.playClick(); minimized = false; }}>
        <Icon name="eye" size={14} /> {t("victory_btn_view_report")}
      </button>
      <button class="gold-button" onclick={() => { sound.playClick(); onReturnToLobby(); }}>
        <Icon name="back" size={14} /> {t("victory_btn_return_hq")}
      </button>
    </div>
  </div>
{:else}
  <div class="victory-backdrop">
    <article class="victory-dossier-modal">
      <div class="victory-hero-banner">
        <img src="/assets/victory-header.webp" alt={t("victory_modal_title")} class="victory-banner-img" />
        <div class="victory-banner-overlay">
          <span class="victory-kicker">
            {isWinnerMe ? t("victory_kicker_win") : t("victory_kicker_defeat")}
          </span>
          <h2>{t("victory_modal_title")}</h2>
        </div>
      </div>

      <div class="victory-body">
        <div class="victory-tabs" role="tablist">
          <button
            type="button"
            class="v-tab-btn"
            class:active={activeTab === "summary"}
            onclick={() => { sound.playClick(); activeTab = "summary"; }}
          >
            Resumo & Classificação
          </button>
          <button
            type="button"
            class="v-tab-btn"
            class:active={activeTab === "timeline"}
            onclick={() => { sound.playClick(); activeTab = "timeline"; }}
          >
            Linha do Tempo ({timelineSnapshots.length}R)
          </button>
          <button
            type="button"
            class="v-tab-btn"
            class:active={activeTab === "awards"}
            onclick={() => { sound.playClick(); activeTab = "awards"; }}
          >
            Condecorações
          </button>
        </div>

        {#if activeTab === "summary"}
        {#if winner}
          <div class="winner-showcase">
            <FactionFlag color={winner.color} width={44} height={28} />
            <div class="winner-meta">
              <span class="winner-faction">{getFactionName(winner.color)}</span>
              <h3>{t("commander")} {winner.name}</h3>
            </div>
            <span class="winner-round-badge">{t("round", { round: game.round }).toUpperCase()}</span>
          </div>

          <div class="fulfilled-directive">
            <span class="directive-label"><Icon name="target" size={14} /> {t("victory_directive_fulfilled")}</span>
            <p>
              {#if (winner.wonderRoundsHeld ?? 0) >= 3}
                {t("wonder_directive_fulfilled")}
              {:else if winner.objective}
                {getObjectiveDescription(winner.objective)}
              {:else}
                {t("victory_conquest_desc")}
              {/if}
            </p>
          </div>
        {/if}

        <div class="standings-section">
          <h4>{t("victory_standings_title")}</h4>
          <div class="standings-list">
            {#each sortedStandings as row, i}
              <div class="standing-row" class:winner-row={row.player.id === game.winnerId}>
                <span class="standing-pos">#{i + 1}</span>
                <FactionFlag color={row.player.color} width={22} height={14} />
                <strong class="standing-name">
                  {row.player.name} {row.player.id === myPlayerId ? `(${t("you")})` : ""}
                </strong>
                <span class="standing-stat">{t("victory_terr_stat", { count: row.terrCount, pct: row.sharePct })}</span>
                <span class="standing-stat">{t("divisions", { count: row.totalArmies })}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- HEGEM-66: Profile XP & Level Progression Card -->
        <div class="xp-progression-section">
          <div class="xp-header">
            <div class="xp-header-title">
              <Icon name="rank" size={16} />
              <h4>{t("xp_progression_title")}</h4>
              <span class="mode-pill mode-{competitionMode}">
                {t(`xp_mode_${competitionMode}`)}
              </span>
            </div>
            <span class="xp-hierarchy-hint">{t("xp_hierarchy_info")}</span>
          </div>

          {#if auth.user && xpBreakdown.eligible}
            <div class="xp-breakdown-row">
              <div class="xp-item">
                <span class="xp-item-label">{t("xp_base_label", { mode: t(`xp_mode_${competitionMode}`) })}</span>
                <span class="xp-item-val">+{xpBreakdown.baseXp} XP</span>
              </div>
              {#if xpBreakdown.winBonus > 0}
                <div class="xp-item bonus">
                  <span class="xp-item-label">{t("xp_win_bonus_label")}</span>
                  <span class="xp-item-val">+{xpBreakdown.winBonus} XP</span>
                </div>
              {/if}
              {#if xpBreakdown.placementBonus > 0}
                <div class="xp-item bonus">
                  <span class="xp-item-label">{t("xp_placement_bonus_label", { pos: myPlacement })}</span>
                  <span class="xp-item-val">+{xpBreakdown.placementBonus} XP</span>
                </div>
              {/if}
              <div class="xp-item total">
                <span class="xp-item-label">{t("xp_total_earned", { xp: xpBreakdown.totalXp })}</span>
              </div>
            </div>

            <!-- Level Progression Bar -->
            <div class="xp-bar-container">
              <div class="xp-bar-labels">
                <span class="current-lvl">{t("xp_level_badge", { level: currentLevelProgress.level })}</span>
                <span class="xp-numbers">
                  {currentLevelProgress.xpInCurrentLevel} / {currentLevelProgress.xpNeededForNextLevel} XP
                </span>
                <span class="next-lvl">{t("xp_level_badge", { level: currentLevelProgress.level + 1 })}</span>
              </div>
              <div class="xp-track">
                <div class="xp-fill" style="width: {currentLevelProgress.progressPct}%;"></div>
              </div>
            </div>

            <p class="xp-disclaimer">{t("xp_progression_disclaimer")}</p>
          {:else if auth.user && !xpBreakdown.eligible}
            <div class="xp-ineligible-box">
              <Icon name="alert" size={14} />
              <span>
                {xpBreakdown.ineligibilityReason === "too_short"
                  ? t("xp_ineligible_too_short")
                  : xpBreakdown.ineligibilityReason === "majority_bots"
                    ? t("xp_ineligible_majority_bots")
                    : xpBreakdown.ineligibilityReason === "abandoned"
                      ? t("xp_ineligible_abandoned")
                      : t("xp_ineligible_guest")}
              </span>
            </div>
        {:else}
            <div class="xp-ineligible-box guest">
              <Icon name="user" size={14} />
              <span>{t("xp_ineligible_guest")}</span>
            </div>
          {/if}
        </div>
        {:else if activeTab === "timeline"}
          <div class="timeline-aar-box">
            <div class="timeline-header">
              <h4>Evolução Estratégica por Rodada</h4>
              <div class="timeline-metric-pills">
                <button
                  type="button"
                  class="tm-pill"
                  class:active={timelineMetric === "territories"}
                  onclick={() => (timelineMetric = "territories")}
                >
                  Territórios
                </button>
                <button
                  type="button"
                  class="tm-pill"
                  class:active={timelineMetric === "armies"}
                  onclick={() => (timelineMetric = "armies")}
                >
                  Divisões
                </button>
                <button
                  type="button"
                  class="tm-pill"
                  class:active={timelineMetric === "economy"}
                  onclick={() => (timelineMetric = "economy")}
                >
                  Economia
                </button>
              </div>
            </div>

            <svg class="timeline-svg" viewBox="0 0 560 185" role="img" aria-label="Gráfico de evolução da partida">
              {#each [0, 0.25, 0.5, 0.75, 1] as step}
                {@const gy = 155 - step * 130}
                <line x1="36" y1={gy} x2="544" y2={gy} stroke="rgba(148,163,184,0.16)" stroke-dasharray="3,3" />
                <text x="6" y={gy + 4} fill="#64748b" font-size="9">
                  {Math.round(timelineMaxValue * step)}
                </text>
              {/each}

              {#each game.players as p}
                {@const points = timelineSnapshots
                  .map((snap, idx) => {
                    const x =
                      timelineSnapshots.length <= 1
                        ? 290
                        : 40 + (idx / (timelineSnapshots.length - 1)) * 500;
                    const val = getSnapshotMetricValue(snap, p.id, timelineMetric);
                    const y = 155 - (val / Math.max(1, timelineMaxValue)) * 130;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(" ")}
                <polyline
                  fill="none"
                  stroke={FACTION_STROKE_COLORS[p.color] ?? "#94a3b8"}
                  stroke-width={p.id === game.winnerId ? "3" : "2"}
                  stroke-linejoin="round"
                  points={points}
                />
                {#each timelineSnapshots as snap, idx}
                  {@const cx =
                    timelineSnapshots.length <= 1
                      ? 290
                      : 40 + (idx / (timelineSnapshots.length - 1)) * 500}
                  {@const ptVal = getSnapshotMetricValue(snap, p.id, timelineMetric)}
                  {@const cy =
                    155 - (ptVal / Math.max(1, timelineMaxValue)) * 130}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={p.id === game.winnerId ? "3.5" : "2.5"}
                    fill={FACTION_STROKE_COLORS[p.color] ?? "#94a3b8"}
                  >
                    <title>R{snap.round} • {p.name}: {ptVal}</title>
                  </circle>
                {/each}
              {/each}

              {#each timelineSnapshots as snap, idx}
                {#if timelineSnapshots.length <= 12 || idx % Math.ceil(timelineSnapshots.length / 10) === 0 || idx === timelineSnapshots.length - 1}
                  {@const tx =
                    timelineSnapshots.length <= 1
                      ? 290
                      : 40 + (idx / (timelineSnapshots.length - 1)) * 500}
                  <text x={tx} y="175" text-anchor="middle" fill="#94a3b8" font-size="9">
                    R{snap.round}
                  </text>
                {/if}
              {/each}
            </svg>

            <div class="timeline-legend">
              {#each game.players as p}
                <span class="tl-legend-item">
                  <span class="tl-swatch" style="background: {FACTION_STROKE_COLORS[p.color]};"></span>
                  <span>{p.name}</span>
                </span>
              {/each}
            </div>
          </div>
        {:else if activeTab === "awards"}
          <div class="awards-aar-grid">
            {#each matchAwards as award}
              <div class="award-card">
                <div class="award-head">
                  <Icon name="crown" size={16} />
                  <strong>{award.title}</strong>
                </div>
                <small class="award-sub">{award.subtitle}</small>
                <div class="award-winner-row">
                  <FactionFlag color={award.player.color} width={22} height={14} />
                  <span>{award.player.name}</span>
                </div>
                <strong class="award-stat">{award.stat}</strong>
              </div>
            {/each}
          </div>
        {/if}

        <div class="crypto-audit-box">
          <div>
            <span>{t("victory_seed_commit")}</span>
            <code>{game.seedCommitHash}</code>
          </div>
          {#if game.revealedSeed}
            <div>
              <span>{t("victory_seed_revealed")}</span>
              <code>{game.revealedSeed}</code>
            </div>
          {/if}
        </div>

        <div class="victory-footer-actions">
          <button class="outline-button" onclick={() => { sound.playClick(); minimized = true; }}>
            <Icon name="globe" size={15} /> {t("victory_btn_inspect_map")}
          </button>
          {#if amIHost && onReturnRoomToLobby}
            <button class="outline-button" onclick={() => { sound.playClick(); onReturnRoomToLobby(); }}>
              <Icon name="users" size={15} /> {t("victory_btn_reset_briefing")}
            </button>
          {/if}
          <button class="gold-button" onclick={() => { sound.playClick(); onReturnToLobby(); }}>
            <Icon name="shield" size={15} /> {t("victory_btn_return_hq")}
          </button>
        </div>
      </div>
    </article>
  </div>
{/if}

<style>
  .victory-backdrop {
    position: fixed;
    inset: 0;
    z-index: 95;
    background: rgba(3, 6, 13, 0.82);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    padding: 20px;
    pointer-events: auto;
  }

  .victory-dossier-modal {
    width: min(100%, 660px);
    background: linear-gradient(165deg, #111c32 0%, #070c16 100%);
    border: 1px solid rgba(234, 179, 8, 0.65);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 32px 90px rgba(0, 0, 0, 0.95), 0 0 40px rgba(234, 179, 8, 0.18);
  }

  .victory-hero-banner {
    position: relative;
    height: 165px;
    overflow: hidden;
    border-bottom: 1px solid rgba(234, 179, 8, 0.45);
  }
  .victory-banner-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: brightness(0.85);
  }
  .victory-banner-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(6, 10, 19, 0.25) 0%, rgba(7, 12, 22, 0.96) 100%);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding: 18px;
    text-align: center;
  }
  .victory-kicker {
    font-family: var(--font-tactical);
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.24em;
    color: #fde047;
    margin-bottom: 4px;
  }
  .victory-banner-overlay h2 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #ffffff;
    text-shadow: 0 4px 20px rgba(234, 179, 8, 0.55);
  }

  .victory-body {
    padding: 22px 26px 26px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .winner-showcase {
    display: flex;
    align-items: center;
    gap: 14px;
    background: linear-gradient(90deg, rgba(202, 138, 4, 0.2), rgba(15, 23, 42, 0.8));
    border: 1px solid rgba(234, 179, 8, 0.5);
    padding: 12px 16px;
    border-radius: 6px;
  }
  .winner-meta {
    display: flex;
    flex-direction: column;
  }
  .winner-faction {
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #fde047;
  }
  .winner-meta h3 {
    font-family: var(--font-display);
    font-size: 1.3rem;
    color: #f8fafc;
  }
  .winner-round-badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    font-weight: 800;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(234, 179, 8, 0.4);
    color: #fef08a;
    padding: 5px 10px;
    border-radius: 4px;
  }

  .fulfilled-directive {
    background: rgba(6, 11, 21, 0.85);
    border-left: 3px solid #eab308;
    padding: 12px 14px;
    border-radius: 4px;
  }
  .directive-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-tactical);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #eab308;
    margin-bottom: 4px;
  }
  .fulfilled-directive p {
    font-size: 0.88rem;
    color: #f1f5f9;
    line-height: 1.45;
  }

  .standings-section h4 {
    font-family: var(--font-tactical);
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #94a3b8;
    margin-bottom: 8px;
  }
  .standings-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .standing-row {
    display: grid;
    grid-template-columns: 32px auto 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(6, 11, 21, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .standing-row.winner-row {
    border-color: rgba(234, 179, 8, 0.5);
    background: rgba(202, 138, 4, 0.12);
  }
  .standing-pos {
    font-family: var(--font-mono);
    font-weight: 800;
    color: #eab308;
  }
  .standing-name {
    color: #f8fafc;
  }
  .standing-stat {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: #cbd5e1;
  }

  /* HEGEM-66: Profile XP & Progression Card */
  .xp-progression-section {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .xp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .xp-header-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #f8fafc;
  }
  .xp-header-title h4 {
    margin: 0;
    font-size: 0.88rem;
    font-family: var(--font-tactical);
    letter-spacing: 0.05em;
  }
  .mode-pill {
    font-size: 0.65rem;
    font-family: var(--font-tactical);
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .mode-pill.mode-custom {
    background: rgba(148, 163, 184, 0.2);
    color: #cbd5e1;
    border: 1px solid rgba(148, 163, 184, 0.35);
  }
  .mode-pill.mode-casual {
    background: rgba(56, 189, 248, 0.2);
    color: #7dd3fc;
    border: 1px solid rgba(56, 189, 248, 0.4);
  }
  .mode-pill.mode-ranked {
    background: rgba(234, 179, 8, 0.2);
    color: #fde047;
    border: 1px solid rgba(234, 179, 8, 0.45);
  }
  .xp-hierarchy-hint {
    font-size: 0.64rem;
    font-family: var(--font-mono);
    color: #64748b;
  }
  .xp-breakdown-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 6px 10px;
    background: rgba(8, 14, 26, 0.6);
    border-radius: 4px;
  }
  .xp-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
  }
  .xp-item-label {
    color: #94a3b8;
  }
  .xp-item-val {
    color: #f8fafc;
    font-weight: 700;
  }
  .xp-item.bonus .xp-item-val {
    color: #38bdf8;
  }
  .xp-item.total {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 800;
    color: #fde047;
  }
  .xp-bar-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .xp-bar-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.68rem;
    font-family: var(--font-tactical);
    font-weight: 700;
  }
  .current-lvl {
    color: #38bdf8;
  }
  .xp-numbers {
    color: #94a3b8;
    font-family: var(--font-mono);
    font-size: 0.65rem;
  }
  .next-lvl {
    color: #64748b;
  }
  .xp-track {
    width: 100%;
    height: 7px;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 3px;
    overflow: hidden;
  }
  .xp-fill {
    height: 100%;
    background: linear-gradient(90deg, #38bdf8, #eab308);
    transition: width 0.4s ease;
  }
  .xp-disclaimer {
    font-size: 0.62rem;
    color: #64748b;
    margin: 0;
    font-style: italic;
  }
  .xp-ineligible-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(15, 23, 42, 0.5);
    border: 1px dashed rgba(148, 163, 184, 0.3);
    border-radius: 4px;
    font-size: 0.72rem;
    color: #94a3b8;
  }

  .crypto-audit-box {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    background: rgba(4, 7, 14, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.16);
    padding: 10px 12px;
    border-radius: 5px;
    font-size: 0.68rem;
  }
  .crypto-audit-box span {
    display: block;
    color: #64748b;
    margin-bottom: 3px;
  }
  .crypto-audit-box code {
    font-family: var(--font-mono);
    color: #94a3b8;
    word-break: break-all;
  }

  .victory-footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 4px;
  }

  .victory-minimized-bar {
    pointer-events: auto;
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    background: linear-gradient(135deg, rgba(15, 24, 42, 0.96), rgba(8, 14, 26, 0.96));
    border: 1px solid #eab308;
    border-radius: 7px;
    padding: 10px 18px;
    display: flex;
    align-items: center;
    gap: 20px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.85);
  }
  .v-min-left {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #fef08a;
    font-family: var(--font-tactical);
    font-size: 0.88rem;
    letter-spacing: 0.06em;
  }
  .v-min-actions {
    display: flex;
    gap: 8px;
  }

  .victory-tabs {
    display: flex;
    gap: 6px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    padding-bottom: 8px;
  }
  .v-tab-btn {
    padding: 5px 12px;
    border-radius: 5px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(15, 23, 42, 0.72);
    color: #94a3b8;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
  }
  .v-tab-btn.active {
    border-color: #eab308;
    background: rgba(234, 179, 8, 0.16);
    color: #fef08a;
  }
  .timeline-aar-box {
    background: rgba(4, 9, 19, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 7px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .timeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .timeline-header h4 {
    margin: 0;
    font-size: 0.82rem;
    color: #f8fafc;
  }
  .timeline-metric-pills {
    display: flex;
    gap: 4px;
  }
  .tm-pill {
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.85);
    color: #cbd5e1;
    font-size: 0.66rem;
    font-weight: 700;
    cursor: pointer;
  }
  .tm-pill.active {
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.16);
    color: #bae6fd;
  }
  .timeline-svg {
    width: 100%;
    height: auto;
    background: rgba(7, 12, 23, 0.88);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 5px;
  }
  .timeline-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 0.68rem;
    color: #cbd5e1;
  }
  .tl-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .tl-swatch {
    width: 10px;
    height: 3px;
    border-radius: 2px;
  }
  .awards-aar-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .award-card {
    background: rgba(9, 15, 28, 0.85);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 7px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .award-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #fde047;
    font-size: 0.78rem;
  }
  .award-sub {
    font-size: 0.65rem;
    color: #94a3b8;
    line-height: 1.3;
  }
  .award-winner-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    color: #f8fafc;
    font-size: 0.76rem;
    font-weight: 700;
  }
  .award-stat {
    color: #6ee7b7;
    font-size: 0.72rem;
  }
  @media (max-width: 640px) {
    .awards-aar-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
