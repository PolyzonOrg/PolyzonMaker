import { own } from '$lib/own';
import * as tc from '$msg/tools/common';

/** Unit codes of the tool fields and their words in the page's language. */
const UNIT_LABELS: Record<string, () => string> = {
	mm: tc.tc_unit_mm,
	m: tc.tc_unit_m,
	g: tc.tc_unit_g,
	'g/cm3': tc.tc_unit_g_cm3,
	'mm/s': tc.tc_unit_mm_s,
	'mm/s2': tc.tc_unit_mm_s2,
	'mm3/s': tc.tc_unit_mm3_s,
	h: tc.tc_unit_h,
	min: tc.tc_unit_min,
	W: tc.tc_unit_w,
	Hz: tc.tc_unit_hz,
	A: tc.tc_unit_a,
	Ohm: tc.tc_unit_ohm,
	px: tc.tc_unit_px
};

/**
 * Units of the tool fields by code (`unit="mm"`), written the page language's way: «мм»,
 * «mm», «Вт» / «W». Anything else — «%», «°», a word from the tool's own messages — is shown
 * as given.
 */
export function unitLabel(unit: string): string {
	const label = own(UNIT_LABELS, unit);
	return label ? label() : unit;
}
