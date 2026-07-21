import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import {
	ClickedCancelActiveRequest,
	ClickedClearLineHistory,
	ClickedOpenCurrentFile,
	ClickedOpenEditorDiff,
	ClickedOpenSelectionDiffs,
	ClickedRefreshTimeline,
	ClickedResetPreferences,
	ClickedToggleActionsMenu,
	ClickedToggleHotkeys,
	ClickedToggleSidebar,
	ClickedToggleSidebarFromMenu,
	ClickedToggleTimelinePane,
	SelectedFileSwitcherMode,
	SubmittedFileSwitcher,
} from '../messages.ts';
import type { Model } from '../model.ts';
import { shortcutTooltip } from '../domain/timeline-shortcuts.ts';
import { formatLineHistoryLabel } from '../../../src/shared/line-history.ts';
import {
	getActiveRangeOverviewItems,
	getRangeLabel,
	getRangeOverviewLoading,
	getRangeSubtitle,
	getFilePathTrailLabel,
	getSelectionDiffCount,
	getShowSnapshotStatus,
	getSnapshotStatusLabel,
	getStepStatus,
	getVersion,
} from '../selectors.ts';
import { combobox, type ComboboxOption } from './combobox.ts';
import { timelineControls } from './timeline-controls.ts';
import { timelineRevisionPickers } from './timeline-revision-pickers.ts';
import { timelineTrack } from './timeline-track.ts';

