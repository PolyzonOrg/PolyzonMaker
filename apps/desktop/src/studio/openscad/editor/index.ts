/**
 * The OpenSCAD editor: one lazily loaded chunk that assembles CodeMirror 6.
 * `ScadEditor.svelte` reaches it only through `import()`, so nothing here may
 * run during SSR and none of it lands in the route's initial bundle.
 */
import {
	Annotation,
	Compartment,
	EditorState,
	Prec,
	RangeSet,
	StateEffect,
	StateField,
	type Extension
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	GutterMarker,
	crosshairCursor,
	drawSelection,
	dropCursor,
	gutterLineClass,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
	type DecorationSet
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
	bracketMatching,
	foldGutter,
	foldKeymap,
	indentOnInput,
	indentUnit
} from '@codemirror/language';
import {
	highlightSelectionMatches,
	openSearchPanel,
	search,
	searchKeymap
} from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { clampLine, type ScadDiagnostic } from '../diagnostics';
import { scad } from './language';
import { scadAutocompletion } from './complete';
import { scadTheme } from './theme';
import { scadPhrases } from './phrases';
import { detectIndentUnit } from './tokenizer';

export interface ScadEditorOptions {
	/** Stands in for OpenSCAD. */
	language?: Extension;
	doc: string;
	wrap: boolean;
	ariaLabel: string;
	ariaDescribedBy?: string;
	/** Fires for the user's own edits only, never for `setValue`. */
	onChange: (code: string) => void;
	onCursor?: (pos: { line: number; col: number; lines: number }) => void;
	/** Mod-Enter */
	onRun?: () => void;
	/** Mod-S */
	onSave?: () => void;
}

export interface ScadEditorHandle {
	getValue(): string;
	/** Replaces the document (undoable) when it differs; does not fire `onChange`. */
	setValue(code: string): void;
	/** `[]` clears. The first error (else warning) with a line gets the line background. */
	setDiagnostics(items: ScadDiagnostic[]): void;
	goToLine(line: number): void;
	setSelection(anchor: number, head?: number): void;
	setWrap(on: boolean): void;
	openSearch(): void;
	focus(): void;
	hasFocus(): boolean;
	/** Re-measure after the container changed size (fullscreen toggle). */
	refresh(): void;
	destroy(): void;
}

/** Marks a programmatic replacement so the update listener does not echo it back. */
const External = Annotation.define<boolean>();

const setErrorLine = StateEffect.define<number | null>();
const errorLineDecoration = Decoration.line({ class: 'cm-scad-error-line' });
const errorGutterMarker = new (class extends GutterMarker {
	elementClass = 'cm-scad-error-gutter';
})();

/** Line background + line-number badge for the compile error; follows edits until the next compile. */
const errorLineField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, tr) {
		decorations = decorations.map(tr.changes);
		for (const effect of tr.effects) {
			if (!effect.is(setErrorLine)) continue;
			if (effect.value === null) return Decoration.none;
			const line = tr.state.doc.line(clampLine(tr.state.doc.lines, effect.value));
			return Decoration.set(errorLineDecoration.range(line.from));
		}
		return decorations;
	},
	provide: (field) => [
		EditorView.decorations.from(field),
		gutterLineClass.compute([field], (state) => {
			let markers = RangeSet.empty as RangeSet<GutterMarker>;
			state.field(field).between(0, state.doc.length, (from) => {
				markers = RangeSet.of(errorGutterMarker.range(from));
				return false;
			});
			return markers;
		})
	]
});

function toLintDiagnostics(state: EditorState, items: ScadDiagnostic[]): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const item of items) {
		if (item.line === null) continue;
		const line = state.doc.line(clampLine(state.doc.lines, item.line));
		const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
		out.push({
			from: Math.min(line.from + indent, line.to),
			to: line.to,
			severity: item.severity,
			source: 'OpenSCAD',
			message: item.message
		});
	}
	return out;
}

