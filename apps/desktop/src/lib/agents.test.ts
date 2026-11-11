import { describe, expect, it } from 'vitest';
import { agents, SERVER } from './agents';

const exe = 'C:\Users\Вася\AppData\Local\Polyzon Maker\polyzon-maker.exe';
const decode = (b64: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));

describe('ready ways to connect an AI agent', () => {
	const list = agents(exe, 'windows');
	const by = (id: string) => list.find((a) => a.id === id)!;

	it('gives each agent the program and its --mcp switch, the path quoted where a shell reads it', () => {
		expect(by('claude-code').text).toBe(`claude mcp add --scope user ${SERVER} -- "${exe}" --mcp`);
		expect(by('codex').text).toBe(`codex mcp add ${SERVER} -- "${exe}" --mcp`);
		expect(by('kimi').text).toBe(`kimi mcp add --transport stdio ${SERVER} -- "${exe}" --mcp`);
	});

	it('writes settings files as valid JSON with the path as it is', () => {
		for (const a of list.filter((a) => a.how !== 'run')) {
			const parsed = JSON.parse(a.text);
			expect(JSON.stringify(parsed)).toContain(JSON.stringify(exe).slice(1, -1));
		}
		expect(JSON.parse(by('claude-desktop').text).mcpServers[SERVER]).toEqual({ command: exe, args: ['--mcp'] });
		expect(JSON.parse(by('vscode').text).servers[SERVER]).toEqual({ type: 'stdio', command: exe, args: ['--mcp'] });
		expect(JSON.parse(by('opencode').text).mcp[SERVER]).toEqual({ type: 'local', command: [exe, '--mcp'], enabled: true });
	});

	it('links open the agent with the same server, even for a name in another alphabet', () => {
		for (const id of ['cursor', 'lmstudio']) {
			const link = new URL(by(id).link!);
			expect(link.searchParams.get('name')).toBe(SERVER);
			expect(decode(link.searchParams.get('config')!)).toEqual({ command: exe, args: ['--mcp'] });
		}
		expect(by('cursor').link).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/);
		expect(by('lmstudio').link).toMatch(/^lmstudio:\/\/add-mcp\?/);
	});

	it('names the settings file where it is on each system', () => {
		expect(by('claude-desktop').file).toBe('%APPDATA%\\Claude\\claude_desktop_config.json');
		expect(agents(exe, 'mac').find((a) => a.id === 'claude-desktop')!.file).toBe('~/Library/Application Support/Claude/claude_desktop_config.json');
		expect(by('gemini').file).toBe('%USERPROFILE%\\.gemini\\settings.json');
		expect(agents('/opt/maker', 'linux').find((a) => a.id === 'windsurf')!.file).toBe('~/.codeium/windsurf/mcp_config.json');
	});
});
