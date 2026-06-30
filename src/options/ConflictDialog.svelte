<script lang="ts">
	// In-profile reuse confirmation dialog.
	//
	// Leaf, presentational component: shown when a user assigns an input that is
	// already bound to a DIFFERENT action in the SAME profile. It asks the user
	// to confirm unbinding the current control before reusing the input. No
	// business logic — the parent owns `open` and the confirm/cancel actions.
	import { m, type Locale } from '../core/i18n';

	interface Props {
		open: boolean;
		locale: Locale;
		inputLabel: string; // e.g. "W" (already prettified)
		currentControlLabel: string; // e.g. "Left stick · Up"
		newControlLabel: string; // e.g. "D-pad · Up"
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open,
		locale,
		inputLabel,
		currentControlLabel,
		newControlLabel,
		onConfirm,
		onCancel,
	}: Props = $props();

	const title = $derived(m.opt_conflict_title({}, { locale }));
	const body = $derived(
		m.opt_conflict_body(
			{
				input: inputLabel,
				current: currentControlLabel,
				next: newControlLabel,
			},
			{ locale },
		),
	);
	const confirmLabel = $derived(m.opt_conflict_confirm({}, { locale }));
	const cancelLabel = $derived(m.opt_conflict_cancel({}, { locale }));

	let cancelButton = $state<HTMLButtonElement | null>(null);

	// Focus the safe (Cancel) default whenever the dialog opens.
	$effect(() => {
		if (open) cancelButton?.focus();
	});
</script>

{#if open}
	<!-- Backdrop: click outside the card cancels; Escape cancels. -->
	<div
		class="pad-backdrop fixed inset-0 z-50 grid place-items-center p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onCancel();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onCancel();
			}
		}}
	>
		<!-- Card -->
		<div
			class="text-pad-text pad-panel-bg border-pad-accent/40 w-full max-w-sm rounded-lg border p-5 shadow-pad-panel"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
		>
			<h2 class="text-pad-accent m-0 mb-2 text-base font-semibold">{title}</h2>
			<p class="text-pad-text/85 mb-5 text-sm leading-relaxed">{body}</p>
			<div class="flex justify-end gap-2.5">
				<button
					bind:this={cancelButton}
					type="button"
					class="bg-pad-chip text-pad-text border-pad-border cursor-pointer rounded-md border px-3.5 py-2 text-sm hover:brightness-125"
					onclick={onCancel}
				>
					{cancelLabel}
				</button>
				<button
					type="button"
					class="border-pad-danger-border text-pad-danger cursor-pointer rounded-md border bg-transparent px-3.5 py-2 text-sm font-semibold hover:brightness-125"
					onclick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
