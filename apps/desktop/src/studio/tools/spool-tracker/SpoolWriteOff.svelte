<script lang="ts">
	/**
	 * Write a print's filament off a spool of «Учёт катушек», or hold it while
	 * the print runs. Used by the G-code viewer and the calculator; the book is
	 * this browser's.
	 */
	import { onMount } from 'svelte';
	import { TriangleAlert } from 'lucide-svelte';
	import { singleClick } from '$lib/forms';
	import { showToast } from '$lib/toast';
	import NumberInput from '../print-kit/NumberInput.svelte';
	import { grams as g } from '../print-kit/format';
	import {
		available,
		loadBook,
		reserve,
		spoolName,
		writeOff,
		type MovementSource,
		type SpoolBook
	} from './model';
	import { bookTooBig, saveAndSync, syncBook } from './sync';
	import Rich from '$lib/components/Rich.svelte';
	import { slots } from '$lib/i18n/rich';
	import * as tc from '$msg/tools/common';
	import * as msg from '$msg/tools/spool-tracker';

	let {
		grams,
		note = '',
		source = 'manual',
		preferred = null
	}: {
		grams: number;
		note?: string;
		source?: MovementSource;
		/** The spool to offer first, e.g. the one loaded in the chosen printer. */
		preferred?: string | null;
	} = $props();

	const TRACKER = '/workspace/tools/spool-tracker';
	const id = $props.id();
	let book = $state.raw<SpoolBook | null>(null);
	let spoolId = $state('');
	/** The account refuses a book this large: what is written here stays in this browser. */
	let tooBig = $state(false);
	// A new file brings a new weight; the field can still be edited.
	let amount = $derived(Math.round(grams * 10) / 10);

	onMount(() => {
		book = loadBook();
		const first = preferred && book.spools.some((s) => s.id === preferred) ? preferred : null;
		spoolId = first ?? book.spools[0]?.id ?? '';
		// Spools added on another device show up once the account's copy is in.
		void syncBook().then((synced) => {
			book = synced;
			tooBig = bookTooBig();
			if (!synced.spools.some((s) => s.id === spoolId)) spoolId = synced.spools[0]?.id ?? '';
		});
	});

	const left = $derived(book && spoolId ? available(book, spoolId) : 0);
	const spool = $derived(book?.spools.find((s) => s.id === spoolId) ?? null);

	function act(kind: 'use' | 'reserve') {
		if (!book || !spool) return;
		try {
			book =
				kind === 'use'
					? writeOff(book, spool.id, amount, note, source)
					: reserve(book, spool.id, amount, note);
			void saveAndSync(book).then((synced) => {
				book = synced;
				tooBig = bookTooBig();
			});
			showToast(
				kind === 'use'
					? msg.t_spool_tracker_writeoff_used_toast({ grams: g(amount), spool: spoolName(spool) })
					: msg.t_spool_tracker_writeoff_reserved_toast({
							grams: g(amount),
							spool: spoolName(spool)
						}),
				{ kind: 'success', action: { label: msg.t_spool_tracker_writeoff_open(), href: TRACKER } }
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e), { kind: 'error' });
		}
	}
</script>

{#if !book}
	<p class="text-sm text-neutral-400">{msg.t_spool_tracker_writeoff_loading()}</p>
{:else if !book.spools.length}
	<p class="text-sm text-neutral-400">
		<Rich text={msg.t_spool_tracker_writeoff_empty(slots('link'))}
			>{#snippet link()}<a href={TRACKER} class="underline hover:text-neutral-100"
					>{msg.t_spool_tracker_writeoff_empty_link()}</a
				>{/snippet}</Rich
		>
	</p>
{:else}
	<div>
		<label for="{id}-spool" class="label">{msg.t_spool_tracker_spool()}</label>
		<select id="{id}-spool" class="input" bind:value={spoolId}>
			{#each book.spools as s (s.id)}
				<option value={s.id}
					>{msg.t_spool_tracker_writeoff_option({
						spool: spoolName(s),
						grams: g(available(book, s.id))
					})}</option
				>
			{/each}
		</select>
	</div>
	<NumberInput
		label={msg.t_spool_tracker_amount()}
		unit={tc.tc_unit_g()}
		bind:value={amount}
		digits={1}
		max={100_000}
	/>
	{#if tooBig}
		<div class="notice notice-warning" role="status">
			<TriangleAlert size={16} aria-hidden="true" />
			<p>{msg.t_spool_tracker_account_full()}</p>
		</div>
	{/if}
	{#if amount > left}
		<div class="notice notice-warning" role="status">
			<TriangleAlert size={16} aria-hidden="true" />
			<p>{msg.t_spool_tracker_writeoff_overdraw({ grams: g(left) })}</p>
		</div>
	{/if}
	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			class="btn-ghost btn-s"
			disabled={!(amount > 0)}
			onclick={singleClick(() => act('use'))}
		>
			{msg.t_spool_tracker_confirm_use({ grams: g(amount) })}
		</button>
		<button
			type="button"
			class="btn-ghost btn-s"
			disabled={!(amount > 0)}
			onclick={singleClick(() => act('reserve'))}
		>
			{msg.t_spool_tracker_writeoff_reserve()}
		</button>
	</div>
	<p class="text-xs text-neutral-400">
		<Rich text={msg.t_spool_tracker_writeoff_note(slots('link'))}
			>{#snippet link()}<a href={TRACKER} class="underline hover:text-neutral-100"
					>{msg.t_spool_tracker_writeoff_note_link()}</a
				>{/snippet}</Rich
		>
	</p>
{/if}
