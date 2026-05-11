import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import type { Model } from '../model.ts';
import { diffPanel } from './diff-panel.ts';
import { sidebar } from './sidebar.ts';
import { timelinePane } from './timeline-pane.ts';

export function view(model: Model): Html {
	const h = html<Message>();
	const workspaceClasses = [
		'workspace',
		model.sidebarCollapsed ? 'is-collapsed' : '',
		model.diffFocusMode ? 'is-diff-focus' : '',
	]
		.filter(Boolean)
		.join(' ');

	return h.div(
		[h.Class('app')],
		[
			h.section(
				[h.Class(workspaceClasses)],
				[
					sidebar(model),
					h.div([h.Class('resize-handle'), h.Id('resizeHandle')], []),
					h.section([h.Class('panel diff-panel')], [timelinePane(model), diffPanel(model)]),
				],
			),
		],
	);
}
