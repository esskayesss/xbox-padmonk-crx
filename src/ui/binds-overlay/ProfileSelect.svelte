<script lang="ts">
	// Bind Profiles dropselect — a custom (NOT native <select>) profile switcher
	// rendered inside the binds-overlay shadow root, sat in the overlay header
	// beside the existing shortcut chips.
	//
	// ARIA combobox-with-listbox pattern: focus STAYS on the trigger button at
	// all times. The trigger owns `aria-haspopup="listbox"`, `aria-expanded`,
	// `aria-controls`, and `aria-activedescendant` (pointing at the highlighted
	// option's id), so a screen reader announces the roving highlight without the
	// DOM focus ever leaving the trigger. All keyboard navigation therefore lives
	// on the TRIGGER's onkeydown — the listbox panel is a sibling that is never
	// focused, so a handler there would be dead.
	//
	// Pure presentational: no chrome.*, no storage, no business logic. Local
	// state is only open/closed + the roving keyboard highlight index. The
	// integrator owns the actual profile-switch side effect via `onSelect`.
	//
	// Shadow-root etiquette (mirrors BindsOverlay.svelte):
	//   - `stop` discipline on the component's own pointer events so clicks
	//     inside don't bubble to the page or trip the overlay backdrop's
	//     click-to-close.
	//   - a window pointerdown listener (only while open) closes the panel on
	//     any outside interaction; it is torn down on close/destroy.
	import { m } from '../../core/i18n';
	import type { Locale } from '../../core/i18n';

	interface Props {
		profiles: { id: string; name: string }[];
		activeProfileId: string;
		locale: Locale;
		onSelect: (id: string) => void;
	}
	let { profiles, activeProfileId, locale, onSelect }: Props = $props();

	// Second line of defense (see overlay): swallow on our own subtree so the
	// backdrop click-to-close + the page underneath never see these events.
	const stop = (e: Event) => e.stopPropagation();

	let open = $state(false);
	let highlight = $state(0);
	let rootEl: HTMLDivElement | null = $state(null);
	let triggerEl: HTMLButtonElement | null = $state(null);

	// Stable ids so the trigger's aria-controls/aria-activedescendant can address
	// the listbox + the highlighted option (roving virtual focus).
	const listboxId = 'padm0nk-profile-listbox';
	const optionId = (i: number) => `${listboxId}-opt-${i}`;

	const activeIndex = $derived(
		Math.max(
			0,
			profiles.findIndex((p) => p.id === activeProfileId),
		),
	);
	const activeName = $derived(
		profiles.find((p) => p.id === activeProfileId)?.name ?? profiles[0]?.name ?? '',
	);

	function openPanel() {
		highlight = activeIndex;
		open = true;
	}

	function closePanel(refocus = false) {
		open = false;
		if (refocus) triggerEl?.focus();
	}

	function toggle() {
		if (open) closePanel();
		else openPanel();
	}

	function pick(id: string) {
		onSelect(id);
		closePanel(true);
	}

	// All keyboard nav lives here because the TRIGGER holds focus the whole time.
	function onTriggerKeydown(e: KeyboardEvent) {
		if (!open) {
			// CLOSED: any of these opens the panel (seeded to the active profile).
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openPanel();
			}
			return;
		}

		// OPEN: roving highlight + select/close. preventDefault on the nav/commit
		// keys stops page scroll and native button activation (Enter/Space).
		if (!profiles.length) {
			if (e.key === 'Escape') {
				e.stopPropagation();
				e.preventDefault();
				closePanel(true);
			}
			return;
		}
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlight = Math.min(highlight + 1, profiles.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlight = Math.max(highlight - 1, 0);
				break;
			case 'Home':
				e.preventDefault();
				highlight = 0;
				break;
			case 'End':
				e.preventDefault();
				highlight = profiles.length - 1;
				break;
			case 'Enter':
			case ' ': {
				e.preventDefault();
				const p = profiles[highlight];
				if (p) pick(p.id);
				break;
			}
			case 'Escape':
				// Close the dropdown ONLY. stopPropagation so Escape does NOT bubble
				// to the overlay backdrop (which would close the whole overlay).
				e.stopPropagation();
				e.preventDefault();
				closePanel(true);
				break;
			case 'Tab':
				// Let focus move naturally; just dismiss the panel.
				closePanel();
				break;
		}
	}

	// Outside-interaction close. Lives over a game in a shadow root, so we watch
	// window pointerdown and close when the target is outside our root. Bound
	// only while open; the $effect cleanup detaches it on close/destroy.
	$effect(() => {
		if (!open) return;
		const onWindowPointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (rootEl && target && !rootEl.contains(target)) closePanel();
		};
		window.addEventListener('pointerdown', onWindowPointerDown, true);
		return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
	});

	const triggerLabel = $derived(m.overlay_profile_select({ name: activeName }, { locale }));
	const panelLabel = $derived(m.overlay_profile_panel_label({}, { locale }));
</script>

<div
	bind:this={rootEl}
	class="relative inline-block"
	onpointerdown={stop}
	onmousedown={stop}
	onmouseup={stop}
	onclick={stop}
	role="presentation"
>
	<button
		bind:this={triggerEl}
		type="button"
		class="pad-surface text-pad-text hover:bg-pad-key/10 flex cursor-pointer items-center gap-1.5 rounded-sm border px-3 py-2 text-sm"
		aria-haspopup="listbox"
		role="combobox"
		aria-expanded={open}
		aria-controls={listboxId}
		aria-activedescendant={open ? optionId(highlight) : undefined}
		aria-label={triggerLabel}
		onclick={toggle}
		onkeydown={onTriggerKeydown}
	>
		<span class="max-w-32 truncate">{activeName}</span>
		<span class="text-pad-muted text-xs leading-none" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div
			id={listboxId}
			class="pad-panel-bg border-pad-accent/40 absolute right-0 z-50 mt-1 max-h-64 min-w-44 overflow-auto rounded-sm border p-1 shadow-lg"
			role="listbox"
			aria-label={panelLabel}
			aria-activedescendant={optionId(highlight)}
			tabindex="-1"
		>
			{#each profiles as profile, i (profile.id)}
				{@const isActive = profile.id === activeProfileId}
				{@const isHighlight = i === highlight}
				<!-- Roving virtual focus: keyboard nav lives on the trigger via
				     aria-activedescendant, so options carry no own key handler. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					id={optionId(i)}
					class="flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1.5 text-sm"
					class:border-pad-accent={isActive}
					class:text-pad-accent={isActive}
					class:border-transparent={!isActive}
					class:bg-pad-chip={isHighlight}
					role="option"
					aria-selected={isHighlight}
					tabindex="-1"
					onclick={() => pick(profile.id)}
					onmouseenter={() => (highlight = i)}
				>
					<span class="min-w-0 flex-1 truncate">{profile.name}</span>
					{#if isActive}
						<span class="text-pad-accent text-xs leading-none" aria-hidden="true">✓</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
