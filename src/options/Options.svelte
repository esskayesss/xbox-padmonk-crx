<script lang="ts">
	// Two-page Advanced Settings shell. See plan §7.
	//
	// Thin shell only: it owns the page-level chrome (sponsor banner + footer) and
	// a hash-routed top tab bar ("Settings" / "Game mapping"). The pages
	// themselves (SettingsPage / MappingPage) are self-contained — they load and
	// persist their own state. The language selector that used to live in this
	// header now lives inside SettingsPage's Global Settings card.
	import { onMount } from 'svelte';
	import { baseLocale, m } from '../core/i18n';
	import { onProfilesChanged, readProfilesState } from '../shared/profiles-storage';
	import SettingsPage from './SettingsPage.svelte';
	import MappingPage from './MappingPage.svelte';
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

	type Page = 'settings' | 'mapping';

	/** Map the URL hash to a page (default = settings). */
	function pageFromHash(): Page {
		return location.hash.replace(/^#\/?/, '') === 'mapping' ? 'mapping' : 'settings';
	}

	let page = $state<Page>('settings');
	let locale = $state<Locale>(baseLocale);

	function go(next: Page): void {
		location.hash = `#/${next}`;
	}

	onMount(() => {
		page = pageFromHash();
		const onHash = (): void => {
			page = pageFromHash();
		};
		window.addEventListener('hashchange', onHash);
		void readProfilesState().then((s) => (locale = s.globals.locale));
		const unsub = onProfilesChanged((s) => (locale = s.globals.locale));
		return () => {
			window.removeEventListener('hashchange', onHash);
			unsub();
		};
	});

	const tabClass = (active: boolean): string =>
		`cursor-pointer rounded-md px-4 py-2 text-sm font-semibold ${
			active
				? 'bg-pad-chip text-pad-accent border border-pad-accent'
				: 'text-pad-muted border border-transparent hover:text-pad-accent'
		}`;
</script>

<div
	class="text-pad-text mx-auto min-h-screen max-w-3xl px-5 pt-7 pb-16 font-sans text-sm leading-relaxed"
>
	<section
		class="bg-pad-sponsor text-pad-sponsor-soft border-pad-sponsor-strong mb-4 flex flex-col gap-3 rounded-md border px-4 py-3 shadow-pad-hud sm:flex-row sm:items-center sm:justify-between"
	>
		<div>
			<div class="text-sm font-black tracking-wide uppercase">
				❤ {m.opt_support_title({}, { locale })}
			</div>
			<div class="text-pad-sponsor-soft/85 text-xs">
				{m.opt_support_subtitle({}, { locale })}
			</div>
		</div>
		<div class="flex gap-2">
			<a
				href={GITHUB_SPONSORS_URL}
				target="_blank"
				rel="noreferrer"
				class="bg-pad-sponsor-soft text-pad-sponsor-strong rounded-sm px-3 py-1 text-xs font-black uppercase hover:brightness-95"
			>
				{m.opt_support_github_sponsors({}, { locale })}
			</a>
			<a
				href={BUY_ME_COFFEE_URL}
				target="_blank"
				rel="noreferrer"
				class="border-pad-coffee-border bg-pad-coffee text-pad-coffee-text hover:bg-pad-coffee-hover rounded-sm border px-3 py-1 text-xs font-black uppercase"
			>
				{m.opt_support_coffee({}, { locale })}
			</a>
		</div>
	</section>

	<!-- Top-level page tabs (hash-routed). -->
	<nav class="border-pad-border mb-6 flex gap-2 border-b pb-3" aria-label="Settings pages">
		<button
			type="button"
			class={tabClass(page === 'settings')}
			aria-current={page === 'settings' ? 'page' : undefined}
			onclick={() => go('settings')}
		>
			{m.opt_tab_settings({}, { locale })}
		</button>
		<button
			type="button"
			class={tabClass(page === 'mapping')}
			aria-current={page === 'mapping' ? 'page' : undefined}
			onclick={() => go('mapping')}
		>
			{m.opt_tab_mapping({}, { locale })}
		</button>
	</nav>

	{#if page === 'mapping'}
		<MappingPage />
	{:else}
		<SettingsPage />
	{/if}

	<footer
		class="border-pad-border text-pad-muted mt-10 flex flex-wrap items-center gap-4 border-t pt-4 text-xs"
	>
		<a
			href={GITHUB_REPO_URL}
			target="_blank"
			rel="noreferrer"
			class="text-pad-accent hover:underline"
		>
			{m.opt_footer_repo({}, { locale })}
		</a>
		<a href={WEBSITE_URL} target="_blank" rel="noreferrer" class="text-pad-accent hover:underline">
			{m.opt_footer_web({}, { locale })}
		</a>
		<a
			href={BUG_REPORT_URL}
			target="_blank"
			rel="noreferrer"
			class="text-pad-accent hover:underline"
		>
			{m.opt_footer_bug({}, { locale })}
		</a>
	</footer>
</div>
