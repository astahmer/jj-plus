import { For, Show, createSignal, onCleanup } from 'solid-js';
import { useTimelineContext } from '../timeline-context.tsx';
import { RevisionIdentifier, getRevisionIdentifierValue } from './revision-identifier.tsx';

function formatDiffActionLabel(label: string, diffCount: number | null) {
	return diffCount === null ? label : `${label} (${diffCount})`;
}

export function Sidebar() {
	const { state, actions } = useTimelineContext();
	const [copiedIdentifierKey, setCopiedIdentifierKey] = createSignal('');
	const [expandedDescriptionById, setExpandedDescriptionById] = createSignal<Record<string, boolean>>({});
	let copiedIdentifierTimer: number | undefined;

	onCleanup(() => {
		if (copiedIdentifierTimer) {
			window.clearTimeout(copiedIdentifierTimer);
		}
	});

	async function copyIdentifier(copyKey: string, copyValue: string) {
		if (!copyValue) {
			return;
		}

		try {
			await navigator.clipboard.writeText(copyValue);
		} catch {
			return;
		}

		setCopiedIdentifierKey(copyKey);
		if (copiedIdentifierTimer) {
			window.clearTimeout(copiedIdentifierTimer);
		}

		copiedIdentifierTimer = window.setTimeout(() => {
			setCopiedIdentifierKey('');
		}, 2000);
	}

	function toggleDescription(entryId: string) {
		setExpandedDescriptionById((current) => ({
			...current,
			[entryId]: !current[entryId],
		}));
	}

	return (
		<aside class="panel sidebar" id="sidebar">
			<div class="sidebar-head">
				<div class="sidebar-head-main">
					<div class="eyebrow">Revisions</div>
					<div class="sidebar-hint" id="sidebarHint">
						{state.visibleEntryCount()} visible
					</div>
				</div>
				<div class="sidebar-head-actions">
					<button
						class="sidebar-icon-button"
						id="toggleSidebarOrderButton"
						type="button"
						aria-label={state.oldestFirst() ? 'Show newest revisions first' : 'Show oldest revisions first'}
						onClick={actions.toggleSortOrder}
					>
						{state.oldestFirst() ? '↓' : '↑'}
					</button>
					<button
						class="sidebar-head-action"
						id="openSidebarRangeDiffButton"
						type="button"
						onClick={actions.openSelectionDiffs}
					>
						{formatDiffActionLabel('Open selection diffs', state.selectionDiffCount())}
					</button>
				</div>
			</div>
			<div class="sidebar-search-wrap">
				<input
					class="sidebar-search-input"
					id="sidebarSearchInput"
					type="search"
					placeholder="Search revisions"
					autocomplete="off"
					value={state.sidebarSearchQuery()}
					onInput={(event) => actions.setSidebarSearchQuery(event.currentTarget.value)}
				/>
			</div>
			<div class="history-list" id="historyList">
				<Show
					when={state.sidebarEntries().length}
					fallback={
						<div class="empty">
							{state.sidebarSearchQuery().trim()
								? 'No revisions match the current search.'
								: 'No revisions in the current filter.'}
						</div>
					}
				>
					<For each={state.sidebarEntries()}>
						{(entry) => {
							const showCommittedSelection = () => state.pendingSelectionIndex() === null;
							const isFrom = () => showCommittedSelection() && entry.index === state.fromIndex();
							const isTo = () => showCommittedSelection() && entry.index === state.toIndex();
							const inRange = () =>
								showCommittedSelection() &&
								entry.index >= Math.min(state.fromIndex(), state.toIndex()) &&
								entry.index <= Math.max(state.fromIndex(), state.toIndex());
							const pending = () => state.pendingSelectionIndex() === entry.index;
							const preview = () => state.previewForEntry(entry.index);
							const inPendingRange = () => {
								const pendingIndex = state.pendingSelectionIndex();
								const hoveredIndex = state.hoveredSelectionIndex();
								if (pendingIndex === null || hoveredIndex === null) {
									return false;
								}

								return (
									entry.index >= Math.min(pendingIndex, hoveredIndex) &&
									entry.index <= Math.max(pendingIndex, hoveredIndex)
								);
							};
							const showOperationPrimary = () => state.comparisonSource() === 'snapshot' && Boolean(entry.operationId);
							const copyKey = `primary:${entry.id}`;
							const revisionIdentifierValue =
								getRevisionIdentifierValue(entry) || entry.shortRevision || entry.revision || entry.id;
							const primaryCopyValue = showOperationPrimary()
								? entry.operationId || revisionIdentifierValue
								: revisionIdentifierValue;
							const primaryContent = () =>
								copiedIdentifierKey() === copyKey ? (
									'Copied!'
								) : showOperationPrimary() ? (
									<span class="identifier">
										<span class="identifier-plain">{entry.operationId}</span>
									</span>
								) : (
									<RevisionIdentifier
										value={getRevisionIdentifierValue(entry)}
										highlightPrefix={entry.changeId}
										plain={entry.isWorkingTree}
									/>
								);
							const operationCopyKey = `operation-key:${entry.id}`;
							const primaryTooltipLabel = () =>
								showOperationPrimary() ? 'Revision' : entry.operationId ? 'Operation' : null;
							const primaryTooltipValue = () =>
								showOperationPrimary() ? revisionIdentifierValue : entry.operationId || '';
							const descriptionExpandable = entry.description.length > 88 || entry.description.includes('\n');
							const descriptionExpanded = () => expandedDescriptionById()[entry.id] === true;
							const rowDiffCount = () => state.entryDiffCount(entry.index);

							return (
								<article
									class={`history-item${!entry.touchesFile ? ' is-intermediate' : ''}${inRange() ? ' in-range' : ''}${pending() ? ' pending-anchor' : ''}${inPendingRange() ? ' pending-range' : ''}${isFrom() ? ' is-from' : ''}${isTo() ? ' is-to' : ''}`}
									data-entry-index={entry.index}
									tabindex="0"
									onClick={() => actions.selectEntry(entry.index)}
									onMouseEnter={() => actions.hoverEntry(entry.index)}
									onMouseLeave={() => actions.hoverEntry(null)}
									onFocus={() => actions.hoverEntry(entry.index)}
									onBlur={() => actions.hoverEntry(null)}
									onKeyDown={(event) => {
										if (event.key === 'Enter' || event.key === ' ') {
											event.preventDefault();
											actions.selectEntry(entry.index);
										}
									}}
								>
									<div class="history-top">
										<div class="history-primary">
											<div class="history-identity">
												<button
													class="history-id-button"
													type="button"
													onMouseEnter={(event) => {
														const tooltipValue = primaryTooltipValue();
														if (tooltipValue) {
															actions.showInfoTooltip(event, primaryTooltipLabel(), tooltipValue);
														}
													}}
													onMouseLeave={actions.hideInfoTooltip}
													onClick={(event) => {
														event.stopPropagation();
														void copyIdentifier(copyKey, primaryCopyValue);
													}}
												>
													{primaryContent()}
												</button>
												<Show when={entry.operationKey}>
													<button
														class="mini-badge other mini-badge-copy"
														type="button"
														onClick={(event) => {
															event.stopPropagation();
															void copyIdentifier(operationCopyKey, entry.operationKey || '');
														}}
													>
														<Show
															when={copiedIdentifierKey() === operationCopyKey}
															fallback={
																<RevisionIdentifier value={entry.operationKey || ''} highlightPrefix={entry.changeId} />
															}
														>
															Copied!
														</Show>
													</button>
												</Show>
											</div>
											<Show when={!entry.touchesFile}>
												<span class="mini-badge other">OTHER</span>
											</Show>
											<Show when={isFrom()}>
												<span class="mini-badge from">FROM</span>
											</Show>
											<Show when={isTo()}>
												<span class="mini-badge to">TO</span>
											</Show>
										</div>
										<div class="history-actions">
											<span
												class="history-date-trigger"
												onMouseEnter={(event) => actions.showInfoTooltip(event, 'Timestamp', entry.authorDate)}
												onMouseLeave={actions.hideInfoTooltip}
											>
												{entry.shortDate}
											</span>
											<Show when={entry.remoteUrl}>
												<button
													class="history-action history-action-remote"
													type="button"
													onClick={(event) => {
														event.stopPropagation();
														actions.openRevisionRemote(entry.index);
													}}
												>
													Remote
												</button>
											</Show>
											<Show when={entry.hasPreviousEntry}>
												<button
													class="history-action history-action-diff"
													type="button"
													onClick={(event) => {
														event.stopPropagation();
														actions.openRevisionFilesDiff(entry.index);
													}}
												>
													{formatDiffActionLabel('Open diffs', rowDiffCount())}
												</button>
											</Show>
										</div>
									</div>
									<div
										class={`history-description${descriptionExpandable && !descriptionExpanded() ? ' is-truncated' : ''}`}
									>
										{entry.description}
									</div>
									<Show when={descriptionExpandable}>
										<button
											class="history-more"
											type="button"
											onClick={(event) => {
												event.stopPropagation();
												toggleDescription(entry.id);
											}}
										>
											{descriptionExpanded() ? 'Less' : 'More...'}
										</button>
									</Show>
									<div class="history-bottom">
										<span class="history-meta">
											<span
												class="history-meta-timestamp"
												onMouseEnter={(event) => actions.showInfoTooltip(event, 'Timestamp', entry.authorDate)}
												onMouseLeave={actions.hideInfoTooltip}
											>
												{entry.relativeDate}
											</span>
											<Show when={entry.authorName}>
												<span> · {entry.authorName}</span>
											</Show>
										</span>
										<span class="history-stats">
											<Show when={preview()}>
												<Show when={preview()!.hasChanges} fallback={<span class="stat">No text</span>}>
													<span class="stat stat--plus">+{preview()!.additions}</span>
													<span class="stat stat--minus">-{preview()!.deletions}</span>
												</Show>
											</Show>
										</span>
									</div>
								</article>
							);
						}}
					</For>
				</Show>
			</div>
		</aside>
	);
}
