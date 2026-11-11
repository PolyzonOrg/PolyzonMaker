/**
 * A 3MF file of one model made of parts — one part per colour. Every part is
 * its own mesh object, and one object puts them together (3MF components),
 * so PrusaSlicer, OrcaSlicer, Bambu Studio and Cura open it as a single
 * multi-part model with the parts already in place: assign each a filament.
 * Each part also carries a display colour (3MF base materials).
 */
import { weld } from '../weld';
import { zipStore } from './zip';

export interface ColourPart {
	name: string;
	tris: Float32Array;
	/** #RRGGBB to show it by in the slicer */
	colour?: string;
}

/** Display colours for parts that name none: white base, black second, then a few. */
export const PART_COLOURS = [
	'#F2F2F2',
	'#1F1F1F',
	'#D93B3B',
	'#2F6FD6',
	'#E8B11C',
	'#3BA55C',
	'#8E44AD',
	'#E67E22'
];

const esc = (s: string) =>
	s.replace(
		/[<>&"']/g,
		(c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!
	);

/** Compact numbers: 4 decimals, no trailing zeros. */
function n(v: number): string {
	const s = v.toFixed(4);
	return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
}

export function model3mf(parts: readonly ColourPart[], title: string): string {
	const live = parts.filter((p) => p.tris.length >= 9);
	const out: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<model unit="millimeter" xml:lang="ru-RU" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
		`<metadata name="Title">${esc(title)}</metadata>`,
		'<metadata name="Application">Polyzon Studio</metadata>',
		'<resources>',
		'<basematerials id="1">',
		...live.map(
			(p, i) =>
				`<base name="${esc(p.name)}" displaycolor="${p.colour ?? PART_COLOURS[i % PART_COLOURS.length]}"/>`
		),
		'</basematerials>'
	];
	live.forEach((p, i) => {
		// Equal corners only, as a slicer joins them: corners a few nanometres
		// apart are separate vertices, and joining them left edges of four faces.
		const mesh = weld(p.tris, 1e-9);
		out.push(
			`<object id="${i + 2}" type="model" name="${esc(p.name)}" pid="1" pindex="${i}">`,
			'<mesh><vertices>'
		);
		// One push per line: spread into a single call, a dense model overflows the stack.
		for (let k = 0; k < mesh.positions.length; k += 3)
			out.push(
				`<vertex x="${n(mesh.positions[k])}" y="${n(mesh.positions[k + 1])}" z="${n(mesh.positions[k + 2])}"/>`
			);
		out.push('</vertices><triangles>');
		for (let k = 0; k < mesh.indices.length; k += 3)
			out.push(
				`<triangle v1="${mesh.indices[k]}" v2="${mesh.indices[k + 1]}" v3="${mesh.indices[k + 2]}"/>`
			);
		out.push('</triangles></mesh></object>');
	});
	const whole = live.length + 2;
	out.push(
		`<object id="${whole}" type="model" name="${esc(title)}"><components>`,
		...live.map((_, i) => `<component objectid="${i + 2}"/>`),
		'</components></object>',
		'</resources>',
		`<build><item objectid="${whole}"/></build>`,
		'</model>'
	);
	return out.join('\n');
}

export function write3mf(parts: readonly ColourPart[], title: string): Uint8Array {
	return zipStore([
		{
			name: '[Content_Types].xml',
			data:
				'<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
				'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
				'<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'
		},
		{
			name: '_rels/.rels',
			data:
				'<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
		},
		{ name: '3D/3dmodel.model', data: model3mf(parts, title) }
	]);
}
