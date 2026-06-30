<script lang="ts">
	// What's-new promo page. Opened programmatically by the service worker on a
	// meaningful (minor/major) version bump — see service-worker.ts onInstalled.
	// Locale is resolved from the durable profiles store; degrades to baseLocale
	// when storage is unavailable (e.g. opened directly outside the extension).
	import { onMount } from 'svelte';
	import { m, baseLocale, type Locale } from '../core/i18n';
	import { readProfilesState } from '../shared/profiles-storage';

	const RATE_URL =
		'https://redirects.esskayesss.dev/padmonk-ext?utm_source=padmonk-ext&utm_medium=whatsnew&utm_campaign=rate';
	const SPONSOR_URL =
		'https://redirects.esskayesss.dev/sponsor-github?utm_source=padmonk-ext&utm_medium=whatsnew&utm_campaign=support';
	const COFFEE_URL =
		'https://redirects.esskayesss.dev/sponsor-coffee?utm_source=padmonk-ext&utm_medium=whatsnew&utm_campaign=support';

	// Release-specific changelog. Authored INLINE in English on purpose: this
	// content describes THIS release and is not part of the translated message
	// catalogue (only the surrounding chrome is localised).
	const CHANGES = [
		'Bind profiles — create multiple named control profiles',
		'Per-game defaults — the right profile auto-loads per game',
		'Switch profiles from the in-game overlay',
		'Conflict-safe rebinding — every control is rebindable',
		'Two-page Advanced Settings',
	];

	let locale = $state<Locale>(baseLocale);
	// Manifest version for the header chip. Guarded: chrome.* is absent when the
	// page is opened directly (dev preview) rather than as an extension page.
	let version = $state<string>('');

	onMount(() => {
		try {
			version = chrome?.runtime?.getManifest?.()?.version ?? '';
		} catch {
			/* chrome.* unavailable */
		}
		void (async () => {
			try {
				const state = await readProfilesState();
				if (state?.globals?.locale) locale = state.globals.locale;
			} catch {
				/* storage unavailable — keep baseLocale */
			}
		})();
	});

	function dismiss(): void {
		window.close();
	}
</script>

<main class="bg-pad-bg text-pad-text flex min-h-screen items-center justify-center p-6 font-sans">
	<section
		class="pad-panel-bg border-pad-accent/40 w-full max-w-md rounded-lg border p-6 shadow-pad-panel"
	>
		<header class="flex items-baseline justify-between gap-3">
			<div class="text-2xl font-semibold tracking-wide uppercase">padmonk</div>
			{#if version}
				<span class="text-pad-muted text-2xs tracking-widest uppercase">v{version}</span>
			{/if}
		</header>
		<h1 class="text-pad-accent mt-1 text-lg font-semibold">
			{m.whatsnew_title({}, { locale })}
		</h1>

		<section class="mt-5">
			<h2 class="text-pad-muted text-2xs font-semibold tracking-widest uppercase">
				{m.whatsnew_changes_heading({}, { locale })}
			</h2>
			<ul class="mt-2 grid gap-2">
				{#each CHANGES as change (change)}
					<li class="flex items-start gap-2 text-sm leading-snug">
						<span class="text-pad-accent mt-0.5 shrink-0">▸</span>
						<span>{change}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="pad-surface mt-5 grid gap-3 rounded-md border p-4">
			<p class="text-sm leading-snug">
				{m.whatsnew_rate_blurb({}, { locale })}
			</p>
			<div class="grid gap-2">
				<a
					href={RATE_URL}
					target="_blank"
					rel="noreferrer"
					class="bg-pad-accent text-pad-ink hover:bg-pad-key rounded-sm px-3 py-2 text-center text-sm font-black tracking-wide uppercase"
				>
					{m.whatsnew_rate({}, { locale })}
				</a>
				<div class="grid grid-cols-2 gap-2">
					<a
						href={SPONSOR_URL}
						target="_blank"
						rel="noreferrer"
						class="bg-pad-sponsor text-pad-sponsor-soft hover:bg-pad-sponsor-strong border-pad-sponsor/70 rounded-sm border px-3 py-2 text-center text-xs font-black tracking-wide uppercase"
					>
						{m.whatsnew_sponsor({}, { locale })}
					</a>
					<a
						href={COFFEE_URL}
						target="_blank"
						rel="noreferrer"
						class="border-pad-coffee-border bg-pad-coffee text-pad-coffee-text hover:bg-pad-coffee-hover rounded-sm border px-3 py-2 text-center text-xs font-black tracking-wide uppercase"
					>
						{m.whatsnew_coffee({}, { locale })}
					</a>
				</div>
			</div>
		</section>

		<div class="mt-5 flex justify-end">
			<button
				type="button"
				class="bg-pad-chip text-pad-text border-pad-border hover:border-pad-accent cursor-pointer rounded-sm border px-4 py-2 text-xs font-semibold tracking-wide uppercase"
				onclick={dismiss}
			>
				{m.whatsnew_dismiss({}, { locale })}
			</button>
		</div>
	</section>
</main>
