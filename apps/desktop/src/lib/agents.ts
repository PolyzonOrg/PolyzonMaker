// The ready ways to connect each popular AI agent to Polyzon Maker's MCP server: a command to run once, a link
// that opens the agent with the server filled in, or the lines for its settings file. Each one was taken from
// the agent's own documentation (2026-11); where the docs leave a command unclear, the settings file is given.

export type Os = 'windows' | 'mac' | 'linux';

export interface Agent {
	id: string;
	name: string;
	/** run: a command in a terminal; link: a button that opens the agent; file: lines for a settings file */
	how: 'run' | 'link' | 'file';
	/** What the person copies: the command, or the settings */
	text: string;
	/** For a link: the agent's own install address */
	link?: string;
	/** Where the settings go */
	file?: string;
}

/** The server's name in every agent. */
export const SERVER = 'polyzon-maker';

/** UTF-8 base64: a user folder may be named in any alphabet. */
const base64 = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));

export function agents(exe: string, os: Os): Agent[] {
	const shell = `"${exe}"`;
	const stdio = { command: exe, args: ['--mcp'] };
	const json = (value: unknown) => JSON.stringify(value, null, 2);
	const servers = json({ mcpServers: { [SERVER]: stdio } });
	const home = (windows: string, unix: string) => (os === 'windows' ? `%USERPROFILE%\\${windows}` : `~/${unix}`);
	return [
		{ id: 'claude-code', name: 'Claude Code', how: 'run', text: `claude mcp add --scope user ${SERVER} -- ${shell} --mcp` },
		{ id: 'codex', name: 'Codex', how: 'run', text: `codex mcp add ${SERVER} -- ${shell} --mcp` },
		{
			id: 'cursor',
			name: 'Cursor',
			how: 'link',
			link: `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER}&config=${encodeURIComponent(base64(stdio))}`,
			text: servers,
			file: home('.cursor\\mcp.json', '.cursor/mcp.json')
		},
		{
			id: 'claude-desktop',
			name: 'Claude Desktop',
			how: 'file',
			text: servers,
			file:
				os === 'windows'
					? '%APPDATA%\\Claude\\claude_desktop_config.json'
					: os === 'mac'
						? '~/Library/Application Support/Claude/claude_desktop_config.json'
						: '~/.config/Claude/claude_desktop_config.json'
		},
		// VS Code: the command palette's «MCP: Open User Configuration» opens this file
		{ id: 'vscode', name: 'VS Code', how: 'file', text: json({ servers: { [SERVER]: { type: 'stdio', ...stdio } } }), file: 'mcp.json («MCP: Open User Configuration»)' },
		{ id: 'gemini', name: 'Gemini CLI', how: 'file', text: servers, file: home('.gemini\\settings.json', '.gemini/settings.json') },
		{ id: 'qwen', name: 'Qwen Code', how: 'file', text: servers, file: home('.qwen\\settings.json', '.qwen/settings.json') },
		{ id: 'kimi', name: 'Kimi CLI', how: 'run', text: `kimi mcp add --transport stdio ${SERVER} -- ${shell} --mcp` },
		{ id: 'windsurf', name: 'Windsurf', how: 'file', text: servers, file: home('.codeium\\windsurf\\mcp_config.json', '.codeium/windsurf/mcp_config.json') },
		{
			id: 'lmstudio',
			name: 'LM Studio',
			how: 'link',
			link: `lmstudio://add-mcp?name=${SERVER}&config=${encodeURIComponent(base64(stdio))}`,
			text: servers,
			file: home('.lmstudio\\mcp.json', '.lmstudio/mcp.json')
		},
		{ id: 'opencode', name: 'OpenCode', how: 'file', text: json({ mcp: { [SERVER]: { type: 'local', command: [exe, '--mcp'], enabled: true } } }), file: 'opencode.json' },
		// DeepSeek, GLM and the like have no agent of their own: they work inside these, which read the common format
		{ id: 'other', name: 'Cline, Roo Code, Cherry Studio', how: 'file', text: servers }
	];
}

/** The system the program runs on, from the browser's own description. */
export function osOf(platform: string): Os {
	return /win/i.test(platform) ? 'windows' : /mac/i.test(platform) ? 'mac' : 'linux';
}
