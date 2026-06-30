<script lang="ts">
	// Shared modal scrim + dialog semantics. Owns the fixed full-screen backdrop,
	// the dialog role / aria-modal / aria-label, outside-click close
	// (target === currentTarget), and Escape handling (preventDefault + onClose)
	// CONSISTENTLY for every modal. Individual dialogs supply only their card
	// content + focus-on-open. Presentational leaf: no business logic.
	import type { Snippet } from 'svelte';

	interface Props {
		onClose: () => void;
		ariaRole?: 'dialog' | 'alertdialog';
		ariaLabel: string;
		children: Snippet;
	}

	let { onClose, ariaRole = 'dialog', ariaLabel, children }: Props = $props();
</script>

<!-- Backdrop: click outside the card closes; Escape closes. -->
<div
	class="pad-backdrop fixed inset-0 z-50 grid place-items-center p-4"
	role={ariaRole}
	aria-modal="true"
	aria-label={ariaLabel}
	tabindex="-1"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}}
>
	{@render children()}
</div>
