/**
 * A label for a spool: 50 × 30 mm, black on white, a QR code that opens
 * «Остатки пластика» on the write-off of this spool, and what is on the spool.
 * Printed material, not interface: the colours are the paper's and the ink's.
 *
 * One grid: 4 mm margins (they are the QR's quiet zone too), the code 22 mm
 * square, the text column beside it from the code's top to its bottom. Two
 * sizes of type; a long name wraps to a second line instead of being squeezed.
 */
import { darkRects, encodeQr } from '../shared/qr';
import { spoolName, type Spool } from './model';
import { num } from '$lib/i18n/current';
import * as msg from '$msg/tools/spool-tracker';

export const LABEL_MM = { width: 50, height: 30 } as const;

/** Where the label's QR code leads: this spool's write-off. */
export function spoolLink(origin: string, spoolId: string): string {
	return spoolId;
}

const MARGIN = 4;
const CODE = 22;
const TEXT_X = MARGIN + CODE + 2.5;
const TEXT_W = LABEL_MM.width - MARGIN - TEXT_X;
/** Arial: cap height and the average width of a letter, as shares of the size. */
const CAP = 0.72;
const LETTER = 0.5;

const escape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Words into at most `max` lines of `room` mm; the last one ends with «…» if text is left. */
export function wrap(text: string, size: number, room: number, max: number): string[] {
	const fits = Math.max(1, Math.floor(room / (size * LETTER)));
	const lines: string[] = [];
	let rest = text.trim().replace(/\s+/g, ' ');
	while (rest && lines.length < max) {
		if (rest.length <= fits) {
			lines.push(rest);
			rest = '';
			break;
		}
		const space = rest.lastIndexOf(' ', fits);
		const at = space > 0 ? space : fits;
		lines.push(rest.slice(0, at).trimEnd());
		rest = rest.slice(at).trimStart();
	}
	if (rest && lines.length) {
		const last = lines[lines.length - 1];
		lines[lines.length - 1] = `${last.slice(0, Math.max(1, fits - 1)).trimEnd()}…`;
	}
	return lines;
}

const weight = (g: number) =>
	g >= 1000
		? msg.t_spool_tracker_label_kg({ weight: num(Math.round(g / 100) / 10, 1) })
		: msg.t_spool_tracker_label_g({ weight: num(g) });

export function labelSvg(spool: Spool, link: string): string {
	const qr = encodeQr(link, 'M');
	const unit = CODE / qr.size;
	const cells = darkRects(qr.modules)
		.map(
			([x, y, w, h]) =>
				`<rect x="${(MARGIN + x * unit).toFixed(3)}" y="${(MARGIN + y * unit).toFixed(3)}" width="${(w * unit).toFixed(3)}" height="${(h * unit).toFixed(3)}"/>`
		)
		.join('');

	const out: string[] = [];
	const text = (s: string, x: number, y: number, size: number, bold = false) =>
		out.push(
			`<text x="${x}" y="${y.toFixed(2)}" font-size="${size}"${bold ? ' font-weight="700"' : ''}>${escape(s)}</text>`
		);

	// The material: its cap line on the code's top edge.
	const title = 4.4;
	let y = MARGIN + title * CAP;
	text(wrap(spool.material, title, TEXT_W, 1)[0], TEXT_X, y, title, true);

	// The colour: a dot of the filament's own colour, ringed so white shows on white.
	const body = 2.6;
	const step = body * 1.4;
	const dot = 1.1;
	const colourX = TEXT_X + dot * 2 + 1;
	y += 4.4;
	const colour = wrap(
		spool.colorName || msg.t_spool_tracker_label_no_colour(),
		body,
		LABEL_MM.width - MARGIN - colourX,
		2
	);
	out.push(
		`<circle cx="${TEXT_X + dot}" cy="${(y - (body * CAP) / 2).toFixed(2)}" r="${dot}" fill="${spool.color}" stroke="#000" stroke-width="0.25"/>`
	);
	colour.forEach((line, i) => text(line, colourX, y + i * step, body));
	y += colour.length * step;

	for (const line of [spool.brand, weight(spool.netWeight)]) {
		if (!line) continue;
		text(wrap(line, body, TEXT_W, 1)[0], TEXT_X, y, body);
		y += step;
	}

	// The prompt: its last baseline on the code's bottom edge.
	const small = 2;
	const bottom = MARGIN + CODE;
	text(msg.t_spool_tracker_label_scan(), TEXT_X, bottom, small);

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_MM.width}mm" height="${LABEL_MM.height}mm" viewBox="0 0 ${LABEL_MM.width} ${LABEL_MM.height}">`,
		`<title>${escape(spoolName(spool))}</title>`,
		`<rect width="${LABEL_MM.width}" height="${LABEL_MM.height}" fill="#fff"/>`,
		`<g fill="#000">${cells}</g>`,
		`<g fill="#000" font-family="Arial, Helvetica, sans-serif">${out.join('')}</g>`,
		'</svg>'
	].join('');
}
