import type { Model } from '../model.ts';
import { syncPortaledOverlays } from './overlay-portal.ts';

/**
 * Escape overflow:hidden / transform ancestors by portaling open chrome to
 * document.body and pinning to triggers. One path for menus + comboboxes.
 */
export function syncOverlayGeometry(model: Model): void {
	if (typeof document === 'undefined') {
		return;
	}

	const openComboboxId = model.openComboboxId._tag === 'Some' ? model.openComboboxId.value : null;

	syncPortaledOverlays([
		{
			open: model.hotkeysOpen,
			triggerId: 'toggleHotkeysButton',
			panelId: 'hotkeysPopover',
			placement: { zIndex: 1300, maxWidth: Math.min(560, window.innerWidth - 24), align: 'end' },
		},
		{
			open: model.viewMenuOpen,
			triggerId: 'viewMenuButton',
			panelId: 'viewMenu',
			placement: { zIndex: 1250, maxWidth: 280, align: 'end' },
		},
		{
			open: model.actionsMenuOpen,
			triggerId: 'actionsButton',
			panelId: 'actionsMenu',
			placement: { zIndex: 1260, maxWidth: 220, align: 'end' },
		},
		{
			open: openComboboxId === 'fromRevisionInput',
			triggerId: 'fromRevisionInput',
			panelId: 'fromRevisionInputOptions',
			placement: { zIndex: 1400, maxWidth: 720, minWidth: 280, align: 'start' },
		},
		{
			open: openComboboxId === 'toRevisionInput',
			triggerId: 'toRevisionInput',
			panelId: 'toRevisionInputOptions',
			placement: { zIndex: 1400, maxWidth: 720, minWidth: 280, align: 'start' },
		},
		{
			open: openComboboxId === 'fileSwitcher',
			triggerId: 'fileSwitcher',
			panelId: 'fileSwitcherOptions',
			placement: { zIndex: 1400, maxWidth: 720, minWidth: 280, align: 'start' },
		},
	]);
}
