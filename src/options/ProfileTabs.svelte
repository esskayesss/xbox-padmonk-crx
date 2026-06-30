<script lang="ts">
	// Bind Profiles tab strip — a horizontally-scrollable row of profile tabs for
	// the Options Settings page. Pure presentational leaf: no chrome.*, no
	// storage, no business logic. The integrator owns every side effect via the
	// callback props; this file only tracks local UI state (which tab is being
	// renamed, the edit buffer, and whether the overflow menu is open).
	//
	// Interaction model:
	//   - click an INACTIVE tab        -> onSelect(id)
	//   - click the ACTIVE tab         -> enter inline rename (native <input>)
	//   - trailing "+"                 -> onAdd()
	//   - "⋮" on the active tab        -> popover with Duplicate / Delete
	//
	// Rename uses a real <input type="text"> (NOT contenteditable), styled to
	// match the tab. Commit on Enter/blur (only when non-empty AND changed),
	// discard on Escape. The parent re-normalizes (dedupe/clamp) so validation
	// here stays light (just trim). The overflow menu closes on outside pointer
	// down (window listener, bound only while open) and on Escape.
	import { m } from '../core/i18n';
	import type { Locale } from '../core/i18n';

	interface Props {
		profiles: { id: string; name: string }[];
		activeProfileId: string;
		locale: Locale;
		onSelect: (id: string) => void;
		onRename: (id: string, name: string) => void; // commit a new name
		onAdd: () => void; // add a blank/new profile
		onDuplicate: (id: string) => void;
		onDelete: (id: string) => void; // parent guards last-profile
		canDelete?: boolean; // false hides the Delete menu item (last profile)
	}
	let {
		profiles,
		activeProfileId,
		locale,
		onSelect,
		onRename,
		onAdd,
		onDuplicate,
		onDelete,
		canDelete = true,
	}: Props = $props();

	// Swallow on our own subtree so the trailing menu's clicks never bubble up to
	// a tab (which would trip rename) or the page.
	const stop = (e: Event) => e.stopPropagation();

	// Local UI state only.
	let editingId = $state<string | null>(null); // tab currently in rename mode
	let editValue = $state(''); // rename buffer
	let menuOpen = $state(false); // overflow popover open?
	let rootEl: HTMLDivElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);

	function beginRename(profile: { id: string; name: string }): void {
		menuOpen = false;
		editingId = profile.id;
		editValue = profile.name;
	}

	function commitRename(): void {
		const id = editingId;
		if (id == null) return;
		const next = editValue.trim();
		const current = profiles.find((p) => p.id === id)?.name ?? '';
		editingId = null;
		// Only commit a real, non-empty change. Parent re-normalizes the rest.
		if (next && next !== current) onRename(id, next);
	}

	function cancelRename(): void {
		editingId = null;
	}

	function onTabClick(profile: { id: string; name: string }): void {
		if (editingId === profile.id) return; // already editing this tab
		if (profile.id === activeProfileId) beginRename(profile);
		else onSelect(profile.id);
	}

	function onTabKeydown(e: KeyboardEvent, profile: { id: string; name: string }): void {
		if (editingId === profile.id) return; // input owns its own keys
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onTabClick(profile);
		}
	}

	function onInputKeydown(e: KeyboardEvent): void {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelRename();
		}
	}

	// Auto-focus + select-all when the rename input mounts.
	$effect(() => {
		if (editingId && inputEl) {
			inputEl.focus();
			inputEl.select();
		}
	});

	// Outside-interaction close for the overflow menu. Bound only while open; the
	// $effect cleanup detaches it on close/destroy.
	$effect(() => {
		if (!menuOpen) return;
		const onWindowPointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (rootEl && target && !rootEl.contains(target)) menuOpen = false;
		};
		const onWindowKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') menuOpen = false;
		};
		window.addEventListener('pointerdown', onWindowPointerDown, true);
		window.addEventListener('keydown', onWindowKeydown, true);
		return () => {
			window.removeEventListener('pointerdown', onWindowPointerDown, true);
			window.removeEventListener('keydown', onWindowKeydown, true);
		};
	});

	const addLabel = $derived(m.opt_profile_add({}, { locale }));
	const menuLabel = $derived(m.opt_profile_menu({}, { locale }));
	const duplicateLabel = $derived(m.opt_profile_duplicate({}, { locale }));
	const deleteLabel = $derived(m.opt_profile_delete({}, { locale }));
