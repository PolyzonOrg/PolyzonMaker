<script lang="ts">
	/** Picture → outline settings, the same in every tool that traces images. */
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import type { TraceOptions } from './trace';
	import * as tc from '$msg/tools/common';

	let {
		value = $bindable(),
		minDetail = $bindable()
	}: {
		value: TraceOptions;
		/** mm */
		minDetail: number;
	} = $props();
</script>

<NumberField
	label={tc.tc_trace_threshold()}
	bind:value={value.threshold}
	min={1}
	max={254}
	hint={value.invert ? tc.tc_trace_threshold_light() : tc.tc_trace_threshold_dark()}
/>
<ToggleField
	label={tc.tc_trace_invert()}
	bind:checked={value.invert}
	hint={tc.tc_trace_invert_hint()}
/>
<NumberField
	label={tc.tc_trace_noise()}
	unit="px"
	bind:value={value.blur}
	min={0}
	max={5}
	step={0.5}
/>
<NumberField label={tc.tc_trace_smooth()} bind:value={value.smooth} min={0} max={3} step={0.5} />
<NumberField
	label={tc.tc_trace_min_detail()}
	unit="mm"
	bind:value={minDetail}
	min={0}
	max={5}
	step={0.1}
	hint={tc.tc_trace_min_detail_hint()}
/>
