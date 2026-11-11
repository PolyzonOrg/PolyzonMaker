import * as m from '$msg/scad';

/**
 * The templates are written in Russian (the *.scad files next to this one). Their header and
 * code comments, Customizer group names and labels and the sample text are messages too,
 * listed here in file order: `localizeTemplate` puts the current language's texts in their
 * places, so the code and the Customizer panel speak the page's language. In Russian the file
 * comes back byte for byte (tests/openscad-templates.test.ts keeps lists and files in step).
 */
export const TEMPLATE_TEXTS: Record<string, readonly (() => string)[]> = {
	mug: [
		m.scad_tpl_mug_about,
		m.scad_tpl_mug_group_body,
		m.scad_tpl_mug_diameter,
		m.scad_tpl_mug_height,
		m.scad_tpl_mug_wall,
		m.scad_tpl_mug_bottom,
		m.scad_tpl_mug_group_handle,
		m.scad_tpl_mug_handle_height,
		m.scad_tpl_mug_handle_reach,
		m.scad_tpl_mug_handle_thickness,
		m.scad_tpl_mug_note_handle_h,
		m.scad_tpl_mug_note_fillet,
		m.scad_tpl_mug_note_profile,
		m.scad_tpl_mug_note_handle
	],
	box: [
		m.scad_tpl_box_about,
		m.scad_tpl_box_group_box,
		m.scad_tpl_box_width,
		m.scad_tpl_box_depth,
		m.scad_tpl_box_height,
		m.scad_tpl_box_wall,
		m.scad_tpl_box_corner,
		m.scad_tpl_box_group_lid,
		m.scad_tpl_box_lid,
		m.scad_tpl_box_lip,
		m.scad_tpl_box_clearance,
		m.scad_tpl_box_note_rounded
	],
	gear: [
		m.scad_tpl_gear_about,
		m.scad_tpl_gear_group_gear,
		m.scad_tpl_gear_teeth,
		m.scad_tpl_gear_mod,
		m.scad_tpl_gear_thickness,
		m.scad_tpl_gear_pressure_angle,
		m.scad_tpl_gear_group_hub,
		m.scad_tpl_gear_bore,
		m.scad_tpl_gear_d_flat,
		m.scad_tpl_gear_hub_diameter,
		m.scad_tpl_gear_hub_height,
		m.scad_tpl_gear_note_half,
		m.scad_tpl_gear_note_involute
	],
	keychain: [
		m.scad_tpl_keychain_about,
		m.scad_tpl_keychain_group_label,
		m.scad_tpl_keychain_label,
		m.scad_tpl_keychain_label_sample,
		m.scad_tpl_keychain_font_size,
		m.scad_tpl_keychain_text_height,
		m.scad_tpl_keychain_group_keychain,
		m.scad_tpl_keychain_thickness,
		m.scad_tpl_keychain_margin,
		m.scad_tpl_keychain_group_hole,
		m.scad_tpl_keychain_hole_diameter
	],
	vase: [
		m.scad_tpl_vase_about,
		m.scad_tpl_vase_group_shape,
		m.scad_tpl_vase_height,
		m.scad_tpl_vase_base_radius,
		m.scad_tpl_vase_belly_radius,
		m.scad_tpl_vase_belly_at,
		m.scad_tpl_vase_neck_radius,
		m.scad_tpl_vase_top_radius,
		m.scad_tpl_vase_group_walls,
		m.scad_tpl_vase_wall,
		m.scad_tpl_vase_bottom,
		m.scad_tpl_vase_note_keys,
		m.scad_tpl_vase_note_extrude
	],
	hook: [
		m.scad_tpl_hook_about,
		m.scad_tpl_hook_group_hook,
		m.scad_tpl_hook_reach,
		m.scad_tpl_hook_lip,
		m.scad_tpl_hook_arm,
		m.scad_tpl_hook_width,
		m.scad_tpl_hook_group_plate,
		m.scad_tpl_hook_plate_height,
		m.scad_tpl_hook_plate,
		m.scad_tpl_hook_group_screws,
		m.scad_tpl_hook_screw,
		m.scad_tpl_hook_head,
		m.scad_tpl_hook_note_bend,
		m.scad_tpl_hook_note_holes,
		m.scad_tpl_hook_note_arc,
		m.scad_tpl_hook_note_profile,
		m.scad_tpl_hook_note_corners,
		m.scad_tpl_hook_note_countersink
	],
	bracket: [
		m.scad_tpl_bracket_about,
		m.scad_tpl_bracket_group_bracket,
		m.scad_tpl_bracket_arm,
		m.scad_tpl_bracket_width,
		m.scad_tpl_bracket_thickness,
		m.scad_tpl_bracket_group_gussets,
		m.scad_tpl_bracket_gusset,
		m.scad_tpl_bracket_gusset_thickness,
		m.scad_tpl_bracket_group_holes,
		m.scad_tpl_bracket_screw,
		m.scad_tpl_bracket_head,
		m.scad_tpl_bracket_note_holes,
		m.scad_tpl_bracket_note_profile,
		m.scad_tpl_bracket_note_hole,
		m.scad_tpl_bracket_note_shelf_x,
		m.scad_tpl_bracket_note_shelf_y
	],
	'phone-stand': [
		m.scad_tpl_phone_stand_about,
		m.scad_tpl_phone_stand_group_stand,
		m.scad_tpl_phone_stand_width,
		m.scad_tpl_phone_stand_thickness,
		m.scad_tpl_phone_stand_group_back,
		m.scad_tpl_phone_stand_back_length,
		m.scad_tpl_phone_stand_back_angle,
		m.scad_tpl_phone_stand_group_shelf,
		m.scad_tpl_phone_stand_slot,
		m.scad_tpl_phone_stand_lip,
		m.scad_tpl_phone_stand_group_cable,
		m.scad_tpl_phone_stand_cable,
		m.scad_tpl_phone_stand_note_points,
		m.scad_tpl_phone_stand_note_bar,
		m.scad_tpl_phone_stand_note_corners,
		m.scad_tpl_phone_stand_note_cable
	],
	'bottle-opener': [
		m.scad_tpl_bottle_opener_about,
		m.scad_tpl_bottle_opener_group_opener,
		m.scad_tpl_bottle_opener_length,
		m.scad_tpl_bottle_opener_handle,
		m.scad_tpl_bottle_opener_thickness,
		m.scad_tpl_bottle_opener_group_opening,
		m.scad_tpl_bottle_opener_opening,
		m.scad_tpl_bottle_opener_tooth,
		m.scad_tpl_bottle_opener_tooth_width,
		m.scad_tpl_bottle_opener_group_hanger,
		m.scad_tpl_bottle_opener_hang_hole,
		m.scad_tpl_bottle_opener_note_rim,
		m.scad_tpl_bottle_opener_note_corners,
		m.scad_tpl_bottle_opener_note_tooth
	]
};

