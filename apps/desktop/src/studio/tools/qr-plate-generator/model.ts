/**
 * «QR-таблички»: a QR code (link, text, Wi-Fi, phone, e-mail, contact card)
 * on a plate, raised or engraved, with an optional caption, frame, screw
 * holes and magnet pockets. The code and the caption sit on their own
 * height above the plate, so one filament change at that height prints them
 * in a second colour. Pure: 2D layers out (relief.ts turns them into a solid).
 */
import type { CrossSection } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import { encodeQr, QrTooLongError, type QrEcc } from '../shared/qr';
import {
	boundsOf,
	circle,
	inside,
	largestFit,
	layoutText,
	qrRegion,
	qrSide,
	rect,
	regionOf,
	type Box,
	type Layer,
	type ModuleShape,
	type Region,
	type Scope,
	type TextShapes
} from '../shared/relief';
import {
	anchor,
	countersinks,
	fmt,
	FRAME_INSET,
	MAGNET_CLEARANCE,
	MIN_FLOOR,
	roundedRect,
	type ReliefMode
} from '../nameplate-generator/tag';
import { clampTo as clamp } from '../shared/math';
import { qrPayload, type PayloadFields } from './payload';
import * as m from '$msg/tools/qr-plate-generator';

export type PlateShape = 'rect' | 'circle';
export type CaptionPlace = 'below' | 'above' | 'right';
export type PlateMount = 'none' | 'top' | 'top2' | 'corners';

export interface QrPlateParams extends PayloadFields {
	ecc: QrEcc;
	modules: ModuleShape;
	/** Size of a dot or a diamond, % of the module */
	dotSize: number;
	mode: ReliefMode;
	/** Height of the raised parts or depth of the engraving, mm */
	relief: number;
	/** Raise the light modules instead of the dark ones (dark plate, light top) */
	lightOnTop: boolean;
	/** Light border around the code, in modules */
	quiet: number;

	shape: PlateShape;
	/** mm; a round plate uses the width as its diameter */
	width: number;
	height: number;
	thickness: number;
	radius: number;
	frame: boolean;
	frameWidth: number;

	caption: boolean;
	captionText: string;
	captionPlace: CaptionPlace;
	/** Height of capitals, mm */
	captionHeight: number;

	mount: PlateMount;
	holeDiameter: number;
	countersink: boolean;
	magnets: 0 | 1 | 2 | 4;
	magnetDiameter: number;
	magnetDepth: number;
}

export interface QrPlatePreset {
	id: string;
	label: string;
	params: Partial<QrPlateParams>;
}

export const QR_PLATE_LIMITS = {
	width: [30, 200],
	height: [30, 200],
	thickness: [1.6, 8],
	radius: [0, 30],
	relief: [0.4, 3],
	quiet: [1, 8],
	dotSize: [50, 92],
	frameWidth: [0.8, 6],
	captionHeight: [4, 20],
	holeDiameter: [2.5, 8],
	magnetDiameter: [3, 25],
	magnetDepth: [0.6, 5]
} as const satisfies Record<string, readonly [number, number]>;

/**
 * A portrait sign: a 60 mm code with a caption under it. 3.2 mm = 16 layers
 * of 0.2; the code stands 1 mm (5 layers) proud for a clean colour change;
 * three modules of light border read reliably with phone cameras.
 */
export const QR_PLATE_DEFAULTS: QrPlateParams = {
	kind: 'link',
	link: 'https://polyzon.org',
	text: '',
	wifiName: '',
	wifiPassword: '',
	wifiSecurity: 'WPA',
	wifiHidden: false,
	phone: '',
	email: '',
	emailSubject: '',
	emailBody: '',
	contactName: '',
	contactOrg: '',
	contactPhone: '',
	contactEmail: '',
	contactSite: '',
	ecc: 'M',
	modules: 'square',
	dotSize: 85,
	mode: 'raised',
	relief: 1,
	lightOnTop: false,
	quiet: 3,
	shape: 'rect',
	width: 70,
	height: 88,
	thickness: 3.2,
	radius: 4,
	frame: true,
	frameWidth: 1.6,
	caption: true,
	// A sample caption printed on the plate: each language gets its own.
	get captionText() {
		return m.t_qr_plate_generator_default_caption();
	},
	captionPlace: 'below',
	captionHeight: 8,
	mount: 'none',
	holeDiameter: 4,
	countersink: false,
	magnets: 0,
	magnetDiameter: 10,
	magnetDepth: 2.2
};

