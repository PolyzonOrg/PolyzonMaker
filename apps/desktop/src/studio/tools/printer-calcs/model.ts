/**
 * «Калькуляторы принтера»: the formulas a printer owner looks up — steps
 * and Klipper rotation_distance, jerk / junction deviation / square corner
 * velocity, layer heights in whole motor steps, volumetric flow and the top
 * speed of a hotend, filament length and weight, size and hole correction,
 * stepper driver Vref, and the pitch of a plucked belt. Pure.
 */

// ---------- steps ----------

/** Klipper rotation_distance from Marlin steps per mm. */
export const rotationDistance = (fullSteps: number, microsteps: number, stepsPerMm: number) =>
	(fullSteps * microsteps) / stepsPerMm;

/** Marlin steps per mm from a rotation distance. */
export const stepsPerMm = (fullSteps: number, microsteps: number, rd: number) =>
	(fullSteps * microsteps) / rd;

/** A belt axis: one turn moves pitch × teeth. */
export const beltDistance = (pitch: number, teeth: number) => pitch * teeth;

/** A lead screw: one turn moves pitch × starts (T8×8 = 2 × 4). */
export const screwDistance = (pitch: number, starts: number) => pitch * starts;

/** Extruder: asked to push `requested` mm, it pushed `actual`. */
export function extruderFix(
	steps: number,
	requested: number,
	actual: number
): { steps: number; factor: number } | null {
	if (!(steps > 0 && requested > 0 && actual > 0)) return null;
	return { steps: (steps * requested) / actual, factor: actual / requested };
}

// ---------- corners ----------

const SQRT2_1 = Math.SQRT2 - 1;

/** Marlin junction deviation from a classic jerk, mm. */
export const jdFromJerk = (jerk: number, accel: number) => (0.4 * jerk * jerk) / accel;
export const jerkFromJd = (jd: number, accel: number) => Math.sqrt((jd * accel) / 0.4);
/** Klipper square_corner_velocity ↔ junction deviation (the same 90° corner). */
export const jdFromScv = (scv: number, accel: number) => (scv * scv * SQRT2_1) / accel;
export const scvFromJd = (jd: number, accel: number) => Math.sqrt((jd * accel) / SQRT2_1);

// ---------- layers ----------

/** Z per full motor step, mm: lead ÷ full steps (8 mm lead, 200 steps → 0.04). */
export const zStep = (lead: number, fullSteps: number) => lead / fullSteps;

/** Layer heights that are whole full steps, between lo and hi. */
export function wholeStepLayers(lead: number, fullSteps: number, lo = 0.04, hi = 0.4): number[] {
	const s = zStep(lead, fullSteps);
	if (!(s > 0)) return [];
	const out: number[] = [];
	for (let k = Math.max(1, Math.ceil(lo / s - 1e-9)); k * s <= hi + 1e-9 && out.length < 40; k++)
		out.push(Math.round(k * s * 10000) / 10000);
	return out;
}

// ---------- flow ----------

/** Cross-section of a printed line, mm²: a rectangle with round ends (Slic3r flow math). */
export function lineArea(width: number, height: number): number {
	const h = Math.min(height, width);
	return (width - h) * h + (Math.PI * h * h) / 4;
}

/** mm³/s through the nozzle at a speed. */
export const volumetricFlow = (width: number, height: number, speed: number) =>
	lineArea(width, height) * speed;

/** The fastest speed a hotend melting `limit` mm³/s allows. */
export const topSpeed = (limit: number, width: number, height: number) =>
	limit / lineArea(width, height);

// ---------- filament ----------

/** Grams per metre of filament. */
export const gramsPerMetre = (diameter: number, density: number) =>
	((Math.PI * diameter * diameter) / 4) * density;

export const metresOf = (grams: number, diameter: number, density: number) =>
	grams / gramsPerMetre(diameter, density);
export const gramsOf = (metres: number, diameter: number, density: number) =>
	metres * gramsPerMetre(diameter, density);

// ---------- size ----------

/** Scale to set in the slicer so a part measured `measured` comes out `nominal`, %. */
export const scaleFix = (nominal: number, measured: number) => (nominal / measured) * 100;

/** Hole compensation for the slicer (per side, mm): a hole printed small needs it positive. */
export const holeFix = (nominal: number, measured: number) => (nominal - measured) / 2;

// ---------- drivers ----------

export type Driver = 'a4988' | 'drv8825' | 'tmc';

/**
 * Vref for a driver's current: A4988 Vref = 8 · Imax · Rsense; DRV8825
 * Vref = Imax / 2; TMC2208/2209 in standalone mode Vref = Irms · 2.5 / 1.77.
 */
export function vrefOf(driver: Driver, current: number, rsense = 0.1): number {
	if (driver === 'a4988') return 8 * current * rsense;
	if (driver === 'drv8825') return current / 2;
	return (current * 2.5) / 1.77;
}

// ---------- belt ----------

/**
 * The pitch of a plucked belt in a buffer of samples: autocorrelation over
 * the lags of fmin…fmax, refined by a parabola through the peak. Null when
 * the sound is too weak or has no clear pitch.
 */
export function pitchOf(
	samples: Float32Array,
	sampleRate: number,
	fmin = 30,
	fmax = 400
): number | null {
	const n = samples.length;
	let energy = 0;
	for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
	if (energy / n < 1e-6) return null;
	const lo = Math.max(2, Math.floor(sampleRate / fmax));
	const hi = Math.min(n - 2, Math.ceil(sampleRate / fmin));
	const corr = new Float64Array(hi + 2);
	for (let lag = lo - 1; lag <= hi + 1; lag++) {
		let s = 0;
		for (let i = 0; i + lag < n; i++) s += samples[i] * samples[i + lag];
		corr[lag] = s / (n - lag);
	}
	// The first strong peak (not just the largest — harmonics repeat at multiples).
	let best = -1;
	let max = -Infinity;
	for (let lag = lo; lag <= hi; lag++) if (corr[lag] > max) max = corr[lag];
	if (!(max > 0)) return null;
	for (let lag = lo; lag <= hi; lag++) {
		if (corr[lag] > 0.9 * max && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
			best = lag;
			break;
		}
	}
	if (best < 0) return null;
	const a = corr[best - 1];
	const b = corr[best];
	const c = corr[best + 1];
	const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
	return sampleRate / (best + shift);
}
