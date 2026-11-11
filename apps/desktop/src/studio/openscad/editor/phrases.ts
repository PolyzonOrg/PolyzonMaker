import * as m from '$msg/scad';

/**
 * Every user-visible phrase in the CodeMirror packages we ship (view, commands, language,
 * search, autocomplete, lint) in the page's language. Keys are the exact English source
 * strings; `$` is a positional placeholder.
 */
export function scadPhrases(): Record<string, string> {
	return {
		// @codemirror/view
		'Control character': m.scad_cm_control_character(),
		// @codemirror/commands
		'Selection deleted': m.scad_cm_selection_deleted(),
		// @codemirror/language (folding)
		'Folded lines': m.scad_cm_folded_lines(),
		'Unfolded lines': m.scad_cm_unfolded_lines(),
		to: m.scad_cm_lines_to(),
		'folded code': m.scad_cm_folded_code(),
		unfold: m.scad_cm_unfold(),
		'Fold line': m.scad_cm_fold_line(),
		'Unfold line': m.scad_cm_unfold_line(),
		// @codemirror/search
		'Go to line': m.scad_cm_go_to_line(),
		go: m.scad_cm_go(),
		Find: m.scad_cm_find_field(),
		Replace: m.scad_cm_replace_field(),
		next: m.scad_cm_next(),
		previous: m.scad_cm_previous(),
		all: m.scad_cm_all(),
		'match case': m.scad_cm_match_case(),
		regexp: m.scad_cm_regexp(),
		'by word': m.scad_cm_by_word(),
		replace: m.scad_cm_replace(),
		'replace all': m.scad_cm_replace_all(),
		close: m.scad_cm_close(),
		'current match': m.scad_cm_current_match(),
		'on line': m.scad_cm_on_line(),
		'replaced $ matches': m.scad_cm_replaced_matches(),
		'replaced match on line $': m.scad_cm_replaced_match_on_line(),
		// @codemirror/autocomplete
		Completions: m.scad_cm_completions(),
		// @codemirror/lint
		Diagnostics: m.scad_cm_diagnostics(),
		'No diagnostics': m.scad_cm_no_diagnostics()
	};
}
