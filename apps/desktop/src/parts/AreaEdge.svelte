<script lang="ts">
	/**
	 * The border of a page's side area that the person drags, or moves with the arrows: Models' list, the
	 * result's panel, a tool's settings. The page lays itself out from the same width (`areaWidth`), and puts
	 * this in its own box, which stands `position: relative`; where the page stacks its parts, it hides this.
	 */
	import { t } from '../lib/i18n.svelte';
	import { AREAS, areaWidth, MAIN_NARROWEST, type Area } from '../lib/menu';
	import { app, setArea } from '../lib/state.svelte';
	import Edge from './Edge.svelte';

	let { area, room, at = 'left' }: { area: Area; room: number; at?: 'left' | 'right' } = $props();

	const LABEL = { models: 'area.models', result: 'desk.sideWidth', tool: 'area.tool' } as const;
	const width = $derived(areaWidth(area, room, app.areas[area]));
	const pull = (asked: number) => (app.areas[area] = areaWidth(area, room, asked));
	const settle = () => setArea(area, app.areas[area]);
</script>

<Edge
	label={t(LABEL[area])}
	value={width}
	min={AREAS[area].narrowest}
	max={Math.max(AREAS[area].narrowest, Math.min(AREAS[area].widest, room - MAIN_NARROWEST))}
	grow={at === 'left' ? 1 : -1}
	place="{at}: {width - 8}px"
	onchange={pull}
	onsettle={settle}
	onstep={(by) => (pull(width + by), settle())}
/>
