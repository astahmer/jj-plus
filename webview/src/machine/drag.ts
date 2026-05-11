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

export const DragState = S.Union([DragIdle, DragAnchorIntent, DragRange, DragMarker]);
export type DragState = typeof DragState.Type;

export const TRACK_ANCHOR_DRAG_START_DISTANCE = 4;
