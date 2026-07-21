import { shouldPreventOverlayPointerDefault } from '../../../src/shared/overlay-pointer-guard.ts';

export type OverlayPlacement = {
	gap?: number;
	zIndex?: number;
	prefer?: 'below' | 'above' | 'auto';
	align?: 'start' | 'end' | 'stretch';
	maxWidth?: number;
	maxHeight?: number;
	minWidth?: number;
};

export type OverlayRect = {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
};

export type OverlayViewport = {
	width: number;
	height: number;
};

export type ComputedOverlayGeometry = {
	top: number;
	left: number;
	width: number;
	maxWidth: number;
	maxHeight: number;
	minWidth: number;
	zIndex: number;
	stretchedWidth?: number;
};

/**
 * Pure viewport clamping for overlay panels. Used by the body portal so menus
 * never paint off-screen — one path for comboboxes, view/actions, hotkeys.
 */
export function computeOverlayGeometry(
	trigger: OverlayRect,
	panel: { width: number; height: number },
	viewport: OverlayViewport,
	options: OverlayPlacement = {},
): ComputedOverlayGeometry {
	const gap = options.gap ?? 4;
	const zIndex = options.zIndex ?? 1200;
	const prefer = options.prefer ?? 'auto';
	const align = options.align ?? 'start';
	const maxWidth = options.maxWidth ?? Math.min(560, viewport.width - 24);
	const maxHeight = options.maxHeight ?? Math.min(viewport.height * 0.7, 420);
	const minWidth = options.minWidth ?? Math.min(trigger.width, maxWidth);
	const panelWidth = Math.min(Math.max(panel.width || minWidth, minWidth), maxWidth);
	const estimatedHeight = Math.min(panel.height || maxHeight, maxHeight);

	let top = trigger.bottom + gap;
	if (prefer === 'above' || (prefer === 'auto' && top + estimatedHeight > viewport.height - 12)) {
		top = Math.max(12, trigger.top - gap - estimatedHeight);
	}
	top = Math.min(Math.max(12, top), Math.max(12, viewport.height - estimatedHeight - 12));

	let left = trigger.left;
	let stretchedWidth: number | undefined;
	if (align === 'end') {
		left = trigger.right - panelWidth;
	} else if (align === 'stretch') {
		left = trigger.left;
		stretchedWidth = Math.round(Math.min(trigger.width, maxWidth));
	}
	left = Math.min(Math.max(12, left), Math.max(12, viewport.width - panelWidth - 12));

	return {
		top: Math.round(top),
		left: Math.round(left),
		width: Math.round(panelWidth),
		maxWidth: Math.round(maxWidth),
		maxHeight: Math.round(maxHeight),
		minWidth: Math.round(minWidth),
		zIndex,
		stretchedWidth,
	};
}

const PORTAL_ID = 'timelineOverlayPortal';

export function ensureOverlayPortal(): HTMLElement {
	let portal = document.getElementById(PORTAL_ID);
	if (!(portal instanceof HTMLElement)) {
		portal = document.createElement('div');
		portal.id = PORTAL_ID;
		portal.className = 'timeline-overlay-portal';
		document.body.appendChild(portal);
	}
	return portal;
}

export { shouldPreventOverlayPointerDefault } from '../../../src/shared/overlay-pointer-guard.ts';

function bindOverlayPointerGuard(panel: HTMLElement): void {
	if (panel.dataset.overlayPointerGuard === 'true') {
		return;
	}
	panel.dataset.overlayPointerGuard = 'true';
	// Keep combobox focus when clicking options — but never block real inputs.
	panel.addEventListener('pointerdown', (event) => {
		if (!shouldPreventOverlayPointerDefault(event.target as { closest?: (s: string) => unknown } | null)) {
			return;
		}
		event.preventDefault();
	});
}

/**
 * Mount an overlay panel into the body portal and pin it to a trigger.
 * Escapes overflow/transform ancestors once — comboboxes, menus, popovers.
 */
export function placeOverlayPanel(trigger: HTMLElement, panel: HTMLElement, options: OverlayPlacement = {}): void {
	const portal = ensureOverlayPortal();
	// Foldkit may recreate the panel in-tree after a prior portal move. Prefer the
	// newest node and drop stale duplicates so IDs stay unique.
	if (panel.id) {
		const duplicates = document.querySelectorAll(`#${CSS.escape(panel.id)}`);
		for (const node of duplicates) {
			if (node !== panel && node instanceof HTMLElement) {
				node.remove();
			}
		}
	}
	if (panel.parentElement !== portal) {
		portal.appendChild(panel);
	}
	bindOverlayPointerGuard(panel);

	const geometry = computeOverlayGeometry(
		trigger.getBoundingClientRect(),
		{ width: panel.offsetWidth, height: panel.scrollHeight },
		{ width: window.innerWidth, height: window.innerHeight },
		options,
	);

	panel.hidden = false;
	panel.style.position = 'fixed';
	panel.style.zIndex = String(geometry.zIndex);
	panel.style.maxWidth = `${geometry.maxWidth}px`;
	panel.style.maxHeight = `${geometry.maxHeight}px`;
	panel.style.minWidth = `${geometry.minWidth}px`;
	panel.style.overflowX = 'hidden';
	panel.style.overflowY = 'auto';
	panel.style.right = 'auto';
	panel.style.bottom = 'auto';
	if (geometry.stretchedWidth !== undefined) {
		panel.style.width = `${geometry.stretchedWidth}px`;
	}
	panel.style.left = `${geometry.left}px`;
	panel.style.top = `${geometry.top}px`;
	panel.style.visibility = 'visible';
	panel.dataset.overlayPortaled = 'true';
}

export function releaseOverlayPanel(panel: HTMLElement | null): void {
	if (!(panel instanceof HTMLElement)) {
		return;
	}
	if (panel.dataset.overlayPortaled !== 'true') {
		return;
	}
	panel.hidden = true;
	panel.style.visibility = '';
	panel.style.position = '';
	panel.style.left = '';
	panel.style.top = '';
	panel.style.right = '';
	panel.style.bottom = '';
	panel.style.zIndex = '';
	panel.style.maxWidth = '';
	panel.style.maxHeight = '';
	panel.style.minWidth = '';
	panel.style.width = '';
	panel.style.overflowX = '';
	panel.style.overflowY = '';
	delete panel.dataset.overlayPortaled;
}

export function syncPortaledOverlays(
	specs: Array<{
		open: boolean;
		triggerId: string;
		panelId: string;
		placement?: OverlayPlacement;
	}>,
): void {
	if (typeof document === 'undefined') {
		return;
	}
	for (const spec of specs) {
		const trigger = document.getElementById(spec.triggerId);
		const panels = document.querySelectorAll(`#${CSS.escape(spec.panelId)}`);
		const panel = panels.length ? (panels.item(panels.length - 1) as HTMLElement) : null;
		if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
			continue;
		}
		if (!spec.open) {
			releaseOverlayPanel(panel);
			continue;
		}
		placeOverlayPanel(trigger, panel, spec.placement);
	}
}
