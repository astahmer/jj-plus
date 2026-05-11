import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import { ClickedToggleDiffFocus } from '../messages.ts';
import type { Model } from '../model.ts';
import { getCurrentFromEntry, getCurrentToEntry, getEffectiveComparisonSource, getPreview } from '../selectors.ts';
import type { ComparisonMode, ComparisonSource, ContentMode, DiffPreview, DiffRow } from '../types.ts';
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

function renderUnifiedRow(row: DiffRow): Html {
	const h = html<Message>();
	if (row.type === 'skip') {
		return h.div(
			[h.Class('diff-row diff-row--skip')],
			[h.button([h.Class('skip-button'), h.Type('button')], [row.text])],
		);
	}
	const marker = row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' ';
	return h.div(
		[h.Class(`diff-row diff-row--${row.type}`)],
		[
			h.div([h.Class('cell marker')], [marker]),
			h.div([h.Class('cell line-number')], [row.leftNumber === null ? '' : String(row.leftNumber)]),
			h.div([h.Class('cell line-number')], [row.rightNumber === null ? '' : String(row.rightNumber)]),
			h.div([h.Class('cell code')], [row.text || ' ']),
		],
	);
}

type SplitRow =
	| { type: 'skip'; skip: DiffRow }
	| { type: 'context'; left: DiffRow; right: DiffRow }
	| { type: 'change'; left: DiffRow | null; right: DiffRow | null };

function buildSplitRows(rows: ReadonlyArray<DiffRow>): Array<SplitRow> {
	const splitRows: Array<SplitRow> = [];
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (row.type === 'skip') {
			splitRows.push({ type: 'skip', skip: row });
			continue;
		}
		if (row.type === 'context') {
			splitRows.push({ type: 'context', left: row, right: row });
			continue;
		}
		const leftRows: Array<DiffRow> = [];
		const rightRows: Array<DiffRow> = [];
		while (index < rows.length && rows[index].type === 'remove') {
			leftRows.push(rows[index]);
			index += 1;
		}
		while (index < rows.length && rows[index].type === 'add') {
			rightRows.push(rows[index]);
			index += 1;
		}
		index -= 1;
		const pairCount = Math.max(leftRows.length, rightRows.length);
		for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
			splitRows.push({
				type: 'change',
				left: leftRows[pairIndex] || null,
				right: rightRows[pairIndex] || null,
			});
		}
	}
	return splitRows;
}

function renderSplitRow(row: SplitRow): Html {
	const h = html<Message>();
	if (row.type === 'skip') {
		return h.div(
			[h.Class('split-row split-row--skip')],
			[h.button([h.Class('skip-button'), h.Type('button')], [row.skip.text])],
		);
	}
	if (row.type === 'context') {
		return h.div(
			[h.Class('split-row')],
			[
				h.div([h.Class('split-cell split-number')], [row.left.leftNumber === null ? '' : String(row.left.leftNumber)]),
				h.div([h.Class('split-cell split-code')], [row.left.text || ' ']),
				h.div(
					[h.Class('split-cell split-number')],
					[row.right.rightNumber === null ? '' : String(row.right.rightNumber)],
				),
				h.div([h.Class('split-cell split-code')], [row.right.text || ' ']),
			],
		);
	}
	return h.div(
		[h.Class('split-row split-row--change')],
		[
			h.div(
				[h.Class('split-cell split-number')],
				[row.left?.leftNumber === null || row.left?.leftNumber === undefined ? '' : String(row.left.leftNumber)],
			),
			h.div([h.Class('split-cell split-code split-code--left')], [row.left?.text || ' ']),
			h.div(
				[h.Class('split-cell split-number')],
				[row.right?.rightNumber === null || row.right?.rightNumber === undefined ? '' : String(row.right.rightNumber)],
			),
			h.div([h.Class('split-cell split-code split-code--right')], [row.right?.text || ' ']),
		],
	);
}

export function diffPanel(model: Model): Html {
	const h = html<Message>();
	const preview = getPreview(model);
	const source = preview?.comparisonSource || getEffectiveComparisonSource(model);
	const eyebrowLabel = `${model.layoutMode} · ${CONTENT_MODE_LABELS[model.contentMode]} · ${COMPARISON_MODE_LABELS[model.comparisonMode]} · ${COMPARISON_SOURCE_LABELS[source]}`;

	const displayRows =
		preview && model.contentMode === 'full' ? preview.rows : preview && preview.hasChanges ? preview.rows : [];

	let rowsContent: Array<Html> = [];
	if (displayRows.length === 0) {
		if (!preview) {
			rowsContent = [h.div([h.Class('empty-diff')], ['Loading diff…'])];
		} else if (model.contentMode === 'diffs' && !preview.hasChanges) {
			rowsContent = [
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
			];
		} else {
			rowsContent = [h.div([h.Class('empty-diff')], ['The file has no content at this revision.'])];
		}
	} else if (model.layoutMode === 'split') {
		rowsContent = buildSplitRows(displayRows).map(renderSplitRow);
	} else {
		rowsContent = displayRows.map(renderUnifiedRow);
	}

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
												preview
													? [
															h.span([h.Class('stat stat--plus')], [`+${preview.additions}`]),
															h.span([h.Class('stat stat--minus')], [`−${preview.deletions}`]),
															h.span([h.Class('stat')], [`${preview.hunkCount} hunks`]),
														]
													: [],
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
						rowsContent,
					),
				],
			),
		],
	);
}
