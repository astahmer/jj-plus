import { Schema as S } from 'effect';
import { ts } from 'foldkit/schema';

// STATE

export const DragIdle = ts('DragIdle');
export const DragAnchorIntent = ts('DragAnchorIntent', {
	entryIndex: S.Number,
	startClientX: S.Number,
	startClientY: S.Number,
});
export const DragRange = ts('DragRange', {
	startClientX: S.Number,
	startFromVisibleIndex: S.Number,
	startToVisibleIndex: S.Number,
});
export const DragMarker = ts('DragMarker', {
	side: S.Literals(['from', 'to']),
});
export const DragSidebarResize = ts('DragSidebarResize', {
	startClientX: S.Number,
	startClientY: S.Number,
	startWidth: S.Number,
	startHeight: S.Number,
	wasCollapsed: S.Boolean,
	responsive: S.Boolean,
});
export const DragTimelineResize = ts('DragTimelineResize', {
	startClientY: S.Number,
	startHeight: S.Number,
});

export const DragState = S.Union([
	DragIdle,
	DragAnchorIntent,
	DragRange,
	DragMarker,
	DragSidebarResize,
	DragTimelineResize,
]);
export type DragState = typeof DragState.Type;

export const TRACK_ANCHOR_DRAG_START_DISTANCE = 4;
export const SIDEBAR_COLLAPSE_THRESHOLD = 140;
export const SIDEBAR_REOPEN_THRESHOLD = 24;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 760;
export const RESPONSIVE_SIDEBAR_MIN_HEIGHT = 136;
export const RESPONSIVE_SIDEBAR_MAX_HEIGHT = 420;
export const RESPONSIVE_SIDEBAR_COLLAPSE_THRESHOLD = 96;
export const TIMELINE_RESIZE_MIN_HEIGHT = 96;
export const TIMELINE_RESIZE_MAX_HEIGHT = 520;
export const TIMELINE_COLLAPSED_HEIGHT = 128;
export const RESPONSIVE_LAYOUT_MAX_WIDTH = 900;

export function isResponsiveLayout(): boolean {
	return typeof window !== 'undefined' && window.innerWidth <= RESPONSIVE_LAYOUT_MAX_WIDTH;
}
