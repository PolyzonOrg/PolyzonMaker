// How wide the menu is. While it is dragged it follows the hand; where it comes to rest is decided here.

/** Icons alone. 12 + 10 + 18 + 10 + 12: the menu's and an item's padding around an icon, so icons stay put as it narrows. */
export const RAIL = 62;
/** Below this the words no longer fit. */
export const NARROWEST = 180;
export const USUAL = 240;
export const WIDEST = 360;

export const dragged = (x: number) => Math.min(WIDEST, Math.max(RAIL, x));

/** Let go where the words do not fit, it goes to whichever is nearer: the icons or the narrowest width with words. */
export function settled(width: number) {
	if (width >= NARROWEST) return width;
	return width <= (RAIL + NARROWEST) / 2 ? RAIL : NARROWEST;
}

export function stepped(width: number, by: number) {
	const next = width + by;
	if (next < NARROWEST) return by < 0 ? RAIL : NARROWEST;
	return Math.min(next, WIDEST);
}

/** The assistant beside the page: it gives way to the page below its narrowest, and stops at its widest. */
export const CHAT_NARROWEST = 300;
export const CHAT_USUAL = 340;
export const CHAT_WIDEST = 640;

export const chatWidth = (width: number) => Math.round(Math.min(CHAT_WIDEST, Math.max(CHAT_NARROWEST, width)));

export const storedChatWidth = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? chatWidth(value) : CHAT_USUAL);

export function storedWidth(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? settled(dragged(value)) : USUAL;
}

/** The code on the left of CAD and OpenSCAD, and the side panel on the right: as wide as they were pulled. */
export const CODE_NARROWEST = 280;
export const CODE_USUAL = 420;
export const CODE_WIDEST = 960;
export const SIDE_NARROWEST = 200;
export const SIDE_USUAL = 260;
export const SIDE_WIDEST = 480;
/** The scene between them keeps at least this */
export const SCENE_NARROWEST = 360;

export interface Panes {
	code: number;
	side: number;
}

const within = (value: number, low: number, high: number) => Math.round(Math.min(high, Math.max(low, value)));

/**
 * The widths on a desk `room` wide. When the window has not room for what was pulled and the scene, the code
 * gives way first and then the side panel; a page too small for all three stacks them by its own rules.
 */
export function fitted(room: number, asked: Panes, hasSide: boolean): Panes {
	const side = hasSide ? within(asked.side, SIDE_NARROWEST, SIDE_WIDEST) : 0;
	const code = within(Math.min(asked.code, room - SCENE_NARROWEST - side), CODE_NARROWEST, CODE_WIDEST);
	return { code, side: hasSide ? within(Math.min(side, room - SCENE_NARROWEST - code), SIDE_NARROWEST, SIDE_WIDEST) : 0 };
}

/** One width pulled by its edge, as far as the scene keeps its narrowest. The other panel stays as it is: only a window that narrows makes the code give way. */
export function pulled(room: number, now: Panes, asked: Partial<Panes>, hasSide: boolean): Panes {
	const code = asked.code === undefined ? now.code : Math.min(asked.code, room - SCENE_NARROWEST - now.side);
	const side = asked.side === undefined ? now.side : Math.min(asked.side, room - SCENE_NARROWEST - now.code);
	return fitted(room, { code, side }, hasSide);
}

export function storedPanes(value: unknown): Panes {
	const was = (value ?? {}) as Record<string, unknown>;
	const width = (v: unknown, usual: number, low: number, high: number) => (typeof v === 'number' && Number.isFinite(v) ? within(v, low, high) : usual);
	return { code: width(was.code, CODE_USUAL, CODE_NARROWEST, CODE_WIDEST), side: width(was.side, SIDE_USUAL, SIDE_NARROWEST, SIDE_WIDEST) };
}
