// Specks that drift in from every side and are gone at the middle, while a model or a picture is made:
// it looks put together from them. Pure, so the motion can be tested without a screen.

export interface Speck {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	/** Seconds since it came in */
	life: number;
}

/** Pull toward the middle, px/s². */
const PULL = 40;
/** Share of its speed a speck keeps after a second: some inertia, so paths bend and slowly close in. */
const DRAG = 0.5;
/** No speck is faster than this, px/s: a slow drift. */
export const TOP = 70;
/** Closer to the middle than this it is gone, when nothing stands there. */
export const GONE = 14;
/** How far before that it fades out, px. */
const FADE = 60;
/** How hard a speck is pushed sideways as it comes in, px/s. */
const SIDEWAYS = 35;
/** Seconds a speck is on its way, about: how often new ones come in to keep the count. */
export const LIFE = 10;

export function spawn(width: number, height: number, random: () => number = Math.random): Speck {
	const side = Math.floor(random() * 4);
	const along = random();
	const x = side === 0 ? -8 : side === 1 ? width + 8 : along * width;
	const y = side === 2 ? -8 : side === 3 ? height + 8 : along * height;
	const dx = width / 2 - x;
	const dy = height / 2 - y;
	const d = Math.hypot(dx, dy) || 1;
	const across = (random() - 0.5) * 2 * SIDEWAYS;
	return { x, y, vx: (dx / d) * 20 - (dy / d) * across, vy: (dy / d) * 20 + (dx / d) * across, size: 1.2 + random() * 1.4, life: 0 };
}

/** Moves a speck `dt` seconds toward (cx, cy); it is gone `gone` px from there. False once it has arrived. */
export function step(s: Speck, cx: number, cy: number, dt: number, gone = GONE): boolean {
	const dx = cx - s.x;
	const dy = cy - s.y;
	const d = Math.hypot(dx, dy);
	if (d < gone) return false;
	s.vx += (dx / d) * PULL * dt;
	s.vy += (dy / d) * PULL * dt;
	const keep = DRAG ** dt;
	s.vx *= keep;
	s.vy *= keep;
	const speed = Math.hypot(s.vx, s.vy);
	if (speed > TOP) {
		s.vx *= TOP / speed;
		s.vy *= TOP / speed;
	}
	s.x += s.vx * dt;
	s.y += s.vy * dt;
	s.life += dt;
	return true;
}

/** It fades in as it comes and out as it reaches what is made, `distance` away from its middle. */
export const alphaOf = (s: Speck, distance: number, gone = GONE) => Math.max(0, Math.min(1, s.life / 0.6) * Math.min(1, (distance - gone) / FADE));

/** How many new specks are due after `dt` seconds to keep `count` on their way: an even stream, never a burst. */
export function feed(flow: { owed: number }, dt: number, count: number): number {
	flow.owed += (dt * count) / LIFE;
	const due = Math.floor(flow.owed);
	flow.owed -= due;
	return due;
}

/** `count` specks already on their way, each some seconds along its path: the stream is even from the start. */
export function warm(width: number, height: number, cx: number, cy: number, gone: number, count: number, random: () => number = Math.random): Speck[] {
	const specks: Speck[] = [];
	for (let i = 0; i < count; i++) {
		const s = spawn(width, height, random);
		let alive = true;
		for (let t = random() * LIFE; t > 0 && alive; t -= 0.05) alive = step(s, cx, cy, 0.05, gone);
		if (alive) specks.push(s);
	}
	return specks;
}
