import { Option } from 'effect';
import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import {
	ClickedToggleDiffFocus,
	PressedTimelineResize,
	SubmittedFileSwitcher,
	ToggledBlameOverlay,
	ToggledRangeStack,
} from '../messages.ts';
import type { Model } from '../model.ts';
import { shortcutTooltip } from '../domain/timeline-shortcuts.ts';
import {
	getCurrentFromEntry,
	getCurrentToEntry,
	getEffectiveComparisonSource,
	getPreview,
	getRangeStackItems,
} from '../selectors.ts';
import type { ComparisonMode, ComparisonSource, ContentMode, DiffPreview } from '../types.ts';
import { getRevisionIdentifierValue, revisionIdentifier } from './revision-identifier.ts';

const COMPARISON_MODE_LABELS: Record<ComparisonMode, string> = {
	range: 'Range',
	step: 'Single',
};

const COMPARISON_SOURCE_LABELS: Record<ComparisonSource, string> = {
	revision: 'Revision',
	snapshot: 'Snapshot',
};

const CONTENT_MODE_LABELS: Record<ContentMode, string> = {
	diffs: 'Diffs',
	full: 'Whole file',
};

function renderTitle(model: Model, preview: DiffPreview | null): Array<Html | string> {
	const from = getCurrentFromEntry(model);
	const to = getCurrentToEntry(model);
	if (!from || !to) {
		return ['No diff available'];
	}
	const source = preview?.comparisonSource || getEffectiveComparisonSource(model);
	const h = html<Message>();

	if (model.rangeStackOpen) {
		const count = getRangeStackItems(model).length;
		return [
			h.span([h.Class('diff-title-prefix')], ['Range stack']),
			h.span([h.Class('diff-title-meta')], [count ? `${count} file${count === 1 ? '' : 's'}` : 'Loading…']),
		];
	}

	if (source === 'snapshot') {
		return [
			h.span([h.Class('diff-title-prefix')], ['Snapshot']),
			revisionIdentifier<Message>(getRevisionIdentifierValue(from), from.changeId, from.isWorkingTree),
			h.span([h.Class('diff-title-arrow')], ['→']),
			revisionIdentifier<Message>(getRevisionIdentifierValue(to), to.changeId, to.isWorkingTree),
		];
	}

	if (!preview) {
		return ['Loading diff…'];
	}

	return [
		revisionIdentifier<Message>(getRevisionIdentifierValue(from), from.changeId, from.isWorkingTree),
		h.span([h.Class('diff-title-arrow')], ['→']),
		revisionIdentifier<Message>(getRevisionIdentifierValue(to), to.changeId, to.isWorkingTree),
	];
}

function shouldShowPierre(preview: DiffPreview | null, contentMode: ContentMode, rangeStackOpen: boolean): boolean {
	if (rangeStackOpen) {
		return true;
	}
	if (!preview) {
		return false;
	}
	if (typeof preview.beforeText !== 'string' || typeof preview.afterText !== 'string') {
		return false;
	}
	if (contentMode === 'full') {
		return true;
	}
	return preview.hasChanges;
}

function renderBodyOverlay(
	preview: DiffPreview | null,
	contentMode: ContentMode,
	showPierre: boolean,
	rangeStackOpen: boolean,
	stackCount: number,
): Html {
	const h = html<Message>();
	if (showPierre) {
		return h.empty;
	}
	if (rangeStackOpen && stackCount === 0) {
		return h.div(
			[h.Class('diff-body-overlay')],
			[
				h.div(
					[h.Class('diff-body-overlay-card')],
					[
						h.div([h.Class('diff-progress-track'), h.AriaHidden(true)], [h.div([h.Class('diff-progress-bar')], [])]),
						h.div([h.Class('empty-diff')], ['Loading range stack…']),
					],
				),
			],
		);
	}
	if (!preview) {
		return h.div(
			[h.Class('diff-body-overlay')],
			[
				h.div(
					[h.Class('diff-body-overlay-card')],
					[
						h.div([h.Class('diff-progress-track'), h.AriaHidden(true)], [h.div([h.Class('diff-progress-bar')], [])]),
						h.div([h.Class('empty-diff')], ['Loading diff…']),
					],
				),
			],
		);
	}
	if (contentMode === 'diffs' && !preview.hasChanges) {
		return h.div(
			[h.Class('diff-body-overlay')],
			[
				h.div(
					[h.Class('empty-diff')],
					[
						h.div([], ['No textual changes in this selection.']),
						preview.nonTextualDetails?.length
							? h.div(
									[h.Class('empty-diff-details')],
									preview.nonTextualDetails.map((detail) => h.div([], [detail])),
								)
							: h.empty,
					],
				),
			],
		);
	}
	if (typeof preview.beforeText !== 'string' || typeof preview.afterText !== 'string') {
		return h.div(
			[h.Class('diff-body-overlay')],
			[h.div([h.Class('empty-diff')], ['Diff content is unavailable for this selection.'])],
		);
	}
	return h.div(
		[h.Class('diff-body-overlay')],
		[h.div([h.Class('empty-diff')], ['The file has no content at this revision.'])],
	);
}

