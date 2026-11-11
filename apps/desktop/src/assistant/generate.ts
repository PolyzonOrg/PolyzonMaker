// A model from a generator, for what code cannot draw: from the person's photo, or a picture made from words.
// The assistant takes the best of what is installed, and the page of each job opens as soon as it starts.
import { core, type Job } from '../lib/core';
import { app, benchOf, go, isInstalled, pictureModels, startModel, startPictures } from '../lib/state.svelte';
import { bestGenerator, bestPicture, type Choice } from './choose';

const over = (job: Job) => job.state === 'succeeded' || job.state === 'failed' || job.state === 'cancelled';

export async function untilOver(id: string): Promise<Job> {
	for (;;) {
		const job = app.jobs.find((j) => j.id === id); // the queue tells the app of every change
		if (!job) throw new Error('The job is gone.');
		if (over(job)) return job;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}

/** What the chat hears as the work goes. */
export interface Progress {
	picture(job: Job, model: string): void;
	model(job: Job, choice: Choice): void;
}

export type Generated =
	| { done: Job; choice: Choice }
	| { failed: 'no_model' | 'no_picture_model' | 'picture' | 'model'; job?: Job }
	| { cancelled: true };

export async function generate(prompt: string, photo: { name: string; bytes: Uint8Array } | null, progress: Progress): Promise<Generated> {
	const choice = bestGenerator(app.models.filter((m) => isInstalled(m.id)), app.hw!, benchOf());
	if (!choice) return { failed: 'no_model' };
	let image = photo;
	if (!image) {
		const installed = pictureModels().map((m) => m.id);
		const pictureModel = bestPicture(app.models.filter((m) => installed.includes(m.id)), installed);
		if (!pictureModel) return { failed: 'no_picture_model' };
		const started = await startPictures(prompt, 1, pictureModel);
		progress.picture(started, pictureModel);
		go('result', started.id);
		const picture = await untilOver(started.id);
		if (picture.state === 'cancelled') return { cancelled: true };
		if (picture.state !== 'succeeded') return { failed: 'picture', job: picture };
		image = { name: 'picture.png', bytes: new Uint8Array(await core.readFile(picture.id, 'picture.png')) };
	}
	const started = await startModel(image.name, image.bytes, prompt.slice(0, 60), choice.preset, [], choice.model.id);
	progress.model(started, choice);
	go('result', started.id);
	const done = await untilOver(started.id);
	if (done.state === 'cancelled') return { cancelled: true };
	if (done.state !== 'succeeded') return { failed: 'model', job: done };
	return { done, choice };
}
