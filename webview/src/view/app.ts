import { Option } from 'effect';
import { html, type Html } from 'foldkit/html';
import { TIMELINE_COLLAPSED_HEIGHT } from '../machine/drag.ts';
import type { Message } from '../messages.ts';
import { PressedSidebarResize } from '../messages.ts';
import type { Model } from '../model.ts';
import { queuePierreFileDiffSync } from '../pierre/file-diff-host.ts';
import { diffPanel, timelineResizeHandle } from './diff-panel.ts';
import { hotkeysPopover } from './hotkeys.ts';
import { syncOverlayGeometry } from './overlay-geometry.ts';
import { sessionLoadingOverlay } from './session-loading.ts';
import { sidebar } from './sidebar.ts';
import { timelinePane } from './timeline-pane.ts';
import { trackTooltip } from './tooltip.ts';

export function view(model: Model): Html {
	if (typeof window !== 'undefined') {
		queuePierreFileDiffSync(model);
		window.requestAnimationFrame(() => syncOverlayGeometry(model));
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
		[h.Class('app'), h.DataAttribute('theme', model.themePreference), h.Style(layoutVars)],
		[
			h.section(
				[h.Class(workspaceClasses)],
				[
					sidebar(model),
					h.div(
						[
							h.Class(`resize-handle${model.dragState._tag === 'DragSidebarResize' ? ' is-dragging' : ''}`),
							h.Id('resizeHandle'),
							h.OnPointerDown((_pointerType, button, _sx, _sy, _ts, clientX, clientY) =>
								Option.some(PressedSidebarResize({ clientX, clientY, button })),
							),
						],
						[],
					),
					h.section(
						[h.Class('panel diff-panel')],
						[timelinePane(model), timelineResizeHandle(model), diffPanel(model)],
					),
				],
			),
			trackTooltip(model),
			model.hotkeysOpen ? hotkeysPopover(model) : h.empty,
			sessionLoadingOverlay(model),
		],
	);
}
