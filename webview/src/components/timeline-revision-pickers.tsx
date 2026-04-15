import { Show, createMemo } from 'solid-js';
import type { ComboboxOption } from './combobox.tsx';
import { Combobox } from './combobox.tsx';
import { RevisionIdentifier, getRevisionIdentifierValue } from './revision-identifier.tsx';
import { useTimelineContext } from '../timeline-context.tsx';
import { getEntryTimelineMarkers, getTimelineMarkerKeywords } from '../timeline-markers.ts';

export function TimelineRevisionPickers() {
	const { state, actions } = useTimelineContext();
	const revisionOptions = createMemo(() =>
		state.visibleEntries().map((entry) => {
			const markers = getEntryTimelineMarkers(entry);
			return {
				value: entry.shortRevision,
				label: getRevisionIdentifierValue(entry),
				description: [entry.relativeDate, entry.description].filter(Boolean).join(' · '),
				keywords: [entry.revision, entry.changeId, entry.authorName, ...getTimelineMarkerKeywords(markers)].filter(
					Boolean,
				) as string[],
				markers,
			} satisfies ComboboxOption;
		}),
	);

	return (
		<div class="revision-picker-row">
			<div class="revision-picker-col">
				<Combobox
					id="fromRevisionInput"
					inputClass="revision-input"
					value={state.currentFromEntry()?.shortRevision || ''}
					options={revisionOptions()}
					menuClass="combobox-menu--wide"
					onCommit={(value) => actions.submitRevision('from', value)}
				/>
				<div class="revision-picker-meta">
					<button
						class="handle-pill from"
						id="fromHandleLabel"
						type="button"
						onClick={() => state.currentFromEntry() && actions.scrollToEntry(state.currentFromEntry()!.index)}
					>
						<span>From </span>
						<Show when={state.currentFromEntry()}>
							<RevisionIdentifier
								value={getRevisionIdentifierValue(state.currentFromEntry()!)}
								highlightPrefix={state.currentFromEntry()!.changeId}
								plain={state.currentFromEntry()!.isWorkingTree}
							/>
						</Show>
					</button>
					<span class="revision-picker-relative" id="fromRelativeLabel">
						{state.currentFromEntry()?.relativeDate}
					</span>
				</div>
			</div>
			<span class="revision-arrow">→</span>
			<div class="revision-picker-col">
				<Combobox
					id="toRevisionInput"
					inputClass="revision-input"
					value={state.currentToEntry()?.shortRevision || ''}
					options={revisionOptions()}
					menuClass="combobox-menu--wide"
					onCommit={(value) => actions.submitRevision('to', value)}
				/>
				<div class="revision-picker-meta">
					<button
						class="handle-pill to"
						id="toHandleLabel"
						type="button"
						onClick={() => state.currentToEntry() && actions.scrollToEntry(state.currentToEntry()!.index)}
					>
						<span>To </span>
						<Show when={state.currentToEntry()}>
							<RevisionIdentifier
								value={getRevisionIdentifierValue(state.currentToEntry()!)}
								highlightPrefix={state.currentToEntry()!.changeId}
								plain={state.currentToEntry()!.isWorkingTree}
							/>
						</Show>
					</button>
					<span class="revision-picker-relative" id="toRelativeLabel">
						{state.currentToEntry()?.relativeDate}
					</span>
				</div>
			</div>
		</div>
	);
}
