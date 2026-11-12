import { describe, expect, it } from 'vitest';
import { markdown } from './markdown';

describe('a README as the page shows it', () => {
	it('leaves out the card data at the top, pictures and HTML, keeping the words', () => {
		const blocks = markdown('---\nlicense: apache-2.0\ntags: [gguf]\n---\n<p align="center"><img src="x.png"></p>\n\n![logo](logo.png)\n\nA <b>small</b> model.');
		expect(blocks).toEqual([{ t: 'p', inl: [{ t: 'text', v: 'A small model.' }] }]);
	});

	it('reads headings, lists, code and quotes', () => {
		const blocks = markdown('# Qwen3.8 27B\n\n## Highlights\n- **Agent Execution**: plans\n- `xhigh` and low\n\n1. one\n2. two\n\n```bash\nllama-cli -m model.gguf\n```\n\n> note');
		expect(blocks.map((b) => b.t)).toEqual(['h', 'h', 'ul', 'ol', 'code', 'quote']);
		expect(blocks[0]).toEqual({ t: 'h', level: 1, inl: [{ t: 'text', v: 'Qwen3.8 27B' }] });
		expect(blocks[2]).toEqual({
			t: 'ul',
			items: [
				[{ t: 'b', v: 'Agent Execution' }, { t: 'text', v: ': plans' }],
				[{ t: 'code', v: 'xhigh' }, { t: 'text', v: ' and low' }]
			]
		});
		expect(blocks[4]).toEqual({ t: 'code', v: 'llama-cli -m model.gguf' });
	});

	it('keeps links only to web addresses', () => {
		const [p] = markdown('See [the paper](https://arxiv.org/abs/1) or [this](javascript:alert(1)).');
		expect(p).toEqual({
			t: 'p',
			inl: [{ t: 'text', v: 'See ' }, { t: 'link', v: 'the paper', href: 'https://arxiv.org/abs/1' }, { t: 'text', v: ' or this.' }]
		});
	});

	it('turns a table into lines of its cells and drops its rule', () => {
		const blocks = markdown('| Quant | Size |\n|---|---|\n| Q4_K_M | 16 GB |');
		expect(blocks).toEqual([
			{ t: 'p', inl: [{ t: 'text', v: 'Quant · Size' }] },
			{ t: 'p', inl: [{ t: 'text', v: 'Q4_K_M · 16 GB' }] }
		]);
	});

	it('joins the lines of a paragraph and keeps a long README to its start', () => {
		expect(markdown('one\ntwo')).toEqual([{ t: 'p', inl: [{ t: 'text', v: 'one two' }] }]);
		expect(markdown(Array.from({ length: 900 }, (_, i) => `line ${i}\n`).join('\n')).length).toBe(300);
	});
});
