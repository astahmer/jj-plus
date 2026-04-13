import { For } from 'solid-js';
import type { FileRevisionEntry } from '../types.ts';
import { getTimelineAnchorPercent } from '../timeline-model.ts';
import { useTimelineContext } from '../timeline-context.tsx';

export function TimelineTrack() {
	const { state, actions } = useTimelineContext();
	const fromPercent = () =>
		getTimelineAnchorPercent(
			state.visibleEntries(),
			state.visibleEntries().findIndex((entry) => entry.index === state.fromIndex()),
		);
	const toPercent = () =>
		getTimelineAnchorPercent(
			state.visibleEntries(),
			state.visibleEntries().findIndex((entry) => entry.index === state.toIndex()),
		);

	return (
		<div class="timeline-row">
			<button
				class="step-button"
				id="stepFastBackwardButton"
				type="button"
				aria-label="Jump backward"
				disabled={!state.canStepBackward()}
				onClick={() => actions.stepSelection(-5)}
			>
				«
			</button>
			<button
				class="step-button"
				id="stepBackwardButton"
				type="button"
				aria-label="Previous range"
				disabled={!state.canStepBackward()}
				onClick={() => actions.stepSelection(-1)}
			>
				‹
			</button>
			<div class="timeline">
				<div class="selection-meta" id="selectionMeta">
					{state.selectionMeta()}
				</div>
				<div class="track" id="track">
					<For each={state.visibleEntries()}>
						{(entry, index) => {
							const percent = () => getTimelineAnchorPercent(state.visibleEntries(), index());
							const showCommittedSelection = () => state.pendingSelectionIndex() === null;
							const isFrom = () => showCommittedSelection() && entry.index === state.fromIndex();
							const isTo = () => showCommittedSelection() && entry.index === state.toIndex();
							const inRange = () =>
								showCommittedSelection() &&
								entry.index >= Math.min(state.fromIndex(), state.toIndex()) &&
								entry.index <= Math.max(state.fromIndex(), state.toIndex());
							const inPendingRange = () => {
								const pendingIndex = state.pendingSelectionIndex();
								const hoveredIndex = state.hoveredSelectionIndex();
								if (pendingIndex === null || hoveredIndex === null) {
									return false;
								}

								return (
									entry.index >= Math.min(pendingIndex, hoveredIndex) &&
									entry.index <= Math.max(pendingIndex, hoveredIndex)
								);
							};

							return (
								<button
									class={`track-anchor${inRange() ? ' in-range' : ''}${inPendingRange() ? ' pending-range' : ''}${isFrom() ? ' is-from' : ''}${isTo() ? ' is-to' : ''}${!entry.touchesFile ? ' is-intermediate' : ''}`}
									style={{ left: `${percent()}%` }}
									data-entry-index={entry.index}
									type="button"
									onClick={() => actions.selectEntry(entry.index)}
									onMouseEnter={(event) => {
										actions.hoverEntry(entry.index);
										actions.showAnchorTooltip(entry.index, event.currentTarget);
									}}
									onMouseLeave={() => {
										actions.hoverEntry(null);
										actions.hideRangeTooltip();
									}}
									onFocus={(event) => {
										actions.hoverEntry(entry.index);
										actions.showAnchorTooltip(entry.index, event.currentTarget);
									}}
									onBlur={() => {
										actions.hoverEntry(null);
										actions.hideRangeTooltip();
									}}
								/>
							);
						}}
					</For>
				</div>
				<div
					class="range-fill"
					id="rangeFill"
					style={{ left: `${fromPercent()}%`, width: `${Math.max(0, toPercent() - fromPercent())}%` }}
				/>
				<button
					class="handle-marker from"
					id="fromMarker"
					type="button"
					aria-label="Adjust from revision"
					style={{ left: `${fromPercent()}%` }}
				/>
				<button
					class="handle-marker to"
					id="toMarker"
					type="button"
					aria-label="Adjust to revision"
					style={{ left: `${toPercent()}%` }}
				/>
				<div class="month-row">
					<For each={groupMonthLabels(state.visibleEntries())}>{(label) => <div>{label}</div>}</For>
				</div>
			</div>
			<button
				class="step-button"
				id="stepForwardButton"
				type="button"
				aria-label="Next range"
				disabled={!state.canStepForward()}
				onClick={() => actions.stepSelection(1)}
			>
				›
			</button>
			<button
				class="step-button"
				id="stepFastForwardButton"
				type="button"
				aria-label="Jump forward"
				disabled={!state.canStepForward()}
				onClick={() => actions.stepSelection(5)}
			>
				»
			</button>
		</div>
	);
}

function groupMonthLabels(entries: FileRevisionEntry[]): string[] {
	const labels = new Set<string>();
	entries.forEach((entry) => {
		labels.add(formatMonthLabel(entry.authorDate, entry.monthLabel));
	});

	return [...labels].slice(-4);
}

function formatMonthLabel(authorDate: string, fallbackLabel?: string) {
	const date = new Date(authorDate);
	if (Number.isNaN(date.getTime())) {
		return fallbackLabel || 'Unknown month';
	}

	return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);
}
