// The one piece of Node a test reads source files with: the app itself runs in a web view, without Node's types.
declare module 'node:fs' {
	export function readFileSync(path: URL, encoding: 'utf8'): string;
}
