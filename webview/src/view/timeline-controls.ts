import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import {
	ClickedToggleViewMenu,
	SelectedComparisonMode,
	SelectedComparisonSource,
	SelectedContentMode,
	SelectedLayoutMode,
	SelectedPreset,
	AppliedCustomRevset,
	UpdatedCustomRevset,
	ToggledIntermediate,
} from '../messages.ts';
import type { Model } from '../model.ts';
import { getBackend, getIntermediateLabel } from '../selectors.ts';
import type { TimelinePreset } from '../types.ts';

const PRESET_LABELS: Record<TimelinePreset, string> = {
	year: 'This year',
	'7d': 'Last 7D',
	'30d': '30D',
	'90d': '90D',
	all: 'All',
};

export function timelineControls(model: Model): Html {
	const h = html<Message>();
	const backend = getBackend(model);
	const hasIntermediate = model.data
		? (model.data as { hasIntermediateRevisions?: boolean }).hasIntermediateRevisions === true
		: false;

	return h.div(
		[h.Class('control-row')],
		[
			h.div(
				[h.Class('control-row-primary')],
				[
					h.div(
						[h.Class('segmented'), h.Id('comparisonModes')],
						[
							h.button(
								[
									h.Class(`segment${model.comparisonMode === 'range' ? ' active' : ''}`),
									h.Type('button'),
									h.AriaPressed(String(model.comparisonMode === 'range')),
									h.OnClick(SelectedComparisonMode({ value: 'range' })),
								],
								['Range'],
							),
							h.button(
								[
									h.Class(`segment${model.comparisonMode === 'step' ? ' active' : ''}`),
									h.Type('button'),
									h.AriaPressed(String(model.comparisonMode === 'step')),
									h.OnClick(SelectedComparisonMode({ value: 'step' })),
								],
								['Single'],
							),
						],
					),
					backend === 'jj'
						? h.div(
								[h.Class('segmented'), h.Id('comparisonSources')],
								[
									h.button(
										[
											h.Class(`segment${model.comparisonSource === 'revision' ? ' active' : ''}`),
											h.Type('button'),
											h.AriaPressed(String(model.comparisonSource === 'revision')),
											h.OnClick(SelectedComparisonSource({ value: 'revision' })),
										],
										['Revision'],
									),
									h.button(
										[
											h.Class(`segment${model.comparisonSource === 'snapshot' ? ' active' : ''}`),
											h.Type('button'),
											h.AriaPressed(String(model.comparisonSource === 'snapshot')),
											h.OnClick(SelectedComparisonSource({ value: 'snapshot' })),
										],
										['Snapshot'],
									),
								],
							)
						: h.empty,
					h.div(
						[h.Class('view-menu-wrap')],
						[
							h.button(
								[
									h.Class(`menu-button${model.viewMenuOpen ? ' is-active' : ''}`),
									h.Id('viewMenuButton'),
									h.Type('button'),
									h.AriaLabel('View options'),
									h.AriaExpanded(model.viewMenuOpen),
									h.OnClick(ClickedToggleViewMenu()),
								],
								['View'],
							),
							h.div(
								[h.Class(`view-menu${model.viewMenuOpen ? ' open' : ''}`), h.Id('viewMenu')],
								[
									h.div(
										[h.Class('view-menu-section')],
										[
											h.div([h.Class('view-menu-label')], ['Layout']),
											h.div(
												[h.Class('segmented'), h.Id('layoutModes')],
												[
													h.button(
														[
															h.Class(`segment${model.layoutMode === 'split' ? ' active' : ''}`),
															h.Type('button'),
															h.AriaPressed(String(model.layoutMode === 'split')),
															h.OnClick(SelectedLayoutMode({ value: 'split' })),
														],
														['Split'],
													),
													h.button(
														[
															h.Class(`segment${model.layoutMode === 'unified' ? ' active' : ''}`),
															h.Type('button'),
															h.AriaPressed(String(model.layoutMode === 'unified')),
															h.OnClick(SelectedLayoutMode({ value: 'unified' })),
														],
														['Unified'],
													),
												],
											),
										],
									),
									h.div(
										[h.Class('view-menu-section')],
										[
											h.div([h.Class('view-menu-label')], ['Content']),
											h.div(
												[h.Class('segmented'), h.Id('contentModes')],
												[
													h.button(
														[
															h.Class(`segment${model.contentMode === 'diffs' ? ' active' : ''}`),
															h.Type('button'),
															h.AriaPressed(String(model.contentMode === 'diffs')),
															h.OnClick(SelectedContentMode({ value: 'diffs' })),
														],
														['Diffs'],
													),
													h.button(
														[
															h.Class(`segment${model.contentMode === 'full' ? ' active' : ''}`),
															h.Type('button'),
															h.AriaPressed(String(model.contentMode === 'full')),
															h.OnClick(SelectedContentMode({ value: 'full' })),
														],
														['Whole file'],
													),
												],
											),
										],
									),
									h.div(
										[h.Class('view-menu-section')],
										[
											h.div([h.Class('view-menu-label')], ['History']),
											h.button(
												[
													h.Class(`segmented-toggle${model.showIntermediateRevisions ? ' active' : ''}`),
													h.Id('intermediateToggle'),
													h.Type('button'),
													h.AriaLabel(model.showIntermediateRevisions ? 'Hide In-Between' : 'Show In-Between'),
													h.AriaPressed(String(model.showIntermediateRevisions)),
													h.Disabled(!hasIntermediate),
													h.OnClick(ToggledIntermediate()),
												],
												[getIntermediateLabel(model)],
											),
											h.div(
												[h.Class('segmented segmented--wrap'), h.Id('presets')],
												(['year', '7d', '30d', '90d', 'all'] as Array<TimelinePreset>).map((value) =>
													h.button(
														[
															h.Class(`segment${model.preset === value ? ' active' : ''}`),
															h.Type('button'),
															h.AriaPressed(String(model.preset === value)),
															h.OnClick(SelectedPreset({ value })),
														],
														[PRESET_LABELS[value]],
													),
												),
											),
											getBackend(model) === 'jj'
												? h.div(
														[h.Class('revset-filter'), h.Id('revsetFilter')],
														[
															h.label([h.Class('view-menu-label'), h.For('customRevsetInput')], ['Revset']),
															h.input([
																h.Class('revset-input'),
																h.Id('customRevsetInput'),
																h.Type('text'),
																h.Placeholder('e.g. bookmarks() | remote_bookmarks()'),
																h.Value(model.customRevset),
																h.OnInput((value) => UpdatedCustomRevset({ value })),
															]),
															h.button(
																[
																	h.Class('menu-item'),
																	h.Id('applyCustomRevsetButton'),
																	h.Type('button'),
																	h.OnClick(AppliedCustomRevset()),
																],
																['Apply revset'],
															),
														],
													)
												: h.empty,
										],
									),
								],
							),
						],
					),
				],
			),
		],
	);
}
