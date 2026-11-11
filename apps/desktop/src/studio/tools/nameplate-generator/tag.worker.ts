/** Builds tags and nameplates off the page (manifold needs a worker, see relief-worker.ts). */
import { serveRelief } from '../shared/relief-worker';
import { buildTag, type TagInfo, type TagJob } from './tag';

serveRelief<TagJob, TagInfo>((s, job, text) => {
	const { layers, ...info } = buildTag(s, job.params, text, {
		maxLines: job.maxLines,
		mounts: job.mounts
	});
	return { layers, info };
});
