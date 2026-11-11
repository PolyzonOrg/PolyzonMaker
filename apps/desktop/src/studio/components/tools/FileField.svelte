<script lang="ts">
	import { field } from '$lib/agent';
	/**
	 * Drop zone for the tool's input file (DESIGN_CODE §7.8 «Зона загрузки
	 * файла»): click or drop, one file, the accepted kinds named in words. The
	 * tile shows the file taken: an image as it is, a model as a snapshot.
	 */
	import { onDestroy } from 'svelte';
	import { Upload } from 'lucide-svelte';
	import * as tc from '$msg/tools/common';

	let {
		label,
		accept,
		hint,
		fileName = null,
		maxBytes = 100 * 1024 * 1024,
		onfile
	}: {
		label: string;
		/** e.g. ".stl,.obj" or "image/*" */
		accept: string;
		hint: string;
		fileName?: string | null;
		maxBytes?: number;
		onfile: (file: File) => void;
	} = $props();

	let input = $state<HTMLInputElement>();
	let over = $state(false);
	let error = $state<string | null>(null);
	/** The picture of the last file taken; shown while the tool holds that file. */
	let preview = $state<{ name: string; url: string } | null>(null);
	let taken = 0;

	function take(file: File | undefined) {
		if (!file) return;
		if (file.size > maxBytes) {
			error = tc.tc_file_too_big({ mb: Math.round(maxBytes / 1024 / 1024) });
			return;
		}
		error = null;
		onfile(file);
		void picture(file);
	}

	async function picture(file: File) {
		const n = ++taken;
		let url: string | null = null;
		if (file.type.startsWith('image/')) url = URL.createObjectURL(file);
		else if (/\.(stl|obj|3mf|glb)$/i.test(file.name)) {
			try {
				const [{ readModelFile }, { renderThumbnail }] = await Promise.all([
					import('$lib/tools/shared/model-file'),
					import('$lib/openscad/views')
				]);
				url = URL.createObjectURL(await renderThumbnail(await readModelFile(file)));
			} catch {
				// Unreadable here too: the tool says why, the tile keeps its icon.
			}
		}
		if (n !== taken) {
			if (url) URL.revokeObjectURL(url);
			return;
		}
		if (preview) URL.revokeObjectURL(preview.url);
		preview = url ? { name: file.name, url } : null;
	}

	onDestroy(() => {
		taken++;
		if (preview) URL.revokeObjectURL(preview.url);
	});

	field({ kind: 'file', get label() { return label; }, get hint() { return hint; }, get accept() { return accept; }, open: (file) => onfile(file) });
</script>

<div>
	<button
		type="button"
		class="card flex w-full items-center gap-4 text-left {over ? 'bg-panel3' : ''}"
		onclick={() => input?.click()}
		ondragover={(e) => {
			e.preventDefault();
			over = true;
		}}
		ondragleave={() => (over = false)}
		ondrop={(e) => {
			e.preventDefault();
			over = false;
			take(e.dataTransfer?.files?.[0]);
		}}
	>
		<span class="icon-tile overflow-hidden">
			{#if preview && preview.name === fileName}
				<img src={preview.url} alt="" class="size-full object-cover" />
			{:else}
				<Upload size={24} aria-hidden="true" />
			{/if}
		</span>
		<span class="min-w-0">
			<span class="block truncate text-sm font-medium">{fileName ?? label}</span>
			<span class="mt-1 block text-xs text-neutral-400"
				>{fileName ? tc.tc_replace_file() : hint}</span
			>
		</span>
	</button>
	<input
		bind:this={input}
		type="file"
		{accept}
		class="sr-only"
		tabindex="-1"
		aria-hidden="true"
		onchange={(e) => {
			take(e.currentTarget.files?.[0]);
			e.currentTarget.value = '';
		}}
	/>
	{#if error}<p class="field-error" role="alert">{error}</p>{/if}
</div>
