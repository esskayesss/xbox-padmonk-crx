<script lang="ts">
	// Passive HUD dock — bottom-left. Shows the padmonk icon, ON/OFF state, and
	// the real toggle + help combos as key hints. Click-safe: stops pointer/mouse
	// events from reaching the page (legacy parity; P6 also checks composedPath).
	//
	// Colors come ONLY from theme tokens (text-pad-*, bg-pad-*) — no inline hex.
	import { comboLabel } from '../../core/combos';
	import { m } from '../../core/i18n';
	import type { Combo } from '../../core/types';
	import type { Locale } from '../../core/i18n';

	interface Props {
		iconUrl: string;
		locale: Locale;
		toggleCombo: Combo;
		helpCombo: Combo;
		enabled: boolean;
		inGame: boolean;
		/** False when one or more controller actions have no input bound. */
		bindsComplete: boolean;
	}
	let { iconUrl, locale, toggleCombo, helpCombo, enabled, inGame, bindsComplete }: Props = $props();

	// Second line of defense (see shadow.ts CLICK-SAFETY): swallow on the dock.
	const stop = (e: Event) => e.stopPropagation();
</script>

<div
	class="pad-hud-bg pointer-events-auto fixed bottom-3 left-3 flex min-w-56 pad-hud-shell select-none flex-col gap-1.5 overflow-hidden rounded-sm border p-1.5 backdrop-blur-md transition-opacity duration-200 hover:opacity-100"
	class:border-pad-accent={enabled}
	class:border-pad-border={!enabled}
	class:opacity-20={inGame}
	onpointerdowncapture={stop}
	onmousedowncapture={stop}
	onmouseupcapture={stop}
	onclickcapture={stop}
	role="status"
	aria-label="padmonk HUD"
>
	<div class="flex items-center gap-2">
		<div class="grid shrink-0 justify-items-center gap-0.5">
			<div
				class="pad-orb-hud grid size-10 place-items-center overflow-hidden rounded-sm p-1"
				class:opacity-60={!enabled}
			>
				{#if iconUrl}
					<img
						src={iconUrl}
						alt="padmonk"
						class="h-full w-full object-contain"
						class:grayscale={!enabled}
					/>
				{:else}
					<span class="text-pad-accent text-sm font-bold" aria-hidden="true">p</span>
				{/if}
			</div>
			<div
				class="text-2xs tracking-widest"
				class:text-pad-accent={enabled}
				class:text-pad-muted={!enabled}
			>
				{enabled ? m.hud_on({}, { locale }) : m.hud_off({}, { locale })}
			</div>
		</div>

		<div class="grid min-w-0 gap-0.5">
			<div class="flex items-center gap-1.5">
				<b class="text-pad-accent text-xs font-semibold">{comboLabel(toggleCombo, locale)}</b>
				<span class="text-pad-text min-w-0 flex-1 truncate text-xs"
					>{m.hud_toggle({}, { locale })}</span
				>
			</div>
			<div class="flex items-center gap-1.5">
				<b class="text-pad-accent text-xs font-semibold">{comboLabel(helpCombo, locale)}</b>
				<span class="text-pad-text min-w-0 flex-1 truncate text-xs"
					>{m.hud_binds({}, { locale })}</span
				>
			</div>
			<div class="flex items-center gap-1.5">
				<b class="text-pad-muted text-xs font-semibold">Esc</b>
				<span class="text-pad-muted min-w-0 flex-1 truncate text-xs">
					{enabled ? m.hud_release_lock({}, { locale }) : m.hud_click_lock({}, { locale })}
				</span>
			</div>
		</div>
	</div>

	{#if !bindsComplete}
		<div
			class="bg-pad-danger -mx-1.5 -mb-1.5 px-2 py-1 text-center text-2xs font-semibold tracking-widest text-pad-bg uppercase"
			role="alert"
		>
			{m.hud_unmapped({}, { locale })}
		</div>
	{/if}
</div>
