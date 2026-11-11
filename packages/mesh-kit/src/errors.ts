/**
 * What can go wrong with a model, as a stable code the app translates and an
 * English sentence for logs. Studio threw its own localised ToolError; the
 * package says what happened and leaves the wording to the app.
 */

export type MeshKitErrorCode =
	| 'not-stl'
	| 'stl-no-triangles'
	| 'not-a-model'
	| 'no-triangles'
	| 'bad-coordinates'
	| 'obj-bad-face'
	| 'obj-no-faces'
	| 'zip-broken'
	| 'zip-unknown-method'
	| '3mf-no-model'
	| '3mf-bad-face'
	| '3mf-no-triangles'
	| 'glb-unreadable'
	| 'beyond-repair'
	| 'no-plane'
	| 'plane-misses-model'
	| 'plane-misses-cavity'
	| 'too-thin-for-cavity'
	| 'base-too-shallow'
	| 'wall-too-thin-for-plate'
	| 'wall-too-thin-for-lip'
	| 'too-many-parts'
	| 'empty-result'
	| 'not-a-solid'
	| 'remesh-too-fine'
	| 'zip-too-large'
	| 'unknown-op';

const MESSAGES: Record<MeshKitErrorCode, string> = {
	'not-stl': "This isn't an STL file.",
	'stl-no-triangles': 'The STL has no triangles.',
	'not-a-model': "This doesn't look like a model: use STL, OBJ, 3MF or GLB.",
	'no-triangles': 'The file has no triangles.',
	'bad-coordinates': 'The file has corrupted coordinates.',
	'obj-bad-face': "A face in the OBJ refers to a vertex that doesn't exist.",
	'obj-no-faces': 'The OBJ has no faces.',
	'zip-broken': "The archive is corrupted or isn't a ZIP.",
	'zip-unknown-method': 'The archive uses an unknown compression method.',
	'3mf-no-model': 'The 3MF has no model in it.',
	'3mf-bad-face': "A face in the 3MF refers to a vertex that doesn't exist.",
	'3mf-no-triangles': 'The 3MF has no triangles.',
	'glb-unreadable': "The GLB can't be read.",
	'beyond-repair': "The mesh is too damaged to make a closed solid of it.",
	'no-plane': 'Set the cut plane.',
	'plane-misses-model': 'The cut plane misses the model.',
	'plane-misses-cavity': "The cut plane doesn't cross the cavity.",
	'too-thin-for-cavity': 'The model is thinner than two walls: there is no room for a cavity.',
	'base-too-shallow': 'The base is too shallow for a plate: move the plane farther from its bottom.',
	'wall-too-thin-for-plate': 'The wall is too thin for a plate: make it thicker or reduce the clearance.',
	'wall-too-thin-for-lip': 'The wall is too thin for a lip: make it thicker.',
	'too-many-parts': 'The model would need too many parts: make it smaller or use a bigger printer.',
	'empty-result': 'The result is empty.',
	'not-a-solid': "The mesh isn't a closed solid: repair it first.",
	'remesh-too-fine': 'The voxel is too small for a model this size: choose a bigger one.',
	'zip-too-large': 'The archive unpacks to more than allowed.',
	'unknown-op': 'The operation is unknown or from another version of mesh-kit.'
};

export class MeshKitError extends Error {
	readonly code: MeshKitErrorCode;

	constructor(code: MeshKitErrorCode, detail?: string) {
		super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
		this.name = 'MeshKitError';
		this.code = code;
	}
}
