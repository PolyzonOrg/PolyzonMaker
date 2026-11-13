// A file dropped anywhere on the window: a picture goes to «Новая модель», a 3D model into the library, where its
// page prepares it for print as it does a generated one.

const MODEL_FILES = ['stl', 'obj', '3mf', 'glb'];

export const isModelFile = (name: string) => name.includes('.') && MODEL_FILES.includes(name.split('.').pop()!.toLowerCase());

/** Over this a model is left alone: its bytes pass through the page twice on their way in */
export const MAX_MODEL_BYTES = 512 << 20;

/** The library's file for it, written as the tools write theirs (lib/plugins.ts modelFile): a GLB as it is,
 * once it is sure its page can open it. A download cut off, or another file renamed, is refused here and not
 * on a page that cannot show it. */
export async function libraryFile(name: string, bytes: Uint8Array): Promise<Uint8Array> {
	const { glbMesh, importMesh, MeshKitError, writeGlb } = await import('@polyzon/mesh-kit');
	if (!name.toLowerCase().endsWith('.glb')) return writeGlb([await importMesh(name, bytes)]);
	if (!glbMesh(bytes).indices.length) throw new MeshKitError('no-triangles');
	return bytes;
}
