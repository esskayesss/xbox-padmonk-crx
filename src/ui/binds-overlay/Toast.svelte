<script lang="ts">
	// Auto-load toast — a transient, passive status chip that flashes
	// "Loaded ⟨profile⟩ for ⟨game⟩" (~2.2s) when a per-game default profile
	// auto-loads on navigation into a game. MAIN-world; rendered in the shadow
	// root alongside the HUD/overlay (theme tokens injected there as compiledCss).
	//
	// Purely presentational: no chrome.*, no storage. The parent feeds a
	// monotonically-changing `toast` (the `id` bumps on every new toast so
	// re-showing the same profile/game retriggers the timer) plus `locale`.
	//
	// Colors come ONLY from theme tokens (text-pad-*, bg-pad-*, pad-panel-bg,
	// border-pad-accent) — no raw hex.
	import { m } from '../../core/i18n';
	import type { Locale } from '../../core/i18n';

	interface Props {
		// A monotonically-changing toast; null when nothing to show. The `id` bumps
		// on each new toast so re-showing the same profile/game retriggers the timer.
		toast: { id: number; profileName: string; gameName: string } | null;
		locale: Locale;
	}
	let { toast, locale }: Props = $props();

	const SHOW_MS = 2200;

	let visible = $state(false);

	// Retrigger on every new toast id: show, then auto-dismiss after SHOW_MS.
	// Clears the prior timer on retrigger AND on destroy (effect cleanup).
	$effect(() => {
		// Track id (+ presence) so a new toast with the same names still fires.
		const id = toast?.id;
		if (id == null) {
			visible = false;
			return;
		}
		visible = true;
		const timer = setTimeout(() => {
			visible = false;
		}, SHOW_MS);
		return () => clearTimeout(timer);
	});

	// Visible "Loaded ⟨profile⟩ for ⟨game⟩" string via the compiled accessor.
	function loadedText(profile: string, game: string): string {
		return m.overlay_toast_loaded({ profile, game }, { locale });
	}
</script>

{#if toast}
	<div
		class="pointer-events-none fixed inset-x-0 top-6 z-10 flex justify-center px-4"
		role="status"
		aria-live="polite"
	>
		<div
			class="pad-panel-bg border-pad-accent/60 text-pad-text flex max-w-[min(92vw,28rem)] items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-lg transition-all duration-200 ease-out"
			class:opacity-100={visible}
			class:opacity-0={!visible}
			class:translate-y-0={visible}
			class:-translate-y-2={!visible}
		>
			<span
				class="bg-pad-accent inline-block size-2 shrink-0 rounded-full"
				style="box-shadow: 0 0 8px color-mix(in srgb, var(--color-pad-accent) 70%, transparent);"
				aria-hidden="true"
			></span>
			<span class="truncate">{loadedText(toast.profileName, toast.gameName)}</span>
		</div>
	</div>
{/if}
