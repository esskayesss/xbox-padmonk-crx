<script lang="ts">
	// Page 2 — Game → Profile mapping (STUB for Phase 5).
	//
	// Placeholder only: Phase 5 fills this with the seenGames ⋈ gameDefaults table
	// (dropdown per game + reset). For now it shows a titled empty-state. It loads
	// just the active locale so the copy is translated like the rest of Options.
	import { onMount } from 'svelte';
	import { baseLocale, m } from '../core/i18n';
	import { onProfilesChanged, readProfilesState } from '../shared/profiles-storage';
	import type { Locale } from '../core/i18n';

	let locale = $state<Locale>(baseLocale);

	onMount(() => {
		void readProfilesState().then((s) => (locale = s.globals.locale));
		return onProfilesChanged((s) => (locale = s.globals.locale));
	});
</script>

<h1 class="text-pad-accent m-0 text-xl">{m.opt_tab_mapping({}, { locale })}</h1>
<div
	class="border-pad-border text-pad-muted mt-6 rounded-md border border-dashed px-4 py-10 text-center text-sm"
>
	{m.opt_mapping_empty({}, { locale })}
</div>
