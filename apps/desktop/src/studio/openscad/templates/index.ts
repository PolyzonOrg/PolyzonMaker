// Hand-crafted OpenSCAD templates with Customizer-style parameters.
// Loaded as raw text at build time via Vite's `?raw` import.
import mug from './mug.scad?raw';
import box from './box.scad?raw';
import gear from './gear.scad?raw';
import keychain from './keychain.scad?raw';
import vase from './vase.scad?raw';
import hook from './hook.scad?raw';
import bracket from './bracket.scad?raw';
import phoneStand from './phone-stand.scad?raw';
import bottleOpener from './bottle-opener.scad?raw';
import * as m from '$msg/scad';
import { localizeTemplate, TEMPLATE_TEXTS } from './texts';

/** Lucide icon names (DESIGN_CODE §8: Lucide only — emoji render differently per OS). */
export type ScadTemplateIcon =
	| 'coffee'
	| 'package'
	| 'cog'
	| 'tag'
	| 'amphora'
	| 'anchor'
	| 'bolt'
	| 'smartphone'
	| 'wine';

export interface ScadTemplate {
	id: string;
	label: string;
	icon: ScadTemplateIcon;
	/** The code with its comments and Customizer labels in the page's language (texts.ts). */
	source: string;
}

function template(
	id: string,
	icon: ScadTemplateIcon,
	raw: string,
	label: () => string
): ScadTemplate {
	return {
		id,
		icon,
		get label() {
			return label();
		},
		get source() {
			return localizeTemplate(
				raw,
				TEMPLATE_TEXTS[id].map((text) => text())
			);
		}
	};
}

export const SCAD_TEMPLATES: readonly ScadTemplate[] = [
	template('mug', 'coffee', mug, m.scad_tpl_mug_title),
	template('box', 'package', box, m.scad_tpl_box_title),
	template('gear', 'cog', gear, m.scad_tpl_gear_title),
	template('keychain', 'tag', keychain, m.scad_tpl_keychain_title),
	template('vase', 'amphora', vase, m.scad_tpl_vase_title),
	template('hook', 'anchor', hook, m.scad_tpl_hook_title),
	template('bracket', 'bolt', bracket, m.scad_tpl_bracket_title),
	template('phone-stand', 'smartphone', phoneStand, m.scad_tpl_phone_stand_title),
	template('bottle-opener', 'wine', bottleOpener, m.scad_tpl_bottle_opener_title)
];
