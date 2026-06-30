<script lang="ts">
	// Popup command deck: quick power state + aim tuning. Persists through the
	// profiles store; external edits live-refresh through onProfilesChanged. The
	// display Config is PROJECTED from the active profile so every existing
	// `config.xxx` binding renders unchanged. Tab-awareness is wired but degrades
	// to the global default until Phase 2 populates storage.session.
	import { onMount } from 'svelte';
	import {
		AIM_CONTROLS,
		aimConfigValue,
		aimDisplayFill,
		aimDisplayValue,
	} from '../core/aim-settings';
	import { comboLabel } from '../core/combos';
	import { DEFAULT_CONFIG } from '../core/config';
	import { m, t as translate } from '../core/i18n';
	import {
		normalizeProfilesState,
		projectProfileConfig,
		resolveProfileId,
		updateProfile,
		type ProfilesState,
	} from '../core/profiles';
	import {
		onProfilesChanged,
		readProfilesState,
		readTabProfile,
		writeProfilesState,
	} from '../shared/profiles-storage';

	const TOGGLES = [
		{ key: 'invertY', label: 'popup_toggle_invert_label', hint: 'popup_toggle_invert_hint' },
		{ key: 'lockPointerOnClick', label: 'popup_toggle_lock_label', hint: 'popup_toggle_lock_hint' },
	] as const;

	const GITHUB_SPONSORS_URL =
		'https://redirects.esskayesss.dev/sponsor-github?utm_source=padmonk-ext&utm_medium=popup&utm_campaign=support&skip';
	const BUY_ME_COFFEE_URL =
		'https://redirects.esskayesss.dev/sponsor-coffee?utm_source=padmonk-ext&utm_medium=popup&utm_campaign=support&skip';
	const BUG_REPORT_URL =
		'https://redirects.esskayesss.dev/padmonk-issues?utm_source=padmonk-ext&utm_medium=popup&utm_campaign=bug-report&skip';

	let pstate = $state<ProfilesState>(normalizeProfilesState(undefined));
	let activeProfileId = $state<string>('');
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	// The display Config, projected from the active profile + globals. Every
	// existing `config.xxx` template binding reads from this unchanged.
	const config = $derived(
		projectProfileConfig(pstate, activeProfileId || resolveProfileId(pstate, null, null)),
	);
	const activeProfileName = $derived(
		(pstate.profiles.find((p) => p.id === activeProfileId) ?? pstate.profiles[0]).name,
	);
	const toggleLabel = $derived(comboLabel(config.toggleCombo, config.locale));
	const helpLabel = $derived(comboLabel(config.helpCombo, config.locale));
	const stateLabel = $derived(
		config.enabled
			? m.popup_state_armed({}, { locale: config.locale })
			: m.popup_state_offline({}, { locale: config.locale }),
	);

	onMount(() => {
		void (async () => {
			const state = await readProfilesState();
			pstate = state;
			// Seed the active profile SYNCHRONOUSLY (global default) before any await so
			// early slider/toggle edits target a real profile, not ''. The tab-aware
			// block below refines it if this tab has a TabProfile override.
			activeProfileId = resolveProfileId(state, null, null);
			let id = activeProfileId;
			try {
				const tabs = await chrome.tabs?.query?.({ active: true, currentWindow: true });
				const tabId = tabs?.[0]?.id;
				if (tabId != null) {
					const tab = await readTabProfile(tabId);
					if (tab?.profileId) id = tab.profileId;
				}
			} catch {
				/* chrome.tabs unavailable — keep the global default */
			}
			activeProfileId = id;
		})();
		const unsub = onProfilesChanged((s) => (pstate = s));
		return () => {
			unsub();
			if (saveTimer) clearTimeout(saveTimer);
		};
	});

	/** Persist the whole state immediately. */
	function persist(): void {
		void writeProfilesState($state.snapshot(pstate));
	}

	/** Patch the active profile's per-profile fields (bumps updatedAt). */
	function patchActiveProfile(patch: Partial<ProfilesState['profiles'][number]>): void {
		pstate = updateProfile(pstate, activeProfileId, patch);
	}

	function queueSave(): void {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(persist, 80);
	}

	// Aim sliders are PER-PROFILE; keep the 80ms debounce idiom.
	function setNumber(key: (typeof AIM_CONTROLS)[number]['key'], raw: string): void {
		patchActiveProfile({ [key]: aimConfigValue(key, raw) });
		queueSave();
	}

	// `enabled` is GLOBAL; invertY/lockPointerOnClick are PER-PROFILE. Both save
	// immediately (clamped/boolean — always safe).
	function setBool(key: 'enabled' | 'invertY' | 'lockPointerOnClick', value: boolean): void {
		if (key === 'enabled') {
			pstate = { ...pstate, globals: { ...pstate.globals, enabled: value } };
		} else {
			patchActiveProfile({ [key]: value });
		}
		persist();
	}

	function resetSliders(): void {
		if (!window.confirm(m.popup_reset_confirm({}, { locale: config.locale }))) return;
		patchActiveProfile({
			sensitivity: DEFAULT_CONFIG.sensitivity,
			smoothing: DEFAULT_CONFIG.smoothing,
			aimMin: DEFAULT_CONFIG.aimMin,
			aimCurve: DEFAULT_CONFIG.aimCurve,
		});
		persist();
	}

	function openOptions(): void {
		chrome.runtime.openOptionsPage();
	}

	function openUrl(url: string): void {
		chrome.tabs?.create?.({ url });
	}
</script>

<main
	class="bg-pad-bg text-pad-text w-70 select-none overflow-hidden p-2 font-sans text-sm leading-tight"
