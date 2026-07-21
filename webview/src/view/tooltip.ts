import { html, type Html } from 'foldkit/html';
import { clampTooltipX, clampTooltipY, formatRevisionCount, shouldPlaceTooltipBelow } from '../domain/timeline-tooltips.ts';
import type { Message } from '../messages.ts';
import type { Model } from '../model.ts';
import { getPreview, getVisibleEntries } from '../selectors.ts';
import { buildPreviewKey } from '../domain/timeline-selection.ts';
import { getEffectiveComparisonSource } from '../selectors.ts';
import type { DiffPreview, FileRevisionEntry } from '../types.ts';
import { getRevisionIdentifierValue, revisionIdentifier } from './revision-identifier.ts';

function formatExactTimestamp(authorDate: string): string {
	const date = new Date(authorDate);
	if (Number.isNaN(date.getTime())) {
		return 'Unknown time';
	}
	return date.toLocaleString();
}

export function trackTooltip(model: Model): Html {
	const h = html<Message>();
	if (model.maybeTrackTooltip._tag !== 'Some') {
		return h.empty;
	}

	const tooltip = model.maybeTrackTooltip.value;
	const entries = getVisibleEntries(model);
	const fromEntry = entries.find((entry) => entry.index === tooltip.fromIndex);
	const toEntry = entries.find((entry) => entry.index === tooltip.toIndex);
	if (!fromEntry || !toEntry) {
		return h.empty;
	}

	const comparisonSource = getEffectiveComparisonSource(model);
	const previewKey = buildPreviewKey(tooltip.fromIndex, tooltip.toIndex, comparisonSource);
	const preview =
		previewKey === buildPreviewKey(model.fromIndex, model.toIndex, comparisonSource)
			? getPreview(model)
			: ((model.previewByRange as Record<string, DiffPreview>)[previewKey] ?? null);

	const classes = ['anchor-tooltip', 'anchor-tooltip--segment', tooltip.pending ? 'anchor-tooltip--pending' : '']
		.filter(Boolean)
		.join(' ');

	const left = clampTooltipX(tooltip.left);
	const placeBelow = shouldPlaceTooltipBelow(tooltip.top);
	const top = clampTooltipY(tooltip.top, 200, placeBelow);

	return h.div(
		[
			h.Class(classes),
			h.Style({
				left: `${left}px`,
				top: `${top}px`,
				transform: placeBelow ? 'translate(-50%, 12px)' : 'translate(-50%, calc(-100% - 8px))',
			}),
		],
		[
			h.div(
				[h.Class('anchor-tooltip-id anchor-tooltip-range')],
				[
					revisionIdentifierNode(fromEntry),
					h.span([h.Class('diff-title-arrow')], ['→']),
					revisionIdentifierNode(toEntry),
				],
			),
			h.div(
				[h.Class('anchor-tooltip-label')],
				[
					tooltip.pending
						? `Pending selection · ${formatRevisionCount(tooltip.selectedCount)}`
						: formatRevisionCount(tooltip.selectedCount),
				],
			),
			h.div(
				[h.Class('anchor-tooltip-meta')],
				[`From ${fromEntry.relativeDate || 'unknown'} · ${formatExactTimestamp(fromEntry.authorDate)}`],
			),
			h.div(
				[h.Class('anchor-tooltip-meta')],
				[`To ${toEntry.relativeDate || 'unknown'} · ${formatExactTimestamp(toEntry.authorDate)}`],
			),
			h.div(
				[h.Class('anchor-tooltip-desc')],
				[
					h.div(
						[h.Class('anchor-tooltip-desc-line')],
						[
							h.div([h.Class('anchor-tooltip-desc-label')], ['From description']),
							h.div([h.Class('anchor-tooltip-desc-value')], [fromEntry.description || 'No description']),
						],
					),
					h.div(
						[h.Class('anchor-tooltip-desc-line')],
						[
							h.div([h.Class('anchor-tooltip-desc-label')], ['To description']),
							h.div([h.Class('anchor-tooltip-desc-value')], [toEntry.description || 'No description']),
						],
					),
				],
			),
			preview?.subtitle ? h.div([h.Class('anchor-tooltip-meta')], [preview.subtitle]) : h.empty,
		],
	);
}

function revisionIdentifierNode(entry: FileRevisionEntry): Html {
	return revisionIdentifier<Message>(getRevisionIdentifierValue(entry), entry.changeId, entry.isWorkingTree);
}