export const QR_PLATE_PRESETS: readonly QrPlatePreset[] = [
	{
		id: 'wifi',
		get label() {
			return m.t_qr_plate_generator_preset_wifi();
		},
		params: {
			kind: 'wifi',
			get wifiName() {
				return m.t_qr_plate_generator_preset_wifi_name();
			},
			wifiPassword: '12345678',
			captionText: 'Wi-Fi',
			width: 70,
			height: 88,
			shape: 'rect',
			magnets: 0,
			mount: 'none'
		}
	},
	{
		id: 'menu',
		get label() {
			return m.t_qr_plate_generator_preset_menu();
		},
		params: {
			kind: 'link',
			link: 'https://polyzon.org',
			get captionText() {
				return m.t_qr_plate_generator_preset_menu_caption();
			},
			shape: 'rect',
			width: 64,
			height: 80,
			mount: 'none',
			magnets: 0
		}
	},
	{
		id: 'card',
		get label() {
			return m.t_qr_plate_generator_preset_card();
		},
		params: {
			kind: 'contact',
			get contactName() {
				return m.t_qr_plate_generator_preset_card_name();
			},
			contactPhone: '+7 900 000-00-00',
			get captionText() {
				return m.t_qr_plate_generator_preset_card_name();
			},
			captionPlace: 'right',
			captionHeight: 5,
			shape: 'rect',
			width: 90,
			height: 50,
			thickness: 2.4,
			frame: false,
			mount: 'none',
			magnets: 0
		}
	},
	{
		id: 'door',
		get label() {
			return m.t_qr_plate_generator_preset_door();
		},
		params: {
			kind: 'link',
			get captionText() {
				return m.t_qr_plate_generator_preset_door_caption();
			},
			shape: 'rect',
			width: 100,
			height: 124,
			mount: 'corners',
			holeDiameter: 4,
			countersink: true,
			magnets: 0
		}
	},
	{
		id: 'fridge',
		get label() {
			return m.t_qr_plate_generator_preset_fridge();
		},
		params: {
			kind: 'phone',
			phone: '+7 900 000-00-00',
			caption: false,
			shape: 'circle',
			width: 60,
			quiet: 2,
			frame: true,
			mount: 'none',
			magnets: 1
		}
	}
];

export interface QrPlateInfo {
	warnings: string[];
	/** Where the second colour starts, mm from the bed. */
	colorChange: number;
	qr: {
		version: number;
		size: number;
		ecc: QrEcc;
		module: number;
		side: number;
		bytes: number;
	};
	captionCap: number | null;
}

const GAP = 2;
/** Largest code (modules per side) still drawn with dots or diamonds. */
const MAX_DOTS_SIDE = 61;

