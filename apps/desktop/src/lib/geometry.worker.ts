// Geometry off the main thread: the window keeps moving while a model is read and prepared.
import { analyze, bounds, loadManifold, makeSolid, prepareForPrint, previewMesh, readModel, type Analysis, type PrintResult, type Provenance, type SolidModel, type Triangles } from '@polyzon/mesh-kit';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

const BED: [number, number, number] = [256, 256, 256];

export type Request =
	| { op: 'open'; bytes: Uint8Array; finished: boolean }
	| { op: 'prepare'; height: number; name: string; solid: boolean; provenance?: Provenance }
	| { op: 'printed'; stl: Uint8Array };

export interface Opened {
	preview: Float32Array;
	report: Analysis;
	/** The file's own count of faces when it had more than a print needs and was simplified as it opened; else 0 */
	fileFaces: number;
}

export interface Prepared {
	stl: Uint8Array | null;
	threemf: Uint8Array | null;
	report: Analysis;
	ready: boolean;
	flat: boolean;
	solid: PrintResult['solid'];
	filled: number;
	moved: number;
	crumbs: number;
	faces: PrintResult['faces'];
	problems: string[];
	/** What the files hold, for the screen, where the opened model stands */
	preview: Float32Array;
}

const post = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void };
let model: Triangles | null = null;
let report: Analysis | null = null;
let finished = false;
/** The model rebuilt as one solid body, when the person asked: made once, printed at any height */
let solid: SolidModel | null = null;

const manifold = () => loadManifold({ locateFile: () => wasmUrl });

self.onmessage = async (e: MessageEvent<Request & { id: number }>) => {
	const { id, ...req } = e.data;
	try {
		const [value, transfer] = await run(req as Request);
		post.postMessage({ id, value }, transfer);
	} catch (err) {
		post.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
	}
};

/** The printed mesh moved and scaled back over the opened one, so the view keeps its place. */
function overOpened(mesh: Triangles, opened: Analysis): Triangles {
	const b = bounds(mesh);
	const k = opened.size[2] / (b.size[2] || 1);
	return mesh.map((v, i) => (v - b.min[i % 3]) * k + opened.min[i % 3]) as Triangles;
}

async function run(req: Request): Promise<[unknown, Transferable[]]> {
	if (req.op === 'open') {
		const wasm = await manifold();
		let fileFaces = 0;
		model = await readModel('model.glb', req.bytes, { glbUnit: 'm', simplified: (faces) => (fileFaces = faces) });
		finished = req.finished;
		solid = null;
		// a generated model has no size of its own yet: the bed matters once the person has chosen one
		report = analyze(model, { wasm, buildVolume: finished ? BED : undefined, finished });
		const preview = (await previewMesh(model)).slice();
		const value: Opened = { preview, report, fileFaces };
		return [value, [preview.buffer]];
	}
	if (!model || !report) throw new Error('no model');
	// print files made on an earlier visit: only their picture for the screen, over the opened model
	if (req.op === 'printed') {
		const preview = (await previewMesh(overOpened(await readModel('print.stl', req.stl), report))).slice();
		return [preview, [preview.buffer]];
	}
	const wasm = await manifold();
	// a rebuild on a grid smooths the detail away: only when the person asks for it
	const whole = req.solid;
	if (whole && !solid) {
		post.postMessage({ stage: 'solid' });
		solid = await makeSolid(model, wasm);
	}
	const result = await prepareForPrint(model, report, {
		wasm,
		height: req.height,
		buildVolume: BED,
		finished,
		name: req.name,
		solid: whole ? solid! : undefined,
		provenance: req.provenance,
		progress: (stage) => post.postMessage({ stage })
	});
	const bytesOf = (format: string) => result.files.find((f) => f.format === format && f.ready)?.bytes ?? null;
	const [stl, threemf] = [bytesOf('stl'), bytesOf('3mf')];
	const printed = await previewMesh(overOpened(result.mesh, report));
	const preview = printed.slice();
	const value: Prepared = {
		stl,
		threemf,
		report: result.report,
		ready: result.ready,
		flat: result.flat,
		solid: result.solid,
		filled: result.filled,
		moved: result.moved,
		crumbs: result.crumbs,
		faces: result.faces,
		problems: result.files.flatMap((f) => f.problems),
		preview
	};
	const transfer = [stl, threemf, preview].flatMap((b) => (b ? [b.buffer as ArrayBuffer] : []));
	return [value, transfer];
}
