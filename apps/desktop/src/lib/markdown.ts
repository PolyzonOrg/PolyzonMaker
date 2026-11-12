// A README from Hugging Face, made safe to show. The page builds every element itself from these
// blocks, so nothing in a README runs or loads: pictures, HTML and the model card's data are left out,
// and only links to web addresses stay links.

export type Inline = { t: 'text' | 'b' | 'code'; v: string } | { t: 'link'; v: string; href: string };
export type Block =
	| { t: 'h'; level: number; inl: Inline[] }
	| { t: 'p' | 'quote'; inl: Inline[] }
	| { t: 'ul' | 'ol'; items: Inline[][] }
	| { t: 'code'; v: string }
	| { t: 'hr' };

/** Far more than anyone reads on a model's page; a long README is kept to its start. */
const MAX_BLOCKS = 300;

const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/** Single * and _ around words only lean the text: the markers go, the words stay. */
const plain = (s: string) => s.replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2');

function inline(text: string): Inline[] {
	const out: Inline[] = [];
	const add = (t: Inline) => {
		const last = out[out.length - 1];
		if (t.t === 'text' && last?.t === 'text') last.v += t.v;
		else if (t.t !== 'text' || t.v) out.push(t);
	};
	let at = 0;
	for (const m of text.matchAll(TOKEN)) {
		add({ t: 'text', v: plain(text.slice(at, m.index)) });
		if (m[1]) add({ t: 'code', v: m[1].slice(1, -1) });
		else if (m[2]) add({ t: 'b', v: m[2].slice(2, -2) });
		else if (/^https?:\/\//i.test(m[4])) add({ t: 'link', v: plain(m[3]), href: m[4] });
		else add({ t: 'text', v: plain(m[3]) });
		at = m.index + m[0].length;
	}
	add({ t: 'text', v: plain(text.slice(at)) });
	return out;
}

/** Pictures, empty links left by badges and HTML tags go; their words stay. */
const clean = (line: string) =>
	line
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[\]\([^)]*\)/g, '')
		.replace(/<[^>\n]+>/g, '');

function withoutCard(text: string): string {
	let src = text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
	if (src.startsWith('---\n')) {
		const end = src.indexOf('\n---', 3);
		if (end >= 0) src = src.slice(src.indexOf('\n', end + 1) + 1 || src.length);
	}
	return src;
}

export function markdown(text: string): Block[] {
	const lines = withoutCard(text).split('\n');
	const blocks: Block[] = [];
	let para: string[] = [];
	let quote: string[] = [];
	let list: { t: 'ul' | 'ol'; items: Inline[][] } | null = null;
	const flush = () => {
		if (para.length) blocks.push({ t: 'p', inl: inline(para.join(' ')) });
		if (quote.length) blocks.push({ t: 'quote', inl: inline(quote.join(' ')) });
		if (list) blocks.push(list);
		[para, quote, list] = [[], [], null];
	};
	for (let i = 0; i < lines.length && blocks.length < MAX_BLOCKS; i++) {
		const fence = lines[i].match(/^\s*(```|~~~)/);
		if (fence) {
			flush();
			const code: string[] = [];
			while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i]);
			blocks.push({ t: 'code', v: code.join('\n') });
			continue;
		}
		const line = clean(lines[i]).trimEnd();
		const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
		const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
		const quoted = line.match(/^\s*>\s?(.*)$/);
		if (!line.trim()) flush();
		else if (heading) {
			flush();
			blocks.push({ t: 'h', level: heading[1].length, inl: inline(heading[2]) });
		} else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
			flush();
			blocks.push({ t: 'hr' });
		} else if (/^\s*\|/.test(line)) {
			flush();
			if (/^[\s|:-]+$/.test(line)) continue; // the rule under a table's head
			const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
			if (cells.length) blocks.push({ t: 'p', inl: inline(cells.join(' · ')) });
		} else if (item) {
			const kind = /\d/.test(item[1]) ? 'ol' : 'ul';
			if (para.length || quote.length || (list && list.t !== kind)) flush();
			list ??= { t: kind, items: [] };
			list.items.push(inline(item[2]));
		} else if (quoted) {
			if (para.length || list) flush();
			quote.push(quoted[1]);
		} else {
			if (quote.length || list) flush();
			para.push(line.trim());
		}
	}
	flush();
	return blocks.slice(0, MAX_BLOCKS);
}
