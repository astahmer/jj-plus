import type { Model } from '../model.ts';

function placeFixedBelowRight(trigger: HTMLElement, panel: HTMLElement, gap = 4, zIndex = 1000): void {
	const rect = trigger.getBoundingClientRect();
	const panelWidth = Math.min(panel.offsetWidth || 260, window.innerWidth - 24);
	const maxHeight = Math.min(window.innerHeight * 0.7, 520);
	let top = rect.bottom + gap;
	const right = Math.max(12, window.innerWidth - rect.right);
	const estimatedHeight = Math.min(panel.scrollHeight || maxHeight, maxHeight);
	if (top + estimatedHeight > window.innerHeight - 12) {
		top = Math.max(12, rect.top - gap - estimatedHeight);
	}
	panel.style.position = 'fixed';
	panel.style.top = `${Math.round(top)}px`;
	panel.style.right = `${Math.round(right)}px`;
	panel.style.left = 'auto';
	panel.style.bottom = 'auto';
	panel.style.maxHeight = `${Math.round(maxHeight)}px`;
	panel.style.width = `${Math.round(panelWidth)}px`;
	panel.style.zIndex = String(zIndex);
}

/**
 * Escape overflow:hidden ancestors by fixing open menus/hotkeys to the viewport,
 * anchored to their trigger buttons (same idea as track tooltips).
 */
export function syncOverlayGeometry(model: Model): void {
	if (typeof document === 'undefined') {
		return;
	}

	if (model.hotkeysOpen) {
		const trigger = document.getElementById('toggleHotkeysButton');
		const panel = document.getElementById('hotkeysPopover');
		if (trigger instanceof HTMLElement && panel instanceof HTMLElement) {
			placeFixedBelowRight(trigger, panel, 4, 1100);
			panel.style.width = `${Math.min(560, window.innerWidth - 24)}px`;
		}
	}

	if (model.viewMenuOpen) {
		const trigger = document.getElementById('viewMenuButton');
		const panel = document.getElementById('viewMenu');
		if (trigger instanceof HTMLElement && panel instanceof HTMLElement) {
			placeFixedBelowRight(trigger, panel, 4, 1000);
			panel.style.width = `${Math.min(280, window.innerWidth - 24)}px`;
		}
	}

	if (model.actionsMenuOpen) {
		const trigger = document.getElementById('actionsButton');
		const panel = document.getElementById('actionsMenu');
		if (trigger instanceof HTMLElement && panel instanceof HTMLElement) {
			placeFixedBelowRight(trigger, panel, 4, 1050);
			panel.style.width = `${Math.min(220, window.innerWidth - 24)}px`;
		}
	}
}
