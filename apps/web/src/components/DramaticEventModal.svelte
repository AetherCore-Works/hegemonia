<script lang="ts">
  import type { DramaticEvent } from "@hegemonia/shared";
  import { i18n } from "../i18n/index.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    event: DramaticEvent | null;
    muted?: boolean;
    onDismiss: () => void;
    onToggleMute?: () => void;
    onFocusTerritory?: (territoryId: string) => void;
  }

  let {
    event,
    muted = false,
    onDismiss,
    onToggleMute,
    onFocusTerritory,
  }: Props = $props();

  const isEn = $derived(i18n.locale === "en");

  function handleKeydown(e: KeyboardEvent) {
    if (event && e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if event}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dramatic-event-backdrop" onclick={onDismiss}>
    <div
      class="dramatic-event-card tone-{event.tone}"
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? event.titleEn : event.titlePt}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="event-ribbon">
        <span class="event-round">ROUND {event.round} • DISPATCH</span>
        <div class="event-header-actions">
          {#if onToggleMute}
            <button
              type="button"
              class="event-icon-btn"
              onclick={onToggleMute}
              title={muted ? "Ativar som de eventos" : "Silenciar eventos"}
            >
              <Icon name={muted ? "close" : "bell"} size={13} />
              <span>{muted ? "Silenciado" : "Silenciar"}</span>
            </button>
          {/if}
          <button
            type="button"
            class="event-icon-btn"
            onclick={onDismiss}
            title="Fechar (ESC)"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <h2 class="event-title">{isEn ? event.titleEn : event.titlePt}</h2>
      <p class="event-subtitle">{isEn ? event.subtitleEn : event.subtitlePt}</p>
      <div class="event-divider"></div>
      <p class="event-body">{isEn ? event.bodyEn : event.bodyPt}</p>

      <div class="event-footer">
        {#if event.territoryId && onFocusTerritory}
          <button
            type="button"
            class="btn secondary"
            onclick={() => {
              onFocusTerritory(event.territoryId!);
              onDismiss();
            }}
          >
            <Icon name="target" size={14} />
            Localizar no Mapa
          </button>
        {/if}
        <button type="button" class="btn primary-gold" onclick={onDismiss}>
          Entendido (ESC)
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dramatic-event-backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(5, 8, 15, 0.62);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: evtFadeIn 0.18s ease-out;
  }

  .dramatic-event-card {
    width: min(520px, 96vw);
    background: linear-gradient(180deg, rgba(17, 23, 38, 0.98) 0%, rgba(10, 14, 24, 0.99) 100%);
    border: 2px solid #eab308;
    border-radius: 10px;
    padding: 18px 22px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.78), 0 0 32px rgba(234, 179, 8, 0.22);
    color: #f8fafc;
    animation: evtPopIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .dramatic-event-card.tone-crimson {
    border-color: #ef4444;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8), 0 0 36px rgba(239, 68, 68, 0.28);
  }

  .dramatic-event-card.tone-cyan {
    border-color: #38bdf8;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.78), 0 0 32px rgba(56, 189, 248, 0.24);
  }

  .dramatic-event-card.tone-amber {
    border-color: #f59e0b;
  }

  .event-ribbon {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .event-round {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: #eab308;
  }

  .tone-crimson .event-round {
    color: #f87171;
  }

  .tone-cyan .event-round {
    color: #38bdf8;
  }

  .event-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .event-icon-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .event-icon-btn:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  .event-title {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: #f8fafc;
  }

  .event-subtitle {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #cbd5e1;
  }

  .event-divider {
    height: 1px;
    margin: 12px 0;
    background: linear-gradient(90deg, rgba(234, 179, 8, 0.55), rgba(148, 163, 184, 0.1));
  }

  .tone-crimson .event-divider {
    background: linear-gradient(90deg, rgba(239, 68, 68, 0.6), rgba(148, 163, 184, 0.1));
  }

  .event-body {
    margin: 0 0 16px;
    font-size: 13.5px;
    line-height: 1.5;
    color: #e2e8f0;
  }

  .event-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  @keyframes evtFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes evtPopIn {
    from { opacity: 0; transform: scale(0.94) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
</style>
