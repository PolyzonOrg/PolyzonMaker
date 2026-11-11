import { core } from '../lib/core';

/** A tool's file, through the system's save dialog. */
export async function saveFile(name: string, bytes: Uint8Array | string): Promise<void> {
	await core.saveFile(name, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
}
