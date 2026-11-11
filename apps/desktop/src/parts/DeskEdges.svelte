<script lang="ts">
	/**
	 * The two borders of CAD's and OpenSCAD's desk that the person drags: the code's right edge and the side
	 * panel's left one, as the menu and the assistant have theirs. The desk lays its columns out from the same
	 * widths (`fitted`); in a window too narrow for three columns the desk stacks them and these step aside.
	 */
	import { t } from '../lib/i18n.svelte';
	import { CODE_NARROWEST, fitted, pulled, SCENE_NARROWEST, SIDE_NARROWEST, type Panes } from '../lib/menu';
	import { app, setPanes } from '../lib/state.svelte';
	import Edge from './Edge.svelte';

	let { desk, room, top, side }: { desk: 'cad' | 'openscad'; room: number; top: number; side: boolean } = $props();

	const now = $derived(fitted(room, app.panes[desk], side));
	/** What the hand asks for, as far as it goes (`pulled`): the stored width is the one shown */
	const pull = (asked: Partial<Panes>) => (app.panes[desk] = pulled(room, now, asked, side));
	const settle = () => setPanes(desk, $state.snapshot(app.panes[desk]));
</script>

<span class="edges">
	<Edge
		label={t('desk.codeWidth')}
		value={now.code}
		min={CODE_NARROWEST}
		max={Math.max(CODE_NARROWEST, room - SCENE_NARROWEST - now.side)}
		place="left: {now.code - 8}px; top: {top}px"
		onchange={(code) => pull({ code })}
		onsettle={settle}
		onstep={(by) => (pull({ code: now.code + by }), settle())}
	/>
	{#if side}
		<Edge
			label={t('desk.sideWidth')}
			value={now.side}
			min={SIDE_NARROWEST}
			max={Math.max(SIDE_NARROWEST, room - SCENE_NARROWEST - now.code)}
			grow={-1}
			place="right: {now.side - 8}px; top: {top}px"
			onchange={(width) => pull({ side: width })}
			onsettle={settle}
			onstep={(by) => (pull({ side: now.side + by }), settle())}
		/>
	{/if}
</span>

<style>
	.edges {
		display: contents;
	}

	/* the desk's own rule stacks its columns there, and a column under another has no border to drag */
	@container (max-width: 860px) {
		.edges {
			display: none;
		}
	}
</style>
