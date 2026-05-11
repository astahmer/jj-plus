import { For, Show } from 'solid-js';
import type { TimelinePreset } from '../types.ts';
import { useTimelineContext } from '../timeline-context.tsx';

const presetLabels: Record<TimelinePreset, string> = {
	year: 'This year',
	'7d': 'Last 7D',
	'30d': '30D',
	'90d': '90D',
	all: 'All',
};

export function TimelineControls() {
	const { state, actions } = useTimelineContext();

	return (
		<div class="control-row">
			<div class="segmented" id="comparisonModes">
				<button
					class={`segment${state.comparisonMode() === 'range' ? ' active' : ''}`}
					type="button"
					aria-pressed={state.comparisonMode() === 'range'}
					onClick={() => actions.setComparisonMode('range')}
				>
					Range
				</button>
				<button
					class={`segment${state.comparisonMode() === 'step' ? ' active' : ''}`}
					type="button"
					aria-pressed={state.comparisonMode() === 'step'}
					onClick={() => actions.setComparisonMode('step')}
				>
					Single
				</button>
			</div>
			<Show when={state.backend() === 'jj'}>
				<div class="segmented" id="comparisonSources">
					<button
						class={`segment${state.comparisonSource() === 'revision' ? ' active' : ''}`}
						type="button"
						aria-pressed={state.comparisonSource() === 'revision'}
						onClick={() => actions.setComparisonSource('revision')}
					>
						Revision
					</button>
					<button
						class={`segment${state.comparisonSource() === 'snapshot' ? ' active' : ''}`}
						type="button"
						aria-pressed={state.comparisonSource() === 'snapshot'}
						onClick={() => actions.setComparisonSource('snapshot')}
					>
						Snapshot
					</button>
				</div>
			</Show>
			<div class="segmented" id="layoutModes">
				<button
					class={`segment${state.layoutMode() === 'split' ? ' active' : ''}`}
					type="button"
					aria-pressed={state.layoutMode() === 'split'}
					onClick={() => actions.setLayoutMode('split')}
				>
					Split
				</button>
				<button
					class={`segment${state.layoutMode() === 'unified' ? ' active' : ''}`}
					type="button"
					aria-pressed={state.layoutMode() === 'unified'}
					onClick={() => actions.setLayoutMode('unified')}
				>
					Unified
				</button>
			</div>
			<div class="segmented" id="contentModes">
				<button
					class={`segment${state.contentMode() === 'diffs' ? ' active' : ''}`}
					type="button"
					aria-pressed={state.contentMode() === 'diffs'}
					onClick={() => actions.setContentMode('diffs')}
				>
					Diffs
				</button>
				<button
					class={`segment${state.contentMode() === 'full' ? ' active' : ''}`}
					type="button"
					aria-pressed={state.contentMode() === 'full'}
					onClick={() => actions.setContentMode('full')}
				>
					Whole file
				</button>
			</div>
			<button
				class={`toggle-chip${state.showIntermediateRevisions() ? ' active' : ''}`}
				id="intermediateToggle"
				type="button"
				aria-label={state.showIntermediateRevisions() ? 'Hide In-Between' : 'Show In-Between'}
				disabled={!state.hasIntermediateRevisions()}
				onClick={actions.toggleIntermediateRevisions}
			>
				{state.intermediateLabel()}
			</button>
			<div class="segmented" id="presets">
				<For each={['year', '7d', '30d', '90d', 'all'] as TimelinePreset[]}>
					{(value) => (
						<button
							class={`segment${state.preset() === value ? ' active' : ''}`}
							type="button"
							aria-pressed={state.preset() === value}
							onClick={() => actions.setPreset(value)}
						>
							{presetLabels[value]}
						</button>
					)}
				</For>
			</div>
		</div>
	);
}
