<script lang="ts">
  import {
    CLASSIC_MAP,
    GLOBAL_LAND_SVG_PATH,
    MAP_HEIGHT,
    MAP_WIDTH,
  } from "@hegemonia/maps";
  import type {
    DramaticEvent,
    DramaticEventKind,
    GameState,
    PlayerColor,
    RoundSnapshot,
  } from "@hegemonia/shared";
  import { i18n } from "../i18n/index.svelte";
  import type { IconName } from "../lib/icons";
  import FactionFlag from "./FactionFlag.svelte";
  import Icon from "./Icon.svelte";

  let { game }: { game: GameState } = $props();

  const FACTION_TERRITORY_COLORS: Record<PlayerColor, string> = {
    blue: "#2563eb",
    red: "#dc2626",
    green: "#059669",
    dark_green: "#15803d",
    yellow: "#ca8a04",
    orange: "#ea580c",
    pink: "#db2777",
    purple: "#9333ea",
    black: "#475569",
    white: "#e2e8f0",
  };

  interface TimelapseMarker {
    id: string;
    round: number;
    frameIndex: number;
    kind: DramaticEventKind | "victory";
    tone: "crimson" | "gold" | "cyan" | "amber";
    title: string;
    subtitle: string;
  }

  let frames = $derived.by<RoundSnapshot[]>(() => {
    const history = game.roundHistory ?? [];
    const withBorders = history.filter(
      (s) => s.territoryOwners && Object.keys(s.territoryOwners).length > 0
    );
    if (withBorders.length > 0) {
      return withBorders;
    }
    const territoryOwners: Record<string, string> = {};
    for (const t of Object.values(game.territories)) {
      territoryOwners[t.id] = t.ownerId;
    }
    const playersObj: RoundSnapshot["players"] = {};
    for (const p of game.players) {
      const owned = Object.values(game.territories).filter((t) => t.ownerId === p.id);
      const res = p.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      playersObj[p.id] = {
        territories: owned.length,
        armies: owned.reduce((acc, t) => acc + t.armies, 0),
        money: res.money,
        resourcesTotal: res.steel + res.oil + res.gold,
        combatsWon: p.analytics?.combatsWon ?? 0,
      };
    }
    return [
      {
        round: game.round,
        worldTension: game.worldTension ?? 0,
        players: playersObj,
        territoryOwners,
      },
    ];
  });

  let frameIndex = $state(0);
  let playing = $state(false);
  let speed = $state<1 | 2 | 4>(1);

  $effect(() => {
    if (frameIndex >= frames.length) {
      frameIndex = Math.max(0, frames.length - 1);
    }
  });

  $effect(() => {
    if (!playing || frames.length <= 1) return;
    const intervalMs = speed === 4 ? 220 : speed === 2 ? 450 : 900;
    const timer = window.setInterval(() => {
      if (frameIndex >= frames.length - 1) {
        playing = false;
        return;
      }
      frameIndex += 1;
    }, intervalMs);
    return () => window.clearInterval(timer);
  });

  function resolveFrameIndexForRound(round: number): number {
    if (frames.length <= 1) return 0;
    const exact = frames.findIndex((f) => f.round === round);
    if (exact >= 0) return exact;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].round <= round) return i;
    }
    return 0;
  }

  let timelineMarkers = $derived.by<TimelapseMarker[]>(() => {
    const isEn = i18n.locale === "en";
    const events: DramaticEvent[] = game.dramaticEvents ?? [];
    const list: TimelapseMarker[] = events.map((ev) => ({
      id: ev.id,
      round: ev.round,
      frameIndex: resolveFrameIndexForRound(ev.round),
      kind: ev.kind,
      tone: ev.tone,
      title: isEn ? ev.titleEn : ev.titlePt,
      subtitle: isEn ? ev.subtitleEn : ev.subtitlePt,
    }));

    if (game.winnerId && frames.length > 0) {
      const winner = game.players.find((p) => p.id === game.winnerId);
      const lastRound = frames[frames.length - 1].round;
      list.push({
        id: `victory_${lastRound}`,
        round: lastRound,
        frameIndex: frames.length - 1,
        kind: "victory",
        tone: "gold",
        title: isEn
          ? `Victory: ${winner?.name ?? ""}`
          : `Vitória: ${winner?.name ?? ""}`,
        subtitle: isEn
          ? `Campaign ended in Round ${lastRound}`
          : `Campanha encerrada na Rodada ${lastRound}`,
      });
    }

    return list;
  });

  let currentFrame = $derived(frames[frameIndex] ?? frames[0]);
  let playerById = $derived(new Map(game.players.map((p) => [p.id, p])));

  let frameEvents = $derived(
    timelineMarkers.filter((m) => m.frameIndex === frameIndex)
  );

  let rankedCounts = $derived.by(() => {
    const owners = currentFrame?.territoryOwners ?? {};
    const counts = new Map<string, number>();
    for (const ownerId of Object.values(owners)) {
      counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
    }
    const total = Math.max(1, Object.keys(owners).length || CLASSIC_MAP.territories.length);
    return game.players
      .map((p) => {
        const terrs = counts.get(p.id) ?? currentFrame?.players[p.id]?.territories ?? 0;
        return {
          player: p,
          terrs,
          pct: Math.round((terrs / total) * 100),
        };
      })
      .sort((a, b) => b.terrs - a.terrs);
  });

  function togglePlay() {
    if (frames.length <= 1) return;
    if (!playing && frameIndex >= frames.length - 1) {
      frameIndex = 0;
    }
    playing = !playing;
  }

  function jumpToFrame(idx: number) {
    playing = false;
    frameIndex = Math.max(0, Math.min(frames.length - 1, idx));
  }

  function getMarkerIcon(kind: TimelapseMarker["kind"]): IconName {
    switch (kind) {
      case "coalition_formed":
        return "swords";
      case "wonder_started":
      case "wonder_completed":
      case "wonder_destroyed":
        return "wonder";
      case "player_eliminated":
      case "extermination_first_kill":
        return "alert";
      case "naval_blockade":
        return "anchor";
      case "victory":
        return "crown";
    }
  }
