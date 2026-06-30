<script lang="ts">
	// Page 1 — Settings (staged-save engine). See plan §7.1.
	//
	// This page edits the durable `profiles` store, but NEVER autosaves: Options
	// edits broadcast live to running game tabs, so commits are explicit (Save
	// Global / Save Profile) and gated by the conflict engine. Every keystroke
	// edits a DRAFT (draftGlobals / draftProfile); the stored state only changes
	// on an explicit save (binds + aim) or a durable structural action (profile
	// add / rename / duplicate / delete, which don't disrupt a running game).
	//
	// Two save buttons, one validator (validateBindPlan):
	//   - Save Global validates draftGlobals against EVERY profile and hard-blocks
	//     on a global-shortcut collision (a profile binds an input == new toggle/
	//     help code).
	//   - Save Profile validates the active draft against current draftGlobals;
	//     'unmapped' issues warn but don't block.
	// Edit-time gating mirrors this: a capture is blocked outright on a global
	// collision (GlobalShortcutModal) and prompts on in-profile reuse
	// (ConflictDialog) before the rebind lands in the draft.
	import { onMount } from 'svelte';
	import {
		AIM_CONTROLS,
		aimConfigValue,
		aimDisplayFill,
		aimDisplayValue,
	} from '../core/aim-settings';
	import {
		actionEq,
		actionKey,
		groupsForOptions,
		allBindsConfigured,
	} from '../core/controller-actions';
	import { normalizeConfig } from '../core/config';
	import {
		configToProfile,
		profileToConfig,
		profilesToBundle,
		bundleFromImport,
	} from '../core/profile';
	import {
		addProfile,
		createProfile,
		deleteProfile,
		duplicateProfile,
		inProfileConflict,
		normalizeProfilesState,
		renameProfile,
		resolveProfileId,
		updateProfile,
		validateBindPlan,
		type Globals,
		type Profile,
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
	import ConflictDialog from './ConflictDialog.svelte';
	import GlobalShortcutModal from './GlobalShortcutModal.svelte';
	import ProfileTabs from './ProfileTabs.svelte';
	import type { Action, Config } from '../core/types';
	import type { Locale } from '../core/i18n';

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

	// ---- staged draft model (never autosaved) ----
	const seed = normalizeProfilesState(undefined);
	let pstate = $state<ProfilesState>(seed);
	let activeProfileId = $state('');
	let draftGlobals = $state<Globals>(structuredClone(seed.globals));
	let draftProfile = $state<Profile>(structuredClone(seed.profiles[0]));
	let globalsDirty = $state(false);
	let profileDirty = $state(false);

	// Display locale tracks the DRAFT language so the page previews live.
	const locale = $derived(draftGlobals.locale);
	const groups = $derived(groupsForOptions(locale));
	const toggleLabel = $derived(comboLabel(draftGlobals.toggleCombo, locale));
	const helpLabel = $derived(comboLabel(draftGlobals.helpCombo, locale));
	const bindsComplete = $derived(allBindsConfigured(draftProfile.bindings));
	// Full Config projection of the drafts — feeds the aim sliders (they read the
	// clamped Config aim fields) and export.
	const draftConfig = $derived(draftToConfig());
	const canDelete = $derived(pstate.profiles.length > 1);
	const tabs = $derived(pstate.profiles.map((p) => ({ id: p.id, name: p.name })));

	// Capture state: which row (binding) or combo button is awaiting input.
	type Capturing =
		| { kind: 'binding'; action: Action; id: string }
		| { kind: 'toggle' | 'help' }
		| null;
	let capturing = $state<Capturing>(null);

	// Modal / dialog state.
	let globalModal = $state<{ open: boolean; inputLabel: string; comboKind: 'toggle' | 'help' }>({
		open: false,
		inputLabel: '',
		comboKind: 'toggle',
	});
	let conflict = $state<{
		open: boolean;
		inputLabel: string;
		currentControlLabel: string;
		newControlLabel: string;
	}>({ open: false, inputLabel: '', currentControlLabel: '', newControlLabel: '' });
	let pendingBind: { inputId: string; action: Action } | null = null;

	// Banners.
	let saved = $state(false);
	let globalError = $state<string | null>(null);

	let jsonText = $state('');
	let savedTimer: ReturnType<typeof setTimeout> | null = null;
	let fileInput: HTMLInputElement;
	let bundleInput: HTMLInputElement;

	// ---- helpers ----
	/** Input ids in the DRAFT profile currently bound to a given action. */
	function inputsFor(action: Action): string[] {
		return Object.keys(draftProfile.bindings).filter((id) =>
			actionEq(draftProfile.bindings[id], action),
		);
	}

	/** Friendly "Group · Label" for an action key, else a generic fallback. */
	function controlLabelFor(key: string): string {
		for (const g of groups) {
			for (const item of g.items) {
				if (actionKey(item.action) === key) return `${g.title} · ${item.label}`;
			}
		}
		return m.opt_control_fallback({}, { locale });
	}

	function flashSaved(): void {
		saved = true;
		if (savedTimer) clearTimeout(savedTimer);
		savedTimer = setTimeout(() => (saved = false), 1200);
	}

	/** Build a full Config from the current drafts (for export / projection). */
	function draftToConfig(): Config {
		const g = $state.snapshot(draftGlobals);
		const p = $state.snapshot(draftProfile);
		return normalizeConfig({
			enabled: g.enabled,
			locale: g.locale,
			sensitivity: p.sensitivity,
			smoothing: p.smoothing,
			aimMin: p.aimMin,
			aimCurve: p.aimCurve,
			invertY: p.invertY,
			lockPointerOnClick: p.lockPointerOnClick,
			toggleCombo: g.toggleCombo,
			helpCombo: g.helpCombo,
			bindings: p.bindings,
		});
	}

	/** Load drafts for a profile id (clears profile-dirty). */
	function loadDraftProfile(id: string): void {
		const p = pstate.profiles.find((x) => x.id === id) ?? pstate.profiles[0];
		activeProfileId = p.id;
		// $state.snapshot already deep-copies the proxy → draft is ref-isolated.
		draftProfile = $state.snapshot(p);
		profileDirty = false;
	}

	/** Run `proceed` after an optional discard confirmation when profile-dirty. */
	function guardDiscard(proceed: () => void): void {
		if (profileDirty && !window.confirm(m.opt_dirty_prompt({}, { locale }))) return;
		proceed();
	}

	// ---- capture ----
	function startCapture(c: Exclude<Capturing, null>): void {
		capturing = c;
	}
	function cancelCapture(): void {
		capturing = null;
	}

	/** Apply a raw input -> action into the draft (immutably) and mark dirty. */
	function setBind(inputId: string, action: Action): void {
		const next = { ...$state.snapshot(draftProfile.bindings) };
		next[inputId] = { ...action } as Action;
		draftProfile.bindings = next;
		profileDirty = true;
	}

	/**
	 * Commit a captured binding inputId -> action, gated by the conflict engine:
	 *   1) global-shortcut collision -> hard block (GlobalShortcutModal).
	 *   2) in-profile reuse -> confirm (ConflictDialog).
	 *   3) else apply.
	 */
	function commitBinding(inputId: string): void {
		if (capturing?.kind !== 'binding') return;
		const action = capturing.action;
		capturing = null;

		// 1) Global-shortcut collision (keyboard codes only; mouse/wheel can't match).
		if (inputId === draftGlobals.toggleCombo.code) {
			globalModal = { open: true, inputLabel: prettyInput(inputId, locale), comboKind: 'toggle' };
			return;
		}
		if (inputId === draftGlobals.helpCombo.code) {
			globalModal = { open: true, inputLabel: prettyInput(inputId, locale), comboKind: 'help' };
			return;
		}

		// 2) In-profile reuse of an input already driving a different action.
		const reuse = inProfileConflict(
			$state.snapshot(draftProfile.bindings),
			inputId,
			actionKey(action),
		);
		if (reuse) {
			pendingBind = { inputId, action };
			conflict = {
				open: true,
				inputLabel: prettyInput(inputId, locale),
				currentControlLabel: controlLabelFor(reuse.currentActionKey),
				newControlLabel: controlLabelFor(actionKey(action)),
			};
			return;
		}

		// 3) Free input — apply directly.
		setBind(inputId, action);
	}

	function confirmConflict(): void {
		conflict = { ...conflict, open: false };
		if (pendingBind) setBind(pendingBind.inputId, pendingBind.action);
		pendingBind = null;
	}
	function cancelConflict(): void {
		conflict = { ...conflict, open: false };
		pendingBind = null;
	}

	/** Capture a global combo (toggle/help) into the DRAFT globals. */
	function commitCombo(e: KeyboardEvent): void {
		if (capturing?.kind !== 'toggle' && capturing?.kind !== 'help') return;
		const combo = comboFromEvent(e);
		if (capturing.kind === 'toggle') draftGlobals.toggleCombo = combo;
		else draftGlobals.helpCombo = combo;
		capturing = null;
		globalsDirty = true;
	}

	function unbind(id: string): void {
		const next = { ...$state.snapshot(draftProfile.bindings) };
		delete next[id];
		draftProfile.bindings = next;
		profileDirty = true;
	}

	// ---- aim / behavior (per-profile) ----
	function setNumber(key: (typeof AIM_CONTROLS)[number]['key'], raw: string): void {
		draftProfile[key] = aimConfigValue(key, raw);
		profileDirty = true;
	}
	function setBool(key: 'invertY' | 'lockPointerOnClick', value: boolean): void {
		draftProfile[key] = value;
		profileDirty = true;
	}

	// ---- global settings ----
	function setEnabled(value: boolean): void {
		draftGlobals.enabled = value;
		globalsDirty = true;
	}
	function setLocale(value: Locale): void {
		draftGlobals.locale = value;
		globalsDirty = true;
	}

	/** Save Global: block on a cross-profile global-shortcut collision. */
	function saveGlobal(): void {
		const g = $state.snapshot(draftGlobals) as Globals;
		// Validate against every SAVED profile AND the in-progress active draft, so a
		// global-shortcut collision against an UNSAVED bind is caught at Save Global.
		const plans: Profile[] = [...pstate.profiles, $state.snapshot(draftProfile) as Profile];
		for (const p of plans) {
			const issues = validateBindPlan(g, p);
			const hit = issues.find((i) => i.kind === 'global-collision');
			if (hit) {
				globalError = m.opt_global_block_body(
					{
						input: prettyInput(hit.inputId ?? '', locale),
						shortcut:
							hit.comboKind === 'help'
								? m.opt_shortcut_help({}, { locale })
								: m.opt_shortcut_toggle({}, { locale }),
					},
					{ locale },
				);
				return;
			}
		}
		globalError = null;
		const next = normalizeProfilesState({ ...$state.snapshot(pstate), globals: g });
		pstate = next;
		void writeProfilesState(next);
		draftGlobals = structuredClone(next.globals);
		globalsDirty = false;
		flashSaved();
	}

	/** Save Profile: block on global collision, warn (non-blocking) on unmapped. */
	function saveProfile(): void {
		const g = $state.snapshot(draftGlobals) as Globals;
		const p = $state.snapshot(draftProfile) as Profile;
		const issues = validateBindPlan(g, p);
		const collision = issues.find((i) => i.kind === 'global-collision');
		if (collision) {
			globalModal = {
				open: true,
				inputLabel: prettyInput(collision.inputId ?? '', locale),
				comboKind: collision.comboKind ?? 'toggle',
			};
			return;
		}
		const next = updateProfile(pstate, activeProfileId, {
			bindings: p.bindings,
			sensitivity: p.sensitivity,
			smoothing: p.smoothing,
			aimMin: p.aimMin,
			aimCurve: p.aimCurve,
			invertY: p.invertY,
			lockPointerOnClick: p.lockPointerOnClick,
		});
		pstate = next;
		void writeProfilesState(next);
		loadDraftProfile(activeProfileId);
		flashSaved();
	}

	// ---- profile tabs (DURABLE structural actions) ----
	function onSelect(id: string): void {
		guardDiscard(() => loadDraftProfile(id));
	}
	function onRename(id: string, name: string): void {
		const next = renameProfile(pstate, id, name);
		pstate = next;
		void writeProfilesState(next);
		if (id === activeProfileId) {
			const renamed = next.profiles.find((p) => p.id === id);
			if (renamed) draftProfile.name = renamed.name;
		}
	}
	function onAdd(): void {
		guardDiscard(() => {
			const fresh = createProfile(m.opt_new_profile({}, { locale }));
			const next = addProfile(pstate, fresh);
			pstate = next;
			void writeProfilesState(next);
			loadDraftProfile(fresh.id);
		});
	}
	function onDuplicate(id: string): void {
		guardDiscard(() => {
			const before = new Set(pstate.profiles.map((p) => p.id));
			const next = duplicateProfile(pstate, id);
			pstate = next;
			void writeProfilesState(next);
			// Switch+reload to the freshly created copy (the id absent before), so
			// duplicate behaves like add rather than persisting a copy out of view.
			const created = next.profiles.find((p) => !before.has(p.id));
			if (created) loadDraftProfile(created.id);
		});
	}
	function onDelete(id: string): void {
		if (!canDelete) return; // core guards last-profile; UI guard here too
		// Deleting the active profile discards its draft — prompt first when dirty
		// (mirrors onSelect/onAdd). Durable delete proceeds after confirmation.
		guardDiscard(() => {
			const next = deleteProfile(pstate, id);
			pstate = next;
			void writeProfilesState(next);
			// Reconcile the active profile against the resulting list.
			if (!next.profiles.some((p) => p.id === activeProfileId)) {
				loadDraftProfile(resolveProfileId(next, null, null));
			}
		});
	}

	// ---- import / export (operate on the active draft) ----
	function applyConfigToDraft(cfg: Config): void {
		draftProfile.bindings = cfg.bindings;
		draftProfile.sensitivity = cfg.sensitivity;
		draftProfile.smoothing = cfg.smoothing;
		draftProfile.aimMin = cfg.aimMin;
		draftProfile.aimCurve = cfg.aimCurve;
		draftProfile.invertY = cfg.invertY;
		draftProfile.lockPointerOnClick = cfg.lockPointerOnClick;
		draftGlobals.enabled = cfg.enabled;
		draftGlobals.locale = cfg.locale;
		draftGlobals.toggleCombo = cfg.toggleCombo;
		draftGlobals.helpCombo = cfg.helpCombo;
		profileDirty = true;
		globalsDirty = true;
	}
	function exportToBox(): void {
		jsonText = JSON.stringify(configToProfile(draftToConfig()), null, 2);
	}
	function importFromBox(): void {
		try {
			applyConfigToDraft(profileToConfig(JSON.parse(jsonText)));
		} catch (err) {
			alert(
				m.opt_invalid_json({ error: err instanceof Error ? err.message : String(err) }, { locale }),
			);
		}
	}
	function downloadProfile(): void {
		const blob = new Blob([JSON.stringify(configToProfile(draftToConfig()), null, 2)], {
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
				applyConfigToDraft(profileToConfig(JSON.parse(String(reader.result))));
			} catch (err) {
				alert(
					m.opt_invalid_file(
						{ error: err instanceof Error ? err.message : String(err) },
						{ locale },
					),
				);
			}
		};
		reader.readAsText(file);
		(e.target as HTMLInputElement).value = ''; // allow re-uploading same file
	}

	// ---- bundle import / export (operate on the WHOLE store) ----
	/** Download every profile + globals + mappings as one padmonk bundle file. */
	function downloadBundle(): void {
		const blob = new Blob([JSON.stringify(profilesToBundle($state.snapshot(pstate)), null, 2)], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'padmonk-profiles.json';
		a.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Import a bundle file: REPLACES all profiles/globals/mappings. After a
	 * successful write, reload the active draft from the new state so the page
	 * reflects the imported store immediately (the onProfilesChanged subscription
	 * also fires, but we reconcile the active id eagerly here).
	 */
	function onUploadBundle(e: Event): void {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const next = bundleFromImport(JSON.parse(String(reader.result)));
				pstate = next;
				void writeProfilesState(next);
				activeProfileId = resolveProfileId(next, null, null);
				draftGlobals = structuredClone(next.globals);
				globalsDirty = false;
				loadDraftProfile(activeProfileId);
				flashSaved();
			} catch (err) {
				alert(
					m.opt_bundle_invalid(
						{ error: err instanceof Error ? err.message : String(err) },
						{ locale },
					),
				);
			}
		};
		reader.readAsText(file);
		(e.target as HTMLInputElement).value = ''; // allow re-uploading same file
	}

	const isCapturing = (c: Capturing, kind: string, id?: string): boolean =>
		c != null && c.kind === kind && (id === undefined || (c.kind === 'binding' && c.id === id));

	onMount(() => {
		void readProfilesState().then((s) => {
			pstate = s;
			activeProfileId = resolveProfileId(s, null, null);
			draftGlobals = structuredClone(s.globals);
			loadDraftProfile(activeProfileId);
		});
		const unsub = onProfilesChanged((s) => {
			pstate = s;
			// Reconcile the active id if it vanished externally.
			if (!s.profiles.some((p) => p.id === activeProfileId)) {
				// WHY: the active profile was deleted elsewhere. A dirty draft now targets
				// a profile that no longer exists — saving it would write the dead draft
				// onto an unrelated profile (corruption). Discard the dead draft and load
				// the resolved fallback UNCONDITIONALLY (nothing valid to save it to).
				activeProfileId = resolveProfileId(s, null, null);
				loadDraftProfile(activeProfileId);
			} else if (!profileDirty) {
				// Active profile still exists: refresh only when no pending profile edits.
				loadDraftProfile(activeProfileId);
			}
			// Refresh globals draft only when the user has no pending global edits.
			if (!globalsDirty) draftGlobals = structuredClone(s.globals);
		});

		const onKey = (e: KeyboardEvent): void => {
			if (!capturing) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.code === 'Escape') return cancelCapture();
			if (capturing.kind === 'toggle' || capturing.kind === 'help') return commitCombo(e);
			commitBinding(e.code);
		};
		const onMouse = (e: MouseEvent): void => {
			if (capturing?.kind !== 'binding') return;
			if ((e.target as Element)?.closest('button, .chip-x')) return;
			e.preventDefault();
			commitBinding('Mouse' + e.button);
		};
		const onWheel = (e: WheelEvent): void => {
			if (capturing?.kind !== 'binding') return;
			e.preventDefault();
			commitBinding(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
		};
		// Warn on navigation while any draft is dirty.
		const onBeforeUnload = (e: BeforeUnloadEvent): void => {
			if (!globalsDirty && !profileDirty) return;
			e.preventDefault();
			e.returnValue = '';
		};

		window.addEventListener('keydown', onKey, true);
		window.addEventListener('mousedown', onMouse, true);
		window.addEventListener('wheel', onWheel, { capture: true, passive: false });
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => {
			unsub();
			if (savedTimer) clearTimeout(savedTimer);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('mousedown', onMouse, true);
			window.removeEventListener('wheel', onWheel, true);
			window.removeEventListener('beforeunload', onBeforeUnload);
		};
	});
</script>

<ConflictDialog
	open={conflict.open}
	{locale}
	inputLabel={conflict.inputLabel}
	currentControlLabel={conflict.currentControlLabel}
	newControlLabel={conflict.newControlLabel}
	onConfirm={confirmConflict}
	onCancel={cancelConflict}
/>
<GlobalShortcutModal
	open={globalModal.open}
	{locale}
	inputLabel={globalModal.inputLabel}
	comboKind={globalModal.comboKind}
	onClose={() => (globalModal = { ...globalModal, open: false })}
/>

<!-- Dashed capture button, shared by toggle/help/binding sites. `label` is the
     fully-resolved text (active vs idle decided by the caller); `active` drives
     the capturing pulse styling; `onToggle` starts/cancels the capture. -->
{#snippet captureButton(active: boolean, label: string, onToggle: () => void)}
	<button
		type="button"
		class="cursor-pointer rounded-md border border-dashed px-2.5 py-0.5 text-sm {active
			? 'border-pad-capture bg-pad-capture-bg text-pad-capture animate-pulse'
			: 'border-pad-accent/40 bg-pad-green/10 text-pad-accent'}"
		onclick={onToggle}
	>
		{label}
	</button>
{/snippet}

<!-- Per-profile boolean row (label + desc + checkbox) for the aim grid. -->
{#snippet boolRow(
	id: string,
	label: string,
	desc: string,
	checked: boolean,
	onToggle: (value: boolean) => void,
)}
	<div>
		<label id={`${id}-label`} for={id} class="text-pad-text/85 block font-semibold">{label}</label>
		<p class="text-pad-muted mt-1 text-xs leading-snug">{desc}</p>
	</div>
	<div>
		<input
			{id}
			type="checkbox"
			class="accent-pad-accent"
			{checked}
			onchange={(e) => onToggle(e.currentTarget.checked)}
		/>
	</div>
{/snippet}

