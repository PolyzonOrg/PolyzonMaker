/**
 * Whether an OpenSCAD source can render glyphs and therefore needs the
 * 825 KB Noto Sans file mounted before compiling. Sources calling `text()`
 * (or the metric functions) do; so do sources pulling in libraries, which may
 * call it out of sight. Everything else — the vast majority of parametric
 * parts — compiles without the download. Pure, so it is unit-tested.
 */
export function needsFont(source: string): boolean {
	return /\b(?:text|textmetrics|fontmetrics)\s*\(|\b(?:use|include)\s*</.test(source);
}
