/**
 * The web view on macOS refuses a page's clipboard writes (NotAllowedError), and WebKitGTK can too. Then the
 * program copies with the system's own tool (copy_text in main.rs). Mended once at start, so every copy button
 * gets it, the Studio tools' as well.
 */
export function mendClipboard(clipboard: Pick<Clipboard, 'writeText'> | undefined, program: (text: string) => Promise<unknown>) {
	if (!clipboard) return;
	const page = clipboard.writeText.bind(clipboard);
	clipboard.writeText = (text) => page(text).catch(() => program(text).then(() => undefined));
}
