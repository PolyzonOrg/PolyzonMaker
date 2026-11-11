<script lang="ts">
	/**
	 * «Учёт катушек»: the spools — what is left in grams and rubles, the log of
	 * write-offs, refills and weighings, reservations for running prints, a
	 * JSON backup, labels with a QR code. Kept in this browser and with the
	 * account (sync.ts), so a label scanned on the phone opens the write-off of
	 * that spool. The calculator and the G-code viewer read and write the same book.
	 */
	import Collapsible from '$lib/components/Collapsible.svelte';
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ArrowDown,
		ArrowUp,
		Check,
		Copy,
		Download,
		Pencil,
		Plus,
		Printer,
		QrCode,
		Scale,
		Trash2,
		TriangleAlert,
		Upload,
		X
	} from 'lucide-svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import { singleClick } from '$lib/forms';
	import { showToast } from '$lib/toast';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import ToolPage from '../print-kit/ToolPage.svelte';
	import NumberInput, { submitWith } from '../print-kit/NumberInput.svelte';
	import { grams, rub } from '../print-kit/format';
	import {
		spoolMaterials,
		addSpool,
		adjust,
		available,
		cancelReservation,
		commitReservation,
		deleteSpool,
		emptyBook,
		exportBook,
		loadBook,
		NEW_SPOOL_COLOR,
		parseBook,
		pricePerGram,
		refill,
		remaining,
		reserve,
		reserved,
		spoolName,
		summary,
		updateSpool,
		writeOff,
		type Movement,
		type Spool,
		type SpoolBook,
		type SpoolInput
	} from './model';
	import { bookTooBig, saveAndSync, syncBook } from './sync';
	import { labelSvg, spoolLink } from './label';
	import { restoreBook } from './restore';
	import { currentLocale, intlLocale, num } from '$lib/i18n/current';
	import { listSeparator } from '$lib/i18n/locale';
	import { localMoney } from '$lib/tools/shared/money';
	import * as common from '$msg/common';
	import * as tc from '$msg/tools/common';
	import * as msg from '$msg/tools/spool-tracker';

	let { tool }: { tool: ToolInfo } = $props();
	// Joins the facts about a spool: «, », Japanese and Chinese «、».
	const separator = listSeparator(currentLocale());

	let book = $state.raw<SpoolBook>(emptyBook());
	let loaded = $state(false);
	/** The account refuses a book this large: it lives in this browser only. */
	let tooBig = $state(false);
	onMount(() => {
		book = loadBook();
		loaded = true;
		// Opened from a spool label: its write-off, once the account's copy is in.
		const scanned = new URL(location.href).searchParams.get('spool');
		void syncBook().then((synced) => {
			book = synced;
			tooBig = bookTooBig();
			if (scanned) openScanned(scanned);
		});
	});

	function openScanned(id: string) {
		replaceState(resolve('/workspace/tools/[slug]', { slug: tool.slug }), {});
		const s = book.spools.find((x) => x.id === id);
		if (s) openMove(s, 'use');
		else {
			showToast(msg.t_spool_tracker_scanned_missing(), { kind: 'error' });
		}
	}

	function commit(next: SpoolBook, message?: string) {
		book = next;
		void saveAndSync(next).then((synced) => {
			book = synced;
			tooBig = bookTooBig();
		});
		if (message) showToast(message, { kind: 'success' });
	}

	function attempt(fn: () => void) {
		try {
			fn();
			return true;
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e), { kind: 'error' });
			return false;
		}
	}

	const total = $derived(summary(book));
	const priced = $derived(book.spools.some((s) => s.price > 0));
	const unpriced = $derived(book.spools.filter((s) => !(s.price > 0)).length);
	const byId = $derived(new Map(book.spools.map((s) => [s.id, s])));
	let logLimit = $state(20);
	const log = $derived(book.movements.slice(0, logLimit));
	// The book loads in onMount: the dates render in the browser only, in the page's language.
	const dateFormat = new Intl.DateTimeFormat(intlLocale(), {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
	const KIND_LABEL: Record<Movement['kind'], string> = {
		use: msg.t_spool_tracker_kind_use(),
		refill: msg.t_spool_tracker_kind_refill(),
		adjust: msg.t_spool_tracker_kind_adjust()
	};
	/** What a spool cost is typed in: the visitor's own currency. */
	const money = localMoney(currentLocale());
	const materials = spoolMaterials();

	// ---- add / edit ----
	const blank = (): SpoolInput & { initial: number } => ({
		material: 'PLA',
		colorName: '',
		color: NEW_SPOOL_COLOR,
		brand: '',
		netWeight: 1000,
		price: 0,
		initial: 1000,
		location: '',
		notes: ''
	});
	let editOpen = $state(false);
	let editingId = $state<string | null>(null);
	let draft = $state(blank());
	// A new spool is full until told otherwise: «now on it» follows its net weight.
	let lastNet = 1000;
	$effect(() => {
		const net = draft.netWeight;
		if (!editingId && draft.initial === lastNet) draft.initial = net;
		lastNet = net;
	});
	let deleteOpen = $state(false);

	function openEdit(s: Spool | null) {
		editingId = s?.id ?? null;
		draft = s ? { ...s, initial: s.initial } : blank();
		editOpen = true;
	}

	// Another spool like this one: the same plastic, full, ready to edit.
	function openCopy(s: Spool) {
		editingId = null;
		draft = { ...s, initial: s.netWeight };
		editOpen = true;
	}

	function saveSpool() {
		const ok = attempt(() => {
			if (editingId) commit(updateSpool(book, editingId, draft), msg.t_spool_tracker_saved_toast());
			else commit(addSpool(book, draft), msg.t_spool_tracker_added_toast());
		});
		if (ok) editOpen = false;
	}

	function removeSpool() {
		if (!editingId) return;
		commit(deleteSpool(book, editingId), msg.t_spool_tracker_deleted_toast());
		deleteOpen = false;
		editOpen = false;
	}

	// ---- movements ----
	type Action = 'use' | 'refill' | 'adjust' | 'reserve';
	let moveOpen = $state(false);
	let moveSpool = $state<Spool | null>(null);
	let action = $state<string>('use');
	let amount = $state(0);
	let note = $state('');
	const ACTIONS = [
		{ value: 'use', label: msg.t_spool_tracker_action_use() },
		{ value: 'refill', label: msg.t_spool_tracker_action_refill() },
		{ value: 'adjust', label: msg.t_spool_tracker_action_adjust() },
		{ value: 'reserve', label: msg.t_spool_tracker_action_reserve() }
	];
	const moveLeft = $derived(moveSpool ? remaining(book, moveSpool.id) : 0);
	const moveFree = $derived(moveSpool ? available(book, moveSpool.id) : 0);
	const confirmLabel = $derived(
		(
			{
				use: msg.t_spool_tracker_confirm_use({ grams: grams(amount) }),
				refill: msg.t_spool_tracker_confirm_refill({ grams: grams(amount) }),
				adjust: msg.t_spool_tracker_confirm_adjust(),
				reserve: msg.t_spool_tracker_confirm_reserve({ grams: grams(amount) })
			} as Record<string, string>
		)[action]
	);

	function openMove(s: Spool, kind: Action = 'use') {
		moveSpool = s;
		action = kind;
		amount = kind === 'adjust' ? Math.max(0, remaining(book, s.id)) : 0;
		note = '';
		moveOpen = true;
	}

	// Weighing starts from the current remaining; grams typed for a write-off stay
	// when switching to «Добавить» or «Отложить» — only leaving «Взвесить» clears them.
	let lastAction = 'use';
	$effect(() => {
		if (!moveSpool) return;
		const id = moveSpool.id;
		if (action === 'adjust') amount = Math.max(0, remaining(book, id));
		else if (lastAction === 'adjust') amount = 0;
		lastAction = action;
	});

	function saveMove() {
		const s = moveSpool;
		if (!s) return;
		const ok = attempt(() => {
			if (action === 'use')
				commit(
					writeOff(book, s.id, amount, note),
					msg.t_spool_tracker_used_toast({ grams: grams(amount) })
				);
			else if (action === 'refill')
				commit(
					refill(book, s.id, amount, note),
					msg.t_spool_tracker_refilled_toast({ grams: grams(amount) })
				);
			else if (action === 'adjust')
				commit(
					adjust(book, s.id, amount, note),
					msg.t_spool_tracker_adjusted_toast({ grams: grams(amount) })
				);
			else
				commit(
					reserve(book, s.id, amount, note),
					msg.t_spool_tracker_reserved_toast({ grams: grams(amount) })
				);
		});
		if (ok) moveOpen = false;
	}

	// ---- backup ----
	let fileInput = $state<HTMLInputElement>();
	let pending = $state.raw<SpoolBook | null>(null);
	let importOpen = $state(false);

	function exportJson() {
		// The user's own date (Swedish locale formats it as YYYY-MM-DD); toISOString
		// is UTC and names a backup made after midnight in Moscow with yesterday.
		const date = new Date().toLocaleDateString('sv-SE');
		downloadBytes(
			exportBook(book),
			`${msg.t_spool_tracker_backup_filename()}-${date}.json`,
			'application/json'
		);
	}

	async function importJson(file: File | undefined) {
		if (!file) return;
		try {
			pending = parseBook(await file.text());
			importOpen = true;
		} catch (e) {
			showToast(e instanceof Error ? e.message : msg.t_spool_tracker_file_unreadable(), {
				kind: 'error'
			});
		}
	}

	function applyImport() {
		if (pending) {
			commit(
				restoreBook(book, pending, Date.now()),
				msg.t_spool_tracker_restored_toast({ count: num(pending.spools.length, 0) })
			);
		}
		pending = null;
		importOpen = false;
	}

	// ---- labels ----
	const labelOf = (s: Spool) => labelSvg(s, spoolLink(location.origin, s.id));
	const labelSrc = (s: Spool) =>
		`data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelOf(s))}`;
	let printing = $state(false);

	function downloadLabel(s: Spool) {
		const name = spoolName(s)
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.toLowerCase();
		downloadBytes(
			labelOf(s),
			`${msg.t_spool_tracker_label_filename()}-${name}.svg`,
			'image/svg+xml'
		);
	}

	async function printLabels() {
		printing = true;
		// The sheet renders first; the browser prints only it (see the style).
		await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
		window.print();
		printing = false;
	}

	const share = (s: Spool) =>
		s.netWeight > 0 ? Math.max(0, Math.min(1, remaining(book, s.id) / s.netWeight)) : 0;

	/** «500 г из 1 кг, 50 %, отложено 100 г, 1,5 ₽/г, brand, place» — the facts there are. */
	function rowDetails(s: Spool, left: number, held: number): string {
		return [
			msg.t_spool_tracker_row_amount({
				left: grams(Math.max(0, left)),
				net: grams(s.netWeight),
				share: num(share(s) * 100, 0)
			}),
			held ? msg.t_spool_tracker_row_held({ grams: grams(held) }) : '',
			s.price
				? msg.t_spool_tracker_row_price({
						price: num(pricePerGram(s), 2),
						currency: money.symbol
					})
				: '',
			s.brand,
			s.location
		]
			.filter(Boolean)
			.join(separator);
	}
</script>

<ToolPage {tool} lead={msg.t_spool_tracker_lead()}>
	{#snippet action()}
		<button type="button" class="btn-primary" onclick={() => openEdit(null)}>
			<Plus size={16} aria-hidden="true" />
			{msg.t_spool_tracker_add_spool()}
		</button>
	{/snippet}

	{#if tooBig}
		<div class="notice notice-warning" role="status">
			<TriangleAlert size={16} aria-hidden="true" />
			<p>{msg.t_spool_tracker_account_full()}</p>
		</div>
	{/if}

	{#if loaded && book.spools.length}
		<section aria-label={msg.t_spool_tracker_totals()} class="grid gap-3 sm:grid-cols-3">
			<div class="card">
				<div class="text-xs text-neutral-400">{msg.t_spool_tracker_total_spools()}</div>
				<div class="mt-1 text-2xl font-semibold tabular-nums">{total.spools}</div>
			</div>
			<div class="card">
				<div class="text-xs text-neutral-400">{msg.t_spool_tracker_total_grams()}</div>
				<div class="mt-1 text-2xl font-semibold tabular-nums">{grams(total.grams)}</div>
			</div>
			<div class="card">
				<div class="text-xs text-neutral-400">{msg.t_spool_tracker_total_value()}</div>
				{#if priced}
					<div class="mt-1 text-2xl font-semibold tabular-nums">{rub(total.value)}</div>
					<div class="mt-1 text-xs tabular-nums text-neutral-400">
						{unpriced
							? msg.t_spool_tracker_month_unpriced({
									grams: grams(total.monthGrams),
									cost: rub(total.monthCost),
									spools: msg.t_spool_tracker_spools({ count: unpriced, n: num(unpriced, 0) })
								})
							: msg.t_spool_tracker_month({
									grams: grams(total.monthGrams),
									cost: rub(total.monthCost)
								})}
					</div>
				{:else}
					<!-- No prices yet: «0 ₽» would read as free filament. -->
					<div class="mt-1 text-2xl font-semibold tabular-nums">—</div>
					<div class="mt-1 text-xs tabular-nums text-neutral-400">
						{msg.t_spool_tracker_month_no_prices({ grams: grams(total.monthGrams) })}
					</div>
				{/if}
			</div>
		</section>
	{/if}

	<Collapsible variant="section" title={msg.t_spool_tracker_my_spools()}>
		{#if !loaded}
			<p class="text-sm text-neutral-400">{msg.t_spool_tracker_loading()}</p>
		{:else if !book.spools.length}
			<EmptyState
				icon={tool.icon}
				title={msg.t_spool_tracker_empty_title()}
				description={msg.t_spool_tracker_empty_text()}
			/>
		{:else}
			<ul class="list">
				{#each book.spools as s (s.id)}
					{@const left = remaining(book, s.id)}
					{@const held = reserved(book, s.id)}
					<li class="list-row">
						<span class="swatch-thumb" style:background-color={s.color} aria-hidden="true"></span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium">{spoolName(s)}</div>
							<div class="mt-1 break-words text-xs tabular-nums text-neutral-400">
								{rowDetails(s, left, held)}
							</div>
							<div
								class="mt-2 h-1 max-w-48 overflow-hidden rounded-full bg-panel3"
								role="meter"
								aria-label={msg.t_spool_tracker_remaining()}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={Math.round(share(s) * 100)}
							>
								<div class="h-full bg-accent" style:width="{share(s) * 100}%"></div>
							</div>
							{#if left < 0}
								<p class="mt-1 text-xs text-amber-300">
									{msg.t_spool_tracker_overdrawn()}
								</p>
							{/if}
						</div>
						<button type="button" class="btn-ghost btn-s" onclick={() => openMove(s)}>
							{msg.t_spool_tracker_action_use()}
						</button>
						<button
							type="button"
							class="icon-btn"
							aria-label={msg.t_spool_tracker_edit_label({ spool: spoolName(s) })}
							title={msg.t_spool_tracker_edit()}
							onclick={() => openEdit(s)}
						>
							<Pencil size={16} aria-hidden="true" />
						</button>
						<button
							type="button"
							class="icon-btn"
							aria-label={msg.t_spool_tracker_copy_label({ spool: spoolName(s) })}
							title={msg.t_spool_tracker_copy()}
							onclick={() => openCopy(s)}
						>
							<Copy size={16} aria-hidden="true" />
						</button>
						<button
							type="button"
							class="icon-btn"
							aria-label={msg.t_spool_tracker_label_label({ spool: spoolName(s) })}
							title={msg.t_spool_tracker_label()}
							onclick={() => downloadLabel(s)}
						>
							<QrCode size={16} aria-hidden="true" />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</Collapsible>

	{#if book.reservations.length}
		<Collapsible
			variant="section"
			title={msg.t_spool_tracker_reserved_title()}
			lead={msg.t_spool_tracker_reserved_lead()}
		>
			<ul class="list">
				{#each book.reservations as r (r.id)}
					{@const s = byId.get(r.spoolId)}
					<li class="list-row flex-wrap">
						<div class="min-w-48 flex-1">
							<div class="break-words text-sm font-medium">
								{msg.t_spool_tracker_reservation({
									spool: s ? spoolName(s) : msg.t_spool_tracker_spool(),
									grams: grams(r.grams)
								})}
							</div>
							<div class="mt-1 truncate text-xs text-neutral-400">
								{dateFormat.format(r.at)}{r.note ? `, ${r.note}` : ''}
							</div>
						</div>
						<div class="flex gap-2">
							<button
								type="button"
								class="btn-ghost btn-s"
								onclick={singleClick(() =>
									commit(
										commitReservation(book, r.id),
										msg.t_spool_tracker_used_toast({ grams: grams(r.grams) })
									)
								)}
							>
								<Check size={14} aria-hidden="true" />
								{msg.t_spool_tracker_commit()}
							</button>
							<button
								type="button"
								class="btn-ghost btn-s"
								onclick={singleClick(() =>
									commit(cancelReservation(book, r.id), msg.t_spool_tracker_returned_toast())
								)}
							>
								<X size={14} aria-hidden="true" />
								{msg.t_spool_tracker_return()}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		</Collapsible>
	{/if}

	{#if book.movements.length}
		<Collapsible variant="section" title={msg.t_spool_tracker_history()}>
			<ul class="list">
				{#each log as m (m.id)}
					{@const s = byId.get(m.spoolId)}
					<li class="list-row">
						{#if m.kind === 'use'}
							<ArrowDown size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						{:else if m.kind === 'refill'}
							<ArrowUp size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						{:else}
							<Scale size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						{/if}
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium">
								{msg.t_spool_tracker_log_title({
									kind: KIND_LABEL[m.kind],
									spool: s ? spoolName(s) : msg.t_spool_tracker_log_spool_unknown()
								})}
							</div>
							<div class="mt-1 truncate text-xs text-neutral-400">
								{[
									dateFormat.format(m.at),
									m.source === 'gcode'
										? msg.t_spool_tracker_log_from_gcode()
										: m.source === 'reservation'
											? msg.t_spool_tracker_log_from_reservation()
											: '',
									m.note
								]
									.filter(Boolean)
									.join(separator)}
							</div>
						</div>
						<div class="shrink-0 text-right">
							<div class="text-sm tabular-nums">
								{m.grams > 0 ? '+' : '−'}{grams(Math.abs(m.grams))}
							</div>
							{#if m.cost}<div class="mt-1 text-xs tabular-nums text-neutral-400">
									{rub(m.cost)}
								</div>{/if}
						</div>
					</li>
				{/each}
			</ul>
			{#if book.movements.length > logLimit}
				<button type="button" class="btn-ghost btn-s mt-4" onclick={() => (logLimit += 50)}>
					{msg.t_spool_tracker_show_more()}
				</button>
			{/if}
		</Collapsible>
	{/if}

	<Collapsible
		variant="section"
		title={msg.t_spool_tracker_backup_title()}
		lead={msg.t_spool_tracker_backup_lead()}
	>
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="btn-ghost btn-s"
				disabled={!book.spools.length}
				onclick={printLabels}
			>
				<Printer size={14} aria-hidden="true" />
				{msg.t_spool_tracker_print_labels()}
			</button>
			<button
				type="button"
				class="btn-ghost btn-s"
				disabled={!book.spools.length}
				onclick={exportJson}
			>
				<Download size={14} aria-hidden="true" />
				{msg.t_spool_tracker_download_json()}
			</button>
			<button type="button" class="btn-ghost btn-s" onclick={() => fileInput?.click()}>
				<Upload size={14} aria-hidden="true" />
				{msg.t_spool_tracker_restore_json()}
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".json,application/json"
				class="sr-only"
				tabindex="-1"
				aria-hidden="true"
				onchange={(e) => {
					void importJson(e.currentTarget.files?.[0]);
					e.currentTarget.value = '';
				}}
			/>
		</div>
	</Collapsible>
</ToolPage>

{#if printing}
	<div class="label-sheet" aria-hidden="true">
		{#each book.spools as s (s.id)}
			<img src={labelSrc(s)} alt="" width="189" height="113" />
		{/each}
	</div>
{/if}

<Dialog
	bind:open={editOpen}
	title={editingId ? msg.t_spool_tracker_edit_title() : msg.t_spool_tracker_new_title()}
	size="md"
>
	<form id="spool-edit" class="space-y-4" onsubmit={submitWith(saveSpool)}>
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label for="spool-material" class="label">{tc.tc_plastic()}</label>
				<select id="spool-material" class="input" bind:value={draft.material}>
					{#each materials as m (m)}<option value={m}>{m}</option>{/each}
				</select>
			</div>
			<div class="flex items-end gap-3">
				<div class="min-w-0 flex-1">
					<TextField
						label={msg.t_spool_tracker_color_name()}
						bind:value={draft.colorName}
						maxlength={40}
						placeholder={msg.t_spool_tracker_color_name_placeholder()}
					/>
				</div>
				<label class="swatch" style:background-color={draft.color}>
					<input
						type="color"
						bind:value={draft.color}
						aria-label={msg.t_spool_tracker_color_sample()}
					/>
				</label>
			</div>
			<TextField
				label={msg.t_spool_tracker_brand()}
				bind:value={draft.brand}
				placeholder={msg.t_spool_tracker_brand_placeholder()}
			/>
			<TextField
				label={msg.t_spool_tracker_location()}
				bind:value={draft.location}
				placeholder={msg.t_spool_tracker_location_placeholder()}
			/>
			<NumberInput
				label={msg.t_spool_tracker_net_weight()}
				unit={tc.tc_unit_g()}
				bind:value={draft.netWeight}
				max={100000}
				digits={0}
				hint={msg.t_spool_tracker_net_weight_hint()}
			/>
			<NumberInput
				label={msg.t_spool_tracker_price()}
				unit={money.symbol}
				bind:value={draft.price}
			/>
			{#if !editingId}
				<NumberInput
					label={msg.t_spool_tracker_now_on_spool()}
					unit={tc.tc_unit_g()}
					bind:value={draft.initial}
					max={100000}
					digits={0}
					hint={msg.t_spool_tracker_initial_hint()}
				/>
			{/if}
		</div>
		<div>
			<label for="spool-notes" class="label">{msg.t_spool_tracker_notes()}</label>
			<textarea id="spool-notes" class="input" maxlength="500" bind:value={draft.notes}></textarea>
		</div>
		{#if editingId}
			<button
				type="button"
				class="btn-ghost btn-s text-red-300"
				onclick={() => {
					editOpen = false;
					deleteOpen = true;
				}}
			>
				<Trash2 size={14} aria-hidden="true" />
				{msg.t_spool_tracker_delete_spool()}
			</button>
		{/if}
	</form>
	{#snippet footer()}
		<button type="button" class="btn-ghost" onclick={() => (editOpen = false)}
			>{common.common_cancel()}</button
		>
		<button type="submit" form="spool-edit" class="btn-primary">
			{editingId ? msg.t_spool_tracker_save_spool() : msg.t_spool_tracker_add_spool()}
		</button>
	{/snippet}
</Dialog>

<Dialog
	bind:open={moveOpen}
	title={moveSpool ? spoolName(moveSpool) : msg.t_spool_tracker_spool()}
	size="sm"
>
	{#if moveSpool}
		<form id="spool-move" class="space-y-4" onsubmit={submitWith(saveMove)}>
			<p class="text-sm tabular-nums text-neutral-300">
				{moveLeft !== moveFree
					? msg.t_spool_tracker_move_left_free({
							left: grams(Math.max(0, moveLeft)),
							free: grams(Math.max(0, moveFree))
						})
					: msg.t_spool_tracker_move_left({ left: grams(Math.max(0, moveLeft)) })}
			</p>
			<Tabs
				id="spool-move"
				items={ACTIONS}
				bind:value={action}
				label={msg.t_spool_tracker_action()}
				panelId="spool-move-panel"
			/>
			<div
				id="spool-move-panel"
				role="tabpanel"
				aria-labelledby="spool-move-tab-{action}"
				class="space-y-4"
			>
				<NumberInput
					label={action === 'adjust'
						? msg.t_spool_tracker_now_on_spool()
						: msg.t_spool_tracker_amount()}
					unit={tc.tc_unit_g()}
					bind:value={amount}
					digits={1}
					max={100000}
					hint={action === 'adjust'
						? msg.t_spool_tracker_adjust_hint()
						: action === 'reserve'
							? msg.t_spool_tracker_reserve_hint()
							: undefined}
				/>
				<TextField
					label={msg.t_spool_tracker_note()}
					bind:value={note}
					maxlength={200}
					placeholder={msg.t_spool_tracker_note_placeholder()}
				/>
				{#if (action === 'use' || action === 'reserve') && amount > moveFree}
					<div class="notice notice-warning" role="status">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>
							{msg.t_spool_tracker_overdraw_warning({ grams: grams(Math.max(0, moveFree)) })}
						</p>
					</div>
				{/if}
				{#if action === 'use' && amount > 0 && moveSpool.price}
					<p class="text-xs tabular-nums text-neutral-400">
						{msg.t_spool_tracker_move_cost({ cost: rub(amount * pricePerGram(moveSpool)) })}
					</p>
				{/if}
			</div>
		</form>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn-ghost" onclick={() => (moveOpen = false)}
			>{common.common_cancel()}</button
		>
		<button
			type="submit"
			form="spool-move"
			class="btn-primary"
			disabled={action !== 'adjust' && !(amount > 0)}
		>
			{confirmLabel}
		</button>
	{/snippet}
</Dialog>

<ConfirmDialog
	bind:open={deleteOpen}
	title={msg.t_spool_tracker_delete_title()}
	description={msg.t_spool_tracker_delete_text()}
	confirmLabel={msg.t_spool_tracker_delete_spool()}
	variant="danger"
	onConfirm={removeSpool}
/>

<ConfirmDialog
	bind:open={importOpen}
	title={msg.t_spool_tracker_restore_title()}
	description={msg.t_spool_tracker_restore_text({ count: num(pending?.spools.length ?? 0, 0) })}
	confirmLabel={msg.t_spool_tracker_restore_confirm()}
	onConfirm={applyImport}
/>

<style>
	/* Print material (DESIGN_CODE §9): the sheet alone goes to the printer. */
	.label-sheet {
		display: none;
	}
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		.label-sheet,
		.label-sheet * {
			visibility: visible;
		}
		.label-sheet {
			position: absolute;
			inset: 0 auto auto 0;
			display: flex;
			flex-wrap: wrap;
			gap: 3mm;
		}
		.label-sheet img {
			width: 50mm;
			height: 30mm;
			break-inside: avoid;
		}
	}
	/* Colour sample (DESIGN_CODE §7.5): a square with a hairline, so white
	   shows on white; in the list it is the row's 40px thumbnail. */
	.swatch-thumb,
	.swatch {
		flex: none;
		width: 40px;
		height: 40px;
		border: 1px solid var(--pz-color-border);
		border-radius: var(--pz-radius-sm);
	}
	.swatch {
		position: relative;
		width: 42px;
		height: 42px;
		cursor: pointer;
	}
	.swatch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.swatch:has(input:focus-visible) {
		outline: 2px solid var(--pz-color-focus);
		outline-offset: 2px;
	}
	/* Same height as the .input next to it. */
	@media (pointer: coarse) {
		.swatch {
			width: 44px;
			height: 44px;
		}
	}
</style>
