import { FileDiff, type FileContents } from '@pierre/diffs';
import type { Model } from '../model.ts';
import { getPreview } from '../selectors.ts';
import type { ContentMode, DiffPreview, LayoutMode } from '../types.ts';

const PIERRE_SLOT_ID = 'pierre-diff-slot';
const PIERRE_ROOT_ID = 'pierre-diff-root';

let fileDiff: FileDiff | undefined;
let lastOldFile: FileContents | undefined;
let lastNewFile: FileContents | undefined;
let lastLayoutMode: LayoutMode | undefined;
let lastContentMode: ContentMode | undefined;
let lastThemeType: 'dark' | 'light' | undefined;
let lastShowPierre = false;
let pendingFrame = 0;
let pendingModel: Model | null = null;
let slotObserver: ResizeObserver | undefined;
let observedSlot: HTMLElement | undefined;
let geometryListenersBound = false;

export function queuePierreFileDiffSync(model: Model): void {
	pendingModel = model;
	if (pendingFrame !== 0) {
		return;
	}
	pendingFrame = window.requestAnimationFrame(() => {
		pendingFrame = 0;
		const next = pendingModel;
		pendingModel = null;
		if (next) {
			syncFromModel(next);
		}
	});
}

function syncFromModel(model: Model): void {
	const preview = getPreview(model);
	const showPierre = Boolean(preview && (model.contentMode === 'full' || preview.hasChanges));

	// Keep the last rendered diff while a new preview is in flight so host
	// churn (sidebar counts, overview, etc.) cannot wipe Pierre mid-frame.
	if (!preview && lastShowPierre) {
		syncPortalGeometry(true);
		return;
	}

	syncPierreFileDiff({
		preview,
		layoutMode: model.layoutMode,
		contentMode: model.contentMode,
		showPierre,
	});
}

export type PierreDiffSyncArgs = {
	preview: DiffPreview | null;
	layoutMode: LayoutMode;
	contentMode: ContentMode;
	showPierre: boolean;
};

export function syncPierreFileDiff(args: PierreDiffSyncArgs): void {
	const portal = ensurePortal();
	observeSlot();

	if (!args.showPierre || !args.preview) {
		clearPierreFileDiff();
		lastShowPierre = false;
		syncPortalGeometry(false);
		return;
	}

	const themeType = resolveThemeType();
	const optionsChanged =
		lastLayoutMode !== args.layoutMode ||
		lastContentMode !== args.contentMode ||
		lastThemeType !== themeType ||
		!lastShowPierre;

	const nextOldFile = stableFileContents(lastOldFile, {
		name: args.preview.beforePath || 'before',
		contents: args.preview.beforeText ?? '',
		cacheKey: `old:${args.preview.beforePath}:${hashText(args.preview.beforeText ?? '')}`,
	});
	const nextNewFile = stableFileContents(lastNewFile, {
		name: args.preview.afterPath || 'after',
		contents: args.preview.afterText ?? '',
		cacheKey: `new:${args.preview.afterPath}:${hashText(args.preview.afterText ?? '')}`,
	});

	const filesChanged = nextOldFile !== lastOldFile || nextNewFile !== lastNewFile;

	if (!fileDiff) {
		fileDiff = new FileDiff(buildOptions(args.layoutMode, args.contentMode, themeType));
	} else if (optionsChanged) {
		fileDiff.setOptions(buildOptions(args.layoutMode, args.contentMode, themeType));
	}

	if (filesChanged || optionsChanged || portal.childElementCount === 0) {
		fileDiff.render({
			oldFile: nextOldFile,
			newFile: nextNewFile,
			containerWrapper: portal,
			forceRender: optionsChanged,
		});
	}

	lastOldFile = nextOldFile;
	lastNewFile = nextNewFile;
	lastLayoutMode = args.layoutMode;
	lastContentMode = args.contentMode;
	lastThemeType = themeType;
	lastShowPierre = true;
	syncPortalGeometry(true);
	// Second frame: FileDiff/shadow layout may settle after first paint.
	window.requestAnimationFrame(() => {
		if (lastShowPierre) {
			syncPortalGeometry(true);
		}
	});
}

export function clearPierreFileDiff(): void {
	fileDiff?.cleanUp();
	fileDiff = undefined;
	lastOldFile = undefined;
	lastNewFile = undefined;
	lastLayoutMode = undefined;
	lastContentMode = undefined;
	lastThemeType = undefined;
	lastShowPierre = false;

	const portal = document.getElementById(PIERRE_ROOT_ID);
	if (portal) {
		portal.replaceChildren();
		portal.hidden = true;
		portal.classList.add('is-pending');
	}
}

function ensurePortal(): HTMLElement {
	let portal = document.getElementById(PIERRE_ROOT_ID);
	if (!(portal instanceof HTMLElement)) {
		portal = document.createElement('div');
		portal.id = PIERRE_ROOT_ID;
		portal.className = 'pierre-diff-root';
		document.body.appendChild(portal);
	}
	return portal;
}

