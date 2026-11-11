<script lang="ts">
	import { onMount } from 'svelte';
	import { openModel, PROBE, runProbe, type Step } from './probe';
	import type { Viewer } from './viewer';

	let canvas: HTMLCanvasElement;
	let steps = $state.raw<Step[]>([]);
	let note = $state('Идёт проверка, около минуты. Не сворачивайте окно.');
	let opened = $state('');
	let viewer: Viewer | null = null;

	const STATUS: Record<Step['status'], string> = { run: '…', ok: 'готово', fail: 'ошибка', skip: 'пропущено' };

	onMount(async () => {
		// fresh objects each time: the probe changes its steps in place, and raw state only sees new references
		const r = await runProbe(canvas, (s) => (steps = s.map((x) => ({ ...x })))).catch((e) => {
			note = `Проверка оборвалась: ${e instanceof Error ? e.message : e}`;
			return null;
		});
		if (!r) return;
		viewer = r.viewer;
		const result = r.failed ? `Ошибок: ${r.failed}.` : 'Ошибок нет.';
		note = r.saved
			? `${result} Отчёт сохранён. Можно покрутить модель мышью или открыть свою, потом закройте окно.`
			: `${result} Без Tauri отчёт не сохраняется.`;
	});

	async function open(file: File | undefined) {
		if (!file || !viewer) return;
		opened = `${file.name}: открываю…`;
		try {
			const r = await openModel(viewer, file);
			opened = `${r.name}: ${r.triangles} треугольников, чтение ${r.readMs} мс, починка ${r.repairMs} мс, ${
				r.closed ? 'замкнута' : 'не замкнута'
			}, ${r.size.join(' × ')} мм`;
		} catch (e) {
			opened = `${file.name}: ${e instanceof Error ? e.message : e}`;
		}
	}

	const brief = (data: Record<string, unknown>) => JSON.stringify(data).replace(/"(\w+)":/g, '$1: ');
</script>

<main
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => {
		e.preventDefault();
		open(e.dataTransfer?.files[0]);
	}}
>
	<canvas bind:this={canvas}></canvas>
	<aside>
		<h1>Проверка оболочки Ark <small>{PROBE}</small></h1>
		<p class="note">{note}</p>
		<ol>
			{#each steps as s (s.id)}
				<li class={s.status}>
					<div><b>{s.label}</b> — {STATUS[s.status]}{s.ms !== undefined ? `, ${s.ms} мс` : ''}</div>
					{#if s.error}<div class="error">{s.error}</div>{/if}
					{#if s.data}<code>{brief(s.data)}</code>{/if}
				</li>
			{/each}
		</ol>
		<label>
			Своя модель (GLB, STL, OBJ, 3MF) — выберите или перетащите в окно
			<input type="file" accept=".glb,.stl,.obj,.3mf" onchange={(e) => open(e.currentTarget.files?.[0])} />
		</label>
		{#if opened}<p>{opened}</p>{/if}
	</aside>
</main>

<style>
	:global(html, body) {
		margin: 0;
		height: 100%;
		font: 14px/1.45 system-ui, sans-serif;
		color: #1d1d1b;
		background: #f4f4f1;
	}
	:global(#app) {
		height: 100%;
	}
	main {
		display: grid;
		grid-template-columns: 1fr 420px;
		height: 100%;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
	}
	aside {
		overflow: auto;
		padding: 16px 20px;
		border-left: 1px solid #d8d6cf;
		background: #fff;
	}
	h1 {
		font-size: 17px;
		margin: 0 0 8px;
	}
	small {
		font-weight: normal;
		color: #77756d;
	}
	ol {
		padding-left: 20px;
	}
	li {
		margin-bottom: 10px;
	}
	li.ok b {
		color: #1f6b3a;
	}
	li.fail b,
	.error {
		color: #a3261b;
	}
	li.skip b {
		color: #77756d;
	}
	code {
		display: block;
		font-size: 11px;
		color: #55534c;
		word-break: break-all;
	}
	label {
		display: block;
		margin-top: 12px;
	}
	input {
		margin-top: 6px;
	}
	@media (max-width: 800px) {
		main {
			grid-template-columns: 1fr;
			grid-template-rows: 55% 45%;
		}
	}
</style>