</script>

<div class="timelapse-aar-box">
  <div class="tl-top-row">
    <div class="tl-title-group">
      <h4>
        {i18n.locale === "en"
          ? "Territorial Border Timelapse"
          : "Timelapse das Fronteiras por Rodada"}
      </h4>
      <span class="tl-round-badge">
        R{currentFrame?.round ?? 1} / R{frames[frames.length - 1]?.round ?? game.round}
      </span>
      <span class="tl-tension-badge">
        {i18n.locale === "en" ? "Tension" : "Tensão"}: {currentFrame?.worldTension ?? 0}%
      </span>
    </div>

    <div class="tl-speed-pills" role="group" aria-label="Playback speed">
      {#each [1, 2, 4] as sp}
        <button
          type="button"
          class="tl-speed-btn"
          class:active={speed === sp}
          onclick={() => (speed = sp as 1 | 2 | 4)}
        >
          {sp}x
        </button>
      {/each}
    </div>
  </div>

  <div class="tl-map-frame">
    <svg
      class="tl-world-svg"
      viewBox="0 0 {MAP_WIDTH} {MAP_HEIGHT}"
      role="img"
      aria-label="Timelapse de controle territorial"
    >
      <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#060d1b" />
      <path d={GLOBAL_LAND_SVG_PATH} fill="#0f172a" stroke="#1e293b" stroke-width="0.6" />

      {#each CLASSIC_MAP.territories as terr (terr.id)}
        {@const ownerId = currentFrame?.territoryOwners?.[terr.id]}
        {@const owner = ownerId ? playerById.get(ownerId) : undefined}
        {@const fillColor = owner
          ? (FACTION_TERRITORY_COLORS[owner.color] ?? "#64748b")
          : "#334155"}
        <path
          d={terr.svgPath}
          fill={fillColor}
          fill-opacity={owner ? 0.88 : 0.45}
          stroke="#090f1d"
          stroke-width="0.9"
          class="tl-terr-poly"
        >
          <title>{terr.namePt}: {owner?.name ?? "Neutro"}</title>
        </path>
      {/each}
    </svg>
  </div>

  <div class="tl-scrubber-panel">
    <div class="tl-transport-btns">
      <button
        type="button"
        class="tl-ctl-btn"
        title="Rodada 1"
        aria-label="Rodada 1"
        disabled={frames.length <= 1}
        onclick={() => jumpToFrame(0)}
      >
        <Icon name="reset" size={13} />
      </button>
      <button
        type="button"
        class="tl-ctl-btn"
        title="Rodada anterior"
        aria-label="Rodada anterior"
        disabled={frameIndex <= 0}
        onclick={() => jumpToFrame(frameIndex - 1)}
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <button
        type="button"
        class="tl-play-btn"
        disabled={frames.length <= 1}
        onclick={togglePlay}
      >
        <Icon name={playing ? "clock" : "arrow-right"} size={13} />
        <span>
          {playing
            ? i18n.locale === "en" ? "Pause" : "Pausar"
            : i18n.locale === "en" ? "Play" : "Reproduzir"}
        </span>
      </button>
      <button
        type="button"
        class="tl-ctl-btn"
        title="Próxima rodada"
        aria-label="Próxima rodada"
        disabled={frameIndex >= frames.length - 1}
        onclick={() => jumpToFrame(frameIndex + 1)}
      >
        <Icon name="chevron-right" size={14} />
      </button>
    </div>

    <div class="tl-slider-wrap">
      <input
        type="range"
        min="0"
        max={Math.max(0, frames.length - 1)}
        value={frameIndex}
        disabled={frames.length <= 1}
        oninput={(e) => jumpToFrame(Number((e.currentTarget as HTMLInputElement).value))}
        class="tl-range-input"
      />
      {#if frames.length > 1 && timelineMarkers.length > 0}
        <div class="tl-markers-track">
          {#each timelineMarkers as marker (marker.id)}
            {@const pct = (marker.frameIndex / Math.max(1, frames.length - 1)) * 100}
            <button
              type="button"
              class="tl-marker-pin tone-{marker.tone}"
              class:is-current={marker.frameIndex === frameIndex}
              style="left: {pct}%;"
              title={`R${marker.round} · ${marker.title} (${marker.subtitle})`}
              onclick={() => jumpToFrame(marker.frameIndex)}
            >
              <Icon name={getMarkerIcon(marker.kind)} size={11} />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if frameEvents.length > 0}
    <div class="tl-events-strip">
      {#each frameEvents as ev (ev.id)}
        <div class="tl-event-chip tone-{ev.tone}">
          <Icon name={getMarkerIcon(ev.kind)} size={12} />
          <strong>R{ev.round}: {ev.title}</strong>
          <small>{ev.subtitle}</small>
        </div>
      {/each}
    </div>
  {:else if timelineMarkers.length > 0}
    <div class="tl-events-hint">
      <Icon name="globe" size={12} />
      <span>
        {i18n.locale === "en"
          ? "Click any marker pin on the timeline to jump to coalitions, wonders, or eliminations."
          : "Clique nos marcadores da barra para saltar direto para coalizões, Maravilha ou eliminações."}
      </span>
    </div>
  {/if}

  <div class="tl-balance-bars">
    {#each rankedCounts as row (row.player.id)}
      <div class="tl-faction-stat" class:is-eliminated={row.terrs === 0}>
        <div class="tl-faction-head">
          <FactionFlag color={row.player.color} width={16} height={10} />
          <span class="tl-fname">{row.player.name}</span>
          <span class="tl-fcount">{row.terrs} ({row.pct}%)</span>
        </div>
        <div class="tl-bar-bg">
          <div
            class="tl-bar-fill"
            style="width: {row.pct}%; background: {FACTION_TERRITORY_COLORS[row.player.color] ?? '#64748b'};"
          ></div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .timelapse-aar-box {
    background: rgba(4, 9, 19, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 7px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tl-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tl-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tl-title-group h4 {
    margin: 0;
    font-size: 0.84rem;
    color: #f8fafc;
  }
  .tl-round-badge,
  .tl-tension-badge {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.14);
    border: 1px solid rgba(56, 189, 248, 0.35);
    color: #bae6fd;
  }
  .tl-tension-badge {
    background: rgba(245, 158, 11, 0.14);
    border-color: rgba(245, 158, 11, 0.35);
    color: #fde68a;
  }
  .tl-speed-pills {
    display: flex;
    gap: 4px;
  }
  .tl-speed-btn {
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.85);
    color: #cbd5e1;
    font-size: 0.68rem;
    font-weight: 700;
    cursor: pointer;
  }
  .tl-speed-btn.active {
    border-color: #eab308;
    background: rgba(234, 179, 8, 0.18);
    color: #fde047;
  }
  .tl-map-frame {
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(56, 189, 248, 0.25);
    background: #060d1b;
  }
  .tl-world-svg {
    display: block;
    width: 100%;
    height: auto;
    max-height: 280px;
  }
  .tl-terr-poly {
    transition: fill 200ms ease, fill-opacity 200ms ease;
  }
  .tl-scrubber-panel {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tl-transport-btns {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tl-ctl-btn,
  .tl-play-btn {
    padding: 5px 9px;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(15, 23, 42, 0.9);
    color: #f8fafc;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
  }
  .tl-play-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    background: linear-gradient(180deg, rgba(234, 179, 8, 0.28), rgba(202, 138, 4, 0.22));
    border-color: rgba(234, 179, 8, 0.55);
    color: #fef08a;
    min-width: 96px;
  }
  .tl-ctl-btn:disabled,
  .tl-play-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .tl-slider-wrap {
    flex: 1;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tl-range-input {
    width: 100%;
    accent-color: #eab308;
    cursor: pointer;
  }
  .tl-markers-track {
    position: relative;
    height: 18px;
    margin: 0 6px;
  }
  .tl-marker-pin {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.45);
    background: rgba(15, 23, 42, 0.95);
    color: #f8fafc;
    font-size: 0.62rem;
    line-height: 1;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .tl-marker-pin.tone-gold {
    border-color: #eab308;
    color: #fde047;
  }
  .tl-marker-pin.tone-crimson {
    border-color: #ef4444;
    color: #fca5a5;
  }
  .tl-marker-pin.tone-amber {
    border-color: #f59e0b;
    color: #fcd34d;
  }
  .tl-marker-pin.is-current {
    transform: translateX(-50%) scale(1.18);
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.65);
  }
  .tl-events-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tl-event-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.68rem;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #e2e8f0;
  }
  .tl-event-chip.tone-gold {
    border-color: rgba(234, 179, 8, 0.55);
    color: #fef08a;
  }
  .tl-event-chip.tone-crimson {
    border-color: rgba(239, 68, 68, 0.55);
    color: #fecaca;
  }
  .tl-event-chip.tone-amber {
    border-color: rgba(245, 158, 11, 0.55);
    color: #fde68a;
  }
  .tl-event-chip small {
    color: #94a3b8;
    font-size: 0.64rem;
  }
  .tl-events-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.66rem;
    color: #94a3b8;
  }
  .tl-balance-bars {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
    gap: 6px;
  }
  .tl-faction-stat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 5px 7px;
    border-radius: 4px;
    background: rgba(8, 14, 26, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.14);
  }
  .tl-faction-stat.is-eliminated {
    opacity: 0.45;
  }
  .tl-faction-head {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.66rem;
    color: #e2e8f0;
  }
  .tl-fname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }
  .tl-fcount {
    font-family: var(--font-mono);
    color: #94a3b8;
    font-size: 0.62rem;
  }
  .tl-bar-bg {
    height: 4px;
    border-radius: 2px;
    background: rgba(30, 41, 59, 0.85);
    overflow: hidden;
  }
  .tl-bar-fill {
    height: 100%;
    transition: width 200ms ease;
  }
</style>
