/**
 * The parts list after one cut: the two halves take the cut part's place and
 * move apart along the plane's normal when the view is exploded.
 */
import type { Vec3 } from '../booleans/plane';

/** Where the two halves go: the part's own direction, minus and plus the normal. */
export function halfDirs(dir: Vec3, normal: Vec3): [minus: Vec3, plus: Vec3] {
	return [
		[dir[0] - normal[0], dir[1] - normal[1], dir[2] - normal[2]],
		[dir[0] + normal[0], dir[1] + normal[1], dir[2] + normal[2]]
	];
}

/** The half to select next: the bigger one, the plus side when they are equal. */
export function biggerHalf<T extends { volume: number }>(minus: T, plus: T): T {
	return plus.volume >= minus.volume ? plus : minus;
}

/** `parts` with `cut` replaced by `made`, in its place. */
export function replacePart<T>(parts: readonly T[], cut: T, made: readonly T[]): T[] {
	const at = parts.indexOf(cut);
	return [...parts.slice(0, at), ...made, ...parts.slice(at + 1)];
}
