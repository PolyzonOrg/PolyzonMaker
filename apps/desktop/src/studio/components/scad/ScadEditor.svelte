<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { Maximize2, Minimize2, Search, WrapText } from 'lucide-svelte';
	// Whole-statement type import: an inline `{ type X }` survives as a side-effect
	// import under verbatimModuleSyntax and would drag CodeMirror into SSR.
	import type { ScadEditorHandle } from '$lib/openscad/editor';
	import type { ScadDiagnostic } from '$lib/openscad/diagnostics';
	import {
		fullscreenKey,
		initialWrap,
		statusMessage,
		wrapFocus
	} from '$lib/openscad/editor-chrome';
	import { currentLocale } from '$lib/i18n/current';
	import { decimalMark } from '$lib/i18n/locale';
	import * as m from '$msg/scad';

	interface Props {
		/** The source; user edits are written back synchronously (`bind:value`). */
		value: string;
		/** Fires only for the user's own edits — programmatic replacements do not echo. */
		onChange: (code: string) => void;
		errorLine?: number | null;
		diagnostics?: ScadDiagnostic[];
		status?: 'idle' | 'compiling' | 'error' | 'ok';
		elapsedMs?: number;
		/** Ctrl/⌘+Enter */
		onRun?: () => void;
		/** Ctrl/⌘+S */
		onSave?: () => void;
		/** Extra header controls (the page's «Отменить замену»). */
		actions?: Snippet;
		/** Stands in for OpenSCAD. */
		language?: import('@codemirror/state').Extension;
		heading?: string;
	}

	let {
		value = $bindable(),
		onChange,
		errorLine = null,
		diagnostics = [],
		status = 'idle',
		elapsedMs = 0,
		onRun,
		onSave,
		actions,
		language,
		heading
	}: Props = $props();

	const WRAP_KEY = 'scad:wrap';
	const uid = $props.id();
	const helpId = `${uid}-help`;

	let root = $state<HTMLDivElement>();
	let host = $state<HTMLDivElement>();
	let fallback = $state<HTMLTextAreaElement>();
	let fullscreenButton = $state<HTMLButtonElement>();
	// Raw: the handle is a plain object with methods, not something to proxy.
	let editor = $state.raw<ScadEditorHandle | null>(null);
	let loadFailed = $state(false);
	let fullscreen = $state(false);
	let wrap = $state(false);
	let cursor = $state({ line: 1, col: 1 });
	let modLabel = $state('Ctrl');
	/** Last value we pushed out; lets the value effect skip echoes of our own edits. */
	let lastEmitted: string | null = null;

	const lineCount = $derived(value.split('\n').length);
	const errorMessage = $derived(statusMessage(diagnostics));

	/** Single write path for both the CodeMirror view and the fallback textarea. */
	function emit(code: string) {
		lastEmitted = code;
		value = code;
		onChange(code);
	}

	export function focusLine(line: number) {
		if (editor) editor.goToLine(line);
		else fallback?.focus();
	}

	onMount(() => {
		let cancelled = false;
		try {
			wrap = initialWrap(localStorage.getItem(WRAP_KEY), window.innerWidth);
		} catch {
			/* private mode */
		}
		modLabel = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘' : 'Ctrl';

		void (async () => {
			try {
				// The only place CodeMirror is reached: one lazy chunk, client-only.
				const { createScadEditor } = await import('$lib/openscad/editor');
				if (cancelled || !host) return;
				const hadFocus = document.activeElement === fallback;
				const selection = fallback
					? ([fallback.selectionStart, fallback.selectionEnd] as const)
					: null;
				const handle = createScadEditor(host, {
					doc: value,
					language,
					wrap,
					ariaLabel: m.scad_editor_code_label(),
					ariaDescribedBy: helpId,
					onChange: emit,
					onCursor: (pos) => (cursor = pos),
					onRun: () => onRun?.(),
					onSave: () => onSave?.()
				});
				lastEmitted = value;
				editor = handle;
				if (hadFocus) {
					handle.focus();
					if (selection) handle.setSelection(selection[0], selection[1]);
				}
			} catch (error) {
				console.error('[scad-editor] CodeMirror failed to load', error);
				loadFailed = true;
			}
		})();

		return () => {
			cancelled = true;
			editor?.destroy();
			editor = null;
		};
	});

	// Page → document: LLM/template replacement, «Отменить замену», draft restore.
	$effect(() => {
		const next = value;
		const handle = editor;
		if (!handle || next === lastEmitted) return;
		lastEmitted = next;
		handle.setValue(next);
	});

	$effect(() => {
		const handle = editor;
		const items = diagnostics;
		if (handle) handle.setDiagnostics(items);
	});

	function toggleWrap() {
		wrap = !wrap;
		editor?.setWrap(wrap);
		try {
			localStorage.setItem(WRAP_KEY, wrap ? '1' : '0');
		} catch {
			/* private mode */
		}
	}

	$effect(() => {
		if (!fullscreen) return;
		const previousOverflow = document.documentElement.style.overflow;
		document.documentElement.style.overflow = 'hidden';
		editor?.refresh();
		queueMicrotask(() => {
			if (editor) editor.focus();
			else fallback?.focus();
		});
		return () => {
			document.documentElement.style.overflow = previousOverflow;
			editor?.refresh();
			queueMicrotask(() => {
				if (fullscreenButton?.isConnected) fullscreenButton.focus();
			});
		};
	});

	const focusableSelector = [
		'a[href]',
		'button:not([disabled])',
		'input:not([disabled])',
		'select:not([disabled])',
		'textarea:not([disabled])',
		'[contenteditable="true"]',
		'[tabindex]:not([tabindex="-1"])'
	].join(',');

	function onRootKeydown(event: KeyboardEvent) {
		const action = fullscreenKey(event, fullscreen);
		if (action === 'close') {
			event.preventDefault();
			fullscreen = false;
			return;
		}
		if (action !== 'trap' || !root) return;
		const focusable = [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(
			(element) => !element.hasAttribute('hidden') && element.offsetParent !== null
		);
		const active = focusable.indexOf(document.activeElement as HTMLElement);
		const next = wrapFocus(focusable.length, active, event.shiftKey);
		if (next === null) return;
		event.preventDefault();
		focusable[next].focus();
	}
</script>

<div
	bind:this={root}
	class="scad-editor"
	class:is-fullscreen={fullscreen}
	role={fullscreen ? 'dialog' : undefined}
	aria-modal={fullscreen ? 'true' : undefined}
	aria-label={fullscreen ? m.scad_editor_dialog_label() : undefined}
	onkeydown={onRootKeydown}
>
	<div class="pane-head">
		<span class="shrink-0">{heading ?? m.scad_editor_title()}</span>
		<div class="scad-toolbar flex min-w-0 items-center gap-1">
			<span class="mr-1 hidden truncate text-xs font-normal tabular-nums text-neutral-400 sm:inline"
				>{m.scad_editor_size({ lines: lineCount, chars: value.length })}</span
			>
			{@render actions?.()}
			<button
				type="button"
				class="icon-btn"
				aria-pressed={wrap}
				aria-label={m.scad_editor_wrap()}
				title={m.scad_editor_wrap()}
				onclick={toggleWrap}
			>
				<WrapText size={20} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="icon-btn"
				aria-label={m.scad_editor_search({ keys: `${modLabel}+F` })}
				title={m.scad_editor_search({ keys: `${modLabel}+F` })}
				disabled={!editor}
				onclick={() => editor?.openSearch()}
			>
				<Search size={20} aria-hidden="true" />
			</button>
			<button
				bind:this={fullscreenButton}
				type="button"
				class="icon-btn"
				aria-label={fullscreen ? m.scad_editor_collapse_label() : m.scad_editor_expand_label()}
				title={fullscreen ? m.scad_editor_collapse() : m.scad_editor_expand()}
				onclick={() => (fullscreen = !fullscreen)}
			>
				{#if fullscreen}
					<Minimize2 size={20} aria-hidden="true" />
				{:else}
					<Maximize2 size={20} aria-hidden="true" />
				{/if}
			</button>
		</div>
	</div>

	<div bind:this={host} class="scad-editor-host">
		{#if !editor}
			<!-- SSR / pre-CodeMirror / no-JS editor: same metrics, so the swap moves nothing. -->
			<textarea
				bind:this={fallback}
				class="scad-editor-fallback"
				{value}
				oninput={(event) => emit(event.currentTarget.value)}
				spellcheck="false"
				aria-label={m.scad_editor_code_label()}
				aria-describedby={helpId}></textarea>
		{/if}
	</div>

	<div
		class="editor-statusbar flex min-h-9 items-center justify-between gap-3 border-t border-border px-4 text-xs text-neutral-400"
	>
		<span class="shrink-0 tabular-nums"
			>{m.scad_editor_cursor({ line: cursor.line, col: cursor.col })}</span
		>
		<span class="flex min-w-0 items-center gap-2" role={fullscreen ? 'status' : undefined}>
			{#if status === 'compiling'}
				<span class="truncate"
					>{m.scad_compiling_for({
						seconds: (elapsedMs / 1000).toFixed(1).replace('.', decimalMark(currentLocale()))
					})}</span
				>
			{:else if status === 'error'}
				<span class="truncate text-red-300">
					{#if errorLine !== null}{m.scad_editor_error_line({
							line: errorLine
						})}{:else}{errorMessage ?? m.scad_compile_error()}{/if}
				</span>
				{#if errorLine !== null}
					<button
						type="button"
						class="hit-44 relative shrink-0 underline hover:text-neutral-100"
						onclick={() => focusLine(errorLine)}
					>
						{m.scad_go_to_line({ line: errorLine })}
					</button>
				{/if}
			{:else if status === 'ok'}
				<span class="truncate">{m.scad_editor_built()}</span>
			{:else if loadFailed}
				<span class="truncate">{m.scad_editor_plain()}</span>
			{/if}
		</span>
		<!-- The editor column is a 360px splitter pane by default, whatever the
		     viewport: an unshrinkable hint spilled 300+px over the status text.
		     It now yields to the status and hides while the pane is narrow. -->
		<p
			id={helpId}
			class="editor-hint hidden min-w-0 truncate xl:block"
			title={m.scad_editor_keys({ mod: modLabel })}
		>
			{m.scad_editor_keys({ mod: modLabel })}
		</p>
	</div>
</div>

<style>
	/* Touch: the toolbar's 36px buttons get 8px between them, so their 44px
	   boxes do not overlap (DESIGN_CODE §12). The desktop pane is too narrow. */
	@media (pointer: coarse) {
		.scad-toolbar {
			gap: var(--pz-space-2);
		}
	}
	/* Keyboard hint: takes only the space left after the status text and
	   disappears while the editor pane is narrower than 40rem (container
	   query, not viewport — the pane is a splitter, not the window). */
	.editor-statusbar {
		container-type: inline-size;
	}
	.editor-hint {
		flex: 1 1 0;
		text-align: right;
	}
	@container (max-width: 39.99rem) {
		.editor-hint {
			display: none;
		}
	}

	.scad-editor {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		background: var(--pz-color-surface);
		/* Shared metrics for the fallback textarea and the CodeMirror theme. */
		--scad-code-size: var(--pz-text-xs);
	}
	/* Overlay on the same element: the EditorView and the toggle button survive.
	   60 sits above the header/lightbox (50) and below ToastHost (70) and Dialog (80). */
	.scad-editor.is-fullscreen {
		position: fixed;
		inset: 0;
		z-index: 60;
		padding-top: env(safe-area-inset-top);
		padding-bottom: env(safe-area-inset-bottom);
		background: var(--pz-color-page);
		--scad-code-size: var(--pz-text-sm);
	}
	/* Touch: 16px keeps iOS from zooming the field (DESIGN_CODE §7), controls reach 44px. */
	@media (max-width: 1023px) {
		.scad-editor,
		.scad-editor.is-fullscreen {
			--scad-code-size: var(--pz-text-md);
			--scad-control-size: 44px;
			--scad-option-size: 36px;
		}
	}
	.scad-editor-host {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		background: var(--pz-color-subtle);
	}
	.scad-editor-fallback {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: var(--pz-space-4) var(--pz-space-4) var(--pz-space-4)
			calc(var(--pz-space-12) + var(--pz-space-3));
		border: 0;
		outline: none;
		resize: none;
		white-space: pre;
		tab-size: 2;
		font: var(--scad-code-size) / 1.625 var(--pz-font-mono);
		color: var(--pz-color-text);
		background: var(--pz-color-subtle);
	}
</style>
