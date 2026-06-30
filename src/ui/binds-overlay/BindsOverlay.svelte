<script lang="ts">
	// Keybind overlay — legacy-fidelity 3-column layout:
	//   header (brand orb + title/subtitle + Toggle/Close legends + × close)
	//   body:
	//     LEFT rail  "Left side"  — LT/LB/Left stick/L3/D-pad rows
	//     CENTER     pad-map      — recolored Xbox controller art (controllerUrl)
	//                              + absolute system-chip row (View/Guide/Menu)
	//                              + aim bar below
	//     RIGHT rail "Right side" — RT/RB/Right stick(info)/R3/A/B/X/Y rows
	//
	// Each rail row shows: bind-icon + label + currently-bound input(s) resolved
	// from `bindings` (prettyInput join " / ", else "UNMAPPED"). The right-stick
	// row is a static INFO row ("Mouse move"). System chips show label + binding.
	//
	// Row labels are i18n message keys, resolved against the active `locale`
	// prop (delivered from inject.ts via config.locale).
	//
	// Colors come from theme tokens (text-pad-*/bg-pad-*); gradients, glows,
	// aspect-ratio, and absolute positioning use inline var(--color-pad-*)/rgba
	// matched to the legacy CSS — no raw hex.
	import { prettyInput } from '../../core/labels';
	import { comboLabel } from '../../core/combos';
	import { actionEq, allBindsConfigured } from '../../core/controller-actions';
	import { m, t } from '../../core/i18n';
	import ProfileSelect from './ProfileSelect.svelte';
	import type { Action, Bindings, Combo } from '../../core/types';
	import type { Locale, MessageKey } from '../../core/i18n';

	interface Props {
		open: boolean;
		locale: Locale;
		bindings: Bindings;
		bindIconBase: string;
		controllerUrl: string;
		iconUrl: string;
		enabled: boolean;
		toggleCombo: Combo;
		helpCombo: Combo;
		onClose: () => void;
		onConfigure: () => void;
		// --- Bind Profiles (header dropselect + save-as-default) -----------------
		profiles: { id: string; name: string }[];
		activeProfileId: string;
		gameName: string | null;
		contextDefaultProfileId: string;
		onSelectProfile: (id: string) => void;
		onSaveAsDefault: () => void;
	}
	let {
		open,
		locale,
		bindings,
		bindIconBase,
		controllerUrl,
		iconUrl,
		enabled,
		toggleCombo,
		helpCombo,
		onClose,
		onConfigure,
		profiles,
		activeProfileId,
		gameName,
		contextDefaultProfileId,
		onSelectProfile,
		onSaveAsDefault,
	}: Props = $props();

	/** A rail/system row: either a bound action or a static INFO value. */
	type Row = {
		icon: string;
		labelKey: MessageKey;
		action?: Action;
		valueKey?: MessageKey;
		dpad?: boolean;
	};

	const leftRows: Row[] = [
		{ icon: 'left-trigger.svg', labelKey: 'action_btn_lt', action: { t: 'b', i: 6 } },
		{ icon: 'left-bumper.svg', labelKey: 'action_btn_lb', action: { t: 'b', i: 4 } },
		{
			icon: 'left-stick.svg',
			labelKey: 'overlay_left_stick',
			valueKey: 'overlay_left_stick_value',
		},
		{ icon: 'left-stick-press.svg', labelKey: 'overlay_l3', action: { t: 'b', i: 10 } },
		{ icon: 'dpad-up.svg', labelKey: 'overlay_dpad_up', action: { t: 'b', i: 12 }, dpad: true },
		{ icon: 'dpad-down.svg', labelKey: 'overlay_dpad_down', action: { t: 'b', i: 13 }, dpad: true },
		{ icon: 'dpad-left.svg', labelKey: 'overlay_dpad_left', action: { t: 'b', i: 14 }, dpad: true },
		{
			icon: 'dpad-right.svg',
			labelKey: 'overlay_dpad_right',
			action: { t: 'b', i: 15 },
			dpad: true,
		},
	];

	const rightRows: Row[] = [
		{ icon: 'right-trigger.svg', labelKey: 'action_btn_rt', action: { t: 'b', i: 7 } },
		{ icon: 'right-bumper.svg', labelKey: 'action_btn_rb', action: { t: 'b', i: 5 } },
		{
			icon: 'right-stick.svg',
			labelKey: 'overlay_right_stick',
			valueKey: 'overlay_right_stick_value',
		},
		{ icon: 'right-stick-press.svg', labelKey: 'overlay_r3', action: { t: 'b', i: 11 } },
		{ icon: 'a.svg', labelKey: 'action_btn_a', action: { t: 'b', i: 0 } },
		{ icon: 'b.svg', labelKey: 'action_btn_b', action: { t: 'b', i: 1 } },
		{ icon: 'x.svg', labelKey: 'action_btn_x', action: { t: 'b', i: 2 } },
		{ icon: 'y.svg', labelKey: 'action_btn_y', action: { t: 'b', i: 3 } },
	];

	// System buttons docked at the bottom of the center controller card.
	const systemChips: Row[] = [
		{ icon: 'view.svg', labelKey: 'overlay_view', action: { t: 'b', i: 8 } },
		{ icon: 'guide.svg', labelKey: 'overlay_guide', action: { t: 'b', i: 16 } },
		{ icon: 'menu.svg', labelKey: 'overlay_menu', action: { t: 'b', i: 9 } },
	];

	/** Action equality — button by index, axis by (axis, direction). */
	function inputIdsFor(action: Action): string[] {
		return Object.keys(bindings).filter((id) => actionEq(bindings[id]!, action));
	}

	// Second line of defense (see shadow.ts CLICK-SAFETY): swallow on the panel.
	const stop = (e: Event) => e.stopPropagation();

	// Warn when one or more controller actions have no input bound.
	const bindsComplete = $derived(allBindsConfigured(bindings));

	// Save-as-default only surfaces when the active profile differs from the
	// context's current default (game default off a game → global default).
	const showSaveDefault = $derived(activeProfileId !== contextDefaultProfileId);
	const saveDefaultLabel = $derived(
		gameName != null
			? m.overlay_save_default_game({ game: gameName }, { locale })
			: m.overlay_save_default_global({}, { locale }),
	);
