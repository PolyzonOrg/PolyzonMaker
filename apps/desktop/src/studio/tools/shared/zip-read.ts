/**
 * Reading ZIP archives in the browser (3MF models, sliced 3MF projects):
 * the central directory, ZIP64 included, and entries inflated with
 * DecompressionStream — no ZIP library. Random access through ByteSource,
 * so a large file is never loaded whole. Pure apart from DecompressionStream,
 * which browsers, workers and Node 18+ all have.
 */
import { ToolError } from '../build.svelte';
import * as tc from '$msg/tools/common';

/** Random access to the file without loading all of it. */
export interface ByteSource {
	size: number;
	read(offset: number, length: number): Promise<Uint8Array>;
}

export function blobSource(blob: Blob): ByteSource {
	return {
		size: blob.size,
		read: async (offset, length) =>
			new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
	};
}

export function bytesSource(bytes: Uint8Array): ByteSource {
	return { size: bytes.length, read: (o, l) => Promise.resolve(bytes.subarray(o, o + l)) };
}

// ---------- ZIP ----------

export interface ZipEntry {
	name: string;
	/** 0 = stored, 8 = deflate */
	method: number;
	compressedSize: number;
	size: number;
	/** Offset of the local header. */
	offset: number;
}

export const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
export const u32 = (b: Uint8Array, o: number) =>
	(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;

const notZip = () => tc.tc_3mf_broken();

export async function zipEntries(src: ByteSource): Promise<ZipEntry[]> {
	const tailLen = Math.min(src.size, 22 + 0xffff);
	const tail = await src.read(src.size - tailLen, tailLen);
	let eocd = -1;
	for (let i = tail.length - 22; i >= 0; i--) {
		if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new ToolError(notZip());
	let count = u16(tail, eocd + 10);
	let cdSize = u32(tail, eocd + 12);
	let cdOffset = u32(tail, eocd + 16);
	if (cdOffset === 0xffffffff || count === 0xffff) {
		// ZIP64: the locator sits right before the classic record.
		const loc = eocd - 20;
		if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new ToolError(notZip());
		const rec = await src.read(u64(tail, loc + 8), 56);
		if (u32(rec, 0) !== 0x06064b50) throw new ToolError(notZip());
		count = u64(rec, 32);
		cdSize = u64(rec, 40);
		cdOffset = u64(rec, 48);
	}
	if (cdOffset + cdSize > src.size || count > 100_000) throw new ToolError(notZip());
	const cd = await src.read(cdOffset, cdSize);
	const decoder = new TextDecoder();
	const entries: ZipEntry[] = [];
	let p = 0;
	for (let n = 0; n < count && p + 46 <= cd.length; n++) {
		if (u32(cd, p) !== 0x02014b50) throw new ToolError(notZip());
		const nameLen = u16(cd, p + 28);
		const extraLen = u16(cd, p + 30);
		const commentLen = u16(cd, p + 32);
		let compressedSize = u32(cd, p + 20);
		let size = u32(cd, p + 24);
		let offset = u32(cd, p + 42);
		// ZIP64 sizes live in the extra field (id 1), only those that overflowed.
		let e = p + 46 + nameLen;
		const end = e + extraLen;
		while (e + 4 <= end) {
			const id = u16(cd, e);
			const len = u16(cd, e + 2);
			if (id === 1) {
				let q = e + 4;
				if (size === 0xffffffff) {
					size = u64(cd, q);
					q += 8;
				}
				if (compressedSize === 0xffffffff) {
					compressedSize = u64(cd, q);
					q += 8;
				}
				if (offset === 0xffffffff) offset = u64(cd, q);
			}
			e += 4 + len;
		}
		entries.push({
			name: decoder.decode(cd.subarray(p + 46, p + 46 + nameLen)),
			method: u16(cd, p + 10),
			compressedSize,
			size,
			offset
		});
		p = end + commentLen;
	}
	return entries;
}

async function entryData(src: ByteSource, entry: ZipEntry): Promise<Uint8Array> {
	const local = await src.read(entry.offset, 30);
	if (u32(local, 0) !== 0x04034b50) throw new ToolError(notZip());
	const start = entry.offset + 30 + u16(local, 26) + u16(local, 28);
	return src.read(start, entry.compressedSize);
}

export function decompressed(
	data: Uint8Array,
	format: 'deflate' | 'deflate-raw'
): ReadableStream<Uint8Array> {
	return new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
}

/** Concatenate a stream's chunks, stopping after `limit` bytes. */
export async function collect(
	stream: ReadableStream<Uint8Array>,
	limit = Infinity
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
		if (total >= limit) {
			await reader.cancel();
			break;
		}
	}
	const out = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

/** An entry's bytes; `limit` stops early (enough to read a header). */
export async function zipRead(
	src: ByteSource,
	entry: ZipEntry,
	limit = Infinity
): Promise<Uint8Array> {
	const data = await entryData(src, entry);
	if (entry.method === 0) return data.subarray(0, Math.min(data.length, limit));
	if (entry.method !== 8) throw new ToolError(tc.tc_zip_unknown_method());
	return collect(decompressed(data, 'deflate-raw'), limit);
}

/** The entries of an archive in memory whose names pass `wanted`, unpacked. */
export async function unzip(
	bytes: Uint8Array,
	wanted: (name: string) => boolean
): Promise<Map<string, Uint8Array>> {
	const src = bytesSource(bytes);
	const files = new Map<string, Uint8Array>();
	for (const entry of await zipEntries(src)) {
		if (wanted(entry.name)) files.set(entry.name, await zipRead(src, entry));
	}
	return files;
}
