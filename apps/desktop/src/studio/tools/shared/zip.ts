/**
 * A ZIP archive without compression (method «stored»): several STL files of
 * one download — the parts of a multi-colour print. STL barely compresses
 * with deflate's small window anyway, and no dependency is needed. Pure.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
	name: string;
	data: Uint8Array | string;
}

/** Files → one .zip (UTF-8 names, fixed date 2026-01-01). */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
	const enc = new TextEncoder();
	const files = entries.map((e) => {
		const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
		return { name: enc.encode(e.name), data, crc: crc32(data) };
	});
	const DOS_TIME = 0;
	const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
	const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
	const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
	const out = new Uint8Array(localSize + centralSize + 22);
	const view = new DataView(out.buffer);
	let at = 0;
	const offsets: number[] = [];
	for (const f of files) {
		offsets.push(at);
		view.setUint32(at, 0x04034b50, true);
		view.setUint16(at + 4, 20, true); // version needed
		view.setUint16(at + 6, 0x0800, true); // UTF-8 names
		view.setUint16(at + 8, 0, true); // stored
		view.setUint16(at + 10, DOS_TIME, true);
		view.setUint16(at + 12, DOS_DATE, true);
		view.setUint32(at + 14, f.crc, true);
		view.setUint32(at + 18, f.data.length, true);
		view.setUint32(at + 22, f.data.length, true);
		view.setUint16(at + 26, f.name.length, true);
		view.setUint16(at + 28, 0, true);
		out.set(f.name, at + 30);
		out.set(f.data, at + 30 + f.name.length);
		at += 30 + f.name.length + f.data.length;
	}
	const centralStart = at;
	files.forEach((f, i) => {
		view.setUint32(at, 0x02014b50, true);
		view.setUint16(at + 4, 20, true); // made by
		view.setUint16(at + 6, 20, true); // needed
		view.setUint16(at + 8, 0x0800, true);
		view.setUint16(at + 10, 0, true);
		view.setUint16(at + 12, DOS_TIME, true);
		view.setUint16(at + 14, DOS_DATE, true);
		view.setUint32(at + 16, f.crc, true);
		view.setUint32(at + 20, f.data.length, true);
		view.setUint32(at + 24, f.data.length, true);
		view.setUint16(at + 28, f.name.length, true);
		// extra, comment, disk, internal attrs: 0
		view.setUint32(at + 38, 0, true); // external attrs
		view.setUint32(at + 42, offsets[i], true);
		out.set(f.name, at + 46);
		at += 46 + f.name.length;
	});
	view.setUint32(at, 0x06054b50, true);
	view.setUint16(at + 8, files.length, true);
	view.setUint16(at + 10, files.length, true);
	view.setUint32(at + 12, at - centralStart, true);
	view.setUint32(at + 16, centralStart, true);
	return out;
}