export function createScadEditor(parent: HTMLElement, opts: ScadEditorOptions): ScadEditorHandle {
	const wrapCompartment = new Compartment();
	const indentCompartment = new Compartment();

	const extensions: Extension[] = [
		// The language first: it supplies indentation, folding and languageData for the rest.
		opts.language ?? scad(),
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightSpecialChars(),
		history(),
		foldGutter(),
		drawSelection(),
		dropCursor(),
		EditorState.allowMultipleSelections.of(true),
		indentOnInput(),
		bracketMatching(),
		closeBrackets(),
		opts.language ? [] : scadAutocompletion(),
		rectangularSelection(),
		crosshairCursor(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		// The search panel sits above the code: it stays visible over a mobile keyboard.
		search({ top: true }),
		// Own bindings first: defaultKeymap maps Mod-Enter to insertBlankLine.
		Prec.high(
			keymap.of([
				{
					key: 'Mod-Enter',
					scope: 'editor search-panel',
					preventDefault: true,
					run: () => {
						opts.onRun?.();
						return true;
					}
				},
				{
					key: 'Mod-s',
					scope: 'editor search-panel',
					preventDefault: true,
					run: () => {
						opts.onSave?.();
						return true;
					}
				}
			])
		),
		// defaultKeymap last: its Escape (simplifySelection) must yield to search/completion.
		keymap.of([
			...closeBracketsKeymap,
			...searchKeymap,
			...completionKeymap,
			...lintKeymap,
			...historyKeymap,
			...foldKeymap,
			indentWithTab,
			...defaultKeymap
		]),
		indentCompartment.of(indentUnit.of(detectIndentUnit(opts.doc))),
		EditorState.tabSize.of(2),
		wrapCompartment.of(opts.wrap ? EditorView.lineWrapping : []),
		EditorState.phrases.of(scadPhrases()),
		EditorView.contentAttributes.of({
			// contenteditable is already reachable with Tab; the explicit tabindex
			// lets checkers (axe scrollable-region-focusable) see that the
			// scrolling .cm-scroller holds focusable content.
			tabindex: '0',
			'aria-label': opts.ariaLabel,
			...(opts.ariaDescribedBy ? { 'aria-describedby': opts.ariaDescribedBy } : {})
		}),
		errorLineField,
		scadTheme,
		EditorView.updateListener.of((update) => {
			if (update.docChanged && !update.transactions.some((tr) => tr.annotation(External))) {
				opts.onChange(update.state.doc.toString());
			}
			if (update.docChanged || update.selectionSet || update.focusChanged) {
				const head = update.state.selection.main.head;
				const line = update.state.doc.lineAt(head);
				opts.onCursor?.({
					line: line.number,
					col: head - line.from + 1,
					lines: update.state.doc.lines
				});
			}
		})
	];

	const view = new EditorView({
		parent,
		state: EditorState.create({ doc: opts.doc, extensions })
	});

	return {
		getValue: () => view.state.doc.toString(),
		setValue(code) {
			if (view.state.doc.toString() === code) return;
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: code },
				selection: { anchor: 0 },
				effects: [
					EditorView.scrollIntoView(0),
					indentCompartment.reconfigure(indentUnit.of(detectIndentUnit(code)))
				],
				annotations: External.of(true)
			});
		},
		setDiagnostics(items) {
			const primary =
				items.find((d) => d.severity === 'error' && d.line !== null) ??
				items.find((d) => d.line !== null);
			view.dispatch(setDiagnostics(view.state, toLintDiagnostics(view.state, items)), {
				effects: setErrorLine.of(primary?.line ?? null)
			});
		},
		goToLine(line) {
			const target = view.state.doc.line(clampLine(view.state.doc.lines, line));
			view.dispatch({
				selection: { anchor: target.from },
				effects: EditorView.scrollIntoView(target.from, { y: 'center' })
			});
			view.focus();
		},
		setSelection(anchor, head = anchor) {
			const max = view.state.doc.length;
			view.dispatch({
				selection: { anchor: Math.min(anchor, max), head: Math.min(head, max) },
				scrollIntoView: true
			});
		},
		setWrap(on) {
			view.dispatch({ effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []) });
		},
		openSearch: () => {
			openSearchPanel(view);
		},
		focus: () => view.focus(),
		hasFocus: () => view.hasFocus,
		refresh: () => view.requestMeasure(),
		destroy: () => view.destroy()
	};
}
