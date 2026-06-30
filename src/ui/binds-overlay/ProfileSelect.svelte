<script lang="ts">
	// Bind Profiles dropselect — a custom (NOT native <select>) profile switcher
	// rendered inside the binds-overlay shadow root, sat in the overlay header
	// beside the existing shortcut chips.
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
	import { t } from '../../core/i18n';
	import type { Locale, MessageKey } from '../../core/i18n';

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

	function onTriggerKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!open) openPanel();
			return;
		}
		if ((e.key === 'Enter' || e.key === ' ') && !open) {
			e.preventDefault();
			openPanel();
		}
	}

	function onPanelKeydown(e: KeyboardEvent) {
		if (!profiles.length) return;
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlight = (highlight + 1) % profiles.length;
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlight = (highlight - 1 + profiles.length) % profiles.length;
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
				e.preventDefault();
				closePanel(true);
				break;
			case 'Tab':
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

	const triggerLabel = $derived(
		t('overlay_profile_select' as MessageKey, locale, { name: activeName }),
	);
	const panelLabel = $derived(t('overlay_profile_panel_label' as MessageKey, locale));
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
		aria-expanded={open}
		aria-label={triggerLabel}
		onclick={toggle}
		onkeydown={onTriggerKeydown}
	>
		<span class="max-w-32 truncate">{activeName}</span>
		<span class="text-pad-muted text-xs leading-none" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div
			class="pad-panel-bg border-pad-accent/40 absolute right-0 z-50 mt-1 max-h-64 min-w-44 overflow-auto rounded-sm border p-1 shadow-lg"
			role="listbox"
			aria-label={panelLabel}
			tabindex="-1"
			onkeydown={onPanelKeydown}
		>
			{#each profiles as profile, i (profile.id)}
				{@const isActive = profile.id === activeProfileId}
				{@const isHighlight = i === highlight}
				<div
					class="flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1.5 text-sm"
					class:border-pad-accent={isActive}
					class:text-pad-accent={isActive}
					class:border-transparent={!isActive}
					class:bg-pad-chip={isHighlight}
					role="option"
					aria-selected={isActive}
					tabindex="-1"
					onclick={() => pick(profile.id)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							pick(profile.id);
						}
					}}
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
