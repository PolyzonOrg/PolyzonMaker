<script module lang="ts">
	/** Open dialogs, the top one last: Escape and Tab belong to it alone. */
	const stack: object[] = [];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import * as m from '$msg/common';

	interface Props {
		open?: boolean;
		title: string;
		children: Snippet;
		footer?: Snippet;
		size?: 'sm' | 'md' | 'lg' | 'media' | 'window';
		placement?: 'center' | 'sheet';
		dismissible?: boolean;
		showClose?: boolean;
		onClose?: () => void;
	}

	let {
		open = $bindable(false),
		title,
		children,
		footer,
		size = 'md',
		placement = 'center',
		dismissible = true,
		showClose = true,
		onClose
	}: Props = $props();

	let panel = $state<HTMLElement>();
	/** A press that began on the backdrop: a drag let go past the panel is no click on it. */
	let pressedBackdrop = false;

	const focusableSelector = [
		'a[href]',
		'button:not([disabled])',
		'input:not([disabled])',
		'select:not([disabled])',
		'textarea:not([disabled])',
		'[tabindex]:not([tabindex="-1"])'
	].join(',');

	function close() {
		if (!dismissible) return;
		// The window is a route (DESIGN_CODE §7.8): it leaves with it, handing the focus back.
		if (size !== 'window') open = false;
		onClose?.();
	}

	$effect(() => {
		if (!open) return;
		const self = {};
		stack.push(self);
		const returnFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousOverflow = document.documentElement.style.overflow;
		document.documentElement.style.overflow = 'hidden';

		queueMicrotask(() => {
			const initial = panel?.querySelector<HTMLElement>('[data-autofocus]');
			const first = panel?.querySelector<HTMLElement>(focusableSelector);
			(initial ?? first ?? panel)?.focus();
		});

		function onKeydown(event: KeyboardEvent) {
			if (stack.at(-1) !== self) return;
			if (event.key === 'Escape' && dismissible) {
				event.preventDefault();
				close();
				return;
			}
			if (event.key !== 'Tab' || !panel) return;

			const focusable = [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter(
				(element) => !element.hasAttribute('hidden') && element.offsetParent !== null
			);
			if (focusable.length === 0) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1)!;
			// Focus lost to the page (a form action resets it): back into the panel.
			if (!panel.contains(document.activeElement)) {
				event.preventDefault();
				first.focus();
				return;
			}
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}

		document.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('keydown', onKeydown);
			stack.splice(stack.indexOf(self), 1);
			document.documentElement.style.overflow = previousOverflow;
			queueMicrotask(() => {
				if (returnFocus?.isConnected) returnFocus.focus();
			});
		};
	});
</script>

{#if open}
	<div
		class:dialog-backdrop-sheet={placement === 'sheet'}
		class:dialog-backdrop-window={size === 'window'}
		class="dialog-backdrop"
		role="presentation"
		onpointerdown={(event) => {
			pressedBackdrop = event.target === event.currentTarget;
		}}
		onclick={(event) => {
			if (pressedBackdrop && event.target === event.currentTarget) close();
		}}
	>
		<div
			bind:this={panel}
			tabindex="-1"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			class:dialog-sheet={placement === 'sheet'}
			class="dialog-panel dialog-{size}"
		>
			<!-- A plain block, not <header>: inside the page it would become a second
			     banner landmark (axe landmark-no-duplicate-banner). -->
			<div class="dialog-header">
				<h2>{title}</h2>
				{#if showClose}
					<button type="button" class="icon-btn" aria-label={m.common_close()} onclick={close}>
						<X size={20} aria-hidden="true" />
					</button>
				{/if}
			</div>
			<div class="dialog-body">{@render children()}</div>
			{#if footer}<div class="dialog-footer">{@render footer()}</div>{/if}
		</div>
	</div>
{/if}

<style>
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--pz-space-4);
		background: var(--pz-dialog-backdrop);
		overscroll-behavior: contain;
		animation: dialog-backdrop-in var(--pz-duration-base) var(--pz-ease-standard);
	}
	.dialog-panel {
		max-height: min(86dvh, 760px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--pz-radius-panel);
		/* Rendered in place: never inherit the trigger's weight or alignment. */
		color: var(--pz-color-text);
		background: var(--pz-color-raised);
		box-shadow: var(--pz-shadow-pop);
		font-size: var(--pz-text-sm);
		font-weight: 400;
		text-align: left;
		animation: dialog-panel-in var(--pz-duration-base) var(--pz-ease-standard);
	}
	.dialog-sm {
		width: min(100%, 400px);
	}
	.dialog-md {
		width: min(100%, 520px);
	}
	.dialog-lg {
		width: min(100%, 760px);
	}
	.dialog-media {
		width: min(100%, 1120px);
	}
	/* The window (DESIGN_CODE §7.8): the whole screen, the page it opened over blurred. */
	.dialog-backdrop-window {
		backdrop-filter: var(--pz-dialog-blur);
	}
	.dialog-window {
		width: min(100%, 1280px);
		height: 100%;
		max-height: none;
	}
	.dialog-header {
		min-height: 56px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pz-space-4);
		padding: var(--pz-space-2) var(--pz-space-4) var(--pz-space-2) var(--pz-space-6);
		border-bottom: 1px solid var(--pz-color-border);
	}
	/* The dialog title is a section title (DESIGN_CODE §7.8): 16/24/600. */
	h2 {
		margin: 0;
		min-width: 0;
		font-size: var(--pz-text-md);
		font-weight: 600;
		line-height: 1.5rem;
		/* Titles may quote user text (chat names); never push the close button away. */
		overflow-wrap: anywhere;
	}
	.dialog-body {
		min-height: 0;
		overflow: auto;
		padding: var(--pz-space-6);
	}
	.dialog-footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--pz-space-2);
		padding: var(--pz-space-4) var(--pz-space-6) var(--pz-space-6);
	}

	@keyframes dialog-backdrop-in {
		from {
			opacity: 0;
		}
	}
	@keyframes dialog-panel-in {
		from {
			opacity: 0;
			transform: translateY(var(--pz-space-2)) scale(0.98);
		}
	}

	@media (max-width: 639px) {
		.dialog-backdrop {
			align-items: flex-end;
			padding: 0;
		}
		.dialog-panel {
			width: 100%;
			max-height: min(90dvh, 760px);
			border-radius: var(--pz-radius-media) var(--pz-radius-media) 0 0;
			border-bottom: 0;
		}
		/* Clear of the iPhone home indicator: a sheet pads its own bottom (its
		   paper runs to the edge), a floating dialog keeps the gap above it. */
		.dialog-backdrop-sheet .dialog-panel {
			padding-bottom: env(safe-area-inset-bottom);
		}
		.dialog-backdrop:not(.dialog-backdrop-sheet) {
			padding: var(--pz-space-3) var(--pz-space-3)
				calc(var(--pz-space-3) + env(safe-area-inset-bottom));
		}
		.dialog-backdrop:not(.dialog-backdrop-sheet) .dialog-panel {
			border-radius: var(--pz-radius-panel);
		}
		.dialog-panel.dialog-window {
			height: 100%;
			max-height: none;
			border-radius: 0;
		}
		.dialog-header {
			padding-left: var(--pz-space-4);
		}
		.dialog-body {
			padding-inline: var(--pz-space-4);
		}
		.dialog-footer {
			flex-direction: column;
			padding: var(--pz-space-4);
		}
		.dialog-footer :global(:is(.btn, .btn-primary, .btn-ghost, .btn-danger)) {
			width: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dialog-backdrop,
		.dialog-panel {
			animation: none;
		}
	}
</style>
