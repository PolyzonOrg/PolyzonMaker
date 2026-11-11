/**
 * Compiler log → editor diagnostics. Pure: no CodeMirror, no DOM, so the page
 * and the unit tests share it.
 *
 * `runner.worker.ts` throws the stderr lines that mention error/warning, joined
 * with `\n` and cut at 600 chars. OpenSCAD writes them as
 *   ERROR: Parser error in file "/in.scad", line 12: syntax error      (2021)
 *   ERROR: Parser error: syntax error in file /in.scad, line 12         (2022)
 *   WARNING: Ignoring unknown variable 'x' in file /in.scad, line 5
 *   ERROR: Assertion 'false' failed in file /in.scad, line 3
 * Anything without the ERROR:/WARNING: prefix («exit 1», «Компиляция
 * отменена.», worker failures) is not a diagnostic — the page still shows the
 * raw text in its chip.
 */
import * as m from '$msg/scad';

export interface ScadDiagnostic {
	severity: 'error' | 'warning';
	/** 1-based source line, when the message names one. */
	line: number | null;
	/** The message without the severity prefix and the «in file …, line N» noise. */
	message: string;
}

const HEAD_RE = /^(ERROR|WARNING):\s*(.*)$/i;
const LOCATION_RE = /\s*\bin file\s+"?[^",\n]*?"?,\s*line\s+(\d+)/i;
const BARE_LINE_RE = /\bline\s+(\d+)/i;

export function parseScadLog(log: string | null | undefined): ScadDiagnostic[] {
	if (!log) return [];
	const out: ScadDiagnostic[] = [];
	for (const raw of log.split('\n')) {
		const head = HEAD_RE.exec(raw.trim());
		if (!head) continue;
		const severity = head[1].toUpperCase() === 'ERROR' ? 'error' : 'warning';
		let message = head[2];
		let line: number | null = null;
		const location = LOCATION_RE.exec(message);
		if (location) {
			line = Number(location[1]);
			message =
				message.slice(0, location.index) + message.slice(location.index + location[0].length);
		} else {
			const bare = BARE_LINE_RE.exec(message);
			if (bare) line = Number(bare[1]);
		}
		message = message.replace(/^[\s:]+|[\s:]+$/g, '');
		if (!message)
			message = severity === 'error' ? m.scad_compile_error() : m.scad_compile_warning();
		out.push({ severity, line, message });
	}
	return out;
}

/** First ERROR line with a line number, else the first WARNING with one, else null. */
export function primaryErrorLine(log: string | null | undefined): number | null {
	const items = parseScadLog(log);
	const pick =
		items.find((d) => d.severity === 'error' && d.line !== null) ??
		items.find((d) => d.line !== null);
	return pick?.line ?? null;
}

/** 1-based line clamped into [1, lines]; a document always has at least one line. */
export function clampLine(lines: number, line: number): number {
	const wanted = Math.trunc(line) || 1;
	return Math.min(Math.max(1, wanted), Math.max(1, lines));
}
