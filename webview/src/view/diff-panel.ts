import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import { ClickedToggleDiffFocus } from '../messages.ts';
import type { Model } from '../model.ts';
import { getCurrentFromEntry, getCurrentToEntry, getEffectiveComparisonSource, getPreview } from '../selectors.ts';
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

function shouldShowPierre(preview: DiffPreview | null, contentMode: ContentMode): boolean {
	if (!preview) {
		return false;
	}
	if (contentMode === 'full') {
		return true;
	}
	return preview.hasChanges;
}

function renderBodyOverlay(preview: DiffPreview | null, contentMode: ContentMode, showPierre: boolean): Html {
	const h = html<Message>();
	if (showPierre) {
		return h.empty;
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
	return h.div(
		[h.Class('diff-body-overlay')],
		[h.div([h.Class('empty-diff')], ['The file has no content at this revision.'])],
	);
}

export function diffPanel(model: Model): Html {
	const h = html<Message>();
	const preview = getPreview(model);
	const source = preview?.comparisonSource || getEffectiveComparisonSource(model);
	const eyebrowLabel = `${model.layoutMode} · ${CONTENT_MODE_LABELS[model.contentMode]} · ${COMPARISON_MODE_LABELS[model.comparisonMode]} · ${COMPARISON_SOURCE_LABELS[source]}`;
	const showPierre = shouldShowPierre(preview, model.contentMode);

	return h.div(
		[],
		[
			h.div([h.Class('timeline-resize-handle'), h.Id('timelineResizeHandle')], []),
			h.div(
				[h.Class('diff-content')],
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
													h.div([h.Class('diff-title-meta')], [preview?.subtitle || '']),
												],
											),
											source === 'snapshot'
												? h.div([h.Class('diff-subtitle')], [getCurrentToEntry(model)?.description || ''])
												: h.empty,
										],
									),
									h.div(
										[h.Class('diff-actions')],
										[
											h.div([h.Class('eyebrow diff-mode-eyebrow'), h.Id('diffModeEyebrow')], [eyebrowLabel]),
											h.div(
												[h.Class('history-stats')],
												[
													h.span([h.Class('stat stat--plus')], [preview ? `+${preview.additions}` : '+—']),
													h.span([h.Class('stat stat--minus')], [preview ? `−${preview.deletions}` : '−—']),
													h.span([h.Class('stat')], [preview ? `${preview.hunkCount} hunks` : '— hunks']),
												],
											),
											h.button(
												[
													h.Class('collapse-button'),
													h.Id('toggleDiffFocusButton'),
													h.Type('button'),
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
						],
						[
							h.div(
								[h.Class(showPierre ? 'pierre-diff-root' : 'pierre-diff-root is-pending'), h.Id('pierre-diff-root')],
								[],
							),
							renderBodyOverlay(preview, model.contentMode, showPierre),
						],
					),
				],
			),
		],
	);
}
