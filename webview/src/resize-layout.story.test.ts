import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import {
	PointerMovedDuringDrag,
	PressedSidebarResize,
	PressedTimelineResize,
	ReleasedPointerDuringDrag,
} from './messages.ts';
import { PersistState } from './commands.ts';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { update } from './update.ts';
import { clampTooltipX, clampTooltipY, shouldPlaceTooltipBelow } from './domain/timeline-tooltips.ts';

test('sidebar resize drag updates width and persists on release', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(PressedSidebarResize({ clientX: 280, clientY: 100, button: 0 })),
		Story.model((model) => {
			expect(model.dragState._tag).toBe('DragSidebarResize');
			expect(model.sidebarWidth).toBe(280);
		}),
		Story.message(PointerMovedDuringDrag({ clientX: 340, clientY: 100 })),
		Story.model((model) => {
			expect(model.sidebarCollapsed).toBe(false);
			expect(model.sidebarWidth).toBe(340);
		}),
		Story.message(ReleasedPointerDuringDrag()),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.dragState._tag).toBe('DragIdle');
			expect(model.sidebarWidth).toBe(340);
		}),
	);
});

test('sidebar resize past collapse threshold collapses the sidebar', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(PressedSidebarResize({ clientX: 280, clientY: 100, button: 0 })),
		Story.message(PointerMovedDuringDrag({ clientX: 40, clientY: 100 })),
		Story.model((model) => {
			expect(model.sidebarCollapsed).toBe(true);
			expect(model.dragState._tag).toBe('DragIdle');
		}),
	);
});

test('timeline resize drag updates pane height', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(PressedTimelineResize({ clientY: 200, button: 0 })),
		Story.model((model) => {
			expect(model.dragState._tag).toBe('DragTimelineResize');
		}),
		Story.message(PointerMovedDuringDrag({ clientX: 0, clientY: 260 })),
		Story.model((model) => {
			expect(model.timelinePaneCollapsed).toBe(false);
			expect(model.timelinePaneHeight).toBe(280);
		}),
		Story.message(ReleasedPointerDuringDrag()),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
	);
});

test('tooltip clamps keep content inside the viewport', () => {
	const previous = globalThis.window;
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { innerWidth: 800, innerHeight: 600 },
	});

	expect(clampTooltipX(10)).toBe(180);
	expect(clampTooltipX(790)).toBe(620);
	expect(shouldPlaceTooltipBelow(20, 160)).toBe(true);
	expect(shouldPlaceTooltipBelow(400, 160)).toBe(false);
	expect(clampTooltipY(20, 160, true)).toBe(28);
	expect(clampTooltipY(20, 160, false)).toBe(168);
	expect(clampTooltipY(700, 160, false)).toBe(592);

	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: previous,
	});
});
