/** Studio's addresses stay as they are: ToolRoom and goto read them. */
export const resolve = (route: string, params: Record<string, string> = {}): string =>
	route.replace(/\[(\w+)\]/g, (_, name: string) => params[name] ?? '');
