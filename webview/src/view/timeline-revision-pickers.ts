import { html, type Html } from 'foldkit/html';
import { getEntryTimelineMarkers, getTimelineMarkerKeywords } from '../domain/timeline-markers.ts';
import type { Message } from '../messages.ts';
import { ClickedScrollToEntry, SubmittedFromRevision, SubmittedToRevision } from '../messages.ts';
import type { Model } from '../model.ts';
import { getCurrentFromEntry, getCurrentToEntry, getVisibleEntries } from '../selectors.ts';
import { combobox, type ComboboxOption } from './combobox.ts';
import { getRevisionIdentifierValue, revisionIdentifier } from './revision-identifier.ts';

export function timelineRevisionPickers(model: Model): Html {
	const h = html<Message>();
	const from = getCurrentFromEntry(model);
	const to = getCurrentToEntry(model);
	const revisionOptions: Array<ComboboxOption> = getVisibleEntries(model).map((entry) => {
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

	return h.div(
		[h.Class('revision-picker-row')],
		[
			h.div(
				[h.Class('revision-picker-col')],
				[
					combobox({
						id: 'fromRevisionInput',
						inputClass: 'revision-input',
						value: model.fromRevisionDraft,
						open: model.openComboboxId._tag === 'Some' && model.openComboboxId.value === 'fromRevisionInput',
						options: revisionOptions,
						onSubmit: (value) => SubmittedFromRevision({ value }),
					}),
					h.div(
						[h.Class('revision-picker-meta')],
						[
							h.button(
								[
									h.Class('handle-pill from'),
									h.Id('fromHandleLabel'),
									h.Type('button'),
									h.OnClick(
										from ? ClickedScrollToEntry({ entryIndex: from.index }) : SubmittedFromRevision({ value: '' }),
									),
								],
								[
									h.span([], ['From ']),
									from
										? revisionIdentifier<Message>(getRevisionIdentifierValue(from), from.changeId, from.isWorkingTree)
										: h.empty,
								],
							),
							h.span([h.Class('revision-picker-relative'), h.Id('fromRelativeLabel')], [from?.relativeDate || '']),
						],
					),
				],
			),
			h.span([h.Class('revision-arrow')], ['→']),
			h.div(
				[h.Class('revision-picker-col')],
				[
					combobox({
						id: 'toRevisionInput',
						inputClass: 'revision-input',
						value: model.toRevisionDraft,
						open: model.openComboboxId._tag === 'Some' && model.openComboboxId.value === 'toRevisionInput',
						options: revisionOptions,
						onSubmit: (value) => SubmittedToRevision({ value }),
					}),
					h.div(
						[h.Class('revision-picker-meta')],
						[
							h.button(
								[
									h.Class('handle-pill to'),
									h.Id('toHandleLabel'),
									h.Type('button'),
									h.OnClick(to ? ClickedScrollToEntry({ entryIndex: to.index }) : SubmittedToRevision({ value: '' })),
								],
								[
									h.span([], ['To ']),
									to
										? revisionIdentifier<Message>(getRevisionIdentifierValue(to), to.changeId, to.isWorkingTree)
										: h.empty,
								],
							),
							h.span([h.Class('revision-picker-relative'), h.Id('toRelativeLabel')], [to?.relativeDate || '']),
						],
					),
				],
			),
		],
	);
}