</script>

{#snippet bindEditor(row: Row, compact = false)}
	{#if row.action}
		{@const ids = inputIdsFor(row.action)}
		{#if ids.length}
			<div class="flex flex-wrap items-center gap-1">
				{#each ids as id (id)}
					<span
						class="bg-pad-chip border-pad-border inline-flex max-w-full items-center rounded-sm border px-1.5 py-0.5"
					>
						<span class="text-pad-key truncate font-semibold {compact ? 'text-2xs' : 'text-xs'}"
							>{prettyInput(id, locale)}</span
						>
					</span>
				{/each}
			</div>
		{:else}
			<span class="text-pad-muted mt-1 block {compact ? 'text-2xs' : 'text-xs'} tracking-wide"
				>{m.overlay_unmapped({}, { locale })}</span
			>
		{/if}
	{:else}
		<span class="text-pad-text block truncate {compact ? 'text-xs' : 'text-sm'} leading-tight">
			{row.valueKey ? t(row.valueKey, locale) : m.overlay_unmapped({}, { locale })}
		</span>
	{/if}
{/snippet}

{#if open}
	<!-- Backdrop: pointer-events on (host is click-through); click closes. -->
	<div
		class="pad-backdrop pointer-events-auto fixed inset-0 grid place-items-center p-4"
		onpointerdowncapture={stop}
		onmousedowncapture={stop}
		onmouseupcapture={stop}
		onwheel={(e) => {
			e.preventDefault();
			e.stopPropagation();
		}}
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
		role="presentation"
	>
		<!-- Panel -->
		<div
			class="text-pad-text pad-panel-bg pad-binds-panel border-pad-accent/40 select-none overflow-auto rounded-lg border p-5"
			onpointerdowncapture={stop}
			onmousedowncapture={stop}
			onmouseupcapture={stop}
			role="dialog"
			aria-modal="true"
			aria-label={m.overlay_title({}, { locale })}
			tabindex="-1"
		>
			{#if !bindsComplete}
				<div
					class="bg-pad-danger text-pad-bg -mx-5 -mt-5 mb-4 px-5 py-2 text-center text-sm font-semibold tracking-wide uppercase"
					role="alert"
				>
					{m.overlay_unmapped_banner({}, { locale })}
				</div>
			{/if}
			<!-- Header: brand orb + title/subtitle | shortcut legends -->
			<div
				class="mb-4 flex items-center justify-between gap-4 max-binds:flex-col max-binds:items-start"
			>
				<div class="flex items-center gap-3.5">
					<!-- Brand orb (green gradient; dim+grayscale when disabled) -->
					<span class="pad-orb grid size-12 place-items-center overflow-hidden rounded-sm">
						{#if iconUrl}
							<img
								src={iconUrl}
								alt="padmonk"
								class="pad-icon-glow block size-9 object-contain"
								class:grayscale={!enabled}
								class:opacity-60={!enabled}
							/>
						{:else}
							<span class="text-pad-accent text-lg font-bold" aria-hidden="true">p</span>
						{/if}
					</span>
					<div>
						<div class="text-2xl tracking-wide uppercase">{m.overlay_title({}, { locale })}</div>
						<div
							class="mt-0.5 text-sm uppercase"
							class:text-pad-accent={enabled}
							class:text-pad-muted={!enabled}
						>
							{enabled ? m.overlay_online({}, { locale }) : m.overlay_disabled({}, { locale })}
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2.5 max-binds:flex-1 max-binds:flex-wrap">
					<ProfileSelect {profiles} {activeProfileId} {locale} onSelect={onSelectProfile} />
					{#if showSaveDefault}
						<button
							type="button"
							class="pad-surface text-pad-text hover:bg-pad-key/10 grid size-9 shrink-0 cursor-pointer place-items-center rounded-sm border text-base leading-none"
							aria-label={saveDefaultLabel}
							title={saveDefaultLabel}
							onpointerdown={stop}
							onmousedown={stop}
							onclick={(e) => {
								e.stopPropagation();
								onSaveAsDefault();
							}}
						>
							<span class="text-pad-accent" aria-hidden="true">★</span>
						</button>
					{/if}
					<span class="text-pad-muted text-xs whitespace-nowrap max-binds:whitespace-normal">
						{m.overlay_shortcut_hint(
							{ toggle: comboLabel(toggleCombo, locale), close: comboLabel(helpCombo, locale) },
							{ locale },
						)}
					</span>
					<button
						type="button"
						class="bg-pad-white text-pad-ink hover:bg-pad-key flex cursor-pointer flex-col items-start rounded-sm px-3 py-2"
						onclick={onConfigure}
					>
						<span class="text-sm">{m.overlay_configure({}, { locale })}</span>
						<span class="mt-1 text-lg leading-none" aria-hidden="true">↗</span>
					</button>
				</div>
			</div>

			<!-- Body: 3 columns (rails + center pad-map); stacks under 900px -->
			<div class="grid grid-cols-binds items-stretch gap-4 max-binds:grid-cols-1">
				<!-- LEFT rail -->
				<div class="grid content-start gap-2 max-binds:grid-cols-2">
					<div
						class="text-pad-accent mb-0.5 text-xs tracking-widest uppercase max-binds:col-span-full"
					>
						{m.overlay_left_side({}, { locale })}
					</div>
					{#each leftRows as row (row.labelKey)}
						<div class="pad-surface flex min-h-11 items-center gap-2 rounded-sm border px-2 py-2">
							<div class="grid size-9 shrink-0 place-items-center">
								{#if bindIconBase}
									<img
										src={bindIconBase + row.icon}
										alt={t(row.labelKey, locale)}
										class="pad-icon-glow max-h-7 max-w-7 object-contain"
									/>
								{:else}
									<span class="text-pad-muted text-xs" aria-hidden="true">•</span>
								{/if}
							</div>
							<div class="min-w-0">
								<span class="text-pad-muted block text-2xs tracking-widest uppercase">
									{t(row.labelKey, locale)}
								</span>
								{@render bindEditor(row)}
							</div>
						</div>
					{/each}
				</div>

				<!-- CENTER: controller art on top; system buttons + aim bar docked bottom -->
				<div
					class="pad-card-bg border-pad-hairline flex min-w-0 flex-col rounded-md border p-3 max-binds:order-first"
				>
					<div
						class="pad-padmap-bg relative aspect-controller w-full overflow-visible rounded-md"
						aria-label={m.overlay_controller_aria({}, { locale })}
					>
						{#if controllerUrl}
							<img
								src={controllerUrl}
								alt={m.overlay_controller_aria({}, { locale })}
								class="pad-art-glow absolute inset-0 h-full w-full object-contain"
							/>
						{/if}
					</div>

					<!-- Docked at the bottom of the card: system buttons + aim bar -->
					<div class="mt-auto grid gap-2.5 pt-3">
						<!-- View / Guide / Menu strip -->
						<div
							class="pad-strip-bg border-pad-accent/20 flex justify-center gap-2 rounded-md border p-2 backdrop-blur-sm"
						>
							{#each systemChips as chip (chip.labelKey)}
								<div
									class="pad-surface flex w-full min-w-24 items-center gap-1 rounded-sm border px-2 py-1.5"
								>
									{#if bindIconBase}
										<img
											src={bindIconBase + chip.icon}
											alt={t(chip.labelKey, locale)}
											class="pad-icon-glow size-8 shrink-0 object-contain"
										/>
									{:else}
										<span class="text-pad-muted text-xs" aria-hidden="true">•</span>
									{/if}
									<div class="min-w-0">
										<span class="text-pad-muted block text-2xs tracking-widest uppercase">
											{t(chip.labelKey, locale)}
										</span>
										{@render bindEditor(chip, true)}
									</div>
								</div>
							{/each}
						</div>

						<!-- Aim bar -->
						<div
							class="pad-aim-bg border-pad-accent/20 flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5"
						>
							<span class="text-pad-accent text-xs uppercase"
								>{m.overlay_aim_title({}, { locale })}</span
							>
							<span class="text-pad-text text-right text-sm"
								>{m.overlay_aim_desc({}, { locale })}</span
							>
						</div>
					</div>
				</div>

				<!-- RIGHT rail -->
				<div class="grid content-start gap-2 max-binds:grid-cols-2">
					<div
						class="text-pad-accent mb-0.5 text-right text-xs tracking-widest uppercase max-binds:col-span-full"
					>
						{m.overlay_right_side({}, { locale })}
					</div>
					{#each rightRows as row (row.labelKey)}
						<div class="pad-surface flex min-h-11 items-center gap-2 rounded-sm border px-2 py-2">
							<div class="grid size-9 shrink-0 place-items-center">
								{#if bindIconBase}
									<img
										src={bindIconBase + row.icon}
										alt={t(row.labelKey, locale)}
										class="pad-icon-glow max-h-7 max-w-7 object-contain"
									/>
								{:else}
									<span class="text-pad-muted text-xs" aria-hidden="true">•</span>
								{/if}
							</div>
							<div class="min-w-0">
								<span class="text-pad-muted block text-2xs tracking-widest uppercase">
									{t(row.labelKey, locale)}
								</span>
								{@render bindEditor(row)}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}
