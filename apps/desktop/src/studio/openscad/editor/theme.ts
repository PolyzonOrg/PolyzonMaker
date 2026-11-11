/**
 * Editor chrome and syntax colours, all through design tokens (DESIGN_CODE
 * §9 «Редактор кода»). Every base-theme rule of CodeMirror that carries a
 * raw colour is overridden here; geometry comes from the same place so the
 * no-JS textarea fallback can match it (`--scad-code-size`, line-height 1.625).
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const scadHighlightStyle = HighlightStyle.define([
	// Keywords are ink like the text around them (no brand colour): weight sets them apart.
	{ tag: t.keyword, color: 'var(--pz-code-keyword)', fontWeight: '700' },
	{ tag: t.modifier, color: 'var(--pz-code-modifier)', fontWeight: '600' },
	{ tag: [t.number, t.bool, t.null, t.constant(t.variableName)], color: 'var(--pz-code-number)' },
	{ tag: [t.string, t.special(t.string)], color: 'var(--pz-code-string)' },
	{ tag: t.comment, color: 'var(--pz-code-comment)' },
	{ tag: t.docComment, color: 'var(--pz-code-definition)', fontWeight: '600' },
	{ tag: t.special(t.comment), color: 'var(--pz-code-annotation)' },
	{
		tag: [t.standard(t.function(t.variableName)), t.special(t.variableName)],
		color: 'var(--pz-code-builtin)'
	},
	{ tag: t.function(t.variableName), color: 'var(--pz-code-definition)' },
	{
		tag: [t.definition(t.function(t.variableName)), t.definition(t.variableName)],
		color: 'var(--pz-code-definition)',
		fontWeight: '600'
	},
	{ tag: t.propertyName, color: 'var(--pz-code-annotation)' },
	{ tag: [t.operator, t.punctuation], color: 'var(--pz-code-operator)' },
	{ tag: t.invalid, color: 'var(--pz-color-error-text)', textDecoration: 'underline dotted' }
]);

const keyboardFocusRing = { outline: '2px solid var(--pz-color-focus)', outlineOffset: '2px' };

const editorTheme = EditorView.theme(
	{
		// The base theme pins `position: relative !important`; the host is a
		// fixed-height flex item, so 100% fills it (the textarea fallback is absolute).
		'&': {
			height: '100%',
			background: 'var(--pz-color-subtle)',
			color: 'var(--pz-color-text)',
			fontSize: 'var(--scad-code-size, var(--pz-text-xs))'
		},
		// No ring around the editor: the caret and the active line show the focus
		// (the base theme would draw a dotted one).
		'&.cm-focused': { outline: 'none' },
		'.cm-scroller': {
			fontFamily: 'var(--pz-font-mono)',
			lineHeight: '1.625',
			overflow: 'auto'
		},
		'.cm-content': { padding: 'var(--pz-space-4) 0', caretColor: 'var(--pz-color-text)' },
		'.cm-line': { padding: '0 var(--pz-space-4) 0 var(--pz-space-3)' },
		'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--pz-color-text)' },
		// The full selector ties the base theme's focused rule; source order then wins.
		'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
			{ background: 'rgb(var(--pz-rgb-accent) / 0.28)' },
		'.cm-selectionMatch': { background: 'rgb(var(--pz-rgb-accent) / 0.14)' },
		'.cm-searchMatch .cm-selectionMatch': { background: 'transparent' },
		// Line backgrounds paint over the selection layer: keep them translucent.
		'.cm-activeLine': { background: 'rgb(var(--pz-rgb-text) / 0.04)' },
		'.cm-line.cm-scad-error-line': { background: 'rgb(var(--pz-rgb-error) / 0.08)' },
		'&.cm-focused .cm-matchingBracket': {
			background: 'rgb(var(--pz-rgb-accent) / 0.18)',
			outline: '1px solid rgb(var(--pz-rgb-accent) / 0.5)'
		},
		'&.cm-focused .cm-nonmatchingBracket': {
			background: 'rgb(var(--pz-rgb-error) / 0.2)',
			outline: '1px solid var(--pz-color-error-text)'
		},
		'.cm-searchMatch': { background: 'rgb(var(--pz-rgb-warning) / 0.28)' },
		'.cm-searchMatch.cm-searchMatch-selected': { background: 'rgb(var(--pz-rgb-accent) / 0.4)' },
		'.cm-specialChar': { color: 'var(--pz-color-error-text)' },
		'.cm-placeholder': { color: 'var(--pz-color-text-muted)' },

		// Gutters
		'.cm-gutters': {
			background: 'var(--pz-color-subtle)',
			color: 'var(--pz-color-text-muted)',
			borderRight: '1px solid var(--pz-color-border)'
		},
		'.cm-lineNumbers .cm-gutterElement': {
			padding: '0 var(--pz-space-2) 0 var(--pz-space-3)',
			fontWeight: '500'
		},
		'.cm-activeLineGutter': {
			background: 'rgb(var(--pz-rgb-text) / 0.04)',
			color: 'var(--pz-color-text)'
		},
		'.cm-lineNumbers .cm-scad-error-gutter': {
			background: 'var(--pz-color-error)',
			color: 'var(--pz-color-text-inverse)',
			borderRadius: 'var(--pz-radius-xs)'
		},
		'.cm-foldGutter .cm-gutterElement': {
			color: 'var(--pz-color-text-muted)',
			cursor: 'pointer',
			padding: '0 var(--pz-space-1)'
		},
		'.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--pz-color-text)' },
		'.cm-foldPlaceholder': {
			background: 'var(--pz-color-raised)',
			border: '1px solid var(--pz-color-border)',
			color: 'var(--pz-color-text-muted)',
			borderRadius: 'var(--pz-radius-xs)',
			margin: '0 var(--pz-space-1)',
			padding: '0 var(--pz-space-1)'
		},

		// Panels: search, go-to-line, lint list
		'.cm-panels': {
			background: 'var(--pz-color-surface)',
			color: 'var(--pz-color-text)',
			fontFamily: 'var(--pz-font-sans)',
			fontSize: 'var(--pz-text-xs)'
		},
		'.cm-panels-top': { borderBottom: '1px solid var(--pz-color-border)' },
		'.cm-panels-bottom': { borderTop: '1px solid var(--pz-color-border)' },
		'.cm-panel.cm-search': {
			padding: 'var(--pz-space-2) var(--pz-space-10) var(--pz-space-2) var(--pz-space-3)'
		},
		'.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
			margin: 'var(--pz-space-1) var(--pz-space-2) var(--pz-space-1) 0'
		},
		'.cm-panel.cm-search label': {
			fontSize: 'var(--pz-text-xs)',
			display: 'inline-flex',
			alignItems: 'center',
			gap: 'var(--pz-space-1)',
			minHeight: 'var(--scad-control-size, 36px)',
			whiteSpace: 'nowrap'
		},
		'.cm-panel.cm-search input[type=checkbox]': {
			width: '18px',
			height: '18px',
			margin: '0',
			accentColor: 'var(--pz-color-accent-app)'
		},
		'.cm-textfield': {
			font: 'inherit',
			fontSize: 'var(--pz-text-xs)',
			minHeight: 'var(--scad-control-size, 36px)',
			padding: '0 var(--pz-space-3)',
			background: 'var(--pz-color-raised)',
			border: '1px solid var(--pz-color-border)',
			borderRadius: 'var(--pz-radius-control)',
			color: 'var(--pz-color-text)'
		},
		'.cm-button': {
			font: 'inherit',
			fontSize: 'var(--pz-text-xs)',
			fontWeight: '650',
			minHeight: 'var(--scad-control-size, 36px)',
			padding: '0 var(--pz-space-3)',
			backgroundImage: 'none',
			background: 'var(--pz-color-surface)',
			border: '1px solid var(--pz-color-border)',
			borderRadius: 'var(--pz-radius-control)',
			color: 'var(--pz-color-text)',
			cursor: 'pointer'
		},
		'.cm-button:hover, .cm-button:active': {
			backgroundImage: 'none',
			background: 'var(--pz-color-subtle)'
		},
		'.cm-textfield:focus-visible': {
			outline: 'none',
			borderColor: 'var(--pz-color-text-tertiary)'
		},
		'.cm-button:focus-visible, .cm-panel [name=close]:focus-visible': keyboardFocusRing,
		'.cm-panel.cm-search [name=close]': {
			top: 'var(--pz-space-1)',
			right: 'var(--pz-space-2)',
			minWidth: 'var(--scad-control-size, 36px)',
			minHeight: 'var(--scad-control-size, 36px)',
			color: 'var(--pz-color-text-muted)',
			borderRadius: 'var(--pz-radius-control)',
			fontSize: 'var(--pz-text-md)',
			cursor: 'pointer'
		},
		'.cm-panel.cm-search [name=close]:hover': { color: 'var(--pz-color-text)' },
		'.cm-panel.cm-panel-lint ul': { fontFamily: 'var(--pz-font-sans)' },
		'.cm-panel.cm-panel-lint ul [aria-selected]': {
			background: 'rgb(var(--pz-rgb-accent) / 0.16)'
		},
		'.cm-panel.cm-panel-lint ul:focus [aria-selected]': {
			background: 'rgb(var(--pz-rgb-accent) / 0.24)',
			color: 'var(--pz-color-text)'
		},
		'.cm-panel.cm-panel-lint [name=close]': {
			color: 'var(--pz-color-text-muted)',
			cursor: 'pointer'
		},

		// Tooltips: completion list, completion info, lint hover
		'.cm-tooltip': {
			background: 'var(--pz-color-raised)',
			border: '1px solid var(--pz-color-border)',
			borderRadius: 'var(--pz-radius-sm)',
			color: 'var(--pz-color-text)',
			boxShadow: 'none'
		},
		'.cm-tooltip-section:not(:first-child)': { borderTop: '1px solid var(--pz-color-border)' },
		'.cm-tooltip-above .cm-tooltip-arrow:before': { borderTopColor: 'var(--pz-color-border)' },
		'.cm-tooltip-above .cm-tooltip-arrow:after': { borderTopColor: 'var(--pz-color-raised)' },
		'.cm-tooltip-below .cm-tooltip-arrow:before': { borderBottomColor: 'var(--pz-color-border)' },
		'.cm-tooltip-below .cm-tooltip-arrow:after': { borderBottomColor: 'var(--pz-color-raised)' },
		'.cm-tooltip.cm-tooltip-autocomplete > ul': {
			fontFamily: 'var(--pz-font-mono)',
			fontSize: 'var(--pz-text-xs)',
			minWidth: '260px',
			maxHeight: '14em'
		},
		'.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
			padding: 'var(--pz-space-1) var(--pz-space-2)',
			lineHeight: '1.5',
			minHeight: 'var(--scad-option-size, 28px)',
			borderLeft: '2px solid transparent'
		},
		'.cm-tooltip-autocomplete ul li[aria-selected]': {
			background: 'rgb(var(--pz-rgb-accent) / 0.16)',
			color: 'var(--pz-color-text)',
			borderLeftColor: 'var(--pz-color-accent)'
		},
		'.cm-completionMatchedText': {
			textDecoration: 'none',
			color: 'var(--pz-color-accent-text)',
			fontWeight: '600'
		},
		'.cm-completionDetail': {
			color: 'var(--pz-color-text-muted)',
			fontStyle: 'normal',
			marginLeft: 'var(--pz-space-2)'
		},
		'.cm-tooltip.cm-completionInfo': {
			fontFamily: 'var(--pz-font-sans)',
			fontSize: 'var(--pz-text-xs)',
			lineHeight: '1.4',
			padding: 'var(--pz-space-2) var(--pz-space-3)',
			maxWidth: '280px',
			color: 'var(--pz-color-text-secondary)'
		},
		'.cm-snippetField': { background: 'rgb(var(--pz-rgb-accent) / 0.16)' },
		'.cm-snippetFieldPosition': { borderLeftColor: 'var(--pz-color-text-muted)' },
		'.cm-completionListIncompleteTop:before, .cm-completionListIncompleteBottom:after': {
			color: 'var(--pz-color-text-muted)'
		},

		// Diagnostics
		'.cm-diagnostic': {
			fontFamily: 'var(--pz-font-sans)',
			fontSize: 'var(--pz-text-xs)',
			padding: 'var(--pz-space-2) var(--pz-space-3)',
			borderLeftWidth: '3px'
		},
		'.cm-diagnostic-error': { borderLeftColor: 'var(--pz-color-error-text)' },
		'.cm-diagnostic-warning': { borderLeftColor: 'var(--pz-color-warning)' },
		'.cm-diagnostic-info': { borderLeftColor: 'var(--pz-color-info)' },
		'.cm-diagnostic-hint': { borderLeftColor: 'var(--pz-color-text-muted)' },
		'.cm-diagnosticAction': {
			background: 'var(--pz-color-subtle)',
			color: 'var(--pz-color-text)',
			borderRadius: 'var(--pz-radius-xs)'
		},
		'.cm-lintRange-error': {
			backgroundImage: 'none',
			textDecoration: 'underline wavy var(--pz-color-error-text)',
			textDecorationSkipInk: 'none',
			textUnderlineOffset: '2px'
		},
		'.cm-lintRange-warning': {
			backgroundImage: 'none',
			textDecoration: 'underline wavy var(--pz-color-warning)',
			textDecorationSkipInk: 'none',
			textUnderlineOffset: '2px'
		},
		'.cm-lintRange-info': {
			backgroundImage: 'none',
			textDecoration: 'underline wavy var(--pz-color-info)'
		},
		'.cm-lintRange-hint': {
			backgroundImage: 'none',
			textDecoration: 'underline dotted var(--pz-color-text-muted)'
		},
		'.cm-lintRange-active': { background: 'rgb(var(--pz-rgb-warning) / 0.2)' },
		'.cm-lintPoint::after': { borderBottomColor: 'var(--pz-color-error-text)' },
		'.cm-lintPoint-warning::after': { borderBottomColor: 'var(--pz-color-warning)' },
		'.cm-lintPoint-info::after': { borderBottomColor: 'var(--pz-color-info)' },
		'.cm-lintPoint-hint::after': { borderBottomColor: 'var(--pz-color-text-muted)' }
	},
	{ dark: true }
);

export const scadTheme: Extension = [editorTheme, syntaxHighlighting(scadHighlightStyle)];
