<script lang="ts">
	// Hard-block modal: shown when a user tries to bind an input whose key equals
	// a global shortcut (toggle/help combo). There is NO "proceed" — the only
	// affordance is acknowledge/close. Parent owns `open` and all business logic;
	// this is a presentational leaf.
	import { m } from '../core/i18n';
	import type { Locale } from '../core/i18n';

	interface Props {
		open: boolean;
		locale: Locale;
		inputLabel: string;
		comboKind: 'toggle' | 'help';
		onClose: () => void;
	}

	let { open, locale, inputLabel, comboKind, onClose }: Props = $props();

	let okButton = $state<HTMLButtonElement | null>(null);

	const title = $derived(m.opt_global_block_title({}, { locale }));
	const shortcutLabel = $derived(
		comboKind === 'toggle'
			? m.opt_shortcut_toggle({}, { locale })
			: m.opt_shortcut_help({}, { locale }),
	);
	const body = $derived(
		m.opt_global_block_body(
			{
				input: inputLabel,
				shortcut: shortcutLabel,
			},
			{ locale },
		),
	);
	const okLabel = $derived(m.opt_global_block_ok({}, { locale }));

	// Focus the acknowledge button whenever the modal opens.
	$effect(() => {
		if (open) okButton?.focus();
	});
</script>

{#if open}
	<!-- Backdrop: dim + blur the page; click outside closes. -->
	<div
		class="pad-backdrop fixed inset-0 z-50 grid place-items-center p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
		role="presentation"
	>
		<!-- Dialog: danger-accented hard-block card. -->
		<div
			class="text-pad-text pad-panel-bg w-full max-w-md rounded-lg border border-pad-danger-border p-5 shadow-pad-panel"
			role="alertdialog"
			aria-modal="true"
			aria-label={title}
		>
			<h2 class="text-pad-danger mb-2 text-lg font-semibold">{title}</h2>
			<p class="text-pad-muted mb-5 text-sm leading-relaxed">{body}</p>
			<div class="flex justify-end">
				<button
					bind:this={okButton}
					type="button"
					class="text-pad-bg cursor-pointer rounded-md border border-pad-danger-border bg-pad-danger px-3.5 py-2 text-sm font-semibold hover:brightness-110"
					onclick={onClose}
				>
					{okLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
