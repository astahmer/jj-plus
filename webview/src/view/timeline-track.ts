import { html, type Html } from 'foldkit/html';
import { getTimelineAnchorPercent } from '../domain/timeline-model.ts';
import type { Message } from '../messages.ts';
import {
	ClickedStepBackward,
	ClickedStepFastBackward,
	ClickedStepFastForward,
	ClickedStepForward,
	ClickedTrackAnchor,
	HoveredEntry,
	UnhoveredEntry,
} from '../messages.ts';
import type { Model } from '../model.ts';
import { canStepBackward, canStepForward } from '../update.ts';
import { getPendingSelectionIndex, getVisibleEntries } from '../selectors.ts';
import { getSelectionMeta } from '../selectors.ts';

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
						[h.Class('track'), h.Id('track')],
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
							const classes = [
								'track-anchor',
								inRange ? 'in-range' : '',
								inPendingRange ? 'pending-range' : '',
								isFrom ? 'is-from' : '',
								isTo ? 'is-to' : '',
								!entry.touchesFile ? 'is-intermediate' : '',
							]
								.filter(Boolean)
								.join(' ');
							return h.keyed('button')(
								`anchor-${entry.id}`,
								[
									h.Class(classes),
									h.Style({ left: `${percent}%` }),
									h.DataAttribute('entry-index', String(entry.index)),
									h.Type('button'),
									h.OnClick(ClickedTrackAnchor({ entryIndex: entry.index })),
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