export function buildQrPlate(
	s: Scope,
	raw: QrPlateParams,
	text: TextShapes | null
): { layers: Layer[]; info: QrPlateInfo } {
	const L = QR_PLATE_LIMITS;
	const payload = qrPayload(raw);
	if (!payload) throw new ToolError(m.t_qr_plate_generator_error_empty());
	let code;
	try {
		code = encodeQr(payload, raw.ecc);
	} catch (e) {
		if (e instanceof QrTooLongError) throw new ToolError(m.t_qr_plate_generator_error_too_long());
		throw e;
	}
	const warnings: string[] = [];
	const round = raw.shape === 'circle';
	const W = clamp(raw.width, L.width);
	const H = round ? W : clamp(raw.height, L.height);
	const t = clamp(raw.thickness, L.thickness);
	const relief = clamp(raw.relief, L.relief);
	const engraved = raw.mode === 'engraved';
	const depth = Math.min(relief, t - MIN_FLOOR);
	const top = engraved ? t : t + relief;
	const z0 = engraved ? t - depth : t;
	const z1 = engraved ? t + 0.01 : t + relief;
	const kind = engraved ? 'engrave' : 'relief';
	const quiet = Math.round(clamp(raw.quiet, L.quiet));
	const fw = clamp(raw.frameWidth, L.frameWidth);

	const plate: CrossSection = round
		? s.cs(circle(0, 0, W / 2))
		: s.cs(roundedRect(W, H, clamp(raw.radius, L.radius)));
	const layers: Layer[] = [{ kind: 'body', part: 'base', region: regionOf(plate), z0: 0, z1: t }];
	const cuts: Layer[] = [];

	// --- Screw holes: the centres sit a hole's width from the edge ---
	const d = clamp(raw.holeDiameter, L.holeDiameter);
	const centres: [number, number][] = [];
	if (raw.mount !== 'none') {
		const inner = regionOf(s.t(plate.offset(-(d / 2 + Math.max(2.5, d * 0.6)), 'Round')));
		const dirs: [number, number][] =
			raw.mount === 'top'
				? [[0, 1]]
				: raw.mount === 'top2'
					? [
							[-1, 1],
							[1, 1]
						]
					: [
							[-1, 1],
							[1, 1],
							[-1, -1],
							[1, -1]
						];
		for (const dir of dirs) {
			const a = anchor(inner, dir, 0);
			if (a) centres.push([a.x, a.y]);
		}
		for (const [x, y] of centres)
			cuts.push({ kind: 'cut', part: 'hole', region: [circle(x, y, d / 2)], z0: -1, z1: top + 1 });
		if (raw.countersink) cuts.push(countersinks(centres, d, t, top));
	}

	// --- Room for the code and the caption ---
	const margin = raw.frame ? FRAME_INSET + fw + 1.5 : 3;
	const field = s.t(plate.offset(-margin, 'Round'));
	const keep = d / 2 + (raw.countersink ? d / 2 : 0) + 1.5;
	const allowed = centres.length
		? s.t(field.subtract(s.cs(centres.map(([x, y]) => circle(x, y, keep)))))
		: field;
	const box = { ...(boundsOf(regionOf(field)) as Box) };
	for (const [, y] of centres) {
		if (y > 0) box.y1 = Math.min(box.y1, y - keep);
		else box.y0 = Math.max(box.y0, y + keep);
	}

	const captionText = raw.captionText.trim();
	const captionShape = raw.caption && captionText ? text?.lines[captionText] : undefined;
	const capOn = !!captionShape?.length && !!text;
	const cap = clamp(raw.captionHeight, L.captionHeight);
	const band = capOn ? cap * 1.45 : 0; // capitals plus room for descenders
	const place = raw.captionPlace;
	const bw = box.x1 - box.x0;
	const bh = box.y1 - box.y0;
	const cx = (box.x0 + box.x1) / 2;
	const cy = (box.y0 + box.y1) / 2;

	let qMax: number;
	let qrAt: (q: number) => [number, number];
	let capBox: (q: number) => Box;
	if (capOn && place === 'right') {
		qMax = Math.min(bh, bw * 0.6);
		qrAt = (q) => [box.x0, cy - q / 2];
		capBox = (q) => ({ x0: box.x0 + q + GAP, y0: cy - q / 2, x1: box.x1, y1: cy + q / 2 });
	} else {
		const extra = capOn ? GAP + band : 0;
		qMax = Math.min(bw, bh - extra);
		// The code and the caption, centred together; the caption below or above.
		qrAt = (q) => {
			const y0 = cy - (q + extra) / 2;
			return [cx - q / 2, place === 'above' ? y0 : y0 + extra];
		};
		capBox = (q) => {
			const [, qy] = qrAt(q);
			const yb = place === 'above' ? qy + q + GAP : qy - GAP - band;
			return { x0: box.x0, y0: yb, x1: box.x1, y1: yb + band };
		};
	}
	if (qMax <= 0) throw new ToolError(m.t_qr_plate_generator_error_no_room());
	const k = largestFit(s, allowed, (f) => {
		const q = qMax * f;
		const [x, y] = qrAt(q);
		const parts: Region = [rect(x, y, x + q, y + q)];
		if (capOn && place !== 'right') {
			const b = capBox(q);
			parts.push(rect(cx - Math.min(q, bw) / 2, b.y0, cx + Math.min(q, bw) / 2, b.y1));
		}
		return parts;
	});
	const q = qMax * k;
	if (q < 8) throw new ToolError(m.t_qr_plate_generator_error_no_room_caption());
	const module = q / (code.size + 2 * quiet);
	// Separate dots on a big code mean tens of thousands of islands: slow to build, hard to print.
	const moduleShape: ModuleShape = code.size > MAX_DOTS_SIDE ? 'square' : raw.modules;
	if (moduleShape !== raw.modules)
		warnings.push(m.t_qr_plate_generator_warn_dots({ max: MAX_DOTS_SIDE, size: code.size }));
	const [qx, qy] = qrAt(q);
	const qr = qrRegion(s, code, {
		x: qx,
		y: qy,
		module,
		quiet,
		shape: moduleShape,
		fill: moduleShape === 'square' ? 1 : clamp(raw.dotSize, L.dotSize) / 100,
		invert: raw.lightOnTop
	});
	layers.push({ kind, part: 'qr', region: qr, z0, z1 });

	// --- Caption: as wide as the plate allows at its height ---
	let captionCap: number | null = null;
	if (capOn && text) {
		let b = capBox(q);
		if (place !== 'right') {
			const full = b.x1 - b.x0;
			const w =
				full *
				largestFit(s, allowed, (f) => [rect(cx - (full * f) / 2, b.y0, cx + (full * f) / 2, b.y1)]);
			b = { ...b, x0: cx - w / 2, x1: cx + w / 2 };
		}
		const block = layoutText(text, [{ text: captionText, cap }], b, 'center');
		if (block.region.length) {
			captionCap = block.caps[0];
			layers.push({ kind, part: 'caption', region: block.region, z0, z1 });
			if (captionCap < cap * 0.8)
				warnings.push(m.t_qr_plate_generator_warn_caption_shrunk({ height: fmt(captionCap) }));
			if (captionCap < 3) warnings.push(m.t_qr_plate_generator_warn_caption_small());
		}
	}

	// --- Frame ---
	if (raw.frame) {
		const outer = s.t(plate.offset(-FRAME_INSET, 'Round'));
		const inner = s.t(plate.offset(-FRAME_INSET - fw, 'Round'));
		layers.push({
			kind: 'relief',
			part: 'frame',
			region: regionOf(s.t(s.t(outer.subtract(inner)).simplify(0.01))),
			z0: t,
			z1: t + relief
		});
		// The light border between the frame and the code must look like two modules or more.
		if (quiet * module + 1.5 < 2 * module) warnings.push(m.t_qr_plate_generator_warn_frame());
	}

	// --- Magnet pockets on the back ---
	if (raw.magnets > 0) {
		const md = clamp(raw.magnetDiameter, L.magnetDiameter) + MAGNET_CLEARANCE;
		const want = clamp(raw.magnetDepth, L.magnetDepth);
		const limit = t - MIN_FLOOR - (engraved ? depth : 0);
		const mdep = Math.min(want, limit);
		const qx4 = W / 4;
		const qy4 = round ? W / 4 : H / 4;
		const spots: [number, number][] =
			raw.magnets === 1
				? [[0, 0]]
				: raw.magnets === 2
					? [
							[-qx4, 0],
							[qx4, 0]
						]
					: [
							[-qx4 * (round ? 0.8 : 1), qy4 * (round ? 0.8 : 1)],
							[qx4 * (round ? 0.8 : 1), qy4 * (round ? 0.8 : 1)],
							[-qx4 * (round ? 0.8 : 1), -qy4 * (round ? 0.8 : 1)],
							[qx4 * (round ? 0.8 : 1), -qy4 * (round ? 0.8 : 1)]
						];
		const fitArea = s.t(plate.offset(-(md / 2 + 1), 'Round'));
		const fits = spots.filter(([x, y]) => inside(s, fitArea, [circle(x, y, 0.05, 8)]));
		const apart =
			spots.length < 2 || Math.hypot(spots[0][0] - spots[1][0], spots[0][1] - spots[1][1]) > md + 1;
		if (fits.length < spots.length || !apart) warnings.push(m.t_qr_plate_generator_warn_magnets());
		else if (mdep > 0.2)
			cuts.push({
				kind: 'cut',
				part: 'magnet',
				region: fits.map(([x, y]) => circle(x, y, md / 2)),
				z0: -1,
				z1: mdep
			});
		if (want > limit + 1e-6)
			warnings.push(m.t_qr_plate_generator_warn_magnet_depth({ depth: fmt(Math.max(0, mdep)) }));
	}

	// --- Checks ---
	if (module < 0.8) warnings.push(m.t_qr_plate_generator_warn_module({ module: fmt(module) }));
	if (engraved && relief > t - MIN_FLOOR + 1e-6)
		warnings.push(m.t_qr_plate_generator_warn_engrave_depth({ depth: fmt(depth) }));
	if (t < 2) warnings.push(m.t_qr_plate_generator_warn_thin());
	if (raw.mount !== 'none' && centres.length === 0)
		warnings.push(m.t_qr_plate_generator_warn_holes());

	layers.push(...cuts);
	return {
		layers,
		info: {
			warnings,
			colorChange: engraved ? t - depth : t,
			qr: {
				version: code.version,
				size: code.size,
				ecc: code.ecc,
				module,
				side: qrSide(code, module, quiet),
				bytes: new TextEncoder().encode(payload).length
			},
			captionCap
		}
	};
}

/** The texts the plate needs drawn (the caption). */
export function plateTexts(p: QrPlateParams): string[] {
	return p.caption && p.captionText.trim() ? [p.captionText.trim()] : [];
}

/** A build request for the plate worker. */
export interface QrPlateJob {
	params: QrPlateParams;
}
