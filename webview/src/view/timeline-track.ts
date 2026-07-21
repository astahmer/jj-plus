import { Option } from 'effect';
import { html, type Html } from 'foldkit/html';
import { getTimelineAnchorPercent } from '../domain/timeline-model.ts';
import { churnFromDiffCount, normalizeTrackChurnBars } from '../domain/track-churn.ts';
import type { Message } from '../messages.ts';
import {
	ClickedStepBackward,
	ClickedStepFastBackward,
	ClickedStepFastForward,
	ClickedStepForward,
	ClickedTrackAnchor,
	HoveredEntry,
	PressedMarker,
	PressedRangeFill,
	PressedTrack,
	PressedTrackAnchor,
	UnhoveredEntry,
} from '../messages.ts';
import type { Model } from '../model.ts';
import { canStepBackward, canStepForward } from '../update.ts';
import { getEntryDiffCount, getPendingSelectionIndex, getSelectionMeta, getVisibleEntries } from '../selectors.ts';

export function timelineTrack(model: Model): Html {
	const h = html<Message>();
	const visible = getVisibleEntries(model);
	const pending = getPendingSelectionIndex(model);
	const hoveredIndex = model.maybeHoveredSelectionIndex._tag === 'Some' ? model.maybeHoveredSelectionIndex.value : null;
	const showCommittedSelection = pending === null;

	const fromVisibleIndex = visible.findIndex((entry) => entry.index === model.fromIndex);
	const toVisibleIndex = visible.findIndex((entry) => entry.index === model.toIndex);
	const fromPercent = getTimelineAnchorPercent(visible, fromVisibleIndex);
	const toPercent = getTimelineAnchorPercent(visible, toVisibleIndex);
	const churnBars = normalizeTrackChurnBars(
		visible.map((entry) => ({
			entryIndex: entry.index,
			churn: churnFromDiffCount(getEntryDiffCount(model, entry.index) ?? undefined),
		})),
	);
	const churnByIndex = new Map(churnBars.map((bar) => [bar.entryIndex, bar]));

	return h.div(
		[h.Class('timeline-row')],
		[
			h.button(
				[
					h.Class('step-button'),
					h.Id('stepFastBackwardButton'),
					h.Type('button'),
					h.AriaLabel('Jump backward'),
					h.Disabled(!canStepBackward(model)),
					h.OnClick(ClickedStepFastBackward()),
				],
				['«'],
			),
			h.button(
				[
					h.Class('step-button'),
					h.Id('stepBackwardButton'),
					h.Type('button'),
					h.AriaLabel('Previous range'),
					h.Disabled(!canStepBackward(model)),
					h.OnClick(ClickedStepBackward()),
				],
				['‹'],
			),
			h.div(
				[h.Class('timeline')],
				[
					h.div([h.Class('timeline-hover-axis')], []),
					h.div([h.Class('selection-meta'), h.Id('selectionMeta')], [getSelectionMeta(model)]),
					h.div(
						[
							h.Class('track'),
							h.Id('track'),
							h.OnPointerDown((_pointerType, button, _sx, _sy, _ts, clientX) =>
								Option.some(PressedTrack({ clientX, button })),
							),
						],
						visible.map((entry, index) => {
							const percent = getTimelineAnchorPercent(visible, index);
							const isFrom = showCommittedSelection && entry.index === model.fromIndex;
							const isTo = showCommittedSelection && entry.index === model.toIndex;
							const inRange =
								showCommittedSelection &&
								entry.index >= Math.min(model.fromIndex, model.toIndex) &&
								entry.index <= Math.max(model.fromIndex, model.toIndex);
							const inPendingRange =
								pending !== null &&
								hoveredIndex !== null &&
								entry.index >= Math.min(pending, hoveredIndex) &&
								entry.index <= Math.max(pending, hoveredIndex);
							const churn = churnByIndex.get(entry.index);
							const classes = [
								'track-anchor',
								inRange ? 'in-range' : '',
								inPendingRange ? 'pending-range' : '',
								isFrom ? 'is-from' : '',
								isTo ? 'is-to' : '',
								!entry.touchesFile ? 'is-intermediate' : '',
								churn && churn.churn > 0 ? 'has-churn' : '',
							]
								.filter(Boolean)
								.join(' ');
							const heightPx = 4 + Math.round((churn?.heightFactor ?? 0.2) * 14);
							return h.keyed('button')(
								`anchor-${entry.index}:${entry.id}`,
								[
									h.Class(classes),
									h.Style({
										left: `${percent}%`,
										height: `${heightPx}px`,
										width: `${Math.max(4, Math.round(heightPx / 2))}px`,
									}),
									h.DataAttribute('entry-index', String(entry.index)),
									h.DataAttribute('churn', String(churn?.churn ?? 0)),
									h.DataAttribute('churn-factor', String(churn?.heightFactor ?? 0.2)),
									h.Type('button'),
									h.OnClick(ClickedTrackAnchor({ entryIndex: entry.index })),
									h.OnPointerDown((_pointerType, button, _sx, _sy, _ts, clientX, clientY) =>
										Option.some(
											PressedTrackAnchor({
												entryIndex: entry.index,
												clientX,
												clientY,
												button,
											}),
										),
									),
									h.OnMouseEnter(HoveredEntry({ entryIndex: entry.index })),
									h.OnMouseLeave(UnhoveredEntry()),
								],
								[],
							);
						}),
					),
					h.div(
						[
							h.Class('range-fill'),
							h.Id('rangeFill'),
							h.Style({
								left: `${fromPercent}%`,
								width: `${Math.max(0, toPercent - fromPercent)}%`,
							}),
							h.OnPointerDown((_pointerType, button, _sx, _sy, _ts, clientX) =>
								Option.some(PressedRangeFill({ clientX, button })),
							),
						],
						[],
					),
					h.button(
						[
							h.Class('handle-marker from'),
							h.Id('fromMarker'),
							h.Type('button'),
							h.AriaLabel('Adjust from revision'),
							h.Style({ left: `${fromPercent}%` }),
							h.OnPointerDown((_pointerType, button, _sx, _sy, _ts, clientX) =>
								Option.some(PressedMarker({ side: 'from', clientX, button })),
							),
						],
						[],
					),
					h.button(
						[
							h.Class('handle-marker to'),
							h.Id('toMarker'),
							h.Type('button'),
							h.AriaLabel('Adjust to revision'),
							h.Style({ left: `${toPercent}%` }),
							h.OnPointerDown((_pointerType, button, _sx, _sy, _ts, clientX) =>
								Option.some(PressedMarker({ side: 'to', clientX, button })),
							),
						],
						[],
					),
				],
			),
			h.button(
				[
					h.Class('step-button'),
					h.Id('stepForwardButton'),
					h.Type('button'),
					h.AriaLabel('Next range'),
					h.Disabled(!canStepForward(model)),
					h.OnClick(ClickedStepForward()),
				],
				['›'],
			),
			h.button(
				[
					h.Class('step-button'),
					h.Id('stepFastForwardButton'),
					h.Type('button'),
					h.AriaLabel('Jump forward'),
					h.Disabled(!canStepForward(model)),
					h.OnClick(ClickedStepFastForward()),
				],
				['»'],
			),
		],
	);
}
