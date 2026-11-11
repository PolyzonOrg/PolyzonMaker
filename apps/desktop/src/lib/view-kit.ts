// What every 3D view in the program can be asked, so that one set of controls serves all of them.

export type Side = 'iso' | 'front' | 'top' | 'side';
export type Look = 'clay' | 'glossy' | 'normals' | 'wire';
export const LOOKS: Look[] = ['clay', 'glossy', 'normals', 'wire'];
export const ZOOMS = [50, 100, 200, 400];

export interface Viewable {
	/** The whole model in sight, from the usual corner. */
	fit(): void;
	view(side: Side): void;
	/** How close, in percent of the distance the whole model fits at. */
	zoom(): number;
	setZoom(percent: number): void;
	setLook(look: Look): void;
	setSpin(on: boolean): void;
	setGrid(on: boolean): void;
	/** The left button moves the view instead of turning it. */
	setPan(on: boolean): void;
	/** Shadows, where the view has them. */
	setShadows?(on: boolean): void;
	/** Called whenever the zoom changes, by hand or by a command. */
	onZoom(listener: (percent: number) => void): void;
}

/** Where the camera stands for a side, as a direction from the middle, in a world where `up` is up. */
export function sideOf(side: Side, up: 'y' | 'z'): [number, number, number] {
	const z: Record<Side, [number, number, number]> = { iso: [0.42, -0.84, 0.34], front: [0, -1, 0.0001], top: [0, -0.0001, 1], side: [1, 0, 0.0001] };
	const [x, y, h] = z[side];
	return up === 'z' ? [x, y, h] : [x, h, -y];
}

/** Percent of the fit distance, never zero and never endless. */
export const percentOf = (fitDistance: number, distance: number) => Math.round((fitDistance / Math.max(distance, 1e-6)) * 100);

/** The distance a percent asks for. */
export const distanceFor = (fitDistance: number, percent: number) => fitDistance / (Math.min(Math.max(percent, 5), 2000) / 100);