function observeSlot(): void {
	const slot = document.getElementById(PIERRE_SLOT_ID);
	const rows = document.getElementById('diffRows');
	if (!(slot instanceof HTMLElement)) {
		return;
	}
	if (observedSlot === slot && slotObserver) {
		return;
	}
	slotObserver?.disconnect();
	observedSlot = slot;
	slotObserver = new ResizeObserver(() => {
		syncPortalGeometry(lastShowPierre);
	});
	slotObserver.observe(slot);
	if (rows instanceof HTMLElement) {
		slotObserver.observe(rows);
	}
	bindGeometryListeners();
}

function bindGeometryListeners(): void {
	if (geometryListenersBound) {
		return;
	}
	geometryListenersBound = true;
	window.addEventListener('resize', () => syncPortalGeometry(lastShowPierre));
	window.visualViewport?.addEventListener('resize', () => syncPortalGeometry(lastShowPierre));
	window.visualViewport?.addEventListener('scroll', () => syncPortalGeometry(lastShowPierre));
}

function syncPortalGeometry(visible: boolean): void {
	const portal = ensurePortal();
	const slot = document.getElementById(PIERRE_SLOT_ID);
	const rows = document.getElementById('diffRows');
	if (!(slot instanceof HTMLElement) || !visible) {
		portal.hidden = true;
		portal.classList.add('is-pending');
		return;
	}

	// Prefer the laid-out slot, but if the flex/grid chain collapsed (common in
	// VS Code webviews), fill the remaining viewport under the diff chrome.
	const slotRect = slot.getBoundingClientRect();
	const rowsRect = rows instanceof HTMLElement ? rows.getBoundingClientRect() : slotRect;
	const top = Math.round(Math.max(slotRect.top, rowsRect.top + 6));
	const left = Math.round(rowsRect.left);
	const width = Math.max(0, Math.round(rowsRect.width));
	const viewportBottom = Math.round(window.visualViewport?.height ?? window.innerHeight);
	const heightFromLayout = Math.max(0, Math.round(Math.max(slotRect.height, rowsRect.bottom - top)));
	const heightFromViewport = Math.max(0, viewportBottom - top - 8);
	const height = Math.max(heightFromLayout, heightFromViewport);

	portal.hidden = width < 2 || height < 2;
	portal.classList.toggle('is-pending', portal.hidden);
	portal.style.left = `${left}px`;
	portal.style.top = `${top}px`;
	portal.style.width = `${width}px`;
	portal.style.height = `${height}px`;
}

function buildOptions(layoutMode: LayoutMode, contentMode: ContentMode, themeType: 'dark' | 'light') {
	return {
		theme: { dark: 'pierre-dark' as const, light: 'pierre-light' as const },
		themeType,
		diffStyle: layoutMode === 'unified' ? ('unified' as const) : ('split' as const),
		expandUnchanged: contentMode === 'full',
		disableFileHeader: true,
		hunkSeparators: 'line-info' as const,
		diffIndicators: 'bars' as const,
		overflow: 'scroll' as const,
		// Shadow DOM: force the split code panes to use the full portal height and
		// scroll inside — default align-self:flex-start leaves a tiny content strip.
		unsafeCSS: `
			:host {
				display: block !important;
				height: 100% !important;
				min-height: 0 !important;
				overflow: hidden !important;
			}
			pre {
				height: 100% !important;
				min-height: 0 !important;
				max-height: 100% !important;
				box-sizing: border-box !important;
			}
			[data-diff-type='split'][data-overflow='scroll'] {
				height: 100% !important;
				min-height: 0 !important;
			}
			/* Bound the panes to the portal, but keep line rows natural height.
			   Default align-content:stretch expands each row to fill leftover space. */
			[data-diff-type='split'][data-overflow='scroll'] > [data-code],
			[data-diff-type='split'][data-overflow='scroll'] > code {
				align-self: stretch !important;
				align-content: start !important;
				height: 100% !important;
				min-height: 0 !important;
				max-height: 100% !important;
				overflow: auto !important;
			}
			[data-overflow='scroll'][data-diff-type='unified'] {
				height: 100% !important;
				max-height: 100% !important;
				overflow: auto !important;
				align-content: start !important;
			}
		`,
	};
}

function resolveThemeType(): 'dark' | 'light' {
	const body = document.body;
	if (
		body.classList.contains('vscode-light') ||
		body.classList.contains('vscode-high-contrast-light') ||
		body.dataset.vscodeThemeKind === 'vscode-light'
	) {
		return 'light';
	}
	if (window.matchMedia?.('(prefers-color-scheme: light)').matches && !body.classList.contains('vscode-dark')) {
		if (getComputedStyle(body).colorScheme === 'light') {
			return 'light';
		}
	}
	return 'dark';
}

function stableFileContents(previous: FileContents | undefined, next: FileContents): FileContents {
	if (
		previous &&
		previous.name === next.name &&
		previous.contents === next.contents &&
		previous.cacheKey === next.cacheKey
	) {
		return previous;
	}
	return next;
}

function hashText(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}
