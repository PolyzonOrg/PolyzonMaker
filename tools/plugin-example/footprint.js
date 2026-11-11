// The footprint of a model the app made, in millimetres: glTF keeps each mesh's box beside its points
// (the accessor's min and max), in metres, with Y up. Shared by the page and the panel.
async function footprint(job) {
	const glb = new DataView(await maker.jobs.file(job, 'model.glb'));
	const size = glb.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb.buffer, 20, size)));
	const boxes = json.meshes.flatMap((m) => m.primitives.map((p) => json.accessors[p.attributes.POSITION]));
	const low = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
	const high = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i])));
	const mm = (i) => Math.round((high[i] - low[i]) * 1000);
	return { wide: mm(0), deep: mm(2), high: mm(1) };
}
