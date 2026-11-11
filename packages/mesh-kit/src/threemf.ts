/**
 * A 3MF file of one model made of parts — one part per colour. Every part is
 * its own mesh object, and one object puts them together (3MF components),
 * so PrusaSlicer, OrcaSlicer, Bambu Studio and Cura open it as a single
 * multi-part model with the parts already in place: assign each a filament.
 * Each part also carries a display colour (3MF base materials). The `plain`
 * profile leaves all of that out: geometry and millimetres only.
 */
import { weld } from './weld.js';
import { zipStore } from './zip.js';

export interface ColourPart {
	name: string;
	tris: Float32Array;
	/** #RRGGBB to show it by in the slicer */
	colour?: string;
}

export interface ThreeMfOptions {
	/** The `Application` metadata. */
	application?: string;
	/** `xml:lang` of the model. */
	lang?: string;
	/**
	 * Geometry and units only: one object per part, each its own build item,
	 * no materials, colours or components — the profile every slicer reads alike.
	 */
	plain?: boolean;
	/** More metadata: namespaced names need their prefix declared in `namespaces` */
	metadata?: { namespaces: Record<string, string>; entries: [string, string][] };
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

/**
 * Nine significant digits bring a float32 back exactly. Rounded any further,
 * a corner crosses into another weld cell and the edges a slicer counts are
 * no longer the ones the report counted.
 */
const n = (v: number) => String(Number(v.toPrecision(9)));

export function model3mf(
	parts: readonly ColourPart[],
	title: string,
	{ application = 'Polyzon mesh-kit', lang = 'en-US', plain = false, metadata }: ThreeMfOptions = {}
): string {
	const live = parts.filter((p) => p.tris.length >= 9);
	const prefixes = Object.entries(metadata?.namespaces ?? {})
		.map(([prefix, uri]) => ` xmlns:${prefix}="${esc(uri)}"`)
		.join('');
	const out: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<model unit="millimeter" xml:lang="${esc(lang)}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${prefixes}>`,
		`<metadata name="Title">${esc(title)}</metadata>`,
		`<metadata name="Application">${esc(application)}</metadata>`,
		...(metadata?.entries ?? []).map(([name, value]) => `<metadata name="${esc(name)}">${esc(value)}</metadata>`),
		'<resources>'
	];
	if (!plain)
		out.push(
			'<basematerials id="1">',
			...live.map(
				(p, i) =>
					`<base name="${esc(p.name)}" displaycolor="${p.colour ?? PART_COLOURS[i % PART_COLOURS.length]}"/>`
			),
			'</basematerials>'
		);
	live.forEach((p, i) => {
		// Equal corners only, as a slicer joins them: corners a few nanometres
		// apart are separate vertices, and joining them left edges of four faces.
		const mesh = weld(p.tris, 1e-9);
		out.push(
			`<object id="${i + 2}" type="model" name="${esc(p.name)}"${plain ? '' : ` pid="1" pindex="${i}"`}>`,
			'<mesh><vertices>'
		);
		// One push per line: spread into a single call, a generated model overflows the stack.
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
	if (plain) {
		out.push(
			'</resources>',
			`<build>${live.map((_, i) => `<item objectid="${i + 2}"/>`).join('')}</build>`,
			'</model>'
		);
		return out.join('\n');
	}
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

export function write3mf(
	parts: readonly ColourPart[],
	title: string,
	options: ThreeMfOptions = {}
): Uint8Array {
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
		{ name: '3D/3dmodel.model', data: model3mf(parts, title, options) }
	]);
}
