/**
 * Ready parts of the language: what would otherwise take a model twenty lines, or come out wrong, one
 * call each. They grow out of building real things: every part here earned its place in an exam.
 */
import type { Manifold } from 'manifold-3d';
import { track as studioTrack, wheel as studioWheel } from '../studio/cad/parts';
import type { Axis, V3 } from './lang';

// The language's own words, handed in: this file is what they are used for.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type World = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Part = any;

/** The half thickness of a NACA 4-digit section at x (0 to 1 along the chord), for a thickness of 1. */
const naca = (x: number) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);

/** A closed mesh from rings of the same length, capped at both ends. */
export function skin(mf: World['mf'], rings: V3[][]): Manifold {
	const around = rings[0].length;
	const vertProperties = new Float32Array(rings.flat(2));
	const triVerts: number[] = [];
	const at = (i: number, j: number) => i * around + (j % around);
	for (let i = 0; i + 1 < rings.length; i++) {
		for (let j = 0; j < around; j++) triVerts.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
	}
	for (let j = 1; j + 1 < around; j++) {
		triVerts.push(at(0, 0), at(0, j + 1), at(0, j));
		const last = rings.length - 1;
		triVerts.push(at(last, 0), at(last, j), at(last, j + 1));
	}
	const made = () => {
		const mesh = new mf.Mesh({ numProp: 3, vertProperties, triVerts: new Uint32Array(triVerts) });
		mesh.merge();
		return new mf.Manifold(mesh);
	};
	const body = made();
	if (body.volume() >= 0) return body;
	// the rings went round the other way: the same faces, turned to face out. Inside out, a part that
	// overlaps another cancels it there in a slicer, and the print has holes.
	body.delete();
	for (let i = 0; i < triVerts.length; i += 3) [triVerts[i + 1], triVerts[i + 2]] = [triVerts[i + 2], triVerts[i + 1]];
	return made();
}

export function kit(w: World) {
	const { r, mf, make, wrapManifold, number, Part } = w;

	/**
	 * A wing from its root at the origin out along +X: chord along Y with the leading edge to the front
	 * (-Y), an airfoil section. `sweep` is how far back the tip's leading edge sits, `rise` how far up the
	 * tip goes, `twist` the tip's angle in degrees, `thick` the thickness as a share of the chord.
	 */
	function wing(span: number, root: number, tip = root, o: { sweep?: number; rise?: number; twist?: number; thick?: number } = {}) {
		const sig = 'wing(span, root, tip, { sweep, rise, twist, thick })';
		number(sig, 'span', span, 0);
		number(sig, 'root', root, 0);
		number(sig, 'tip', tip, 0);
		const { sweep = 0, rise = 0, twist = 0, thick = 0.12 } = o;
		const along = 12;
		const points = 24;
		const section = (t: number): V3[] => {
			const chord = root + (tip - root) * t;
			const turn = (twist * t * Math.PI) / 180;
			const ring: V3[] = [];
			for (let k = 0; k < 2 * points; k++) {
				const upper = k < points;
				const s = upper ? k / points : (2 * points - k) / points;
				const x = (1 - Math.cos(s * Math.PI)) / 2;
				const half = naca(x) * thick * chord * (upper ? 1 : -1);
				const y = (x - 0.25) * chord;
				const z = half;
				ring.push([span * t, sweep * t + y * Math.cos(turn) + z * Math.sin(turn), rise * t - y * Math.sin(turn) + z * Math.cos(turn)]);
			}
			return ring;
		};
		return make(wrapManifold(skin(mf, Array.from({ length: along + 1 }, (_, i) => section(i / along)))));
	}

	/** `blades` blades around a hub on Z: a propeller or a main rotor, pitched `pitch` degrees. */
	function rotor(blades: number, radius: number, chord: number, o: { hub?: number; pitch?: number; twist?: number; tip?: number } = {}) {
		const sig = 'rotor(blades, radius, chord, { hub, pitch, twist, tip })';
		number(sig, 'blades', blades, 0);
		number(sig, 'radius', radius, 0);
		number(sig, 'chord', chord, 0);
		const { hub = chord * 0.7, pitch = 8, twist = -8, tip = chord } = o;
		const blade = wing(radius - hub * 0.8, chord, tip, { twist, thick: 0.14 }).turn(pitch, 'x', [0, 0, 0]).x(hub * 0.8);
		const set = Array.from({ length: blades }, (_, i) => blade.turn((i * 360) / blades, 'z', [0, 0, 0]));
		const core = w.cyl(hub, chord * 0.6).at(0, 0, -chord * 0.3);
		return w.group(core, ...set).at(0, 0, 0);
	}

	/** A wheel with its axle along `axis`, standing on Z = 0: tyre, dished rim, hub, spokes. */
	function wheel(radius: number, width: number, o: { axis?: Axis; spokes?: number; rim?: string; tyre?: string } = {}) {
		const sig = 'wheel(radius, width, { axis, spokes, rim, tyre })';
		number(sig, 'radius', radius, 0);
		number(sig, 'width', width, 0);
		const { axis = 'x', spokes = 5 } = o;
		const whole = make(studioWheel(r, { r: radius, width, axis, spokes }));
		return whole.color(o.tyre ?? 'rubber').at(0, 0, 0);
	}

	/** A caterpillar track around wheels [y, z, r] seen from the side, `width` across X. */
	function track(wheels: V3[], width: number, o: { belt?: number; lugs?: boolean } = {}) {
		return make(studioTrack(r, mf, { wheels, width, ...o })).color('rubber');
	}

	/** Teeth around a hole on Z: `module` is the tooth size, two meshing gears share it. */
	function gear(teeth: number, module: number, h: number, bore = 0) {
		const sig = 'gear(teeth, module, h, bore)';
		number(sig, 'teeth', teeth, 3);
		number(sig, 'module', module, 0);
		number(sig, 'h', h, 0);
		const pitch = (teeth * module) / 2;
		const tip = pitch + module;
		const foot = pitch - 1.25 * module;
		const points: [number, number][] = [];
		for (let i = 0; i < teeth; i++) {
			const a = (i * 2 * Math.PI) / teeth;
			const step = (2 * Math.PI) / teeth;
			for (const [k, radius] of [[0, foot], [0.15, foot], [0.3, tip], [0.48, tip], [0.63, foot]] as const) {
				points.push([radius * Math.cos(a + k * step), radius * Math.sin(a + k * step)]);
			}
		}
		const body = w.poly(points, h);
		return bore ? body.hole(bore) : body;
	}

	/** A coil spring along Z, `coils` turns of wire `wire` thick. */
	function spring(radius: number, wire: number, coils: number, h: number) {
		const sig = 'spring(radius, wire, coils, h)';
		number(sig, 'radius', radius, 0);
		number(sig, 'wire', wire, 0);
		number(sig, 'coils', coils, 0);
		number(sig, 'h', h, 0);
		const steps = Math.ceil(coils * 24);
		const path = Array.from({ length: steps + 1 }, (_, i) => {
			const t = (i / steps) * coils * 2 * Math.PI;
			return [radius * Math.cos(t), radius * Math.sin(t), wire / 2 + (i / steps) * (h - wire)] as V3;
		});
		return w.bar(path, wire / 2, false);
	}

	return { wing, rotor, wheel, track, gear, spring, Part };
}