export function timelineResizeHandle(model: Model): Html {
	const h = html<Message>();
	return h.div(
		[
			h.Class(`timeline-resize-handle${model.dragState._tag === 'DragTimelineResize' ? ' is-dragging' : ''}`),
			h.Id('timelineResizeHandle'),
			h.OnPointerDown((_pointerType, button, _sx, _sy, _ts, _clientX, clientY) =>
				Option.some(PressedTimelineResize({ clientY, button })),
			),
		],
		[],
	);
}

export function diffPanel(model: Model): Html {
	const h = html<Message>();
	const preview = getPreview(model);
	const stackItems = getRangeStackItems(model);
	const source = preview?.comparisonSource || getEffectiveComparisonSource(model);
	const eyebrowLabel = `${model.layoutMode} · ${CONTENT_MODE_LABELS[model.contentMode]} · ${COMPARISON_MODE_LABELS[model.comparisonMode]} · ${COMPARISON_SOURCE_LABELS[source]}${model.rangeStackOpen ? ' · stack' : ''}`;
	const showPierre = shouldShowPierre(preview, model.contentMode, model.rangeStackOpen);

	return h.div(
		[h.Class(`diff-content${model.rangeStackOpen ? ' is-range-stack' : ''}`)],
		[
			h.div(
				[h.Class('diff-summary')],
				[
					h.div(
						[h.Class('diff-title-row')],
						[
							h.div(
								[h.Class('diff-summary-left')],
								[
									h.div(
										[h.Class('diff-title-block')],
										[
											h.h3([h.Class('diff-title'), h.Id('diffTitle')], renderTitle(model, preview)),
											h.div(
												[h.Class('diff-title-meta')],
												[model.rangeStackOpen ? 'Top changed files for current from→to' : preview?.subtitle || ''],
											),
										],
									),
									source === 'snapshot' && !model.rangeStackOpen
										? h.div([h.Class('diff-subtitle')], [getCurrentToEntry(model)?.description || ''])
										: h.empty,
									model.rangeStackOpen && stackItems.length
										? h.div(
												[h.Class('range-stack-toc'), h.AriaLabel('Files in range stack')],
												stackItems.map((item) =>
													h.button(
														[
															h.Class('range-stack-toc-chip'),
															h.Type('button'),
															h.Title(`Focus ${item.relativePath}`),
															h.OnClick(SubmittedFileSwitcher({ value: item.relativePath })),
														],
														[
															item.relativePath.split('/').at(-1) || item.relativePath,
															h.span([h.Class('stat')], [`+${item.preview.additions}/−${item.preview.deletions}`]),
														],
													),
												),
											)
										: h.empty,
								],
							),
							h.div(
								[h.Class('diff-actions')],
								[
									h.div([h.Class('eyebrow diff-mode-eyebrow'), h.Id('diffModeEyebrow')], [eyebrowLabel]),
									model.rangeStackOpen
										? h.button(
												[h.Class('collapse-button'), h.Type('button'), h.OnClick(ToggledRangeStack())],
												['Exit stack'],
											)
										: h.div(
												[h.Class('history-stats')],
												[
													h.span([h.Class('stat stat--plus')], [preview ? `+${preview.additions}` : '+—']),
													h.span([h.Class('stat stat--minus')], [preview ? `−${preview.deletions}` : '−—']),
													h.span([h.Class('stat')], [preview ? `${preview.hunkCount} hunks` : '— hunks']),
												],
											),
									!model.rangeStackOpen
										? h.button(
												[
													h.Class(`collapse-button${model.blameOverlayOpen ? ' is-active' : ''}`),
													h.Id('toggleBlameOverlayButton'),
													h.Type('button'),
													h.Title(
														model.blameOverlayOpen
															? 'Hide blame annotations on the after side'
															: 'Show blame annotations; click a line to jump the timeline',
													),
													h.AriaPressed(String(model.blameOverlayOpen)),
													h.OnClick(ToggledBlameOverlay()),
												],
												[
													model.blameLoading
														? 'Blame…'
														: model.blameOverlayOpen
															? Array.isArray(model.blameLines) && (model.blameLines as unknown[]).length
																? `Blame on (${(model.blameLines as unknown[]).length})`
																: 'Blame on'
															: 'Blame',
												],
											)
										: h.empty,
									h.button(
										[
											h.Class('collapse-button'),
											h.Id('toggleDiffFocusButton'),
											h.Type('button'),
											h.Title(shortcutTooltip(model.diffFocusMode ? 'exitDiffFocus' : 'toggleDiffFocus')),
											h.AriaLabel(shortcutTooltip(model.diffFocusMode ? 'exitDiffFocus' : 'toggleDiffFocus')),
											h.OnClick(ClickedToggleDiffFocus()),
										],
										[model.diffFocusMode ? 'Exit focus' : 'Focus diff'],
									),
								],
							),
						],
					),
				],
			),
			h.div(
				[
					h.Class('diff-rows'),
					h.Id('diffRows'),
					h.DataAttribute('layout-mode', model.layoutMode),
					h.DataAttribute('content-mode', model.contentMode),
					h.DataAttribute('range-stack', model.rangeStackOpen ? 'open' : 'closed'),
				],
				[
					// Geometry target only — Pierre mounts in a body-level portal so
					// foldkit re-renders cannot wipe the FileDiff DOM every frame.
					h.div([h.Class('pierre-diff-slot'), h.Id('pierre-diff-slot')], []),
					renderBodyOverlay(preview, model.contentMode, showPierre, model.rangeStackOpen, stackItems.length),
				],
			),
		],
	);
}
