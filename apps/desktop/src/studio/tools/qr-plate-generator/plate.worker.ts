/** Builds QR plates off the page (manifold needs a worker, see relief-worker.ts). */
import { serveRelief } from '../shared/relief-worker';
import { buildQrPlate, type QrPlateInfo, type QrPlateJob } from './model';

serveRelief<QrPlateJob, QrPlateInfo>((s, job, text) => {
	const { layers, info } = buildQrPlate(s, job.params, text);
	return { layers, info };
});
