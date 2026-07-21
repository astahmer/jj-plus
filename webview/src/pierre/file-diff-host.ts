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
let portalMutationObserver: MutationObserver | undefined;
let observedSlot: HTMLElement | undefined;
let geometryListenersBound = false;
let lastForcedHeight = -1;

type DiffLayoutMetrics = {
	viewportH: number;
	portalH: number;
	portalTop: number;
	hostH: number;
	hostScrollH: number;
	rowsH: number;
	contentH: number;
	timelineH: number;
	maxLineH: number;
	minLineH: number;
	lineCount: number;
	maxCodeScrollH: number;
	minCodeClientH: number;
	portalFillRatio: number;
	paintedH: number;
	paintedRatio: number;
	lineTopSpan: number;
	uniqueLineTops: number;
	isCrushed: boolean;
};

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

type PierreDiffSyncArgs = {
	preview: DiffPreview | null;
	layoutMode: LayoutMode;
	contentMode: ContentMode;
	showPierre: boolean;
};

function syncPierreFileDiff(args: PierreDiffSyncArgs): void {
	const portal = ensurePortal();
	observeSlot();
	observePortalMutations(portal);

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

	// Size the portal before FileDiff paints so --pierre-portal-height is real
	// on first shadow stylesheet application (avoids height:100% collapse).
	syncPortalGeometry(true);

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
	window.requestAnimationFrame(() => {
		if (lastShowPierre) {
			syncPortalGeometry(true);
			repairPierreWrapRowSpans(portal);
		}
	});
}

function clearPierreFileDiff(): void {
	fileDiff?.cleanUp();
	fileDiff = undefined;
	lastOldFile = undefined;
	lastNewFile = undefined;
	lastLayoutMode = undefined;
	lastContentMode = undefined;
	lastThemeType = undefined;
	lastShowPierre = false;
	lastForcedHeight = -1;

	const portal = document.getElementById(PIERRE_ROOT_ID);
	if (portal) {
		portal.replaceChildren();
		portal.hidden = true;
		portal.classList.add('is-pending');
	}
}

export function measureDiffLayoutMetrics(): DiffLayoutMetrics {
	const portal = document.getElementById(PIERRE_ROOT_ID);
	if (portal instanceof HTMLElement) {
		repairPierreWrapRowSpans(portal);
	}
	const rows = document.getElementById('diffRows');
	const content = document.querySelector('.diff-content');
	const timeline = document.querySelector('.timeline-pane');
	const host = portal?.querySelector('diffs-container') as HTMLElement | null;
	const root = host?.shadowRoot;
	const codes = [...(root?.querySelectorAll('[data-code], [data-overflow] > code, pre > code') ?? [])] as HTMLElement[];
	const lines = [...(root?.querySelectorAll('[data-line]') ?? [])] as HTMLElement[];
	const viewportH = Math.round(window.visualViewport?.height ?? window.innerHeight);
	const portalRect = portal?.getBoundingClientRect();
	const portalH = portalRect ? Math.round(portalRect.height) : 0;
	const portalTop = portalRect ? Math.round(portalRect.top) : 0;
	const hostH = host ? Math.round(host.getBoundingClientRect().height) : 0;
	const hostScrollH = host ? Math.round(host.scrollHeight) : 0;
	const rowsH = rows ? Math.round(rows.getBoundingClientRect().height) : 0;
	const contentH = content instanceof HTMLElement ? Math.round(content.getBoundingClientRect().height) : 0;
	const timelineH = timeline instanceof HTMLElement ? Math.round(timeline.getBoundingClientRect().height) : 0;
	const lineHeights = lines.map((line) => Math.round(line.getBoundingClientRect().height)).filter((h) => h > 0);
	const codeClientHeights = codes.map((c) => Math.round(c.getBoundingClientRect().height));
	const codeScrollHeights = codes.map((c) => Math.round(c.scrollHeight));
	const maxCodeScrollH = codeScrollHeights.length ? Math.max(...codeScrollHeights) : 0;
	const minCodeClientH = codeClientHeights.length ? Math.min(...codeClientHeights) : 0;
	const maxLineH = lineHeights.length ? Math.max(...lineHeights) : 0;
	const minLineH = lineHeights.length ? Math.min(...lineHeights) : 0;
	const lineCount = lines.length;
	const lineTops = lines.map((line) => line.getBoundingClientRect().top);
	const lineTopSpan = lineTops.length > 0 ? Math.round(Math.max(...lineTops) - Math.min(...lineTops)) : 0;
	const uniqueLineTops = new Set(lineTops.map((top) => Math.round(top / 2) * 2)).size;
	let paintedH = 0;
	if (portalRect) {
		for (const line of lines) {
			const rect = line.getBoundingClientRect();
			if (rect.bottom < portalRect.top || rect.top > portalRect.bottom) {
				continue;
			}
			paintedH += Math.max(0, Math.min(rect.bottom, portalRect.bottom) - Math.max(rect.top, portalRect.top));
		}
	}
	paintedH = Math.round(paintedH);
	const paintedRatio = portalH > 0 ? paintedH / portalH : 0;
	// Crush signatures seen in VS Code for large atproto diffs:
	// - many Pierre lines mounted
	// - host scrollport not growing (wrap content collapsed)
	// - line tops clustered instead of flowing down the document
	const isCrushed =
		portalH > 200 &&
		lineCount > 40 &&
		((hostScrollH <= portalH + 24 && lineTopSpan < Math.max(120, portalH * 0.45)) ||
			(uniqueLineTops < Math.max(8, Math.floor(lineCount * 0.2)) && lineTopSpan < portalH * 0.5));

	return {
		viewportH,
		portalH,
		portalTop,
		hostH,
		hostScrollH,
		rowsH,
		contentH,
		timelineH,
		maxLineH,
		minLineH,
		lineCount,
		maxCodeScrollH,
		minCodeClientH,
		portalFillRatio: viewportH > 0 ? portalH / viewportH : 0,
		paintedH,
		paintedRatio,
		lineTopSpan,
		uniqueLineTops,
		isCrushed,
	};
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
	const content = document.querySelector('.diff-content');
	const workspace = document.querySelector('.workspace');
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
	if (content instanceof HTMLElement) {
		slotObserver.observe(content);
	}
	if (workspace instanceof HTMLElement) {
		slotObserver.observe(workspace);
	}
	bindGeometryListeners();
}

