import { html, type Html } from 'foldkit/html';
import { getEntryTimelineMarkers, getTimelineMarkerKeywords } from '../domain/timeline-markers.ts';
import type { Message } from '../messages.ts';
import { SubmittedFileSwitcher, SubmittedFromRevision, SubmittedToRevision } from '../messages.ts';
import type { Model } from '../model.ts';
import { getActiveRangeOverviewItems, getVisibleEntries } from '../selectors.ts';
import { comboboxMenuContent, filterComboboxOptions, type ComboboxOption } from './combobox.ts';
import { getRevisionIdentifierValue } from './revision-identifier.ts';

function revisionOptions(model: Model): Array<ComboboxOption> {
	return getVisibleEntries(model).map((entry) => {
		const markers = getEntryTimelineMarkers(entry);
		return {
			value: entry.shortRevision,
			label: getRevisionIdentifierValue(entry),
			description: [entry.relativeDate, entry.description].filter(Boolean).join(' · '),
			keywords: [entry.revision, entry.changeId, entry.authorName, ...getTimelineMarkerKeywords(markers)].filter(
				Boolean,
			) as Array<string>,
			markers,
		};
	});
}

function fileOptions(model: Model): Array<ComboboxOption> {
	if (model.fileSwitcherMode === 'overview') {
		return getActiveRangeOverviewItems(model).map((item) => ({
			value: item.relativePath,
			description: `${item.changeCount} touched ${item.changeCount === 1 ? 'revision' : 'revisions'}${item.isCurrentFile ? ' · current file' : ''}`,
		}));
	}
	const data = model.data as { workspaceFiles?: Array<string> } | null;
	return (data?.workspaceFiles || []).map((value) => ({ value }));
}

/**
 * Body-level combobox menus — never clipped by panel overflow.
 * Positioned by syncOverlayGeometry → overlay portal.
 */
export function floatingComboboxMenus(model: Model): Html {
	const h = html<Message>();
	const openId = model.openComboboxId._tag === 'Some' ? model.openComboboxId.value : null;
	if (!openId) {
		return h.empty;
	}

	const specs: Array<{
		id: string;
		value: string;
		options: Array<ComboboxOption>;
		menuClass?: string;
		onSubmit: (value: string) => Message;
	}> = [
		{
			id: 'fromRevisionInput',
			value: model.fromRevisionDraft,
			options: revisionOptions(model),
			menuClass: 'combobox-menu--wide',
			onSubmit: (value) => SubmittedFromRevision({ value }),
		},
		{
			id: 'toRevisionInput',
			value: model.toRevisionDraft,
			options: revisionOptions(model),
			menuClass: 'combobox-menu--wide',
			onSubmit: (value) => SubmittedToRevision({ value }),
		},
		{
			id: 'fileSwitcher',
			value: model.fileInputValue,
			options: fileOptions(model),
			onSubmit: (value) => SubmittedFileSwitcher({ value }),
		},
	];

	const active = specs.find((spec) => spec.id === openId);
	if (!active) {
		return h.empty;
	}

	const filtered = filterComboboxOptions(active.options, active.value, true);
	return h.div(
		[
			h.Class(`combobox-menu${active.menuClass ? ` ${active.menuClass}` : ''}`),
			h.Id(`${active.id}Options`),
			h.Role('listbox'),
		],
		comboboxMenuContent(filtered, active.onSubmit),
	);
}
