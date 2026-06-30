<script lang="ts">
	// Full remapping UI, driven by the controller-actions registry.
	//
	// Sections, labels and the mouse-driven "Aim — Right Stick" info group all
	// come from groupsForOptions(); chips are rendered from the live bindings via
	// prettyInput. Capture flow ports the legacy startCapture/commitCapture, minus
	// the dead commitCapture toggle branch (toggle/help are combos only).
	//
	// Persistence flows through the profiles store. Behavior-equivalent to the
	// legacy config path: the display Config is PROJECTED from the active profile
	// (resolved to the global default for now — staged saves + per-profile UI are
	// Phase 7), and save() splits it back into globals + the active profile.
	import { onMount } from 'svelte';
	import {
		AIM_CONTROLS,
		aimConfigValue,
		aimDisplayFill,
		aimDisplayValue,
	} from '../core/aim-settings';
	import { actionEq, groupsForOptions, allBindsConfigured } from '../core/controller-actions';
	import { DEFAULT_CONFIG, normalizeConfig } from '../core/config';
	import { configToProfile, profileToConfig } from '../core/profile';
	import {
		normalizeProfilesState,
		projectProfileConfig,
		resolveProfileId,
		type ProfilesState,
	} from '../core/profiles';
	import { comboFromEvent, comboLabel } from '../core/combos';
	import { prettyInput } from '../core/labels';
	import { m, t as translate, locales, localeName } from '../core/i18n';
	import {
		onProfilesChanged,
		readProfilesState,
		writeProfilesState,
	} from '../shared/profiles-storage';
	import type { Action, Config } from '../core/types';
	import type { Locale } from '../core/i18n';

	const GITHUB_SPONSORS_URL =
		'https://redirects.esskayesss.dev/sponsor-github?utm_source=padmonk-ext&utm_medium=options&utm_campaign=support';
	const BUY_ME_COFFEE_URL =
		'https://redirects.esskayesss.dev/sponsor-coffee?utm_source=padmonk-ext&utm_medium=options&utm_campaign=support';
	const GITHUB_REPO_URL =
		'https://redirects.esskayesss.dev/padmonk-repo?utm_source=padmonk-ext&utm_medium=options&utm_campaign=repo';
	const BUG_REPORT_URL =
		'https://redirects.esskayesss.dev/padmonk-issues?utm_source=padmonk-ext&utm_medium=options&utm_campaign=bug-report';
	const WEBSITE_URL =
		'https://redirects.esskayesss.dev/padmonk-web?utm_source=padmonk-ext&utm_medium=options&utm_campaign=docs';

	// Per-aim-control long-form copy (options page) as i18n message keys.
	const OPT_AIM_COPY = {
		sensitivity: { label: 'opt_aim_sensitivity_label', desc: 'opt_aim_sensitivity_desc' },
		smoothing: { label: 'opt_aim_smoothing_label', desc: 'opt_aim_smoothing_desc' },
		aimMin: { label: 'opt_aim_deadzone_label', desc: 'opt_aim_deadzone_desc' },
		aimCurve: { label: 'opt_aim_curve_label', desc: 'opt_aim_curve_desc' },
	} satisfies Record<(typeof AIM_CONTROLS)[number]['key'], { label: string; desc: string }>;

	/** Resolve a bind-icon asset URL for the options (extension) page. */
	function iconUrl(icon: string): string {
		try {
			return chrome.runtime?.getURL?.(`assets/bind-icons/${icon}`) ?? '';
		} catch {
			return '';
		}
	}

	let config = $state<Config>(structuredClone(DEFAULT_CONFIG));
	// Latest durable state + the profile this page edits (global default for now).
	let pstate: ProfilesState = normalizeProfilesState(undefined);
	let activeProfileId = '';

	// Options sections, resolved to the active locale (recomputes on language change).
	const groups = $derived(groupsForOptions(config.locale));

	// Capture state: which row (binding) or combo button is awaiting input.
	type Capturing =
		| { kind: 'binding'; action: Action; id: string }
		| { kind: 'toggle' | 'help' }
		| null;
	let capturing = $state<Capturing>(null);

	let jsonText = $state('');
	let saved = $state(false);
	let conflictNotice = $state<string | null>(null);

	const toggleLabel = $derived(comboLabel(config.toggleCombo, config.locale));
	const helpLabel = $derived(comboLabel(config.helpCombo, config.locale));
	const bindsComplete = $derived(allBindsConfigured(config.bindings));

	let savedTimer: ReturnType<typeof setTimeout> | null = null;
	let saveQueueTimer: ReturnType<typeof setTimeout> | null = null;
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;
	let fileInput: HTMLInputElement;

	/** Input ids currently bound to a given action. */
	function inputsFor(action: Action): string[] {
		return Object.keys(config.bindings).filter((id) => actionEq(config.bindings[id], action));
	}

	/** Friendly label of whatever control an input id is currently bound to. */
	function controlLabelFor(action: Action): string {
		for (const g of groups) {
			for (const item of g.items) {
				if (actionEq(action, item.action)) return `${g.title} · ${item.label}`;
			}
		}
		return m.opt_control_fallback({}, { locale: config.locale });
	}

	function flashSaved(): void {
		saved = true;
		if (savedTimer) clearTimeout(savedTimer);
		savedTimer = setTimeout(() => (saved = false), 900);
	}

	function showConflict(msg: string): void {
		conflictNotice = msg;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (conflictNotice = null), 4000);
	}

	function save(): void {
		const snap = $state.snapshot(config);
		const id = activeProfileId || resolveProfileId(pstate, null, null);
		activeProfileId = id;
		const now = Date.now();
		const next: ProfilesState = {
			...pstate,
			globals: {
				...pstate.globals,
				enabled: snap.enabled,
				locale: snap.locale,
				toggleCombo: snap.toggleCombo,
				helpCombo: snap.helpCombo,
			},
			profiles: pstate.profiles.map((p) =>
				p.id === id
					? {
							...p,
							bindings: snap.bindings,
							sensitivity: snap.sensitivity,
							smoothing: snap.smoothing,
							aimMin: snap.aimMin,
							aimCurve: snap.aimCurve,
							invertY: snap.invertY,
							lockPointerOnClick: snap.lockPointerOnClick,
							updatedAt: now,
						}
					: p,
			),
		};
		pstate = next;
		void writeProfilesState(next);
		flashSaved();
	}

	function queueSave(): void {
		if (saveQueueTimer) clearTimeout(saveQueueTimer);
		saveQueueTimer = setTimeout(save, 80);
	}

	// ---- capture ----
	function startCapture(c: Exclude<Capturing, null>): void {
		capturing = c;
	}
	function cancelCapture(): void {
		capturing = null;
	}

	/** Bind a raw input id (key / Mouse0-4 / WheelUp|Down) to the captured action. */
	function commitBinding(inputId: string): void {
		if (capturing?.kind !== 'binding') return;
		const existing = config.bindings[inputId];
		// Tier-4 conflict warning: surface silent reassignment to the user.
		if (existing && !actionEq(existing, capturing.action)) {
			showConflict(
				m.opt_conflict_reassigned(
					{ input: prettyInput(inputId, config.locale), control: controlLabelFor(existing) },
					{ locale: config.locale },
				),
			);
		}
		config.bindings[inputId] = { ...capturing.action };
		capturing = null;
		save();
	}

	function commitCombo(e: KeyboardEvent): void {
		if (capturing?.kind !== 'toggle' && capturing?.kind !== 'help') return;
		const combo = comboFromEvent(e);
		if (capturing.kind === 'toggle') {
			config.toggleCombo = combo;
		} else {
			config.helpCombo = combo;
		}
		capturing = null;
		save();
	}

	function unbind(id: string): void {
		delete config.bindings[id];
		save();
	}

	// Global capture-phase listeners while a capture is active.
	onMount(() => {
		void readProfilesState().then((s) => {
			pstate = s;
			activeProfileId = resolveProfileId(s, null, null);
			config = projectProfileConfig(s, activeProfileId);
		});
		const unsub = onProfilesChanged((s) => {
			pstate = s;
			if (!activeProfileId) activeProfileId = resolveProfileId(s, null, null);
			config = projectProfileConfig(s, activeProfileId);
		});

		const onKey = (e: KeyboardEvent): void => {
			if (!capturing) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.code === 'Escape') return cancelCapture();
			if (capturing.kind === 'toggle' || capturing.kind === 'help') return commitCombo(e);
			commitBinding(e.code); // binding kind — keys bind by code
		};
		const onMouse = (e: MouseEvent): void => {
			if (capturing?.kind !== 'binding') return; // combos must be keys
			if ((e.target as Element)?.closest('button, .chip-x')) return;
			e.preventDefault();
			commitBinding('Mouse' + e.button);
		};
		const onWheel = (e: WheelEvent): void => {
			if (capturing?.kind !== 'binding') return;
			e.preventDefault();
			commitBinding(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
		};

		window.addEventListener('keydown', onKey, true);
		window.addEventListener('mousedown', onMouse, true);
		window.addEventListener('wheel', onWheel, { capture: true, passive: false });
		return () => {
			unsub();
			if (saveQueueTimer) clearTimeout(saveQueueTimer);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('mousedown', onMouse, true);
			window.removeEventListener('wheel', onWheel, true);
		};
	});

	// ---- settings ----
	function setNumber(key: (typeof AIM_CONTROLS)[number]['key'], raw: string): void {
		config[key] = aimConfigValue(key, raw);
		queueSave();
	}
	function setBool(key: 'invertY' | 'lockPointerOnClick', value: boolean): void {
		config[key] = value;
		save();
	}
	function setLocale(value: Locale): void {
		config.locale = value;
		save();
	}

	// ---- import / export ----
	function exportToBox(): void {
		jsonText = JSON.stringify(configToProfile($state.snapshot(config)), null, 2);
	}
	function importFromBox(): void {
		try {
			config = profileToConfig(JSON.parse(jsonText));
			save();
		} catch (err) {
			alert(
				m.opt_invalid_json(
					{ error: err instanceof Error ? err.message : String(err) },
					{ locale: config.locale },
				),
			);
		}
	}
	function downloadProfile(): void {
		const blob = new Blob([JSON.stringify(configToProfile($state.snapshot(config)), null, 2)], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'padmonk-profile.json';
		a.click();
		URL.revokeObjectURL(url);
	}
	function onUpload(e: Event): void {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				config = profileToConfig(JSON.parse(String(reader.result)));
				save();
			} catch (err) {
				alert(
					m.opt_invalid_file(
						{ error: err instanceof Error ? err.message : String(err) },
						{ locale: config.locale },
					),
				);
			}
		};
		reader.readAsText(file);
		(e.target as HTMLInputElement).value = ''; // allow re-uploading same file
	}

	function resetAll(): void {
		if (!window.confirm(m.opt_reset_all_confirm({}, { locale: config.locale }))) return;
		config = normalizeConfig(structuredClone(DEFAULT_CONFIG));
		save();
	}

	const isCapturing = (c: Capturing, kind: string, id?: string): boolean =>
		c != null && c.kind === kind && (id === undefined || (c.kind === 'binding' && c.id === id));
