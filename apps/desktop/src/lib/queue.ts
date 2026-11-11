/**
 * The generation queue as the person sees it: the engine runs one job at a time, the oldest waiting
 * one next (jobs.rs `work`), so a night's or a day's work can be lined up and left.
 */
import { fit, type Bench, type Hardware, type Model } from './catalog';
import type { Job } from './core';
import { lang, t } from './i18n.svelte';

const RUNNING = ['preparing', 'running', 'finalizing'];
/** Where a job stands in line, as jobs.rs `place` has it: a move's place, or when it was made */
const place = (job: Job) => job.turn || job.created * 1000;

export interface Place {
	job: Job;
	running: boolean;
	/** What it still needs, low and high; null for a model with no time of its own */
	seconds: [number, number] | null;
}

/** What runs and what waits, in the engine's order, and when the last should be done (ms since 1970). */
export function queue(jobs: Job[], models: Model[], hw: Hardware, bench: Bench | null, now: number): { places: Place[]; done: [number, number] | null } {
	const running = jobs.filter((j) => RUNNING.includes(j.state));
	const waiting = jobs.filter((j) => j.state === 'queued').sort((a, b) => place(a) - place(b));
	const places = [...running, ...waiting].map((job): Place => {
		const model = models.find((m) => m.id === job.model);
		const whole = model ? fit(model, hw, bench, model.presets.find((p) => p.id === job.preset)).seconds : null;
		const spent = RUNNING.includes(job.state) && job.started ? Math.max(now / 1000 - job.started, 0) : 0;
		return { job, running: RUNNING.includes(job.state), seconds: whole && [Math.max(whole[0] - spent, 0), Math.max(whole[1] - spent, 0)] };
	});
	const known = places.every((p) => p.seconds);
	const sum = (i: 0 | 1) => places.reduce((total, p) => total + (p.seconds?.[i] ?? 0), 0);
	return { places, done: places.length && known ? [now + sum(0) * 1000, now + sum(1) * 1000] : null };
}

/** «Всё будет готово примерно к 05:10–06:40», and only the later time when it is another day. */
export function readyBy([lo, hi]: [number, number], now: number): string {
	const locale = lang.value === 'ru' ? 'ru-RU' : 'en-GB';
	const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
	const day = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
	const days = Math.round((day(hi) - day(now)) / 86_400_000);
	if (days === 1) return t('queue.readyTomorrow', { time: clock(hi) });
	if (days > 1) return t('queue.readyBy', { time: new Date(hi).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
	return t('queue.readyBy', { time: clock(lo) === clock(hi) ? clock(hi) : `${clock(lo)}–${clock(hi)}` });
}
