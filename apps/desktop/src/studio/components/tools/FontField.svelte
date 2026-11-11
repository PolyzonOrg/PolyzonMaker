<script lang="ts">
	/**
	 * The font of a text tool (DESIGN_CODE §9 «Инструменты»): Noto Sans, the six
	 * bundled fonts and the ones opened this visit as choices; «Свой шрифт»
	 * opens a TTF or OTF and selects it. The file goes to OpenSCAD with the
	 * compile (tools/shared/fonts.ts).
	 */
	import { Upload } from 'lucide-svelte';
	import { showToast } from '$lib/toast';
	import { addFont, fontFamilies } from '$lib/tools/shared/fonts';
	import ChoiceField from './ChoiceField.svelte';
	import * as tc from '$msg/tools/common';

	let { value = $bindable(), label = tc.tc_font() }: { value: string; label?: string } = $props();

	let families = $state(fontFamilies());
	let input = $state<HTMLInputElement>();
	let busy = $state(false);

	async function open(file: File | undefined) {
		if (!file) return;
		busy = true;
		try {
			value = await addFont(file);
			families = fontFamilies();
		} catch (e) {
			showToast(e instanceof Error ? e.message : tc.tc_font_failed(), { kind: 'error' });
		} finally {
			busy = false;
		}
	}
</script>

<div>
	<ChoiceField
		{label}
		bind:value
		options={families.map((family) => ({ value: family, label: family }))}
	/>
	<button type="button" class="btn-ghost btn-s mt-3" disabled={busy} onclick={() => input?.click()}>
		<Upload size={14} aria-hidden="true" />
		{tc.tc_font_own()}
	</button>
	<input
		bind:this={input}
		type="file"
		accept=".ttf,.otf,font/ttf,font/otf"
		class="sr-only"
		tabindex="-1"
		aria-hidden="true"
		onchange={(e) => {
			void open(e.currentTarget.files?.[0]);
			e.currentTarget.value = '';
		}}
	/>
	<p class="hint">{tc.tc_font_own_hint()}</p>
</div>
