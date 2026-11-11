<script lang="ts">
	import { onMount } from 'svelte';
	import { alphaOf, feed, GONE, spawn, step, warm, type Speck } from '../lib/particles';

	/** What the specks gather into, and are gone at its edge; the middle of the area when there is nothing. */
	let { target }: { target?: HTMLElement | null } = $props();
	let canvas = $state<HTMLCanvasElement>();

	onMount(() => {
		if (!canvas) return;
		const paint = canvas.getContext('2d');
		if (!paint) return;
		// asked for less motion: the same specks, at half the pace and without their short tails
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const box = canvas;
		let specks: Speck[] = [];
		let [width, height] = [0, 0];
		const fit = () => {
			const ratio = Math.min(devicePixelRatio, 2);
			[width, height] = [box.clientWidth, box.clientHeight];
			box.width = Math.round(width * ratio);
			box.height = Math.round(height * ratio);
			paint.setTransform(ratio, 0, 0, ratio, 0, 0);
		};
		const watcher = new ResizeObserver(fit);
		watcher.observe(box);
		fit();
		// a few, sparse: they set a mood, the page is what matters
		const many = () => Math.min(80, Math.max(24, Math.round((width * height) / 14000)));
		const flow = { owed: 0 };
		let started = false;
		let frame = 0;
		let last = performance.now();
		const draw = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.05) * (calm ? 0.5 : 1);
			last = now;
			const own = box.getBoundingClientRect();
			const aim = target?.getBoundingClientRect();
			const [cx, cy] = aim ? [aim.left + aim.width / 2 - own.left, aim.top + aim.height / 2 - own.top] : [width / 2, height / 2];
			const gone = aim ? Math.max(GONE, Math.min(aim.width, aim.height) / 2) : GONE;
			// already on their way when the page opens, then an even stream: never a wave of them at once
			if (!started && width) [started, specks] = [true, warm(width, height, cx, cy, gone, many())];
			for (let due = feed(flow, dt, many()); due > 0 && specks.length < many() * 1.3; due--) specks.push(spawn(width, height));
			const tail = calm ? 0 : 0.035;
			paint.clearRect(0, 0, width, height);
			paint.strokeStyle = getComputedStyle(box).color;
			paint.lineCap = 'round';
			specks = specks.filter((s) => {
				if (!step(s, cx, cy, dt, gone)) return false;
				paint.globalAlpha = alphaOf(s, Math.hypot(cx - s.x, cy - s.y), gone) * 0.85;
				paint.lineWidth = s.size * 2;
				paint.beginPath();
				paint.moveTo(s.x - s.vx * tail, s.y - s.vy * tail);
				paint.lineTo(s.x + 0.01, s.y);
				paint.stroke();
				return true;
			});
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => {
			cancelAnimationFrame(frame);
			watcher.disconnect();
		};
	});
</script>

<canvas bind:this={canvas} class="gather" aria-hidden="true"></canvas>

<style>
	.gather {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		color: var(--ink-muted);
		pointer-events: none;
	}
</style>
