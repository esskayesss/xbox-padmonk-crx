<script lang="ts">
	// Hard-block modal: shown when a user tries to bind an input whose key equals
	// a global shortcut (toggle/help combo). There is NO "proceed" — the only
	// affordance is acknowledge/close. Parent owns `open` and all business logic;
	// this is a presentational leaf.
	import { m } from '../core/i18n';
	import type { Locale } from '../core/i18n';
	import ModalBackdrop from './ModalBackdrop.svelte';

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
	<ModalBackdrop {onClose} ariaRole="alertdialog" ariaLabel={title}>
		<!-- Dialog: danger-accented hard-block card. -->
		<div
			class="text-pad-text pad-panel-bg border-pad-danger-border w-full max-w-md rounded-lg border p-5 shadow-pad-panel"
		>
			<h2 class="text-pad-danger mb-2 text-lg font-semibold">{title}</h2>
			<p class="text-pad-muted mb-5 text-sm leading-relaxed">{body}</p>
			<div class="flex justify-end">
				<button
					bind:this={okButton}
					type="button"
					class="text-pad-bg border-pad-danger-border bg-pad-danger cursor-pointer rounded-md border px-3.5 py-2 text-sm font-semibold hover:brightness-110"
					onclick={onClose}
				>
					{okLabel}
				</button>
			</div>
		</div>
	</ModalBackdrop>
{/if}
