/*
 * QR Code generator — byte mode (UTF-8), versions 1–40, error correction
 * L/M/Q/H, automatic mask by the standard penalty score. Output: a square
 * matrix of booleans, `modules[y][x]`, true = dark, row 0 at the top.
 *
 * Condensed TypeScript port of Project Nayuki's QR Code generator library
 * (https://www.nayuki.io/page/qr-code-generator-library), reduced to the
 * byte mode the tools need.
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
	version: number;
	/** Modules per side: 4 · version + 17. */
	size: number;
	/** The level actually used: raised above the requested one when it fits for free. */
	ecc: QrEcc;
	mask: number;
	/** `modules[y][x]`, true = dark, row 0 at the top. */
	modules: boolean[][];
}

const ECC_ORDER: readonly QrEcc[] = ['L', 'M', 'Q', 'H'];
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
	// Version: 0 is padding; 1 … 40
	[-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
	[-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
	[-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
	[-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30] // H
];

// prettier-ignore
const NUM_ERROR_CORRECTION_BLOCKS: readonly (readonly number[])[] = [
	[-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
	[-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
	[-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
	[-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81] // H
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** Thrown when the text does not fit even version 40 at this level. */
export class QrTooLongError extends RangeError {}

/** Bits of the data area of a version, function patterns excluded. */
export function rawDataModules(version: number): number {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const numAlign = Math.floor(version / 7) + 2;
		result -= (25 * numAlign - 10) * numAlign - 55;
		if (version >= 7) result -= 36;
	}
	return result;
}

/** Data codewords (bytes, before error correction) of a version and level. */
export function dataCodewords(version: number, ecc: QrEcc): number {
	const e = ECC_ORDER.indexOf(ecc);
	return (
		Math.floor(rawDataModules(version) / 8) -
		ECC_CODEWORDS_PER_BLOCK[e][version] * NUM_ERROR_CORRECTION_BLOCKS[e][version]
	);
}

/** Reed–Solomon block layout of a version and level. */
export function eccBlocks(version: number, ecc: QrEcc): { blocks: number; eccPerBlock: number } {
	const e = ECC_ORDER.indexOf(ecc);
	return {
		blocks: NUM_ERROR_CORRECTION_BLOCKS[e][version],
		eccPerBlock: ECC_CODEWORDS_PER_BLOCK[e][version]
	};
}

/** Centres of the alignment patterns on each axis (empty for version 1). */
export function alignmentPositions(version: number): number[] {
	if (version === 1) return [];
	const size = version * 4 + 17;
	const numAlign = Math.floor(version / 7) + 2;
	const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
	const result = [6];
	for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
	return result;
}

/** The 15 format bits (level + mask, BCH-protected, XOR-masked). */
export function formatBits(ecc: QrEcc, mask: number): number {
	const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
	let rem = version;
	for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
	return (version << 12) | rem;
}

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(x: number, y: number): number {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

function rsDivisor(degree: number): number[] {
	const result = new Array<number>(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < result.length; j++) {
			result[j] = gfMultiply(result[j], root);
			if (j + 1 < result.length) result[j] ^= result[j + 1];
		}
		root = gfMultiply(root, 0x02);
	}
	return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
	const result = divisor.map(() => 0);
	for (const b of data) {
		const factor = b ^ (result.shift() as number);
		result.push(0);
		divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
	}
	return result;
}

function appendBits(value: number, length: number, bits: number[]): void {
	for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

/**
 * Encode text (UTF-8, byte mode) at the smallest version that holds it.
 * With `boostEcc` (default) the level is raised while the version stays the
 * same — more redundancy for free.
 */
export function encodeQr(
	text: string,
	ecc: QrEcc = 'M',
	{ boostEcc = true, mask = -1 }: { boostEcc?: boolean; mask?: number } = {}
): QrCode {
	const bytes = new TextEncoder().encode(text);
	let version = 1;
	let usedBits = 0;
	for (; ; version++) {
		usedBits = 4 + (version <= 9 ? 8 : 16) + bytes.length * 8;
		if (usedBits <= dataCodewords(version, ecc) * 8) break;
		if (version >= 40) throw new QrTooLongError('Data too long');
	}
	let level = ecc;
	if (boostEcc) {
		for (const next of ECC_ORDER.slice(ECC_ORDER.indexOf(ecc) + 1)) {
			if (usedBits <= dataCodewords(version, next) * 8) level = next;
		}
	}

	const bits: number[] = [];
	appendBits(0x4, 4, bits);
	appendBits(bytes.length, version <= 9 ? 8 : 16, bits);
	for (const b of bytes) appendBits(b, 8, bits);
	const capacity = dataCodewords(version, level) * 8;
	appendBits(0, Math.min(4, capacity - bits.length), bits);
	appendBits(0, (8 - (bits.length % 8)) % 8, bits);
	for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) appendBits(pad, 8, bits);
	const data = new Array<number>(bits.length / 8).fill(0);
	bits.forEach((b, i) => (data[i >>> 3] |= b << (7 - (i & 7))));

	return new Matrix(version, level).build(data, mask);
}

class Matrix {
	readonly size: number;
	readonly modules: boolean[][];
	readonly isFunction: boolean[][];

	constructor(
		readonly version: number,
		readonly ecc: QrEcc
	) {
		this.size = version * 4 + 17;
		this.modules = Array.from({ length: this.size }, () =>
			new Array<boolean>(this.size).fill(false)
		);
		this.isFunction = Array.from({ length: this.size }, () =>
			new Array<boolean>(this.size).fill(false)
		);
	}

	build(data: number[], requestedMask: number): QrCode {
		this.drawFunctionPatterns();
		this.drawCodewords(this.interleave(data));
		let mask = requestedMask;
		if (mask < 0 || mask > 7) {
			let best = Infinity;
			for (let m = 0; m < 8; m++) {
				this.applyMask(m);
				this.drawFormatBits(m);
				const penalty = this.penalty();
				if (penalty < best) {
					best = penalty;
					mask = m;
				}
				this.applyMask(m); // XOR again: undo
			}
		}
		this.applyMask(mask);
		this.drawFormatBits(mask);
		return {
			version: this.version,
			size: this.size,
			ecc: this.ecc,
			mask,
			modules: this.modules
		};
	}

	private set(x: number, y: number, dark: boolean): void {
		this.modules[y][x] = dark;
		this.isFunction[y][x] = true;
	}

	private drawFunctionPatterns(): void {
		const size = this.size;
		for (let i = 0; i < size; i++) {
			this.set(6, i, i % 2 === 0);
			this.set(i, 6, i % 2 === 0);
		}
		this.drawFinder(3, 3);
		this.drawFinder(size - 4, 3);
		this.drawFinder(3, size - 4);
		const align = alignmentPositions(this.version);
		const n = align.length;
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < n; j++) {
				// The three corners already hold finder patterns.
				if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
				for (let dy = -2; dy <= 2; dy++) {
					for (let dx = -2; dx <= 2; dx++) {
						this.set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
					}
				}
			}
		}
		this.drawFormatBits(0); // placeholder, overwritten once the mask is chosen
		this.drawVersion();
	}

	private drawFinder(cx: number, cy: number): void {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				const x = cx + dx;
				const y = cy + dy;
				if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
					this.set(x, y, dist !== 2 && dist !== 4);
				}
			}
		}
	}

	private drawFormatBits(mask: number): void {
		const bits = formatBits(this.ecc, mask);
		const bit = (i: number) => ((bits >>> i) & 1) !== 0;
		const size = this.size;
		for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
		this.set(8, 7, bit(6));
		this.set(8, 8, bit(7));
		this.set(7, 8, bit(8));
		for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
		for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(i));
		for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(i));
		this.set(8, size - 8, true); // always dark
	}

	private drawVersion(): void {
		if (this.version < 7) return;
		const bits = versionBits(this.version);
		for (let i = 0; i < 18; i++) {
			const dark = ((bits >>> i) & 1) !== 0;
			const a = this.size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			this.set(a, b, dark);
			this.set(b, a, dark);
		}
	}

	/** Split into blocks, add Reed–Solomon codewords, interleave. */
	private interleave(data: number[]): number[] {
		const e = ECC_ORDER.indexOf(this.ecc);
		const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e][this.version];
		const eccLen = ECC_CODEWORDS_PER_BLOCK[e][this.version];
		const raw = Math.floor(rawDataModules(this.version) / 8);
		const numShort = numBlocks - (raw % numBlocks);
		const shortLen = Math.floor(raw / numBlocks);
		const divisor = rsDivisor(eccLen);
		const blocks: number[][] = [];
		for (let i = 0, k = 0; i < numBlocks; i++) {
			const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
			k += dat.length;
			const ecc = rsRemainder(dat, divisor);
			if (i < numShort) dat.push(0);
			blocks.push(dat.concat(ecc));
		}
		const result: number[] = [];
		for (let i = 0; i < blocks[0].length; i++) {
			blocks.forEach((block, j) => {
				// Skip the padding byte of the short blocks.
				if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]);
			});
		}
		return result;
	}

	/** Zigzag over the data area, two columns at a time, skipping the timing column. */
	private drawCodewords(data: number[]): void {
		const size = this.size;
		let i = 0;
		for (let right = size - 1; right >= 1; right -= 2) {
			if (right === 6) right = 5;
			for (let vert = 0; vert < size; vert++) {
				for (let j = 0; j < 2; j++) {
					const x = right - j;
					const upward = ((right + 1) & 2) === 0;
					const y = upward ? size - 1 - vert : vert;
					if (!this.isFunction[y][x] && i < data.length * 8) {
						this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
						i++;
					}
				}
			}
		}
	}

	private applyMask(mask: number): void {
		const size = this.size;
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				if (this.isFunction[y][x] || !maskBit(mask, x, y)) continue;
				this.modules[y][x] = !this.modules[y][x];
			}
		}
	}

	private penalty(): number {
		const size = this.size;
		const m = this.modules;
		let result = 0;
		for (let pass = 0; pass < 2; pass++) {
			// pass 0: rows, pass 1: columns
			for (let a = 0; a < size; a++) {
				let runColor = false;
				let run = 0;
				const history = [0, 0, 0, 0, 0, 0, 0];
				for (let b = 0; b < size; b++) {
					const dark = pass === 0 ? m[a][b] : m[b][a];
					if (dark === runColor) {
						run++;
						if (run === 5) result += PENALTY_N1;
						else if (run > 5) result++;
					} else {
						this.addHistory(run, history);
						if (!runColor) result += this.countFinderLike(history) * PENALTY_N3;
						runColor = dark;
						run = 1;
					}
				}
				result += this.terminateAndCount(runColor, run, history) * PENALTY_N3;
			}
		}
		for (let y = 0; y < size - 1; y++) {
			for (let x = 0; x < size - 1; x++) {
				const c = m[y][x];
				if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += PENALTY_N2;
			}
		}
		let dark = 0;
		for (const row of m) for (const c of row) if (c) dark++;
		const total = size * size;
		const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
		return result + k * PENALTY_N4;
	}

	private countFinderLike(h: number[]): number {
		const n = h[1];
		const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
		return (
			(core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
		);
	}

	private terminateAndCount(runColor: boolean, run: number, history: number[]): number {
		let length = run;
		if (runColor) {
			this.addHistory(length, history);
			length = 0;
		}
		length += this.size; // light border after the last run
		this.addHistory(length, history);
		return this.countFinderLike(history);
	}

	private addHistory(run: number, history: number[]): void {
		const length = history[0] === 0 ? run + this.size : run; // light border before the first run
		history.pop();
		history.unshift(length);
	}
}

