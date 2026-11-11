import { describe, expect, it } from 'vitest';
import { addPart, applyEdits, dropPart, modelsIn, placeOf, setPaint, setParam, setPlace, usesIn } from './source';

describe('a window move', () => {
	it('adds a line at the top, then changes that line', () => {
		const once = setPlace('return box(1, 1, 1)\n', 'wheel 1', [10, 0, 5]);
		expect(once).toBe("place('wheel 1', 10, 0, 5)\nreturn box(1, 1, 1)\n");
		expect(setPlace(once, 'wheel 1', [20, 0, 0, 0, 0, 90])).toBe("place('wheel 1', 20, 0, 0, 0, 0, 90)\nreturn box(1, 1, 1)\n");
	});

	it('takes the line away when the part is back where it was', () => {
		expect(setPlace("place('a', 1)\nreturn x", 'a', [0, 0, 0, 0, 0, 0])).toBe('return x');
	});

	it('reads back what it wrote', () => {
		expect(placeOf("place('a', 1.5, 0, 3, 0, 0, 90)\n", 'a')).toEqual([1.5, 0, 3, 0, 0, 90]);
		expect(placeOf('return x', 'a')).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it('keeps names with quotes and dots apart', () => {
		const code = setPlace(setPlace('', "it's", [1]), 'a.b', [2]);
		expect(placeOf(code, "it's")[0]).toBe(1);
		expect(placeOf(code, 'axb')[0]).toBe(0);
	});
});

describe('paint and drop', () => {
	it('are lines of their own', () => {
		expect(setPaint(setPaint('return x', 'a', 'red'), 'a', 'blue')).toBe("paint('a', 'blue')\nreturn x");
		expect(dropPart('return x', 'a')).toBe("drop('a')\nreturn x");
	});
});

describe('a slider', () => {
	it('changes the default in the text and nothing else', () => {
		expect(setParam("const w = param('width', 100, 40, 300)\nconst h = param('height', 100)", 'width', 120.5)).toBe("const w = param('width', 120.5, 40, 300)\nconst h = param('height', 100)");
	});
});

describe('a new part', () => {
	it('goes before the return under a free name', () => {
		expect(addPart('return { a }\n', 'box', ['box 1'], 'box(40, 40, 40)')).toBe("part('box 2', box(40, 40, 40))\nreturn { a }\n");
	});

	it('goes at the end when there is no return', () => {
		expect(addPart('const a = 1', 'cyl', [], 'cyl(20, 40)')).toBe("const a = 1\npart('cyl 1', cyl(20, 40))\n");
	});
});

describe('models', () => {
	it('are found by name, once each', () => {
		expect(modelsIn("const a = model('Кружка')\nconst b = model(\"Стол\")\nmodel('Кружка')")).toEqual(['Кружка', 'Стол']);
	});
});

describe('programs', () => {
	it('are found by name', () => {
		expect(usesIn("use('Диван').at(1)\nuse(\"Стол\", { width: 2 })")).toEqual(['Диван', 'Стол']);
	});
});

describe('edits', () => {
	it('change the text in place', () => {
		expect(applyEdits('box(1, 2, 3)\ncyl(4, 5)', [{ find: 'cyl(4', put: 'cyl(6' }, { find: 'box(1', put: 'box(9' }])).toBe('box(9, 2, 3)\ncyl(6, 5)');
	});

	it('refuse what is not there, and what is there twice', () => {
		expect(() => applyEdits('a', [{ find: 'b', put: 'c' }])).toThrow(/Not in the program/);
		expect(() => applyEdits('a a', [{ find: 'a', put: 'c' }])).toThrow(/More than once/);
	});
});