>
	<section class="pad-panel-bg border-pad-accent/40 rounded-md border p-3">
		<header class="flex items-center justify-between gap-2">
			<div>
				<div class="text-xl font-semibold tracking-wide uppercase">padmonk</div>
				<div class="text-pad-muted text-2xs tracking-wide">
					{m.popup_tuning({ name: activeProfileName }, { locale: config.locale })}
				</div>
			</div>
			<span
				class="rounded-sm border px-2 py-0.5 text-2xs tracking-widest uppercase"
				class:border-pad-accent={config.enabled}
				class:border-pad-border={!config.enabled}
				class:text-pad-accent={config.enabled}
				class:text-pad-muted={!config.enabled}
			>
				{stateLabel}
			</span>
		</header>

		<div class="mt-3 grid grid-cols-3 gap-2">
			<label
				class="pad-surface flex cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border p-2 text-center"
			>
				<span class="text-pad-text text-xs font-semibold leading-tight"
					>{m.popup_enabled({}, { locale: config.locale })}</span
				>
				<input
					type="checkbox"
					class="accent-pad-accent"
					checked={config.enabled}
					onchange={(e) => setBool('enabled', e.currentTarget.checked)}
				/>
			</label>
			{#each TOGGLES as t (t.key)}
				<label
					class="pad-surface flex cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border p-2 text-center"
				>
					<span class="text-pad-text text-xs font-semibold leading-tight"
						>{translate(t.label, config.locale)}</span
					>
					<input
						type="checkbox"
						class="accent-pad-accent"
						checked={config[t.key]}
						onchange={(e) => setBool(t.key, e.currentTarget.checked)}
					/>
				</label>
			{/each}
		</div>
	</section>

	<section class="grid gap-2 pt-2">
		<section class="pad-surface grid gap-3 rounded-md border p-3">
			<div class="flex items-center justify-between">
				<h2 class="text-pad-accent text-xs font-semibold tracking-widest uppercase">
					{m.popup_aim_tuning({}, { locale: config.locale })}
				</h2>
				<button
					type="button"
					class="text-pad-muted hover:text-pad-accent cursor-pointer text-2xs uppercase tracking-widest"
					onclick={resetSliders}
				>
					{m.popup_reset({}, { locale: config.locale })}
				</button>
			</div>
			{#each AIM_CONTROLS as s (s.key)}
				<div class="grid gap-1">
					<div class="flex items-baseline justify-between gap-2">
						<span>
							<label
								id={`popup-${s.key}-label`}
								for={`popup-${s.key}-range`}
								class="block text-xs font-semibold"
							>
								{translate(s.label, config.locale)}
							</label>
							<span class="text-pad-muted text-2xs uppercase tracking-wide"
								>{translate(s.hint, config.locale)}</span
							>
						</span>
						<input
							type="number"
							class="pad-number w-16 rounded-sm px-1.5 py-0.5 text-right font-mono text-xs"
							aria-label={m.aim_value_aria(
								{ label: translate(s.label, config.locale) },
								{ locale: config.locale },
							)}
							min={s.min}
							max={s.max}
							step={s.step}
							value={aimDisplayValue(config, s.key).toFixed(s.dp)}
							onchange={(e) => setNumber(s.key, e.currentTarget.value)}
						/>
					</div>
					<input
						id={`popup-${s.key}-range`}
						type="range"
						class="pad-range w-full"
						aria-labelledby={`popup-${s.key}-label`}
						style={`--pad-fill: ${aimDisplayFill(config, s.key)}%`}
						min={s.min}
						max={s.max}
						step={s.step}
						value={aimDisplayValue(config, s.key)}
						oninput={(e) => setNumber(s.key, e.currentTarget.value)}
						onchange={persist}
					/>
				</div>
			{/each}
		</section>

		<div class="grid grid-cols-3 gap-2">
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border hover:border-pad-accent cursor-pointer rounded-sm border px-2 py-2 text-xs font-semibold"
				onclick={openOptions}
			>
				{m.popup_advanced({}, { locale: config.locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border hover:border-pad-accent cursor-pointer rounded-sm border px-2 py-2 text-xs font-semibold"
				onclick={() => chrome.tabs?.create?.({ url: 'https://hardwaretester.com/gamepad' })}
			>
				{m.popup_test_pad({}, { locale: config.locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border hover:border-pad-accent cursor-pointer rounded-sm border px-2 py-2 text-xs font-semibold"
				onclick={() => openUrl(BUG_REPORT_URL)}
			>
				{m.popup_report_bug({}, { locale: config.locale })}
			</button>
		</div>

		<p class="text-pad-muted text-xs leading-snug">
			<b class="text-pad-accent">{toggleLabel}</b>
			{m.popup_hint_toggle({}, { locale: config.locale })}
			<b class="text-pad-accent">{helpLabel}</b>
			{m.popup_hint_help({}, { locale: config.locale })}
		</p>

		<div class="space-y-1.5">
			<div class="grid grid-cols-2 gap-2">
				<button
					type="button"
					class="bg-pad-sponsor text-pad-sponsor-soft hover:bg-pad-sponsor-strong border-pad-sponsor/70 cursor-pointer rounded-sm border px-2 py-2 text-xs font-black tracking-wide uppercase"
					onclick={() => openUrl(GITHUB_SPONSORS_URL)}
				>
					❤ {m.popup_sponsor({}, { locale: config.locale })}
				</button>
				<button
					type="button"
					class="border-pad-coffee-border bg-pad-coffee text-pad-coffee-text hover:bg-pad-coffee-hover cursor-pointer rounded-sm border px-2 py-2 text-xs font-black tracking-wide uppercase"
					onclick={() => openUrl(BUY_ME_COFFEE_URL)}
				>
					☕ {m.popup_coffee({}, { locale: config.locale })}
				</button>
			</div>
		</div>
	</section>
</main>
