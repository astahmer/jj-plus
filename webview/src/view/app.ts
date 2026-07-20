import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import type { Model } from '../model.ts';
import { queuePierreFileDiffSync } from '../pierre/file-diff-host.ts';
import { diffPanel } from './diff-panel.ts';
import { sessionLoadingOverlay } from './session-loading.ts';
import { sidebar } from './sidebar.ts';
import { timelinePane } from './timeline-pane.ts';
import { trackTooltip } from './tooltip.ts';

const TIMELINE_COLLAPSED_HEIGHT = 128;

export function view(model: Model): Html {
	if (typeof window !== 'undefined') {
		queuePierreFileDiffSync(model);
	}

	const h = html<Message>();
	const workspaceClasses = [
		'workspace',
		model.sidebarCollapsed ? 'is-collapsed' : '',
		model.diffFocusMode ? 'is-diff-focus' : '',
	]
		.filter(Boolean)
		.join(' ');

	const layoutVars: Record<string, string> = {
		'--sidebar-width': `${model.sidebarWidth}px`,
		'--responsive-sidebar-height': `${model.sidebarCollapsed ? 0 : model.responsiveSidebarHeight}px`,
		'--timeline-pane-height': `${model.timelinePaneCollapsed ? TIMELINE_COLLAPSED_HEIGHT : model.timelinePaneHeight}px`,
	};

	return h.div(
		[h.Class('app'), h.Style(layoutVars)],
		[
			h.section(
				[h.Class(workspaceClasses)],
				[
					sidebar(model),
					h.div([h.Class('resize-handle'), h.Id('resizeHandle')], []),
					h.section([h.Class('panel diff-panel')], [timelinePane(model), diffPanel(model)]),
				],
			),
			trackTooltip(model),
			sessionLoadingOverlay(model),
		],
	);
}