</script>

<div
	class="text-pad-text mx-auto min-h-screen max-w-3xl px-5 pt-7 pb-16 font-sans text-sm leading-relaxed"
>
	<section
		class="bg-pad-sponsor text-pad-sponsor-soft border-pad-sponsor-strong mb-4 flex flex-col gap-3 rounded-md border px-4 py-3 shadow-pad-hud sm:flex-row sm:items-center sm:justify-between"
	>
		<div>
			<div class="text-sm font-black tracking-wide uppercase">
				❤ {m.opt_support_title({}, { locale: config.locale })}
			</div>
			<div class="text-pad-sponsor-soft/85 text-xs">
				{m.opt_support_subtitle({}, { locale: config.locale })}
			</div>
		</div>
		<div class="flex gap-2">
			<a
				href={GITHUB_SPONSORS_URL}
				target="_blank"
				rel="noreferrer"
				class="bg-pad-sponsor-soft text-pad-sponsor-strong rounded-sm px-3 py-1 text-xs font-black uppercase hover:brightness-95"
			>
				{m.opt_support_github_sponsors({}, { locale: config.locale })}
			</a>
			<a
				href={BUY_ME_COFFEE_URL}
				target="_blank"
				rel="noreferrer"
				class="border-pad-coffee-border bg-pad-coffee text-pad-coffee-text hover:bg-pad-coffee-hover rounded-sm border px-3 py-1 text-xs font-black uppercase"
			>
				{m.opt_support_coffee({}, { locale: config.locale })}
			</a>
		</div>
	</section>

	<div class="mb-1 flex items-start justify-between gap-4">
		<h1 class="text-pad-accent m-0 flex items-center gap-2 text-xl">
			🎮 {m.opt_title({}, { locale: config.locale })}
			<span
				class="text-pad-accent text-xs transition-opacity duration-200"
				class:opacity-0={!saved}
				class:opacity-100={saved}>{m.opt_saved({}, { locale: config.locale })}</span
			>
		</h1>
		<div class="flex shrink-0 items-center gap-2">
			<label id="options-language-label" for="options-language" class="text-pad-muted text-xs">
				{m.opt_language_label({}, { locale: config.locale })}
			</label>
			<select
				id="options-language"
				aria-labelledby="options-language-label"
				class="pad-number rounded-sm px-2 py-1 text-sm"
				value={config.locale}
				onchange={(e) => setLocale(e.currentTarget.value as Locale)}
			>
				{#each locales as code (code)}
					<option value={code}>{localeName(code)}</option>
				{/each}
			</select>
		</div>
	</div>
	<p class="text-pad-muted mb-2">
		{m.opt_intro_before_add({}, { locale: config.locale })}
		<b class="text-pad-accent">{m.opt_add({}, { locale: config.locale })}</b>
		{m.opt_intro_between({}, { locale: config.locale })}
		<b class="text-pad-danger">×</b>
		{m.opt_intro_after_unbind({}, { locale: config.locale })}
	</p>

	<!-- Coverage warning: one or more controller actions have no input bound. -->
	{#if !bindsComplete}
		<div
			role="alert"
			class="bg-pad-danger text-pad-bg mb-2 rounded-md px-3 py-2 text-sm font-semibold"
		>
			⚠ {m.opt_unmapped_warning({}, { locale: config.locale })}
		</div>
	{/if}

	<!-- Conflict warning (Tier-4): non-blocking inline notice. -->
	{#if conflictNotice}
		<div
			role="status"
			class="border-pad-accent/40 bg-pad-green/10 text-pad-accent mb-2 rounded-md border px-3 py-2 text-sm"
		>
			⚠ {conflictNotice}
		</div>
	{/if}

	<!-- Remapping sections, generated from the registry. -->
	{#each groups as group (group.title)}
		<h2
			class="text-pad-muted border-pad-chip mt-7 mb-2.5 border-b pb-1.5 text-sm font-normal tracking-widest uppercase"
		>
			{group.title}
		</h2>
		{#if group.info}
			<div class="text-pad-muted italic">{group.info}</div>
		{/if}
		{#if group.items.length}
			<div class="grid grid-cols-field items-center gap-x-3.5 gap-y-2">
				{#each group.items as item (item.id)}
					<div class="text-pad-text/80 flex items-center gap-2">
						{#if item.icon}
							<img
								src={iconUrl(item.icon)}
								alt=""
								aria-hidden="true"
								class="pad-icon-glow size-5 shrink-0 object-contain"
							/>
						{/if}
						<span>{item.label}</span>
					</div>
					{#if group.fixed}
						<div class="flex flex-wrap items-center gap-1.5">
							{#each inputsFor(item.action) as id (id)}
								<span
									class="bg-pad-chip border-pad-border inline-flex items-center rounded-md border px-2 py-0.5 text-sm"
								>
									<b class="text-pad-key font-semibold">{prettyInput(id, config.locale)}</b>
								</span>
							{/each}
							<span class="text-pad-muted text-2xs uppercase tracking-wide"
								>{m.opt_fixed({}, { locale: config.locale })}</span
							>
						</div>
					{:else}
						<div class="flex flex-wrap items-center gap-1.5">
							{#each inputsFor(item.action) as id (id)}
								<span
									class="bg-pad-chip border-pad-border inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm"
								>
									<b class="text-pad-key font-semibold">{prettyInput(id, config.locale)}</b>
									<button
										type="button"
										class="chip-x text-pad-danger cursor-pointer font-bold"
										title={m.opt_unbind({}, { locale: config.locale })}
										aria-label={m.opt_unbind_aria(
											{ input: prettyInput(id, config.locale) },
											{ locale: config.locale },
										)}
										onclick={() => unbind(id)}>×</button
									>
								</span>
							{/each}
							<button
								type="button"
								class="cursor-pointer rounded-md border border-dashed px-2.5 py-0.5 text-sm {isCapturing(
									capturing,
									'binding',
									item.id,
								)
									? 'animate-pulse border-pad-capture bg-pad-capture-bg text-pad-capture'
									: 'border-pad-accent/40 bg-pad-green/10 text-pad-accent'}"
								onclick={() =>
									isCapturing(capturing, 'binding', item.id)
										? cancelCapture()
										: startCapture({ kind: 'binding', action: item.action, id: item.id })}
							>
								{isCapturing(capturing, 'binding', item.id)
									? m.opt_capture_input({}, { locale: config.locale })
									: m.opt_add({}, { locale: config.locale })}
							</button>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	{/each}

	<!-- Mouse & aim behavior -->
	<h2
		class="text-pad-muted border-pad-chip mt-7 mb-2.5 border-b pb-1.5 text-sm font-normal tracking-widest uppercase"
	>
		{m.opt_behavior_section({}, { locale: config.locale })}
	</h2>
	<p class="text-pad-muted mb-4 max-w-3xl text-sm leading-6">
		{m.opt_behavior_intro({}, { locale: config.locale })}
	</p>
	<div class="grid grid-cols-aim-field items-center gap-x-6 gap-y-3">
		{#each AIM_CONTROLS as s (s.key)}
			<div>
				<label
					id={`options-${s.key}-label`}
					for={`options-${s.key}-range`}
					class="text-pad-text/85 block font-semibold"
				>
					{translate(OPT_AIM_COPY[s.key].label, config.locale)}
				</label>
				<p class="text-pad-muted mt-1 text-xs leading-snug">
					{translate(OPT_AIM_COPY[s.key].desc, config.locale)}
				</p>
			</div>
			<div class="flex items-center gap-3">
				<input
					id={`options-${s.key}-range`}
					type="range"
					class="pad-range w-full"
					aria-labelledby={`options-${s.key}-label`}
					style={`--pad-fill: ${aimDisplayFill(config, s.key)}%`}
					min={s.min}
					max={s.max}
					step={s.step}
					value={aimDisplayValue(config, s.key)}
					oninput={(e) => setNumber(s.key, e.currentTarget.value)}
					onchange={save}
				/>
				<input
					type="number"
					class="pad-number w-20 shrink-0 rounded-sm px-2 py-1 text-right font-mono text-sm"
					aria-label={m.aim_value_aria(
						{ label: translate(OPT_AIM_COPY[s.key].label, config.locale) },
						{ locale: config.locale },
					)}
					min={s.min}
					max={s.max}
					step={s.step}
					value={aimDisplayValue(config, s.key).toFixed(s.dp)}
					onchange={(e) => setNumber(s.key, e.currentTarget.value)}
				/>
			</div>
		{/each}

		<div>
			<label
				id="options-invertY-label"
				for="options-invertY"
				class="text-pad-text/85 block font-semibold"
			>
				{m.opt_invert_label({}, { locale: config.locale })}
			</label>
			<p class="text-pad-muted mt-1 text-xs leading-snug">
				{m.opt_behavior_invert_desc({}, { locale: config.locale })}
			</p>
		</div>
		<div>
			<input
				id="options-invertY"
				type="checkbox"
				class="accent-pad-accent"
				checked={config.invertY}
				onchange={(e) => setBool('invertY', e.currentTarget.checked)}
			/>
		</div>

		<div>
			<label
				id="options-lockPointer-label"
				for="options-lockPointer"
				class="text-pad-text/85 block font-semibold"
			>
				{m.opt_lock_label({}, { locale: config.locale })}
			</label>
			<p class="text-pad-muted mt-1 text-xs leading-snug">
				{m.opt_behavior_lock_desc({}, { locale: config.locale })}
			</p>
		</div>
		<div>
			<input
				id="options-lockPointer"
				type="checkbox"
				class="accent-pad-accent"
				checked={config.lockPointerOnClick}
				onchange={(e) => setBool('lockPointerOnClick', e.currentTarget.checked)}
			/>
		</div>

		<div>
			<div class="text-pad-text/85 font-semibold">
				{m.opt_toggle_label({}, { locale: config.locale })}
			</div>
			<p class="text-pad-muted mt-1 text-xs leading-snug">
				{m.opt_behavior_toggle_desc({}, { locale: config.locale })}
			</p>
		</div>
		<div>
			<button
				type="button"
				class="cursor-pointer rounded-md border border-dashed px-2.5 py-0.5 text-sm {isCapturing(
					capturing,
					'toggle',
				)
					? 'animate-pulse border-pad-capture bg-pad-capture-bg text-pad-capture'
					: 'border-pad-accent/40 bg-pad-green/10 text-pad-accent'}"
				onclick={() =>
					isCapturing(capturing, 'toggle') ? cancelCapture() : startCapture({ kind: 'toggle' })}
			>
				{isCapturing(capturing, 'toggle')
					? m.opt_capture_combo({}, { locale: config.locale })
					: toggleLabel}
			</button>
		</div>

		<div>
			<div class="text-pad-text/85 font-semibold">
				{m.opt_help_label({}, { locale: config.locale })}
			</div>
			<p class="text-pad-muted mt-1 text-xs leading-snug">
				{m.opt_behavior_help_desc({}, { locale: config.locale })}
			</p>
		</div>
		<div>
			<button
				type="button"
				class="cursor-pointer rounded-md border border-dashed px-2.5 py-0.5 text-sm {isCapturing(
					capturing,
					'help',
				)
					? 'animate-pulse border-pad-capture bg-pad-capture-bg text-pad-capture'
					: 'border-pad-accent/40 bg-pad-green/10 text-pad-accent'}"
				onclick={() =>
					isCapturing(capturing, 'help') ? cancelCapture() : startCapture({ kind: 'help' })}
			>
				{isCapturing(capturing, 'help')
					? m.opt_capture_combo({}, { locale: config.locale })
					: helpLabel}
			</button>
		</div>
	</div>

	<!-- Import / Export -->
	<details class="mt-3.5">
		<summary class="text-pad-muted cursor-pointer"
			>{m.opt_importexport({}, { locale: config.locale })}</summary
		>
		<textarea
			class="bg-pad-bg-3 text-pad-text/80 border-pad-border mt-2 h-36 w-full rounded-md border p-2.5 font-mono text-xs leading-relaxed"
			spellcheck="false"
			bind:value={jsonText}
		></textarea>
		<div class="mt-3 flex flex-wrap gap-2.5">
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={exportToBox}
			>
				{m.opt_copy_to_box({}, { locale: config.locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={importFromBox}
			>
				{m.opt_apply_from_box({}, { locale: config.locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={downloadProfile}
			>
				{m.opt_download({}, { locale: config.locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={() => fileInput.click()}
			>
				{m.opt_upload({}, { locale: config.locale })}
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				class="hidden"
				onchange={onUpload}
			/>
		</div>
	</details>

	<!-- Danger zone -->
	<div class="mt-4 flex flex-wrap gap-2.5">
		<button
			type="button"
			class="text-pad-danger cursor-pointer rounded-md border border-pad-danger-border bg-transparent px-3.5 py-2 text-sm hover:brightness-125"
			onclick={resetAll}
		>
			{m.opt_reset_all({}, { locale: config.locale })}
		</button>
	</div>

	<footer
		class="border-pad-border text-pad-muted mt-10 flex flex-wrap items-center gap-4 border-t pt-4 text-xs"
	>
		<a
			href={GITHUB_REPO_URL}
			target="_blank"
			rel="noreferrer"
			class="text-pad-accent hover:underline"
		>
			{m.opt_footer_repo({}, { locale: config.locale })}
		</a>
		<a href={WEBSITE_URL} target="_blank" rel="noreferrer" class="text-pad-accent hover:underline">
			{m.opt_footer_web({}, { locale: config.locale })}
		</a>
		<a
			href={BUG_REPORT_URL}
			target="_blank"
			rel="noreferrer"
			class="text-pad-accent hover:underline"
		>
			{m.opt_footer_bug({}, { locale: config.locale })}
		</a>
	</footer>
</div>
