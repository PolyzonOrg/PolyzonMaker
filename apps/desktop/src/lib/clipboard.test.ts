import { describe, expect, it } from 'vitest';
import { mendClipboard } from './clipboard';

describe('the clipboard', () => {
	it('copies through the program when the web view refuses the page', async () => {
		const program: string[] = [];
		const board = { writeText: (_: string) => Promise.reject(new Error('NotAllowedError')) };
		mendClipboard(board, async (text) => void program.push(text));
		await board.writeText('pz-key');
		expect(program).toEqual(['pz-key']);
	});

	it('leaves a clipboard that works to itself', async () => {
		const page: string[] = [];
		const program: string[] = [];
		const board = { writeText: async (text: string) => void page.push(text) };
		mendClipboard(board, async (text) => void program.push(text));
		await board.writeText('pz-key');
		expect([page, program]).toEqual([['pz-key'], []]);
	});
});
