<script lang="ts">
	/**
	 * «Себестоимость печати»: a page, not a scene. One column of inputs in the
	 * order a print happens — the sliced file (optional, fills weight and
	 * time), the printer, the plastic, time and power, extras, the selling
	 * price — and the running total beside it (below it on a phone). The form,
	 * the user's printers and the spool book live in this browser.
	 */
	import Collapsible from '$lib/components/Collapsible.svelte';
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Check, Copy, Pencil, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import { showToast } from '$lib/toast';
	import { manualCopyHint } from '$lib/clipboard';
	import { currentLocale, num } from '$lib/i18n/current';
	import { sentenceGap } from '$lib/i18n/locale';
	import { unitLabel } from '$lib/components/tools/units';
	import type { ToolInfo } from '$lib/tools/registry';
	import { localMoney } from '$lib/tools/shared/money';
	import * as m from '$msg/tools/calculator';
	import * as tc from '$msg/tools/common';
	import ToolPage from '../print-kit/ToolPage.svelte';
	import NumberInput, { submitWith } from '../print-kit/NumberInput.svelte';
	import { duration, grams, newId, readStored, rub, writeStored } from '../print-kit/format';
	import { loadBook, pricePerGram, spoolName, type SpoolBook } from '../spool-tracker/model';
	import SpoolWriteOff from '../spool-tracker/SpoolWriteOff.svelte';
	import { syncBook } from '../spool-tracker/sync';
	import {
		PRINTER_PRESETS,
		calcDefaults,
		calculate,
		clientQuote,
		projectTotals,
		roundSteps,
		splitTime,
		wearPerHour,
		type CalcInput,
		type ProjectItem,
		type UserPrinter
	} from './model';
	import type { SlicedSummary } from './sliced-file';
	import { cleanPrinter, formFromFile, partName, printSeconds, upsertPrinter } from './form';

	let { tool }: { tool: ToolInfo } = $props();

	const STATE_KEY = 'polyzon:tools:calculator:v2';
	const PRINTERS_KEY = 'polyzon:tools:printers:v2';
	const PROJECT_KEY = 'polyzon:tools:calculator:project:v1';
	const NONE = 'none';

	// Prices typed in are in the visitor's currency; the defaults look like its prices.
	const locale = currentLocale();
	const CALC_DEFAULTS = calcDefaults(locale);
	const currency = localMoney(locale).symbol;
	const perKg = m.t_calculator_unit_per_kg({ currency });
	const roundOptions = [
		{ value: 0, label: m.t_calculator_round_none() },
		...roundSteps(locale).map((n) => ({
			value: n,
			label: m.t_calculator_round_multiple({ n: num(n), currency })
		}))
	];

	let f = $state<CalcInput>({ ...CALC_DEFAULTS, colors: [] });
	let project = $state<ProjectItem[]>([]);
	let printerId = $state(NONE);
	let printers = $state<UserPrinter[]>([]);
	let book = $state.raw<SpoolBook | null>(null);
	let priceSource = $state<string | null>(null);
	let ready = false;

	const active = $derived(printers.find((x) => x.id === printerId) ?? null);
	const withPrinter = (p: { watts: number; price: number; lifeHours: number }): CalcInput => ({
		...f,
		watts: p.watts,
		printerPrice: p.price,
		lifeHours: p.lifeHours
	});
	const r = $derived(calculate(active ? withPrinter(active) : f));
	const others = $derived(
		[
			...(active
				? [
						{
							id: NONE,
							name: m.t_calculator_no_profile(),
							watts: f.watts,
							price: f.printerPrice,
							lifeHours: f.lifeHours
						}
					]
				: []),
			...printers.filter((x) => x.id !== printerId)
		].map((x) => ({ id: x.id, name: x.name, total: calculate(withPrinter(x)).total }))
	);
	// The cheapest of the other printers, if it beats this one.
	const cheapest = $derived.by(() => {
		let best: string | null = null;
		let low = r.total;
		for (const o of others) {
			if (o.total < low - 0.005) {
				low = o.total;
				best = o.id;
			}
		}
		return best;
	});
	const spools = $derived(book?.spools ?? []);
	const projectSum = $derived(projectTotals(project));

	onMount(() => {
		const saved = readStored<{ f?: Partial<CalcInput>; printerId?: string }>(STATE_KEY);
		if (saved?.f) {
			f = {
				...CALC_DEFAULTS,
				...saved.f,
				colors: Array.isArray(saved.f.colors) ? saved.f.colors : []
			};
		}
		project = (readStored<ProjectItem[]>(PROJECT_KEY) ?? []).filter(
			(x) => x && typeof x.id === 'string'
		);
		printers = (readStored<UserPrinter[]>(PRINTERS_KEY) ?? []).filter(
			(x) => x && typeof x.id === 'string'
		);
		if (saved?.printerId && printers.some((x) => x.id === saved.printerId)) {
			printerId = saved.printerId;
		}
		book = loadBook();
		void syncBook().then((synced) => (book = synced));
		// Opened from the G-code viewer: weight and time come in the address.
		const q = new URL(location.href).searchParams;
		if (q.has('weight') || q.has('time')) {
			const weight = Number(q.get('weight'));
			const time = Number(q.get('time'));
			if (Number.isFinite(weight) && weight > 0) {
				f.weight = weight;
				// The colours of a file opened before belong to that file.
				f.colors = [];
			}
			if (Number.isFinite(time) && time > 0) Object.assign(f, splitTime(time));
			replaceState(resolve('/workspace/tools/[slug]', { slug: tool.slug }), {});
		}
		ready = true;
	});

	$effect(() => {
		const snapshot = { f: { ...f }, printerId };
		if (ready) writeStored(STATE_KEY, snapshot);
	});

	function selectPrinter(id: string) {
		printerId = id;
		const p = printers.find((x) => x.id === id);
		const spool = p?.spoolId && book?.spools.find((s) => s.id === p.spoolId);
		if (spool) usePrice(spool.id, p.name);
	}

	/** `printer`: the spool came with the printer of that name. */
	function usePrice(spoolId: string, printer?: string) {
		const spool = book?.spools.find((s) => s.id === spoolId);
		if (!spool) return;
		const name = spoolName(spool);
		// No price on the spool: taking it would make the plastic free.
		if (!(spool.price > 0)) {
			const price = rub(f.pricePerKg);
			priceSource =
				printer === undefined
					? m.t_calculator_spool_no_price({ spool: name, price })
					: m.t_calculator_printer_spool_no_price({ spool: name, printer, price });
			return;
		}
		f.pricePerKg = Math.round(pricePerGram(spool) * 1000 * 100) / 100;
		priceSource =
			printer === undefined
				? m.t_calculator_price_from_spool({ spool: name })
				: m.t_calculator_price_from_printer_spool({ spool: name, printer });
	}

	// ---- own printers ----
	let dialogOpen = $state(false);
	let editingId = $state<string | null>(null);
	const blankPrinter = (): UserPrinter => ({
		id: '',
		name: '',
		watts: CALC_DEFAULTS.watts,
		price: CALC_DEFAULTS.printerPrice,
		lifeHours: CALC_DEFAULTS.lifeHours,
		spoolId: null
	});
	let draft = $state<UserPrinter>(blankPrinter());
	let deleteOpen = $state(false);

	function openPrinter(p: UserPrinter | null) {
		editingId = p?.id ?? null;
		draft = p ? { ...p } : blankPrinter();
		dialogOpen = true;
	}

	function modelPicked(id: string) {
		const preset = PRINTER_PRESETS.find((x) => x.id === id);
		if (!preset) return;
		draft.name = preset.name;
		draft.watts = preset.watts;
	}

	function savePrinter() {
		const clean = cleanPrinter(
			draft,
			editingId ?? newId(),
			CALC_DEFAULTS,
			m.t_calculator_printer_default_name()
		);
		printers = upsertPrinter(printers, clean, editingId);
		writeStored(PRINTERS_KEY, printers);
		dialogOpen = false;
		selectPrinter(clean.id);
	}

	function deletePrinter() {
		printers = printers.filter((x) => x.id !== printerId);
		writeStored(PRINTERS_KEY, printers);
		printerId = NONE;
		deleteOpen = false;
	}

	function clearForm() {
		f = { ...CALC_DEFAULTS, colors: [] };
		priceSource = null;
		summary = null;
		fileName = null;
		fileError = null;
	}

	let priceEl = $state<HTMLElement>();
	async function copyPrice() {
		const text = rub(r.price);
		try {
			await navigator.clipboard.writeText(text);
			showToast(m.t_calculator_price_copied({ price: text }), { kind: 'success' });
		} catch {
			// The hint asks for Ctrl+C, so leave the price selected for it.
			if (priceEl) getSelection()?.selectAllChildren(priceEl);
			showToast(manualCopyHint(m.t_calculator_price_selected()), { kind: 'error' });
		}
	}

	// ---- a project of several parts ----
	let quoteEl = $state<HTMLElement>();
	function addToProject() {
		const name = partName(fileName, () => m.t_calculator_part_name({ n: project.length + 1 }));
		const seconds = printSeconds(f.hours, f.minutes);
		project = [
			...project,
			{
				id: newId(),
				name,
				printer: active?.name ?? '',
				grams: r.plasticGrams,
				seconds,
				total: r.total,
				price: r.price
			}
		];
		writeStored(PROJECT_KEY, project);
		showToast(m.t_calculator_project_added({ name }), { kind: 'success' });
	}

	function removeFromProject(id: string) {
		project = project.filter((x) => x.id !== id);
		writeStored(PROJECT_KEY, project);
	}

	function clearProject() {
		project = [];
		writeStored(PROJECT_KEY, project);
	}

	async function copyQuote() {
		try {
			await navigator.clipboard.writeText(clientQuote(project, { rub, grams, duration }));
			showToast(m.t_calculator_quote_copied(), { kind: 'success' });
		} catch {
			if (quoteEl) getSelection()?.selectAllChildren(quoteEl);
			showToast(manualCopyHint(m.t_calculator_quote_selected()), { kind: 'error' });
		}
	}

	// ---- sliced file ----
	let summary = $state.raw<SlicedSummary | null>(null);
	let fileName = $state<string | null>(null);
	let fileBusy = $state(false);
	let fileError = $state<string | null>(null);

	async function readFile(file: File) {
		fileBusy = true;
		fileError = null;
		try {
			const { blobSource, readSlicedFile } = await import('./sliced-file');
			const s = await readSlicedFile(file.name, blobSource(file));
			summary = s;
			fileName = file.name;
			Object.assign(f, formFromFile(s, f.pricePerKg));
		} catch (e) {
			fileError = e instanceof Error ? e.message : m.t_calculator_file_failed();
		} finally {
			fileBusy = false;
		}
	}
