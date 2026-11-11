/** Builds the STL viewer's mesh off the main thread: a dense model would freeze the page for seconds. */
import { serve } from '$lib/tools/booleans/worker';
import { parseStl } from '$lib/tools/stl';
import { viewMesh } from './view-mesh';

serve<{ stl: Uint8Array }>(async ({ stl }) => {
	const mesh = await viewMesh(parseStl(stl));
	const transfer = [mesh.positions.buffer, mesh.indices.buffer];
	if (mesh.edges) transfer.push(mesh.edges.buffer);
	return [mesh, transfer];
});
