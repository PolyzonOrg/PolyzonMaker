/**
 * A three.js view sized to its container — the studio viewer, the parts
 * viewer, the G-code viewer and the market stage all do this on every resize.
 */

interface Sized {
	setSize(width: number, height: number, updateStyle?: boolean): void;
}
interface Lens {
	aspect: number;
	updateProjectionMatrix(): void;
}

/**
 * The drawing buffer and the camera follow `container` (a collapsed one
 * counts as 1 × 1). `updateStyle` false leaves the canvas's CSS size alone,
 * for a canvas styled 100 % that a capture resizes on its own.
 */
export function fitToContainer(
	renderer: Sized,
	camera: Lens,
	container: Pick<HTMLElement, 'clientWidth' | 'clientHeight'>,
	updateStyle = true
): void {
	const w = container.clientWidth || 1;
	const h = container.clientHeight || 1;
	renderer.setSize(w, h, updateStyle);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}