</script>

<ToolPage {tool} wide lead={m.t_calculator_lead()}>
	<div class="calc-grid">
		<div class="min-w-0 space-y-8">
			<Collapsible
				variant="section"
				title={m.t_calculator_file_section()}
				lead={m.t_calculator_file_lead()}
			>
				<div class="space-y-4">
					<FileField
						label={m.t_calculator_file_pick()}
						accept=".gcode,.gco,.g,.gc,.3mf,.bgcode"
						hint={m.t_calculator_file_hint()}
						maxBytes={1024 * 1024 * 1024}
						{fileName}
						onfile={readFile}
					/>
					{#if fileBusy}
						<p class="text-sm text-neutral-400" role="status">{m.t_calculator_file_reading()}</p>
					{:else if fileError}
						<div class="notice notice-error" role="alert">
							<TriangleAlert size={16} aria-hidden="true" />
							<p>{fileError}</p>
						</div>
					{:else if summary}
						<ul class="list">
							<li class="list-row">
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-medium">{m.t_calculator_file_duration()}</span>
									{#if summary.slicer}
										<span class="mt-1 block text-xs text-neutral-400">{summary.slicer}</span>
									{:else if summary.fromMoves}
										<span class="mt-1 block text-xs text-neutral-400">
											{m.t_calculator_file_from_moves()}
										</span>
									{/if}
								</span>
								<span class="text-sm tabular-nums">
									{summary.timeSec ? duration(summary.timeSec) : m.t_calculator_file_missing()}
								</span>
							</li>
							<li class="list-row">
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-medium">{m.t_calculator_file_filament()}</span>
									{#if summary.gramsEstimated}
										<span class="mt-1 block text-xs text-neutral-400">
											{summary.diameter
												? summary.density
													? m.t_calculator_file_grams_estimated()
													: m.t_calculator_file_grams_estimated_density()
												: summary.density
													? m.t_calculator_file_grams_estimated_diameter()
													: m.t_calculator_file_grams_estimated_both()}
										</span>
									{:else if summary.towerGrams}
										<span class="mt-1 block text-xs text-neutral-400">
											{m.t_calculator_file_tower({ grams: grams(summary.towerGrams) })}
										</span>
									{/if}
								</span>
								<span class="text-sm tabular-nums">
									{summary.grams ? grams(summary.grams) : m.t_calculator_file_missing()}
								</span>
							</li>
							{#if summary.filaments.length > 1}
								{#each summary.filaments as fil, i (i)}
									<li class="list-row">
										<span
											class="size-4 shrink-0 rounded-full border border-border"
											style:background-color={fil.color ?? 'transparent'}
											aria-hidden="true"
										></span>
										<span class="min-w-0 flex-1 text-sm">
											{fil.type
												? m.t_calculator_extruder_type({ n: i + 1, type: fil.type })
												: m.t_calculator_extruder({ n: i + 1 })}
										</span>
										<span class="text-sm tabular-nums">
											{fil.grams
												? grams(fil.grams)
												: m.t_calculator_meters({ n: num((fil.mm ?? 0) / 1000, 2) })}
										</span>
									</li>
								{/each}
							{/if}
							{#if summary.plates.length > 1}
								{#each summary.plates as plate (plate.index)}
									<li class="list-row">
										<span class="min-w-0 flex-1 text-sm">
											{m.t_calculator_plate({ n: plate.index })}
										</span>
										<span class="text-sm tabular-nums">
											{plate.timeSec ? duration(plate.timeSec) : '—'}, {plate.grams
												? grams(plate.grams)
												: '—'}
										</span>
									</li>
								{/each}
							{/if}
						</ul>
						<div class="notice notice-success" role="status">
							<Check size={16} aria-hidden="true" />
							<p>
								{[
									m.t_calculator_file_filled(),
									summary.filaments.length > 1 ? m.t_calculator_file_filled_purge() : '',
									summary.plates.length > 1 ? m.t_calculator_file_filled_plates() : ''
								]
									.filter(Boolean)
									.join(sentenceGap(locale))}
							</p>
						</div>
					{/if}
				</div>
			</Collapsible>

			<Collapsible variant="section" title={m.t_calculator_printer_section()}>
				{#snippet actions()}
					<button type="button" class="btn-ghost btn-s" onclick={() => openPrinter(null)}>
						<Plus size={14} aria-hidden="true" />
						{m.t_calculator_printer_save_own()}
					</button>
				{/snippet}
				<div class="space-y-4">
					{#if printers.length}
						<div>
							<label for="calc-printer-select" class="label"
								>{m.t_calculator_printer_select()}</label
							>
							<select
								id="calc-printer-select"
								class="input"
								value={printerId}
								onchange={(e) => selectPrinter(e.currentTarget.value)}
							>
								<option value={NONE}>{m.t_calculator_printer_none_option()}</option>
								{#each printers as p (p.id)}
									<option value={p.id}>{p.name}</option>
								{/each}
							</select>
						</div>
					{/if}
					{#if active}
						<div class="flex flex-wrap items-center gap-2">
							<p class="min-w-0 flex-1 text-sm tabular-nums text-neutral-300">
								{m.t_calculator_printer_summary({
									watts: num(active.watts, 0),
									wear: rub(wearPerHour(active.price, active.lifeHours))
								})}
							</p>
							<button type="button" class="btn-ghost btn-s" onclick={() => openPrinter(active)}>
								<Pencil size={14} aria-hidden="true" />
								{m.t_calculator_printer_edit()}
							</button>
							<button
								type="button"
								class="btn-ghost btn-s text-red-300"
								onclick={() => (deleteOpen = true)}
							>
								<Trash2 size={14} aria-hidden="true" />
								{m.t_calculator_printer_delete()}
							</button>
						</div>
					{:else}
						<div class="grid gap-4 sm:grid-cols-3">
							<NumberInput
								label={m.t_calculator_watts()}
								unit={unitLabel('W')}
								bind:value={f.watts}
								max={5000}
								digits={0}
								hint={m.t_calculator_watts_hint()}
							/>
							<NumberInput
								label={m.t_calculator_printer_price()}
								unit={currency}
								bind:value={f.printerPrice}
								max={10_000_000}
							/>
							<NumberInput
								label={m.t_calculator_life()}
								unit={unitLabel('h')}
								bind:value={f.lifeHours}
								max={100_000}
								digits={0}
								hint={m.t_calculator_life_hint()}
							/>
						</div>
					{/if}
				</div>
			</Collapsible>

			<Collapsible variant="section" title={tc.tc_plastic()}>
				<div class="space-y-4">
					<div class="grid gap-4 sm:grid-cols-2">
						<NumberInput
							label={m.t_calculator_weight()}
							unit={unitLabel('g')}
							bind:value={f.weight}
							digits={1}
						/>
						<NumberInput
							label={m.t_calculator_price_per_kg()}
							unit={perKg}
							bind:value={f.pricePerKg}
							hint={priceSource ??
								(f.colors.length ? m.t_calculator_price_per_kg_rest_hint() : undefined)}
						/>
					</div>
					{#if f.colors.length}
						<div class="grid gap-4 sm:grid-cols-2">
							{#each f.colors as c, i (i)}
								<NumberInput
									label={c.type
										? m.t_calculator_extruder_type_price({
												n: i + 1,
												type: c.type,
												grams: grams(c.grams)
											})
										: m.t_calculator_extruder_price({ n: i + 1, grams: grams(c.grams) })}
									unit={perKg}
									bind:value={c.pricePerKg}
								/>
							{/each}
						</div>
					{/if}
					{#if spools.length}
						<div>
							<label for="calc-spool" class="label">{m.t_calculator_spool_pick()}</label>
							<select
								id="calc-spool"
								class="input"
								value=""
								onchange={(e) => {
									usePrice(e.currentTarget.value);
									e.currentTarget.value = '';
								}}
							>
								<option value="">{m.t_calculator_spool_pick_placeholder()}</option>
								{#each spools as s (s.id)}
									<option value={s.id}>
										{s.price > 0
											? m.t_calculator_spool_option_price({
													spool: spoolName(s),
													price: rub(pricePerGram(s) * 1000)
												})
											: m.t_calculator_spool_option_no_price({ spool: spoolName(s) })}
									</option>
								{/each}
							</select>
						</div>
					{/if}
					<ToggleField
						label={m.t_calculator_multicolor()}
						hint={m.t_calculator_multicolor_hint()}
						bind:checked={f.multicolor}
					/>
					{#if f.multicolor}
						<div class="grid gap-4 sm:grid-cols-3">
							<NumberInput
								label={m.t_calculator_color_changes()}
								bind:value={f.colorChanges}
								digits={0}
								max={100_000}
							/>
							<NumberInput
								label={m.t_calculator_purge_per_change()}
								unit={unitLabel('g')}
								bind:value={f.purgePerChange}
								digits={2}
								hint={m.t_calculator_purge_per_change_hint()}
							/>
							<NumberInput
								label={m.t_calculator_tower()}
								unit={unitLabel('g')}
								bind:value={f.tower}
								digits={1}
							/>
						</div>
					{/if}
				</div>
			</Collapsible>

			<Collapsible variant="section" title={m.t_calculator_time_section()}>
				<div class="grid gap-4 sm:grid-cols-3">
					<NumberInput
						label={m.t_calculator_hours()}
						unit={unitLabel('h')}
						bind:value={f.hours}
						digits={2}
						max={10_000}
					/>
					<NumberInput
						label={m.t_calculator_minutes()}
						unit={unitLabel('min')}
						bind:value={f.minutes}
						digits={0}
						max={10_000}
					/>
					<NumberInput
						label={m.t_calculator_tariff()}
						unit={currency}
						bind:value={f.tariff}
						digits={2}
					/>
				</div>
			</Collapsible>

			<Collapsible variant="section" title={m.t_calculator_extras_section()}>
				<div class="grid gap-4 sm:grid-cols-3">
					<NumberInput
						label={m.t_calculator_packaging()}
						unit={currency}
						bind:value={f.packaging}
					/>
					<NumberInput
						label={m.t_calculator_labour()}
						unit={currency}
						bind:value={f.labour}
						hint={m.t_calculator_labour_hint()}
					/>
					<NumberInput
						label={m.t_calculator_fail_rate()}
						unit="%"
						bind:value={f.failRate}
						max={90}
						digits={1}
						hint={m.t_calculator_fail_rate_hint()}
					/>
				</div>
			</Collapsible>

			<Collapsible variant="section" title={m.t_calculator_price_section()}>
				<div class="space-y-4">
					<NumberInput
						label={m.t_calculator_markup()}
						unit="%"
						bind:value={f.markup}
						max={10_000}
						digits={1}
						hint={m.t_calculator_markup_hint()}
					/>
					<ChoiceField
						label={m.t_calculator_round()}
						bind:value={f.roundTo}
						options={roundOptions}
					/>
				</div>
			</Collapsible>

			{#if r.plasticGrams > 0}
				<Collapsible variant="section" title={m.t_calculator_spool_section()}>
					<div class="space-y-4">
						<SpoolWriteOff
							grams={r.plasticGrams}
							note={fileName ?? m.t_calculator_spool_note()}
							preferred={active?.spoolId ?? null}
						/>
					</div>
				</Collapsible>
			{/if}
			<button type="button" class="btn-ghost btn-s" onclick={clearForm}>
				<RotateCcw size={14} aria-hidden="true" />
				{m.t_calculator_clear_form()}
			</button>
		</div>

		<aside class="card calc-result" aria-labelledby="calc-result-title">
			<h2 id="calc-result-title" class="text-sm font-semibold">{m.t_calculator_result()}</h2>
			{#if !(r.total > 0)}
				<p class="mt-1 text-xs text-neutral-400">
					{m.t_calculator_result_empty()}
				</p>
			{/if}
			<dl class="mt-4 space-y-2 text-sm">
				<div class="flex justify-between gap-3">
					<dt class="text-neutral-300">
						{m.t_calculator_result_filament({ grams: grams(r.plasticGrams) })}
					</dt>
					<dd class="tabular-nums">{rub(r.plastic)}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-neutral-300">
						{m.t_calculator_result_electricity({ kwh: num(r.kwh, 2) })}
					</dt>
					<dd class="tabular-nums">{rub(r.electricity)}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-neutral-300">
						{m.t_calculator_result_wear({ rate: rub(r.wearPerHour) })}
					</dt>
					<dd class="tabular-nums">{rub(r.wear)}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-neutral-300">
						{m.t_calculator_result_failures({ rate: num(f.failRate, 1) })}
					</dt>
					<dd class="tabular-nums">{rub(r.failures)}</dd>
				</div>
				{#if r.packaging}
					<div class="flex justify-between gap-3">
						<dt class="text-neutral-300">{m.t_calculator_result_packaging()}</dt>
						<dd class="tabular-nums">{rub(r.packaging)}</dd>
					</div>
				{/if}
				{#if r.labour}
					<div class="flex justify-between gap-3">
						<dt class="text-neutral-300">{m.t_calculator_result_labour()}</dt>
						<dd class="tabular-nums">{rub(r.labour)}</dd>
					</div>
				{/if}
			</dl>
			<div class="mt-4 border-t border-border pt-4">
				<div class="text-xs text-neutral-400">{m.t_calculator_result_total()}</div>
				<div class="mt-1 text-2xl font-semibold tabular-nums">{rub(r.total)}</div>
			</div>
			<div class="mt-4">
				<div class="text-xs text-neutral-400">{m.t_calculator_price_section()}</div>
				<div bind:this={priceEl} class="mt-1 text-2xl font-semibold tabular-nums">
					{rub(r.price)}
				</div>
				<div class="mt-1 text-xs tabular-nums text-neutral-400">
					{m.t_calculator_result_markup({ markup: num(f.markup, 1), profit: rub(r.profit) })}
				</div>
			</div>
			<button
				type="button"
				class="btn-primary mt-4 w-full"
				disabled={!(r.price > 0)}
				onclick={copyPrice}
			>
				<Copy size={16} aria-hidden="true" />
				{m.t_calculator_copy_price()}
			</button>
			{#if others.length}
				<div class="mt-6">
					<h3 class="text-xs font-medium text-neutral-400">{m.t_calculator_others()}</h3>
					<ul class="mt-2 space-y-2 text-sm">
						{#each others as o (o.id)}
							<li class="flex justify-between gap-3">
								<span class="min-w-0 truncate text-neutral-300">
									{o.name}{#if o.id === cheapest}
										<span class="text-xs text-neutral-400"
											>&nbsp;{m.t_calculator_cheapest_mark()}</span
										>
									{/if}
								</span>
								<span class="tabular-nums" class:font-semibold={o.id === cheapest}>
									{rub(o.total)}
								</span>
							</li>
						{/each}
					</ul>
					{#if cheapest === null && r.total > 0}
						<p class="mt-2 text-xs text-neutral-400">{m.t_calculator_cheapest_here()}</p>
					{/if}
				</div>
			{/if}
			<div class="mt-6 border-t border-border pt-4">
				<h3 class="text-xs font-medium text-neutral-400">
					{project.length
						? m.t_calculator_project_parts({ count: project.length, n: num(project.length) })
						: m.t_calculator_project_empty_title()}
				</h3>
				{#if project.length}
					<ul bind:this={quoteEl} class="mt-2 space-y-2 text-sm">
						{#each project as x (x.id)}
							<li class="flex items-center gap-2">
								<span class="min-w-0 flex-1">
									<span class="block truncate text-neutral-300">{x.name}</span>
									<span class="block text-xs tabular-nums text-neutral-400">
										{x.printer ? `${x.printer}, ` : ''}{grams(x.grams)}, {duration(x.seconds)}
									</span>
								</span>
								<span class="tabular-nums">{rub(x.price)}</span>
								<button
									type="button"
									class="icon-btn"
									aria-label={m.t_calculator_project_remove_label({ name: x.name })}
									title={m.t_calculator_project_remove()}
									onclick={() => removeFromProject(x.id)}
								>
									<Trash2 size={16} aria-hidden="true" />
								</button>
							</li>
						{/each}
					</ul>
					<dl class="mt-3 space-y-1 text-sm">
						<div class="flex justify-between gap-3">
							<dt class="text-neutral-300">{m.t_calculator_project_total()}</dt>
							<dd class="tabular-nums">{rub(projectSum.total)}</dd>
						</div>
						<div class="flex justify-between gap-3 font-medium">
							<dt>{m.t_calculator_project_price()}</dt>
							<dd class="tabular-nums">{rub(projectSum.price)}</dd>
						</div>
					</dl>
				{:else}
					<p class="mt-1 text-xs text-neutral-400">
						{m.t_calculator_project_empty()}
					</p>
				{/if}
				<div class="mt-3 flex flex-wrap gap-2">
					<button
						type="button"
						class="btn-ghost btn-s"
						disabled={!(r.price > 0)}
						onclick={addToProject}
					>
						<Plus size={14} aria-hidden="true" />
						{m.t_calculator_project_add()}
					</button>
					{#if project.length}
						<button type="button" class="btn-ghost btn-s" onclick={copyQuote}>
							<Copy size={14} aria-hidden="true" />
							{m.t_calculator_quote_copy()}
						</button>
						<button type="button" class="btn-ghost btn-s" onclick={clearProject}>
							{m.t_calculator_project_clear()}
						</button>
					{/if}
				</div>
			</div>
		</aside>
	</div>
</ToolPage>

<Dialog
	bind:open={dialogOpen}
	title={editingId ? m.t_calculator_dialog_edit() : m.t_calculator_dialog_new()}
	size="sm"
>
	<form id="calc-printer-form" class="space-y-4" onsubmit={submitWith(savePrinter)}>
		<div>
			<label for="calc-model" class="label">{m.t_calculator_dialog_model()}</label>
			<select
				id="calc-model"
				class="input"
				value=""
				onchange={(e) => modelPicked(e.currentTarget.value)}
			>
				<option value="">{m.t_calculator_dialog_model_other()}</option>
				{#each PRINTER_PRESETS as preset (preset.id)}
					<option value={preset.id}>
						{m.t_calculator_dialog_model_option({ name: preset.name, watts: preset.watts })}
					</option>
				{/each}
			</select>
			<p class="hint">
				{m.t_calculator_dialog_model_hint()}
			</p>
		</div>
		<TextField
			label={m.t_calculator_dialog_name()}
			bind:value={draft.name}
			placeholder={m.t_calculator_dialog_name_placeholder()}
		/>
		<div class="grid gap-4 sm:grid-cols-3">
			<NumberInput
				label={m.t_calculator_watts()}
				unit={unitLabel('W')}
				bind:value={draft.watts}
				max={5000}
				digits={0}
			/>
			<NumberInput
				label={m.t_calculator_dialog_price()}
				unit={currency}
				bind:value={draft.price}
				max={10_000_000}
			/>
			<NumberInput
				label={m.t_calculator_life()}
				unit={unitLabel('h')}
				bind:value={draft.lifeHours}
				max={100_000}
				digits={0}
			/>
		</div>
		{#if spools.length}
			<div>
				<label for="calc-printer-spool" class="label">{m.t_calculator_dialog_spool()}</label>
				<select
					id="calc-printer-spool"
					class="input"
					value={draft.spoolId ?? ''}
					onchange={(e) => (draft.spoolId = e.currentTarget.value || null)}
				>
					<option value="">{m.t_calculator_dialog_spool_none()}</option>
					{#each spools as s (s.id)}
						<option value={s.id}>{spoolName(s)}</option>
					{/each}
				</select>
				<p class="hint">{m.t_calculator_dialog_spool_hint()}</p>
			</div>
		{/if}
	</form>
	{#snippet footer()}
		<button type="button" class="btn-ghost" onclick={() => (dialogOpen = false)}>
			{m.t_calculator_dialog_cancel()}
		</button>
		<button type="submit" form="calc-printer-form" class="btn-primary">
			{m.t_calculator_dialog_save()}
		</button>
	{/snippet}
</Dialog>

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.t_calculator_delete_title()}
	description={m.t_calculator_delete_text({
		name: active?.name ?? m.t_calculator_printer_default_name()
	})}
	confirmLabel={m.t_calculator_delete_confirm()}
	variant="danger"
	onConfirm={deletePrinter}
/>

<style>
	.calc-grid {
		display: grid;
		gap: var(--pz-space-8);
	}
	@media (min-width: 1024px) {
		.calc-grid {
			grid-template-columns: minmax(0, 1fr) 340px;
			align-items: start;
		}
		.calc-result {
			position: sticky;
			top: var(--pz-space-8);
		}
	}
</style>