const CYRILLIC = /[А-Яа-яЁё]/u; // i18n-ok: finds the Russian pieces of a template

interface Piece {
	/** The piece's first and last line. */
	from: number;
	to: number;
	text: string;
	/** The lines with another text in the piece's place. */
	write: (text: string) => string[];
}

/**
 * The Russian pieces of a template, in order: a run of `//` comment lines (a sentence may
 * wrap over them), a Customizer group `/* [Name] *\/`, a sample string `name = "Text";`.
 */
function pieces(lines: string[]): Piece[] {
	const out: Piece[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!CYRILLIC.test(line)) continue;
		const group = /^(\s*\/\*\s*\[)(.*)(\]\s*\*\/\s*)$/u.exec(line);
		const comment = /^(\s*\/\/ )(.*)$/u.exec(line);
		const sample = /^(\s*\w+\s*=\s*")([^"]*)(".*)$/u.exec(line);
		if (group) {
			out.push({ from: i, to: i, text: group[2], write: (t) => [group[1] + t + group[3]] });
		} else if (comment) {
			const from = i;
			const run = [comment[2]];
			while (lines[i + 1]?.startsWith(comment[1]) && CYRILLIC.test(lines[i + 1]))
				run.push(lines[++i].slice(comment[1].length));
			out.push({
				from,
				to: i,
				text: run.join('\n'),
				write: (t) => t.split('\n').map((l) => comment[1] + l)
			});
		} else if (sample) {
			const quoted = (t: string) => t.replace(/[\\"]/gu, (c) => `\\${c}`);
			out.push({
				from: i,
				to: i,
				text: sample[2],
				write: (t) => [sample[1] + quoted(t) + sample[3]]
			});
		}
	}
	return out;
}

/** The Russian texts of a template in file order — what TEMPLATE_TEXTS must say in Russian. */
export function templatePieces(source: string): string[] {
	return pieces(source.split(/\r?\n/u)).map((piece) => piece.text);
}

/** The template with `texts` (one per piece, in order) in place of its Russian ones. */
export function localizeTemplate(source: string, texts: readonly string[]): string {
	const lines = source.split(/\r?\n/u);
	const found = pieces(lines);
	// Out of step after an edit of the file: the Russian original beats a garbled mix.
	if (found.length !== texts.length) return source;
	const out: string[] = [];
	let at = 0;
	found.forEach((piece, i) => {
		out.push(...lines.slice(at, piece.from), ...piece.write(texts[i]));
		at = piece.to + 1;
	});
	out.push(...lines.slice(at));
	return out.join(source.includes('\r\n') ? '\r\n' : '\n');
}
