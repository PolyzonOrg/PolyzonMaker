/**
 * Flat outlines (rings in mm) in and out of the tools: read the 2D result of
 * an OpenSCAD program from its SVG export, move and mirror rings, write them
 * as an SVG for a laser, plotter or vinyl cutter. Pure, shared by the tools
 * and the tests.
 *
 * Why OpenSCAD at all: text() and import("x.svg") are what it is good at,
 * and a program that only draws a 2D shape exports in a fraction of a second.
 */
import { ringArea, ringsBounds, type Point, type Ring } from './trace';

const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const TOKEN = new RegExp(`([MLZ])|(${NUMBER}),(${NUMBER})`, 'gi');

/**
 * OpenSCAD's SVG export → rings in OpenSCAD's axes (the SVG's y points
 * down). The export is the union OpenSCAD computed: outer contours CCW,
 * holes CW.
 */
export function ringsFromScadSvg(svg: string): Ring[] {
	const rings: Ring[] = [];
	let ring: Ring = [];
	const close = () => {
		if (ring.length >= 3) rings.push(ring);
		ring = [];
	};
	for (const [, d] of svg.matchAll(/\sd="([^"]*)"/g)) {
		for (const [, command, x, y] of d.matchAll(TOKEN)) {
			if (command) {
				if (command.toUpperCase() !== 'L') close();
			} else ring.push([Number(x), -Number(y)] as Point);
		}
		close();
	}
	return rings;
}

/** Rings grouped by slot: the slot whose centre (k · pitch) is nearest. */
export function splitBySlot(rings: readonly Ring[], pitch: number, count: number): Ring[][] {
	const slots: Ring[][] = Array.from({ length: count }, () => []);
	for (const r of rings) {
		const b = ringsBounds([r]);
		const k = Math.round((b.minX + b.maxX) / 2 / pitch);
		if (k >= 0 && k < count) slots[k].push(r);
	}
	return slots;
}

const svgNumber = (n: number) => String(Number(n.toFixed(3)));

/**
 * An SVG in millimetres: one even-odd path (holes stay open), black fill.
 * The SVG y axis points down, so y is flipped.
 */
export function ringsToSvg(rings: readonly Ring[], margin = 2): string {
	const b = ringsBounds(rings);
	const w = b.maxX - b.minX + margin * 2;
	const h = b.maxY - b.minY + margin * 2;
	const d = rings
		.filter((r) => r.length >= 3 && ringArea(r) !== 0)
		.map(
			(r) =>
				'M' +
				r
					.map(([x, y]) => `${svgNumber(x - b.minX + margin)} ${svgNumber(b.maxY - y + margin)}`)
					.join(' L') +
				' Z'
		)
		.join(' ');
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgNumber(w)}mm" height="${svgNumber(h)}mm" viewBox="0 0 ${svgNumber(w)} ${svgNumber(h)}">
<path fill="#000" fill-rule="evenodd" d="${d}"/>
</svg>
`;
}
