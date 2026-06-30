<script lang="ts">
	// Page 2 — Game → Profile mapping (plan §7.2).
	//
	// Self-contained like SettingsPage: loads its own ProfilesState, subscribes to
	// `onProfilesChanged`, and writes durable changes through `writeProfilesState`.
	// One row per entry in `seenGames` (sorted by lastSeen desc), each pairing the
	// captured game name with a native <select> that sets/clears that game's
	// per-game default (`gameDefaults[productId]`). A reset glyph reverts a row to
	// the global default; it is disabled when the row has no override.
	import { onMount } from 'svelte';
	import { m } from '../core/i18n';
	import {
		clearGameDefault,
		normalizeProfilesState,
		setGameDefault,
		type ProfilesState,
	} from '../core/profiles';
	import {
		onProfilesChanged,
		readProfilesState,
		writeProfilesState,
	} from '../shared/profiles-storage';

	// Sentinel <select> value meaning "no per-game override → fall to global default".
	const GLOBAL_SENTINEL = '';

	let pstate = $state<ProfilesState>(normalizeProfilesState(undefined));

	// Display locale tracks the stored globals so copy matches the rest of Options.
	const locale = $derived(pstate.globals.locale);
	const profiles = $derived(pstate.profiles);

	// seenGames ⋈ gameDefaults → rows, most-recently-seen first.
	const rows = $derived(
		Object.entries(pstate.seenGames)
			.map(([productId, game]) => ({
				productId,
				name: game.name.trim() || prettifySlug(game.slug),
				lastSeen: game.lastSeen,
				profileId: pstate.gameDefaults[productId] ?? GLOBAL_SENTINEL,
			}))
			.sort((a, b) => b.lastSeen - a.lastSeen),
	);

	/** Prettify a hyphen-slug into a Title-Case label ("forza-horizon-5" -> "Forza Horizon 5"). */
	function prettifySlug(slug: string): string {
		return slug
			.split('-')
			.filter((w) => w.length > 0)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
	}

	/** Apply a <select> change: a profile id sets the default; the sentinel clears it. */
	function onChange(productId: string, value: string): void {
		const next =
			value === GLOBAL_SENTINEL
				? clearGameDefault(pstate, productId)
				: setGameDefault(pstate, productId, value);
		pstate = next;
		void writeProfilesState(next);
	}

	/** Reset a row to the global default (drop its per-game override). */
	function onReset(productId: string): void {
		const next = clearGameDefault(pstate, productId);
		pstate = next;
		void writeProfilesState(next);
	}

	onMount(() => {
		void readProfilesState().then((s) => (pstate = s));
		return onProfilesChanged((s) => (pstate = s));
	});
</script>

<h1 class="text-pad-accent m-0 text-xl">{m.opt_mapping_title({}, { locale })}</h1>
<p class="text-pad-muted mt-1 mb-4">{m.opt_mapping_intro({}, { locale })}</p>

{#if rows.length === 0}
	<div
		class="border-pad-border text-pad-muted mt-6 rounded-md border border-dashed px-4 py-10 text-center text-sm"
	>
		{m.opt_mapping_empty({}, { locale })}
	</div>
{:else}
	<section class="pad-panel-bg border-pad-border overflow-hidden rounded-md border">
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr class="text-pad-muted border-pad-border border-b text-left">
					<th class="px-4 py-2.5 font-normal tracking-widest uppercase"
						>{m.opt_mapping_col_game({}, { locale })}</th
					>
					<th class="px-4 py-2.5 font-normal tracking-widest uppercase"
						>{m.opt_mapping_col_profile({}, { locale })}</th
					>
					<th class="w-16 px-4 py-2.5 text-center font-normal tracking-widest uppercase"
						>{m.opt_mapping_col_reset({}, { locale })}</th
					>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.productId)}
					<tr class="border-pad-chip border-b last:border-b-0">
						<td class="text-pad-text/85 px-4 py-2.5 font-semibold">{row.name}</td>
						<td class="px-4 py-2.5">
							<select
								class="pad-number rounded-sm px-2 py-1 text-sm"
								aria-label={m.opt_mapping_select_aria({ game: row.name }, { locale })}
								value={row.profileId}
								onchange={(e) => onChange(row.productId, e.currentTarget.value)}
							>
								<option value={GLOBAL_SENTINEL}
									>{m.opt_mapping_global_default({}, { locale })}</option
								>
								{#each profiles as p (p.id)}
									<option value={p.id}>{p.name}</option>
								{/each}
							</select>
						</td>
						<td class="px-4 py-2.5 text-center">
							{#if row.profileId !== GLOBAL_SENTINEL}
								<button
									type="button"
									class="text-pad-muted hover:text-pad-accent cursor-pointer text-base leading-none"
									aria-label={m.opt_mapping_reset_aria({ game: row.name }, { locale })}
									title={m.opt_mapping_col_reset({}, { locale })}
									onclick={() => onReset(row.productId)}>↺</button
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}
