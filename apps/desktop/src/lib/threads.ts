// A thread is everything made from one start: the pictures, their variants and the models from them.
// The menu and the library show threads, the result page shows what is inside one.
import type { Job } from './core';

export interface Thread {
	id: string;
	title: string;
	/** Oldest first */
	jobs: Job[];
	/** What stands for the thread in lists: the newest model, else the newest finished thing */
	cover: Job;
	busy: boolean;
	/** The last time something was added */
	created: number;
}

const WORKING = ['queued', 'preparing', 'running', 'finalizing'];

export const isWorking = (job: Job) => WORKING.includes(job.state);
export const threadOf = (job: Pick<Job, 'id' | 'thread'>) => job.thread || job.id;

export function threads(jobs: Job[]): Thread[] {
	const groups = new Map<string, Job[]>();
	// the list is newest first and several variants start within one second: reversed, they stay in order
	for (const job of [...jobs].reverse().sort((a, b) => a.created - b.created)) {
		const id = threadOf(job);
		groups.set(id, [...(groups.get(id) ?? []), job]);
	}
	return [...groups]
		.map(([id, list]) => {
			const finished = list.filter((j) => j.state === 'succeeded');
			const cover = finished.filter((j) => j.kind === 'model').at(-1) ?? finished.at(-1) ?? list.at(-1)!;
			return { id, title: list[0].title, jobs: list, cover, busy: list.some(isWorking), created: list.at(-1)!.created };
		})
		.sort((a, b) => b.created - a.created);
}

export const threadWith = (jobs: Job[], id: string) => {
	const job = jobs.find((j) => j.id === id);
	return job ? threads(jobs).find((t) => t.id === threadOf(job)) : undefined;
};

/** A generation's versions as its strip shows them: the pictures first, then the models made from them. */
export function versions(jobs: readonly Job[]): { kind: 'picture' | 'model'; jobs: Job[] }[] {
	return (['picture', 'model'] as const).map((kind) => ({ kind, jobs: jobs.filter((j) => j.kind === kind) })).filter((group) => group.jobs.length);
}

const STEPS: Record<string, (at: number, last: number) => number> = {
	ArrowLeft: (at) => at - 1,
	ArrowRight: (at) => at + 1,
	Home: () => 0,
	End: (_, last) => last
};

/** The version a key moves to along the strip; null where it would stay or leave the strip. */
export function stepped(order: readonly string[], current: string, key: string): string | null {
	const at = order.indexOf(current);
	const to = STEPS[key]?.(at, order.length - 1);
	return to === undefined || to === at || to < 0 || to >= order.length ? null : order[to];
}
