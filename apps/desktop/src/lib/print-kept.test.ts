import { describe, expect, it } from 'vitest';
import { kept, keep } from './print-kept';
import type { Prepared } from './geometry';

const analysis = { status: 'basic-passed', faces: 12, size: [10, 20, 30], checks: [] } as unknown as Prepared['report'];
const prepared: Prepared = {
	stl: new Uint8Array([1, 2, 3]),
	threemf: new Uint8Array([4]),
	report: analysis,
	ready: true,
	flat: false,
	solid: null,
	filled: 1,
	moved: 0.04,
	crumbs: 2,
	faces: { before: 400, after: 12 },
	problems: [],
	preview: new Float32Array(9)
};
const saved = (r = prepared, height = 80, mend = false) => new TextDecoder().decode(keep(r, { version: '0.3.3', source: 5000, height, mend }));

describe('a model prepared for print once', () => {
	it('comes back as it was: the size, the mend, what the check found', () => {
		const back = kept(saved(prepared, 120, true), { version: '0.3.3', source: 5000 });
		expect(back).toEqual({ height: 120, mend: true, summary: { report: analysis, ready: true, flat: false, solid: null, filled: 1, moved: 0.04, crumbs: 2, faces: { before: 400, after: 12 }, problems: [] } });
	});

	it('keeps no file and no picture of itself: those are on the disk already', () => {
		const text = saved();
		expect(text).not.toContain('stl');
		expect(text).not.toContain('preview');
	});

	it('is made again after an update, since preparation may have changed', () => {
		expect(kept(saved(), { version: '0.3.4', source: 5000 })).toBeNull();
	});

	it('is made again when the model it was made from is another', () => {
		expect(kept(saved(), { version: '0.3.3', source: 5001 })).toBeNull();
	});

	it('is made again when what was kept is missing, half written or from elsewhere', () => {
		for (const text of ['', '{}', '{"v":1', 'null', '[]', '{"v":2,"version":"0.3.3","source":5000,"height":80,"mend":false,"summary":{}}']) {
			expect(kept(text, { version: '0.3.3', source: 5000 }), text).toBeNull();
		}
		const noSize = JSON.parse(saved());
		noSize.height = 0;
		expect(kept(JSON.stringify(noSize), { version: '0.3.3', source: 5000 })).toBeNull();
		const noReport = JSON.parse(saved());
		delete noReport.summary.report;
		expect(kept(JSON.stringify(noReport), { version: '0.3.3', source: 5000 })).toBeNull();
	});
});
