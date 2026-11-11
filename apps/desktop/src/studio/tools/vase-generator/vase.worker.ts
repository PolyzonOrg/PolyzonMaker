/** Builds the vase off the main thread: big twisted, ribbed vases take a while. */
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { writeStl } from '../stl';
import { vaseMesh, type VaseParams } from './model';

serveMeshJobs<VaseParams, Uint8Array>(
	(params) => writeStl(vaseMesh(params), 'Polyzon Studio vase'),
	(stl) => [stl.buffer]
);