function observePortalMutations(portal: HTMLElement): void {
	if (portalMutationObserver) {
		return;
	}
	portalMutationObserver = new MutationObserver(() => {
		if (lastShowPierre) {
			syncPortalGeometry(true);
		}
	});
	portalMutationObserver.observe(portal, { childList: true, subtree: true });
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
	const content = document.querySelector('.diff-content');
	if (!(slot instanceof HTMLElement) || !visible) {
		portal.hidden = true;
		portal.classList.add('is-pending');
		portal.style.removeProperty('--pierre-portal-height');
		lastForcedHeight = -1;
		return;
	}

	// Prefer the laid-out slot, but if the flex/grid chain collapsed (common in
	// VS Code webviews), fill the remaining viewport under the diff chrome.
	const slotRect = slot.getBoundingClientRect();
	const rowsRect = rows instanceof HTMLElement ? rows.getBoundingClientRect() : slotRect;
	const contentRect = content instanceof HTMLElement ? content.getBoundingClientRect() : rowsRect;
	const top = Math.round(Math.max(slotRect.top, rowsRect.top, contentRect.top + 4));
	const left = Math.round(Math.min(rowsRect.left, contentRect.left));
	const width = Math.max(0, Math.round(Math.max(rowsRect.width, contentRect.width)));
	const viewportBottom = Math.round(window.visualViewport?.height ?? window.innerHeight);
	const heightFromLayout = Math.max(
		0,
		Math.round(Math.max(slotRect.height, rowsRect.bottom - top, contentRect.bottom - top)),
	);
	const heightFromViewport = Math.max(0, viewportBottom - top - 4);
	// Always prefer filling to the viewport bottom so a collapsed grid chain
	// cannot leave a black void under a content-sized Pierre strip.
	const height = Math.max(heightFromLayout, heightFromViewport);

	portal.hidden = width < 2 || height < 2;
	portal.classList.toggle('is-pending', portal.hidden);
	portal.style.left = `${left}px`;
	portal.style.top = `${top}px`;
	portal.style.width = `${width}px`;
	portal.style.height = `${height}px`;
	portal.style.setProperty('--pierre-portal-height', `${height}px`);
	forcePierreHostScrollport(portal, height);
	repairPierreWrapRowSpans(portal);
}

