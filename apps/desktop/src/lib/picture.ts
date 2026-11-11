// A picture as every engine can read it. Engines read the bare pixels of a file: the note a phone leaves
// about which way is up is lost on them, some formats they cannot open, and a huge photo only costs them
// memory they shrink it away with. The browser reads all of it, so the file they get is a plain PNG.
const LONGEST_SIDE = 2048;
/** Under this the shorter side gives an engine little to work with. */
const SMALL_SIDE = 256;

/** Lists show many of these, and a photo as a thumbnail would hold megabytes for each. */
const THUMB_SIDE = 360;

/** A small copy of a picture for a list. */
export async function thumbUrl(file: Blob): Promise<string> {
	const bitmap = await createImageBitmap(file);
	if (Math.max(bitmap.width, bitmap.height) <= THUMB_SIDE) {
		bitmap.close();
		return URL.createObjectURL(file);
	}
	const scale = THUMB_SIDE / Math.max(bitmap.width, bitmap.height);
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	canvas.width = canvas.height = 0;
	return URL.createObjectURL(small ?? file);
}

/** The longest side after shrinking, and whether the picture is small. */
export function fitted(width: number, height: number): { scale: number; small: boolean } {
	return { scale: Math.min(1, LONGEST_SIDE / Math.max(width, height)), small: Math.min(width, height) < SMALL_SIDE };
}

/** Null when the browser cannot read it either: the file then goes on as it is, and the engine says what is wrong. */
export async function plainPicture(file: Blob): Promise<{ bytes: Uint8Array; small: boolean } | null> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file); // turned the way the file says
	} catch {
		return null;
	}
	const { scale, small } = fitted(bitmap.width, bitmap.height);
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	const context = canvas.getContext('2d');
	context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	canvas.width = canvas.height = 0; // the pixels go now, not when the collector comes
	return blob && context ? { bytes: new Uint8Array(await blob.arrayBuffer()), small } : null;
}
