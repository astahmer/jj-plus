import { html, type Html } from 'foldkit/html';
import { getEntryTimelineMarkers } from '../domain/timeline-markers.ts';
import type { Message } from '../messages.ts';
import {
	ClickedEvologEntry,
	ClickedFileOpLogEntry,
	ClickedHistoryEntry,
	ClickedOpenRevisionFilesDiff,
	ClickedOpenRevisionRemote,
	ClickedOpenSelectionDiffs,
	HoveredEntry,
	ToggledSortOrder,
	UnhoveredEntry,
	UpdatedSidebarSearchQuery,
} from '../messages.ts';
import type { Model } from '../model.ts';
import {
	getBackend,
	getFilteredSidebarEntries,
	getEntryDiffCount,
	getEvologStripEntries,
	getPendingSelectionIndex,
	getPreviewForEntry,
	getSelectionDiffCount,
	getVisibleEntries,
} from '../selectors.ts';
import { getRevisionIdentifierValue, revisionIdentifier } from './revision-identifier.ts';
import type { FileRevisionEntry } from '../types.ts';
import { Option } from 'effect';

function formatDiffActionLabel(label: string, diffCount: number | null): string {
	return diffCount === null ? label : `${label} (${diffCount})`;
}

function renderEntry(model: Model, entry: FileRevisionEntry): Html {
	const h = html<Message>();
	const pendingIndex = getPendingSelectionIndex(model);
	const hoveredIndex = model.maybeHoveredSelectionIndex._tag === 'Some' ? model.maybeHoveredSelectionIndex.value : null;
	const showCommittedSelection = pendingIndex === null;
	const isFrom = showCommittedSelection && entry.index === model.fromIndex;
	const isTo = showCommittedSelection && entry.index === model.toIndex;
	const inRange =
		showCommittedSelection &&
		entry.index >= Math.min(model.fromIndex, model.toIndex) &&
		entry.index <= Math.max(model.fromIndex, model.toIndex);
	const isPendingAnchor = pendingIndex === entry.index;
	const inPendingRange =
		pendingIndex !== null &&
		hoveredIndex !== null &&
		entry.index >= Math.min(pendingIndex, hoveredIndex) &&
		entry.index <= Math.max(pendingIndex, hoveredIndex);

	const markers = getEntryTimelineMarkers(entry).filter(
		(marker) => !(model.comparisonSource === 'snapshot' && marker.kind === 'operation'),
	);
	const isIntroduced = !entry.isWorkingTree && !entry.hasPreviousEntry;
	const preview = getPreviewForEntry(model, entry.index);
	const rowDiffCount = getEntryDiffCount(model, entry.index);
	const showOperationPrimary = model.comparisonSource === 'snapshot' && Boolean(entry.operationId);

	const classes = [
		'history-item',
		!entry.touchesFile ? 'is-intermediate' : '',
		inRange ? 'in-range' : '',
		isPendingAnchor ? 'pending-anchor' : '',
		inPendingRange ? 'pending-range' : '',
		isFrom ? 'is-from' : '',
		isTo ? 'is-to' : '',
	]
		.filter(Boolean)
		.join(' ');

	return h.keyed('article')(
		`${entry.index}:${entry.id}`,
		[
			h.Class(classes),
			h.DataAttribute('entry-index', String(entry.index)),
			h.Tabindex(0),
			h.OnClick(ClickedHistoryEntry({ entryIndex: entry.index })),
			h.OnMouseEnter(HoveredEntry({ entryIndex: entry.index })),
			h.OnMouseLeave(UnhoveredEntry()),
			h.OnFocus(HoveredEntry({ entryIndex: entry.index })),
			h.OnBlur(UnhoveredEntry()),
		],
		[
			h.div(
				[h.Class('history-top')],
				[
					h.div(
						[h.Class('history-primary')],
						[
							h.div(
								[h.Class('history-identity')],
								[
									h.button(
										[h.Class('history-id-button'), h.Type('button')],
										[
											showOperationPrimary
												? h.span(
														[h.Class('identifier')],
														[h.span([h.Class('identifier-plain')], [entry.operationId || ''])],
													)
												: revisionIdentifier<Message>(
														getRevisionIdentifierValue(entry),
														entry.changeId,
														entry.isWorkingTree,
													),
										],
									),
								],
							),
							!entry.touchesFile ? h.span([h.Class('mini-badge other')], ['OTHER']) : h.empty,
							markers.length
								? h.div(
										[h.Class('timeline-marker-list history-markers')],
										markers.map((marker) =>
											h.span(
												[h.Class(`timeline-marker timeline-marker--${marker.kind}`), h.Title(marker.title)],
												[h.span([h.Class('timeline-marker-label')], [marker.label])],
											),
										),
									)
								: h.empty,
						],
					),
					h.div(
						[h.Class('history-actions')],
						[
							h.span([h.Class('history-date-trigger')], [entry.shortDate || '']),
							entry.remoteUrl
								? h.button(
										[
											h.Class('history-action history-action-remote'),
											h.Type('button'),
											h.OnClick(ClickedOpenRevisionRemote({ entryIndex: entry.index })),
										],
										['Remote'],
									)
								: h.empty,
							entry.hasPreviousEntry
								? h.button(
										[
											h.Class('history-action history-action-diff'),
											h.Type('button'),
											h.OnClick(ClickedOpenRevisionFilesDiff({ entryIndex: entry.index })),
										],
										[formatDiffActionLabel('Open multi-file diffs', rowDiffCount)],
									)
								: h.empty,
						],
					),
				],
			),
			h.div([h.Class('history-description')], [entry.description]),
			h.div(
				[h.Class('history-bottom')],
				[
					h.span(
						[h.Class('history-meta')],
						[
							isIntroduced
								? h.span(
										[h.Class('mini-badge introduced'), h.Title('First revision touching this file')],
										['INTRODUCED'],
									)
								: h.empty,
							h.span([h.Class('history-meta-timestamp')], [entry.relativeDate || '']),
							entry.authorName ? h.span([], [` · ${entry.authorName}`]) : h.empty,
						],
					),
					h.span(
						[h.Class('history-stats')],
						preview
							? preview.hasChanges
								? [
										h.span([h.Class('stat stat--plus')], [`+${preview.additions}`]),
										h.span([h.Class('stat stat--minus')], [`-${preview.deletions}`]),
									]
								: [h.span([h.Class('stat')], ['No text'])]
							: [],
					),
				],
			),
		],
	);
}

