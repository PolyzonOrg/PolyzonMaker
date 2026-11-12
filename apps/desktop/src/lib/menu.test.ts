import { describe, expect, it } from 'vitest';
import {
	AREAS,
	areaWidth,
	MAIN_NARROWEST,
	storedAreas,
	CHAT_NARROWEST,
	CHAT_USUAL,
	CHAT_WIDEST,
	chatWidth,
	CODE_NARROWEST,
	CODE_USUAL,
	CODE_WIDEST,
	dragged,
	fitted,
	NARROWEST,
	RAIL,
	SCENE_NARROWEST,
	settled,
	SIDE_NARROWEST,
	SIDE_USUAL,
	SIDE_WIDEST,
	stepped,
	storedChatWidth,
	pulled,
	storedPanes,
	storedWidth,
	USUAL,
	WIDEST
} from './menu';

describe('dragging the menu', () => {
	it('follows the hand down to the icons and up to the widest', () => {
		expect(dragged(300)).toBe(300);
		expect(dragged(100)).toBe(100);
		expect(dragged(-50)).toBe(RAIL);
		expect(dragged(2000)).toBe(WIDEST);
	});

	it('stays where it is let go, while the words still fit', () => {
		expect(settled(NARROWEST)).toBe(NARROWEST);
		expect(settled(287)).toBe(287);
	});

	it('falls to the icons or back to the narrowest, whichever is nearer', () => {
		expect(settled(70)).toBe(RAIL);
		expect(settled(120)).toBe(RAIL);
		expect(settled(122)).toBe(NARROWEST);
		// halfway goes to the icons
		expect(settled((RAIL + NARROWEST) / 2)).toBe(RAIL);
		expect(settled(170)).toBe(NARROWEST);
		expect(settled(RAIL)).toBe(RAIL);
	});
});

describe('the keyboard', () => {
	it('moves the edge in steps and stops at the widest', () => {
		expect(stepped(240, 16)).toBe(256);
		expect(stepped(240, -16)).toBe(224);
		expect(stepped(WIDEST - 4, 16)).toBe(WIDEST);
	});

	it('reaches the icons and comes back', () => {
		expect(stepped(NARROWEST, -16)).toBe(RAIL);
		expect(stepped(RAIL, 16)).toBe(NARROWEST);
		expect(stepped(RAIL, -16)).toBe(RAIL);
		expect(stepped(NARROWEST + 16, -16)).toBe(NARROWEST);
	});
});

describe('the width kept from the last time', () => {
	it('comes back as it was', () => {
		expect(storedWidth(300)).toBe(300);
		expect(storedWidth(RAIL)).toBe(RAIL);
	});

	it('is the usual one when nothing sensible was kept', () => {
		for (const nothing of [null, 'wide', Number.NaN, {}]) expect(storedWidth(nothing)).toBe(USUAL);
	});

	it('is brought inside the limits', () => {
		expect(storedWidth(9000)).toBe(WIDEST);
		expect(storedWidth(1)).toBe(RAIL);
	});
});

describe('the assistant beside the page', () => {
	it('is as wide as it is pulled, within its limits', () => {
		expect(chatWidth(420)).toBe(420);
		expect(chatWidth(100)).toBe(CHAT_NARROWEST);
		expect(chatWidth(5000)).toBe(CHAT_WIDEST);
	});

	it('comes back as it was, or at its usual width', () => {
		expect(storedChatWidth(480)).toBe(480);
		expect(storedChatWidth('wide')).toBe(CHAT_USUAL);
		expect(storedChatWidth(9000)).toBe(CHAT_WIDEST);
		expect(storedChatWidth(Infinity)).toBe(CHAT_USUAL);
	});
});

describe('the code and the side panel of CAD and OpenSCAD', () => {
	const wide = 2400;

	it('are as wide as they were pulled, within their limits', () => {
		expect(fitted(wide, { code: 500, side: 300 }, true)).toEqual({ code: 500, side: 300 });
		expect(fitted(wide, { code: 10, side: 10 }, true)).toEqual({ code: CODE_NARROWEST, side: SIDE_NARROWEST });
		expect(fitted(wide, { code: 5000, side: 5000 }, true)).toEqual({ code: CODE_WIDEST, side: SIDE_WIDEST });
	});

	it('leave the scene its narrowest: the code gives way first, then the side panel', () => {
		const roomy = { code: 700, side: 400 };
		expect(fitted(1200, roomy, true)).toEqual({ code: 1200 - SCENE_NARROWEST - 400, side: 400 });
		expect(fitted(CODE_NARROWEST + SCENE_NARROWEST + 300, roomy, true)).toEqual({ code: CODE_NARROWEST, side: 300 });
		// a window too small for all three keeps the narrowest of each: the page goes on in its stacked layout
		expect(fitted(600, roomy, true)).toEqual({ code: CODE_NARROWEST, side: SIDE_NARROWEST });
	});

	it('give the code the side panel’s room while there is no side panel', () => {
		expect(fitted(1200, { code: 1000, side: 400 }, false)).toEqual({ code: 1200 - SCENE_NARROWEST, side: 0 });
	});

	it('are pulled one at a time: an edge stops where the scene would get narrower than it may, and the other panel stays', () => {
		const now = { code: 500, side: 300 };
		expect(pulled(1200, now, { side: 600 }, true)).toEqual({ code: 500, side: 1200 - SCENE_NARROWEST - 500 });
		expect(pulled(1200, now, { code: 900 }, true)).toEqual({ code: 1200 - SCENE_NARROWEST - 300, side: 300 });
		expect(pulled(1200, now, { code: 400 }, true)).toEqual({ code: 400, side: 300 });
		expect(pulled(1200, now, { side: 100 }, true)).toEqual({ code: 500, side: SIDE_NARROWEST });
	});

	it('come back as they were, or at their usual widths', () => {
		expect(storedPanes({ code: 520, side: 310 })).toEqual({ code: 520, side: 310 });
		expect(storedPanes({ code: 'wide', side: Infinity })).toEqual({ code: CODE_USUAL, side: SIDE_USUAL });
		expect(storedPanes(null)).toEqual({ code: CODE_USUAL, side: SIDE_USUAL });
		expect(storedPanes({ code: 9000, side: 1 })).toEqual({ code: CODE_WIDEST, side: SIDE_NARROWEST });
	});
});

describe("a page's side area: Models' list, the result's panel, a tool's settings", () => {
	it('is as wide as it was pulled, within its narrowest and widest', () => {
		expect(areaWidth('models', 1600, 450)).toBe(450);
		expect(areaWidth('models', 1600, 50)).toBe(AREAS.models.narrowest);
		expect(areaWidth('result', 1600, 5000)).toBe(AREAS.result.widest);
	});

	it('leaves the page its main part: a narrow window takes the width back first', () => {
		expect(areaWidth('result', 900, 600)).toBe(900 - MAIN_NARROWEST);
		expect(areaWidth('tool', 500, 600)).toBe(AREAS.tool.narrowest);
	});

	it('is not cut before the page knows how wide it is', () => {
		expect(areaWidth('models', 0, 450)).toBe(450);
	});

	it('starts as the page was before it could be pulled', () => {
		expect(storedAreas(null)).toEqual({ models: 380, result: 320, tool: 360 });
		expect(storedAreas({ models: 'wide', result: 9000, tool: 10 })).toEqual({ models: 380, result: AREAS.result.widest, tool: AREAS.tool.narrowest });
	});
});
