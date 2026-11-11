<script lang="ts">
	/**
	 * A plugin's page or one of its panels: a sandboxed frame with no origin of its own, which can only send
	 * this page messages. Each is answered here, by the rules in lib/plugins.ts, with what the person granted.
	 */
	import { untrack } from 'svelte';
	import { core, pluginUrl } from '../lib/core';
	import { lang } from '../lib/i18n.svelte';
	import { answer, modelFile, type Doors } from '../lib/plugins';
	import { app, go, startModel, startPictures } from '../lib/state.svelte';

	let { id, file = '', title, context }: { id: string; file?: string; title: string; context: Record<string, unknown> } = $props();
	let frame = $state<HTMLIFrameElement>();
	let url = $state('');
	/** What the frame has not been told yet, kept until it listens; then it is told at once */
	const waiting = new Map<string, unknown[]>();
	const listening = new Set<string>();

	$effect(() => {
		const path = file;
		void pluginUrl(id).then((address) => (url = address + path));
	});

	/** Tells the frame something happened. Of the page around a panel only the latest counts. */
	export function send(name: string, value: unknown) {
		if (listening.has(name)) frame?.contentWindow?.postMessage({ maker: true, event: name, value }, '*');
		else waiting.set(name, name === 'context' ? [value] : [...(waiting.get(name) ?? []), value]);
	}

	$effect(() => {
		const now = $state.snapshot(context);
		untrack(() => send('context', now));
	});

	const doors: Doors = {
		info: () => ({ version: app.version, language: lang.value, theme: document.documentElement.dataset.theme }),
		jobs: () => $state.snapshot(app.jobs),
		read: core.readFile,
		pictures: startPictures,
		model: (image, title, preset) => startModel('plugin.png', image, title, preset),
		add: async (title, file) => core.importModel(title, await modelFile(file)),
		open: (job) => go('result', job),
		context: () => $state.snapshot(context),
		listen: (name) => {
			listening.add(name);
			const past = waiting.get(name) ?? [];
			waiting.delete(name);
			return past;
		}
	};

	/** Only this frame is listened to, by its window. */
	async function heard(e: MessageEvent) {
		if (e.source !== frame?.contentWindow || !e.data?.maker) return;
		const { id: call, method, args } = e.data;
		const reply = (message: object) => frame?.contentWindow?.postMessage({ maker: true, id: call, ...message }, '*');
		try {
			reply({ value: await answer(String(method), args, app.settings.plugins[id]?.permissions ?? [], doors) });
		} catch (error) {
			reply({ error: error instanceof Error ? error.message : String(error) });
		}
	}
</script>

<svelte:window onmessage={heard} />

{#if url}
	<iframe bind:this={frame} src={url} {title} sandbox="allow-scripts"></iframe>
{/if}

<style>
	iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}
</style>