function overviewSummary(model: Model): string {
	if (model.fileSwitcherMode !== 'overview') {
		return '';
	}
	if (getRangeOverviewLoading(model)) {
		return 'Scanning selected revisions...';
	}
	const itemCount = getActiveRangeOverviewItems(model).length;
	if (!itemCount) {
		return 'No changed files in the current range';
	}
	return `${itemCount} ${itemCount === 1 ? 'file' : 'files'} in the current range`;
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

export function timelinePane(model: Model): Html {
	const h = html<Message>();
	const stepStatus = getStepStatus(model);
	const showSnapshot = getShowSnapshotStatus(model);
	const showStepStatusRow = Boolean(stepStatus) || showSnapshot;
	const selectionDiffCount = getSelectionDiffCount(model);
	const openSelectionDiffsLabel = selectionDiffCount === null ? 'Open diffs' : `Open diffs (${selectionDiffCount})`;
	const fileSwitcherPlaceholder =
		model.fileSwitcherMode === 'overview' ? 'Jump to a top-changed file...' : 'Switch file...';
	const collapseLabel = model.timelinePaneCollapsed ? 'Expand timeline' : 'Collapse timeline';
	const lineHistory = (model.data as { lineHistory?: { startLine: number; endLine: number } } | null)?.lineHistory;
	const pathTrail = getFilePathTrailLabel(model);
	const rangeFiles = getActiveRangeOverviewItems(model);
	const currentRelativePath = (model.data as { relativePath?: string } | null)?.relativePath || '';

	return h.div(
		[h.Class(`timeline-pane${model.timelinePaneCollapsed ? ' is-collapsed' : ''}`), h.Id('timelinePane')],
		[
			h.div(
				[h.Class('timeline-pane-head')],
				[
					h.button(
						[
							h.Class(`sidebar-toggle-button${model.sidebarCollapsed ? ' is-collapsed' : ''}`),
							h.Id('sidebarToggleButton'),
							h.Type('button'),
							h.Title(shortcutTooltip('toggleSidebar')),
							h.AriaLabel(shortcutTooltip('toggleSidebar')),
							h.OnClick(ClickedToggleSidebar()),
						],
						[model.sidebarCollapsed ? '▸' : '◂'],
					),
					h.div(
						[h.Class('timeline-pane-title')],
						[
							h.div([h.Class('eyebrow')], ['Revision Timeline']),
							h.span([h.Class('version-badge')], [getVersion(model)]),
						],
					),
					h.div(
						[h.Class('timeline-head-summary')],
						[
							h.div([h.Class('range-label')], [getRangeLabel(model)]),
							h.div([h.Class('range-subtitle')], [getRangeSubtitle(model)]),
							pathTrail ? h.div([h.Class('path-trail'), h.Id('pathTrail'), h.Title(pathTrail)], [pathTrail]) : h.empty,
						],
					),
					h.button(
						[
							h.Class('collapse-button'),
							h.Id('toggleTimelinePaneButton'),
							h.Type('button'),
							h.OnClick(ClickedToggleTimelinePane()),
						],
						[collapseLabel],
					),
				],
			),
			lineHistory
				? h.div(
						[h.Class('line-history-banner'), h.Id('lineHistoryBanner')],
						[
							h.span([h.Class('line-history-banner-label')], [`Line history · ${formatLineHistoryLabel(lineHistory)}`]),
							h.button(
								[
									h.Class('line-history-banner-clear'),
									h.Id('clearLineHistoryButton'),
									h.Type('button'),
									h.AriaLabel('Clear line history filter'),
									h.OnClick(ClickedClearLineHistory()),
								],
								['Show full history'],
							),
						],
					)
				: h.empty,
			h.div(
				[h.Class('diff-head'), h.Id('timelineChrome')],
				[
					h.div(
						[h.Class('diff-head-top')],
						[
							h.div(
								[h.Class('file-switcher-row')],
								[
									h.div(
										[h.Class('file-switcher-toolbar')],
										[
											h.div(
												[
													h.Class('segmented'),
													h.Id('fileSwitcherModes'),
													h.Role('tablist'),
													h.AriaLabel('File switcher mode'),
												],
												[
													h.button(
														[
															h.Class(`segment${model.fileSwitcherMode === 'workspace' ? ' active' : ''}`),
															h.Type('button'),
															h.Role('tab'),
															h.AriaSelected(model.fileSwitcherMode === 'workspace'),
															h.OnClick(SelectedFileSwitcherMode({ value: 'workspace' })),
														],
														['All files'],
													),
													h.button(
														[
															h.Class(`segment${model.fileSwitcherMode === 'overview' ? ' active' : ''}`),
															h.Type('button'),
															h.Role('tab'),
															h.AriaSelected(model.fileSwitcherMode === 'overview'),
															h.OnClick(SelectedFileSwitcherMode({ value: 'overview' })),
														],
														['Top changed'],
													),
												],
											),
											model.fileSwitcherMode === 'overview'
												? h.div(
														[h.Class(`file-switcher-summary${getRangeOverviewLoading(model) ? ' is-loading' : ''}`)],
														[overviewSummary(model)],
													)
												: h.empty,
										],
									),
									combobox({
										id: 'fileSwitcher',
										inputClass: 'file-input',
										value: model.fileInputValue,
										open: model.openComboboxId._tag === 'Some' && model.openComboboxId.value === 'fileSwitcher',
										placeholder: fileSwitcherPlaceholder,
										options: fileOptions(model),
										onSubmit: (value) => SubmittedFileSwitcher({ value }),
									}),
									model.fileSwitcherMode === 'overview' && rangeFiles.length
										? h.div(
												[
													h.Class('range-file-list'),
													h.Id('rangeFileList'),
													h.Role('list'),
													h.AriaLabel('Files changed in selected range'),
												],
												rangeFiles
													.slice(0, 16)
													.map((item) =>
														h.button(
															[
																h.Class(
																	`range-file-chip${item.relativePath === currentRelativePath ? ' is-current' : ''}`,
																),
																h.Type('button'),
																h.Role('listitem'),
																h.Title(
																	`${item.relativePath} · ${item.changeCount} change${item.changeCount === 1 ? '' : 's'}`,
																),
																h.OnClick(SubmittedFileSwitcher({ value: item.relativePath })),
															],
															[
																h.span(
																	[h.Class('range-file-chip-name')],
																	[item.relativePath.split('/').at(-1) || item.relativePath],
																),
																h.span([h.Class('range-file-chip-count')], [String(item.changeCount)]),
															],
														),
													),
											)
										: h.empty,
								],
							),
							h.div(
								[h.Class('head-actions')],
								[
									h.button(
										[
											h.Class('menu-button'),
											h.Id('toggleHotkeysButton'),
											h.Type('button'),
											h.Title(shortcutTooltip('toggleHotkeys')),
											h.AriaLabel(shortcutTooltip('toggleHotkeys')),
											h.OnClick(ClickedToggleHotkeys()),
										],
										['?'],
									),
									h.div(
										[h.Class('menu-wrap')],
										[
											h.button(
												[
													h.Class('menu-button'),
													h.Id('actionsButton'),
													h.Type('button'),
													h.OnClick(ClickedToggleActionsMenu()),
												],
												['...'],
											),
											h.div(
												[h.Class(`menu${model.actionsMenuOpen ? ' open' : ''}`), h.Id('actionsMenu')],
												[
													h.button(
														[
															h.Class('menu-item'),
															h.Id('toggleSidebarAction'),
															h.Type('button'),
															h.OnClick(ClickedToggleSidebarFromMenu()),
														],
														[model.sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'],
													),
													h.button(
														[
															h.Class('menu-item'),
															h.Id('openCurrentFileAction'),
															h.Type('button'),
															h.OnClick(ClickedOpenCurrentFile()),
														],
														['Open File'],
													),
													h.button(
														[
															h.Class('menu-item'),
															h.Id('openEditorButton'),
															h.Type('button'),
															h.OnClick(ClickedOpenEditorDiff()),
														],
														['Open diff'],
													),
													h.button(
														[
															h.Class('menu-item'),
															h.Id('openRangeFilesButton'),
															h.Type('button'),
															h.OnClick(ClickedOpenSelectionDiffs()),
														],
														[openSelectionDiffsLabel],
													),
													h.button(
														[
															h.Class('menu-item'),
															h.Id('cancelActiveRequestAction'),
															h.Type('button'),
															h.OnClick(ClickedCancelActiveRequest()),
														],
														['Cancel request'],
													),
													h.button(
														[
															h.Class('menu-item'),
															h.Id('refreshButton'),
															h.Type('button'),
															h.OnClick(ClickedRefreshTimeline()),
														],
														['Refresh'],
													),
													h.button(
														[
															h.Class('menu-item'),
															h.Id('resetPreferencesAction'),
															h.Type('button'),
															h.OnClick(ClickedResetPreferences()),
														],
														['Reset preferences'],
													),
												],
											),
										],
									),
								],
							),
						],
					),
					h.div([h.Class('timeline-head')], [timelineRevisionPickers(model), timelineControls(model)]),
					timelineTrack(model),
					showStepStatusRow
						? h.div(
								[h.Class('step-status-row')],
								[
									stepStatus ? h.div([h.Class('step-status'), h.Id('stepStatus')], [stepStatus]) : h.empty,
									showSnapshot
										? h.div(
												[h.Class('loading-indicator'), h.Id('snapshotLoadingIndicator')],
												[getSnapshotStatusLabel(model)],
											)
										: h.empty,
								],
							)
						: h.empty,
				],
			),
		],
	);
}