export function sidebar(model: Model): Html {
	const h = html<Message>();
	const sidebarEntries = getFilteredSidebarEntries(model);
	const visibleCount = getVisibleEntries(model).length;
	const selectionDiffCount = getSelectionDiffCount(model);
	const query = model.sidebarSearchQuery.trim();

	return h.aside(
		[h.Class('panel sidebar'), h.Id('sidebar')],
		[
			h.div(
				[h.Class('sidebar-head')],
				[
					h.div(
						[h.Class('sidebar-head-main')],
						[
							h.div([h.Class('eyebrow')], ['Revisions']),
							h.div([h.Class('sidebar-hint'), h.Id('sidebarHint')], [`${visibleCount} visible`]),
						],
					),
					h.div(
						[h.Class('sidebar-head-actions')],
						[
							h.button(
								[
									h.Class('sidebar-icon-button'),
									h.Id('toggleSidebarOrderButton'),
									h.Type('button'),
									h.AriaLabel(model.oldestFirst ? 'Show newest revisions first' : 'Show oldest revisions first'),
									h.OnClick(ToggledSortOrder()),
								],
								[model.oldestFirst ? '↓' : '↑'],
							),
							h.button(
								[
									h.Class('sidebar-head-action'),
									h.Id('openSidebarRangeDiffButton'),
									h.Type('button'),
									h.OnClick(ClickedOpenSelectionDiffs()),
								],
								[formatDiffActionLabel('Open selection diffs', selectionDiffCount)],
							),
						],
					),
				],
			),
			h.div(
				[h.Class('sidebar-search-wrap')],
				[
					h.input([
						h.Class('sidebar-search-input'),
						h.Id('sidebarSearchInput'),
						h.Type('search'),
						h.Placeholder('Search: author:alex OR content:TODO AND path:src'),
						h.Autocomplete('off'),
						h.Value(model.sidebarSearchQuery),
						h.OnInput((value) => UpdatedSidebarSearchQuery({ value })),
					]),
				],
			),
			(() => {
				const evolog = getEvologStripEntries(model);
				if (evolog.length <= 1) {
					return h.empty;
				}
				return h.div(
					[h.Class('evolog-strip'), h.Id('evologStrip')],
					[
						h.div([h.Class('eyebrow')], ['Evolution']),
						h.div(
							[h.Class('evolog-strip-list')],
							evolog.map((entry) =>
								h.button(
									[
										h.Class(
											`evolog-strip-item${entry.index === model.toIndex && model.comparisonSource === 'snapshot' ? ' is-active' : ''}`,
										),
										h.Type('button'),
										h.Title(entry.description || entry.shortRevision),
										h.OnClick(ClickedEvologEntry({ entryIndex: entry.index })),
									],
									[entry.shortRevision],
								),
							),
						),
					],
				);
			})(),
			(() => {
				const ops = Array.isArray(model.fileOpLogEntries)
					? (model.fileOpLogEntries as Array<{
							operationId: string;
							description: string;
							entryIndex?: number;
						}>)
					: [];
				if (getBackend(model) !== 'jj' || ops.length === 0) {
					return h.empty;
				}
				return h.div(
					[h.Class('evolog-strip oplog-strip'), h.Id('fileOpLogStrip')],
					[
						h.div([h.Class('eyebrow')], ['Op log']),
						h.div(
							[h.Class('evolog-strip-list')],
							ops.map((entry) =>
								h.button(
									[
										h.Class('evolog-strip-item'),
										h.Type('button'),
										h.Title(entry.description),
										h.OnClick(ClickedFileOpLogEntry({ operationId: entry.operationId })),
									],
									[entry.operationId.slice(0, 8)],
								),
							),
						),
					],
				);
			})(),
			h.div(
				[h.Class('history-list'), h.Id('historyList')],
				sidebarEntries.length === 0
					? [
							h.div(
								[h.Class('empty')],
								[query ? 'No revisions match the current search.' : 'No revisions in the current filter.'],
							),
						]
					: sidebarEntries.map((entry) => renderEntry(model, entry)),
			),
		],
	);
}

// Silence unused imports when helpers are elided.
export const _unusedOption = Option;