</script>

<div
	bind:this={rootEl}
	class="flex items-stretch gap-1 overflow-x-auto pad-thin-scrollbar"
	role="tablist"
>
	{#each profiles as profile (profile.id)}
		{@const isActive = profile.id === activeProfileId}
		{@const isEditing = editingId === profile.id}
		<div class="relative flex shrink-0 items-stretch">
			{#if isEditing}
				<!-- Inline rename: a native <input> styled to match the tab. -->
				<input
					bind:this={inputEl}
					type="text"
					class="border-pad-accent text-pad-accent bg-pad-chip min-w-24 max-w-44 rounded-sm border px-3 py-1.5 text-sm outline-none"
					value={editValue}
					aria-label={m.opt_profile_rename_aria({ name: profile.name }, { locale })}
					oninput={(e) => (editValue = e.currentTarget.value)}
					onkeydown={onInputKeydown}
					onblur={commitRename}
					onpointerdown={stop}
					onclick={stop}
				/>
			{:else}
				<button
					type="button"
					class="flex max-w-44 cursor-pointer items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm
						{isActive
						? 'border-pad-accent text-pad-accent bg-pad-chip'
						: 'border-pad-border text-pad-text hover:bg-pad-key/10'}"
					role="tab"
					aria-selected={isActive}
					aria-label={m.opt_profile_tab_aria({ name: profile.name }, { locale })}
					onclick={() => onTabClick(profile)}
					onkeydown={(e) => onTabKeydown(e, profile)}
				>
					<span class="min-w-0 truncate">{profile.name}</span>
					{#if isActive}
						<!-- Overflow trigger: stop propagation so it doesn't trip rename. -->
						<span
							class="text-pad-muted hover:text-pad-accent -mr-1 cursor-pointer px-1 text-base leading-none"
							role="button"
							tabindex="0"
							aria-haspopup="menu"
							aria-expanded={menuOpen}
							aria-label={menuLabel}
							title={menuLabel}
							onclick={(e) => {
								stop(e);
								menuOpen = !menuOpen;
							}}
							onpointerdown={stop}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									stop(e);
									menuOpen = !menuOpen;
								}
							}}
						>
							⋮
						</span>
					{/if}
				</button>

				{#if isActive && menuOpen}
					<div
						class="pad-panel-bg border-pad-accent/40 absolute top-full right-0 z-50 mt-1 min-w-32 rounded-sm border p-1 shadow-pad-panel"
						role="menu"
						tabindex="-1"
						onpointerdown={stop}
					>
						<button
							type="button"
							class="text-pad-text hover:bg-pad-chip flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm"
							role="menuitem"
							onclick={(e) => {
								stop(e);
								menuOpen = false;
								onDuplicate(activeProfileId);
							}}
						>
							{duplicateLabel}
						</button>
						{#if canDelete}
							<button
								type="button"
								class="text-pad-danger hover:bg-pad-chip flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm"
								role="menuitem"
								onclick={(e) => {
									stop(e);
									menuOpen = false;
									onDelete(activeProfileId);
								}}
							>
								{deleteLabel}
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/each}

	<!-- Trailing add button: always visible at the strip end. -->
	<button
		type="button"
		class="border-pad-border text-pad-muted hover:text-pad-accent hover:bg-pad-key/10 flex shrink-0 cursor-pointer items-center rounded-sm border px-3 py-1.5 text-base leading-none"
		aria-label={addLabel}
		title={addLabel}
		onclick={onAdd}
	>
		+
	</button>
</div>
