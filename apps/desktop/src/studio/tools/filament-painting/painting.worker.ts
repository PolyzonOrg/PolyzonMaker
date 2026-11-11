/** Change layers, the look and the relief off the main thread: a picture is a few hundred thousand points. */
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { paint, type PaintJob, type PaintResult } from './model';

serveMeshJobs<PaintJob, PaintResult>(
	(job) => paint(job),
	(r) => [r.stl.buffer, r.preview.buffer, ...r.bands.map((b) => b.buffer)]
);