/** Whether mask pattern `mask` flips the module at (x, y). */
export function maskBit(mask: number, x: number, y: number): boolean {
	switch (mask) {
		case 0:
			return (x + y) % 2 === 0;
		case 1:
			return y % 2 === 0;
		case 2:
			return x % 3 === 0;
		case 3:
			return (x + y) % 3 === 0;
		case 4:
			return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5:
			return ((x * y) % 2) + ((x * y) % 3) === 0;
		case 6:
			return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
		default:
			return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
	}
}

/**
 * Dark modules as rectangles in module units, origin at the top-left corner,
 * y down: runs of a row merged, then identical runs of consecutive rows
 * merged into one taller rectangle — a few hundred shapes for version 10
 * instead of thousands of squares.
 */
export function darkRects(
	modules: readonly (readonly boolean[])[]
): [number, number, number, number][] {
	const out: [number, number, number, number][] = [];
	let open = new Map<string, [number, number, number, number]>();
	modules.forEach((row, y) => {
		const next = new Map<string, [number, number, number, number]>();
		for (let x = 0; x < row.length; ) {
			if (!row[x]) {
				x++;
				continue;
			}
			let end = x;
			while (end < row.length && row[end]) end++;
			const key = `${x}:${end}`;
			const above = open.get(key);
			if (above) {
				above[3]++;
				next.set(key, above);
			} else {
				const rect: [number, number, number, number] = [x, y, end - x, 1];
				out.push(rect);
				next.set(key, rect);
			}
			x = end;
		}
		open = next;
	});
	return out;
}