<div class="flex items-center gap-2">
	<h1 class="text-pad-accent m-0 flex items-center gap-2 text-xl">
		🎮 {m.opt_title({}, { locale })}
	</h1>
	<span
		class="text-pad-accent text-xs transition-opacity duration-200"
		class:opacity-0={!saved}
		class:opacity-100={saved}>{m.opt_saved({}, { locale })}</span
	>
</div>
<p class="text-pad-muted mt-1 mb-4">
	{m.opt_intro_before_add({}, { locale })}
	<b class="text-pad-accent">{m.opt_add({}, { locale })}</b>
	{m.opt_intro_between({}, { locale })}
	<b class="text-pad-danger">×</b>
	{m.opt_intro_after_unbind({}, { locale })}
</p>

<!-- GLOBAL SETTINGS card -->
<section class="pad-panel-bg border-pad-border mb-6 rounded-md border p-4">
	<div class="mb-3 flex items-center justify-between gap-3">
		<h2 class="text-pad-muted text-sm font-normal tracking-widest uppercase">
			{m.opt_global_section({}, { locale })}
		</h2>
		<div class="flex items-center gap-2">
			{#if globalsDirty}
				<span class="text-pad-capture text-2xs tracking-wide uppercase"
					>{m.opt_unsaved({}, { locale })}</span
				>
			{/if}
			<button
				type="button"
				class="bg-pad-green text-pad-bg cursor-pointer rounded-md px-3.5 py-1.5 text-sm font-semibold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!globalsDirty}
				onclick={saveGlobal}
			>
				{m.opt_save_global({}, { locale })}
			</button>
		</div>
	</div>

	{#if globalError}
		<div
			role="alert"
			class="border-pad-danger-border text-pad-danger mb-3 rounded-md border bg-transparent px-3 py-2 text-sm"
		>
			⚠ {globalError}
		</div>
	{/if}

	<div class="grid grid-cols-aim-field items-center gap-x-6 gap-y-3">
		<div>
			<label for="settings-enabled" class="text-pad-text/85 block font-semibold"
				>{m.opt_master_enable({}, { locale })}</label
			>
		</div>
		<div>
			<input
				id="settings-enabled"
				type="checkbox"
				class="accent-pad-accent"
				checked={draftGlobals.enabled}
				onchange={(e) => setEnabled(e.currentTarget.checked)}
			/>
		</div>

		<div>
			<label
				id="settings-language-label"
				for="settings-language"
				class="text-pad-text/85 block font-semibold">{m.opt_language_label({}, { locale })}</label
			>
		</div>
		<div>
			<select
				id="settings-language"
				aria-labelledby="settings-language-label"
				class="pad-number rounded-sm px-2 py-1 text-sm"
				value={draftGlobals.locale}
				onchange={(e) => setLocale(e.currentTarget.value as Locale)}
			>
				{#each locales as code (code)}
					<option value={code}>{localeName(code)}</option>
				{/each}
			</select>
		</div>

		<div>
			<div class="text-pad-text/85 font-semibold">{m.opt_toggle_label({}, { locale })}</div>
			<p class="text-pad-muted mt-1 text-xs leading-snug">
				{m.opt_behavior_toggle_desc({}, { locale })}
			</p>
		</div>
		<div>
			{@render captureButton(
				isCapturing(capturing, 'toggle'),
				isCapturing(capturing, 'toggle') ? m.opt_capture_combo({}, { locale }) : toggleLabel,
				() =>
					isCapturing(capturing, 'toggle') ? cancelCapture() : startCapture({ kind: 'toggle' }),
			)}
		</div>

		<div>
			<div class="text-pad-text/85 font-semibold">{m.opt_help_label({}, { locale })}</div>
			<p class="text-pad-muted mt-1 text-xs leading-snug">
				{m.opt_behavior_help_desc({}, { locale })}
			</p>
		</div>
		<div>
			{@render captureButton(
				isCapturing(capturing, 'help'),
				isCapturing(capturing, 'help') ? m.opt_capture_combo({}, { locale }) : helpLabel,
				() => (isCapturing(capturing, 'help') ? cancelCapture() : startCapture({ kind: 'help' })),
			)}
		</div>
	</div>
</section>

<!-- PROFILES card -->
<section class="pad-panel-bg border-pad-border rounded-md border p-4">
	<div class="mb-3 flex items-center justify-between gap-3">
		<h2 class="text-pad-muted text-sm font-normal tracking-widest uppercase">
			{m.opt_profiles_section({}, { locale })}
		</h2>
		<div class="flex items-center gap-2">
			{#if profileDirty}
				<span class="text-pad-capture text-2xs tracking-wide uppercase"
					>{m.opt_unsaved({}, { locale })}</span
				>
			{/if}
			<button
				type="button"
				class="bg-pad-green text-pad-bg cursor-pointer rounded-md px-3.5 py-1.5 text-sm font-semibold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!profileDirty}
				onclick={saveProfile}
			>
				{m.opt_save_profile({}, { locale })}
			</button>
		</div>
	</div>

	<ProfileTabs
		profiles={tabs}
		{activeProfileId}
		{locale}
		{onSelect}
		{onRename}
		{onAdd}
		{onDuplicate}
		{onDelete}
		{canDelete}
	/>

	<!-- Coverage warning: one or more controller actions have no input bound. -->
	{#if !bindsComplete}
		<div
			role="alert"
			class="bg-pad-danger text-pad-bg mt-4 rounded-md px-3 py-2 text-sm font-semibold"
		>
			⚠ {m.opt_unmapped_warning({}, { locale })}
		</div>
	{/if}

	<!-- Binds grid (active profile, all rebindable, conflict-checked). -->
	{#each groups as group (group.title)}
		<h3
			class="text-pad-muted border-pad-chip mt-7 mb-2.5 border-b pb-1.5 text-sm font-normal tracking-widest uppercase"
		>
			{group.title}
		</h3>
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
									<b class="text-pad-key font-semibold">{prettyInput(id, locale)}</b>
								</span>
							{/each}
							<span class="text-pad-muted text-2xs tracking-wide uppercase"
								>{m.opt_fixed({}, { locale })}</span
							>
						</div>
					{:else}
						<div class="flex flex-wrap items-center gap-1.5">
							{#each inputsFor(item.action) as id (id)}
								<span
									class="bg-pad-chip border-pad-border inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm"
								>
									<b class="text-pad-key font-semibold">{prettyInput(id, locale)}</b>
									<button
										type="button"
										class="chip-x text-pad-danger cursor-pointer font-bold"
										title={m.opt_unbind({}, { locale })}
										aria-label={m.opt_unbind_aria({ input: prettyInput(id, locale) }, { locale })}
										onclick={() => unbind(id)}>×</button
									>
								</span>
							{/each}
							{@render captureButton(
								isCapturing(capturing, 'binding', item.id),
								isCapturing(capturing, 'binding', item.id)
									? m.opt_capture_input({}, { locale })
									: m.opt_add({}, { locale }),
								() =>
									isCapturing(capturing, 'binding', item.id)
										? cancelCapture()
										: startCapture({ kind: 'binding', action: item.action, id: item.id }),
							)}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	{/each}

	<!-- Aim & behavior (active profile). -->
	<h3
		class="text-pad-muted border-pad-chip mt-7 mb-2.5 border-b pb-1.5 text-sm font-normal tracking-widest uppercase"
	>
		{m.opt_behavior_section({}, { locale })}
	</h3>
	<p class="text-pad-muted mb-4 max-w-3xl text-sm leading-6">
		{m.opt_behavior_intro({}, { locale })}
	</p>
	<div class="grid grid-cols-aim-field items-center gap-x-6 gap-y-3">
		{#each AIM_CONTROLS as s (s.key)}
			<div>
				<label
					id={`settings-${s.key}-label`}
					for={`settings-${s.key}-range`}
					class="text-pad-text/85 block font-semibold"
				>
					{translate(OPT_AIM_COPY[s.key].label, locale)}
				</label>
				<p class="text-pad-muted mt-1 text-xs leading-snug">
					{translate(OPT_AIM_COPY[s.key].desc, locale)}
				</p>
			</div>
			<div class="flex items-center gap-3">
				<input
					id={`settings-${s.key}-range`}
					type="range"
					class="pad-range w-full"
					aria-labelledby={`settings-${s.key}-label`}
					style={`--pad-fill: ${aimDisplayFill(draftConfig, s.key)}%`}
					min={s.min}
					max={s.max}
					step={s.step}
					value={aimDisplayValue(draftConfig, s.key)}
					oninput={(e) => setNumber(s.key, e.currentTarget.value)}
				/>
				<input
					type="number"
					class="pad-number w-20 shrink-0 rounded-sm px-2 py-1 text-right font-mono text-sm"
					aria-label={m.aim_value_aria(
						{ label: translate(OPT_AIM_COPY[s.key].label, locale) },
						{ locale },
					)}
					min={s.min}
					max={s.max}
					step={s.step}
					value={aimDisplayValue(draftConfig, s.key).toFixed(s.dp)}
					onchange={(e) => setNumber(s.key, e.currentTarget.value)}
				/>
			</div>
		{/each}

		{@render boolRow(
			'settings-invertY',
			m.opt_invert_label({}, { locale }),
			m.opt_behavior_invert_desc({}, { locale }),
			draftProfile.invertY,
			(v) => setBool('invertY', v),
		)}

		{@render boolRow(
			'settings-lockPointer',
			m.opt_lock_label({}, { locale }),
			m.opt_behavior_lock_desc({}, { locale }),
			draftProfile.lockPointerOnClick,
			(v) => setBool('lockPointerOnClick', v),
		)}
	</div>

	<!-- Import / Export (active draft profile). -->
	<details class="mt-5">
		<summary class="text-pad-muted cursor-pointer">{m.opt_importexport({}, { locale })}</summary>
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
				{m.opt_copy_to_box({}, { locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={importFromBox}
			>
				{m.opt_apply_from_box({}, { locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={downloadProfile}
			>
				{m.opt_download({}, { locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={() => fileInput.click()}
			>
				{m.opt_upload({}, { locale })}
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				class="hidden"
				onchange={onUpload}
			/>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={downloadBundle}
			>
				{m.opt_export_all({}, { locale })}
			</button>
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
				onclick={() => bundleInput.click()}
			>
				{m.opt_import_all({}, { locale })}
			</button>
			<input
				bind:this={bundleInput}
				type="file"
				accept="application/json,.json"
				class="hidden"
				onchange={onUploadBundle}
			/>
		</div>
	</details>
</section>