/**
 * Portal/`diffs-container` is the scrollport. Pierre content stays content-sized
 * (`overflow: wrap`). Never set height:100% on [data-code] — that collapses to a
 * few pixels in VS Code when the % chain is unresolved (standalone often lucks out).
 */
function forcePierreHostScrollport(portal: HTMLElement, height: number): void {
	if (height === lastForcedHeight) {
		// Still refresh hosts in case Pierre recreated the custom element.
	} else {
		lastForcedHeight = height;
	}

	const hosts = portal.querySelectorAll('diffs-container');
	for (const host of hosts) {
		if (!(host instanceof HTMLElement)) {
			continue;
		}
		host.style.setProperty('display', 'block');
		host.style.setProperty('height', `${height}px`);
		host.style.setProperty('max-height', `${height}px`);
		host.style.setProperty('min-height', '0');
		host.style.setProperty('overflow', 'auto');
		host.style.setProperty('box-sizing', 'border-box');
		host.style.setProperty('width', '100%');
	}
}

function parseGridRowSpan(value: string): number {
	const matched = value.match(/span\s+(\d+)/u)?.[1];
	const parsed = Number.parseInt(matched ?? '', 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

function repairWrapGridColumns(container: HTMLElement): void {
	const columns = [...container.querySelectorAll(':scope > [data-gutter], :scope > [data-content]')] as HTMLElement[];
	const nestedColumns =
		columns.length > 0 ? columns : ([...container.querySelectorAll('[data-gutter], [data-content]')] as HTMLElement[]);
	if (nestedColumns.length === 0) {
		return;
	}
	const rowCount = Math.max(
		1,
		...nestedColumns.map((column) => {
			const fromStyle = parseGridRowSpan(column.style.gridRow);
			const fromCode = parseGridRowSpan((column.parentElement as HTMLElement | null)?.style.gridRow ?? '');
			return Math.max(column.childElementCount, fromStyle, fromCode);
		}),
	);
	for (const column of nestedColumns) {
		column.style.setProperty('grid-row', `span ${rowCount}`);
	}
	container.style.setProperty('grid-auto-rows', 'max-content');
}

/**
 * Wrap mode needs `grid-row: span N` on gutter/content so subgrid lines stack into
 * distinct tracks. In VS Code Electron those spans often never stick (especially
 * split+wrap with `display: contents` on [data-code]), collapsing every line onto
 * one top. Re-apply spans for both split and unified wrap roots.
 */
function repairPierreWrapRowSpans(portal: HTMLElement): void {
	const hosts = portal.querySelectorAll('diffs-container');
	for (const host of hosts) {
		const root = host.shadowRoot;
		if (!root) {
			continue;
		}
		for (const wrap of root.querySelectorAll('[data-diff-type="split"][data-overflow="wrap"]')) {
			if (wrap instanceof HTMLElement) {
				repairWrapGridColumns(wrap);
			}
		}
		for (const code of root.querySelectorAll(
			'[data-diff-type="single"][data-overflow="wrap"] code[data-unified], [data-diff-type="single"][data-overflow="wrap"] [data-code]',
		)) {
			if (code instanceof HTMLElement) {
				repairWrapGridColumns(code);
			}
		}
	}
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
		// Wrap: content defines height; our host scrolls. Avoids Pierre's default
		// overflow:scroll + align-self:flex-start fighting a height:100% override.
		overflow: 'wrap' as const,
		unsafeCSS: `
			:host {
				display: block !important;
				height: var(--pierre-portal-height, 100%) !important;
				min-height: 0 !important;
				max-height: var(--pierre-portal-height, 100%) !important;
				overflow: auto !important;
				box-sizing: border-box !important;
			}
			/* contain:content + display:contents on [data-code] collapses wrap
			   row tracks in VS Code Electron (all lines share one grid row). */
			code[data-code] {
				contain: none !important;
			}
			[data-diff-type="split"][data-overflow="wrap"],
			[data-diff-type="single"][data-overflow="wrap"] code[data-unified],
			[data-diff-type="single"][data-overflow="wrap"] [data-code] {
				grid-auto-rows: max-content !important;
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
