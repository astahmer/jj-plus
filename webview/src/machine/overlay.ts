import { Schema as S } from 'effect';
import { Machine } from 'foldkit/experimental';
import { to } from 'foldkit/experimental/machine';
import { m } from 'foldkit/message';
import { ts } from 'foldkit/schema';

// STATE — at most one chrome overlay open

export const Closed = ts('Closed');
export const Hotkeys = ts('Hotkeys');
export const ViewMenu = ts('ViewMenu');
export const ActionsMenu = ts('ActionsMenu');

export const OverlayState = S.Union([Closed, Hotkeys, ViewMenu, ActionsMenu]);
export type OverlayState = typeof OverlayState.Type;

// MESSAGE

export const ToggledHotkeys = m('ToggledHotkeys');
export const ToggledViewMenu = m('ToggledViewMenu');
export const ToggledActionsMenu = m('ToggledActionsMenu');
export const ClosedOverlays = m('ClosedOverlays');

export const OverlayMessage = S.Union([ToggledHotkeys, ToggledViewMenu, ToggledActionsMenu, ClosedOverlays]);
export type OverlayMessage = typeof OverlayMessage.Type;

// MACHINE

export const overlayMachine = Machine.define({
	state: OverlayState,
	message: OverlayMessage,
})({
	initial: Closed(),
	states: {
		Closed: {
			on: {
				ToggledHotkeys: to('Hotkeys', () => Hotkeys()),
				ToggledViewMenu: to('ViewMenu', () => ViewMenu()),
				ToggledActionsMenu: to('ActionsMenu', () => ActionsMenu()),
				ClosedOverlays: to('Closed', () => Closed()),
			},
		},
		Hotkeys: {
			on: {
				ToggledHotkeys: to('Closed', () => Closed()),
				ToggledViewMenu: to('ViewMenu', () => ViewMenu()),
				ToggledActionsMenu: to('ActionsMenu', () => ActionsMenu()),
				ClosedOverlays: to('Closed', () => Closed()),
			},
		},
		ViewMenu: {
			on: {
				ToggledHotkeys: to('Hotkeys', () => Hotkeys()),
				ToggledViewMenu: to('Closed', () => Closed()),
				ToggledActionsMenu: to('ActionsMenu', () => ActionsMenu()),
				ClosedOverlays: to('Closed', () => Closed()),
			},
		},
		ActionsMenu: {
			on: {
				ToggledHotkeys: to('Hotkeys', () => Hotkeys()),
				ToggledViewMenu: to('ViewMenu', () => ViewMenu()),
				ToggledActionsMenu: to('Closed', () => Closed()),
				ClosedOverlays: to('Closed', () => Closed()),
			},
		},
	},
});

export function overlayStateFromFlags(flags: {
	hotkeysOpen: boolean;
	viewMenuOpen: boolean;
	actionsMenuOpen: boolean;
}): OverlayState {
	if (flags.hotkeysOpen) {
		return Hotkeys();
	}
	if (flags.viewMenuOpen) {
		return ViewMenu();
	}
	if (flags.actionsMenuOpen) {
		return ActionsMenu();
	}
	return Closed();
}

export function overlayFlagsFromState(state: OverlayState): {
	hotkeysOpen: boolean;
	viewMenuOpen: boolean;
	actionsMenuOpen: boolean;
} {
	return {
		hotkeysOpen: state._tag === 'Hotkeys',
		viewMenuOpen: state._tag === 'ViewMenu',
		actionsMenuOpen: state._tag === 'ActionsMenu',
	};
}
