// Pins the Hugging Face repositories runner.py downloads: each at the commit its `main` is at now, with the
// hash of every file it takes (sha256 for a large file, git's blob hash for a small one). runner.py checks
// each file against it, wherever it came from, Hugging Face or its mirror, before an engine reads it.
//
//     node tools/bench/pins.mjs          writes the pins into runner.py, between its PINS markers
//     node tools/bench/pins.mjs --check  says whether a repository's `main` has moved since
//
// A new pin is a new version of a model: run its engine before it ships.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** What runner.py takes from each repository: the patterns it passes to snapshot_download, or all of it */
const WANTED = {
	'tencent/Hunyuan3D-2mini': ['hunyuan3d-dit-v2-mini-turbo/*', 'hunyuan3d-vae-v2-mini-turbo/*'],
	'tencent/Hunyuan3D-2': ['hunyuan3d-dit-v2-0-turbo/*', 'hunyuan3d-vae-v2-0-turbo/*'],
	'tencent/Hunyuan3D-2mv': ['hunyuan3d-dit-v2-mv-turbo/*'],
	'tencent/Hunyuan3D-2.1': ['hunyuan3d-dit-v2-1/*'],
	'VAST-AI/TripoSG': null,
	'briaai/RMBG-1.4': null,
	'stabilityai/TripoSR': null,
	'facebook/dino-vitb16': ['*.json'],
	'facebook/map-anything-apache': null,
	'yyfz233/Pi3': null,
	'facebook/VGGT-1B': null
};

const HUB = 'https://huggingface.co';

/** fnmatch, as huggingface_hub matches allow_patterns: `*` crosses `/` too */
const matches = (path, pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(path);

async function json(url) {
	const res = await fetch(url, { headers: { 'user-agent': 'polyzon-maker-pins' } });
	if (!res.ok) throw new Error(`${url}: ${res.status}`);
	return res.json();
}

async function pin(repo, patterns) {
	const { sha } = await json(`${HUB}/api/models/${repo}/revision/main`);
	const tree = await json(`${HUB}/api/models/${repo}/tree/${sha}?recursive=true`);
	const files = {};
	for (const f of tree) {
		if (f.type !== 'file' || (patterns && !patterns.some((p) => matches(f.path, p)))) continue;
		files[f.path] = f.lfs ? `sha256:${f.lfs.oid}` : `git:${f.oid}`;
	}
	if (!Object.keys(files).length) throw new Error(`${repo}: nothing matches ${patterns}`);
	return { sha, files };
}

const runner = fileURLToPath(new URL('./runner.py', import.meta.url));
const pins = {};
for (const [repo, patterns] of Object.entries(WANTED)) pins[repo] = await pin(repo, patterns);

if (process.argv.includes('--check')) {
	const kept = readFileSync(runner, 'utf8');
	const moved = Object.entries(pins).filter(([repo, { sha }]) => !kept.includes(`"${repo}": ("${sha}"`));
	for (const [repo, { sha }] of moved) console.log(`${repo}: main is at ${sha} now`);
	process.exit(moved.length ? 1 : 0);
}

const py = (s) => JSON.stringify(s);
const lines = Object.entries(pins).map(([repo, { sha, files }]) => {
	const each = Object.entries(files).map(([path, hash]) => `        ${py(path)}: ${py(hash)},`);
	return [`    ${py(repo)}: (${py(sha)}, {`, ...each, '    }),'].join('\n');
});
const block = `PINS = {  # made by pins.mjs\n${lines.join('\n')}\n}`;
const text = readFileSync(runner, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';
const at = /PINS = \{  # made by pins\.mjs[\s\S]*?\r?\n\}/;
if (!at.test(text)) throw new Error('runner.py has no PINS block to replace');
writeFileSync(runner, text.replace(at, block.replace(/\n/g, nl)));
console.log(`pinned ${Object.keys(pins).length} repositories, ${Object.values(pins).reduce((n, p) => n + Object.keys(p.files).length, 0)} files`);
