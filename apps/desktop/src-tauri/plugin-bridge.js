// Served to plugins as maker.js. A plugin's page has no way to the computer: everything goes through
// the app's page, which answers only what the person allowed. See PLUGINS.md.
(() => {
	const waiting = new Map();
	const heard = new Map();
	let next = 1;

	addEventListener('message', (e) => {
		if (e.source !== parent || !e.data?.maker) return;
		if (e.data.event) {
			for (const listener of heard.get(e.data.event) ?? []) listener(e.data.value);
			return;
		}
		const pending = waiting.get(e.data.id);
		waiting.delete(e.data.id);
		if (e.data.error) pending?.reject(new Error(e.data.error));
		else pending?.resolve(e.data.value);
	});

	const call = (method, args) =>
		new Promise((resolve, reject) => {
			const id = next++;
			waiting.set(id, { resolve, reject });
			parent.postMessage({ maker: true, id, method, args }, '*');
		});

	/** `command`: one of the plugin's commands was run; `context`: the page around a panel moved on. */
	const on = (name, listener) => {
		const first = !heard.has(name);
		if (first) heard.set(name, new Set());
		heard.get(name).add(listener);
		// what came before anyone listened is handed over once, to the first listener
		if (first) void call('listen', { name }).then((past) => past.forEach((value) => listener(value)));
	};

	window.maker = Object.freeze({
		info: () => call('info'),
		open: (id) => call('open', { id }),
		context: () => call('context'),
		on,
		jobs: Object.freeze({
			list: () => call('jobs.list'),
			file: (id, name) => call('jobs.file', { id, name }),
			picture: (prompt, options = {}) => call('jobs.picture', { ...options, prompt }),
			model: (image, options = {}) => call('jobs.model', { ...options, image })
		}),
		library: Object.freeze({
			add: (title, file) => call('library.add', { title, file })
		})
	});
})();
