import { FileDiff, type DiffLineAnnotation, type FileContents } from '@pierre/diffs';
import { languageFromPath } from '../../../src/shared/pierre-language.ts';
import { resolvePierreThemeType, type PierreThemePreference } from '../../../src/shared/pierre-theme.ts';
import { findBlameForLine, type BlameLine } from '../../../src/shared/blame.ts';
import { computeBlameHeatLevels, heatLevelClass, type HeatLevel } from '../../../src/shared/blame-heatmap.ts';
import type { Model } from '../model.ts';
import { getPreview, getRangeStackItems } from '../selectors.ts';
import type { ContentMode, DiffPreview, LayoutMode } from '../types.ts';
import { ensurePierreWorkerPool, getPierreWorkerPool } from './worker-pool.ts';

export const PIERRE_BLAME_LINE_EVENT = 'jj-timeline-blame-line';

const PIERRE_SLOT_ID = 'pierre-diff-slot';
const PIERRE_ROOT_ID = 'pierre-diff-root';

type BlameAnnotationMeta = BlameLine & { heatLevel?: HeatLevel };

let fileDiff: FileDiff | undefined;
let lastOldFile: FileContents | undefined;
let lastNewFile: FileContents | undefined;
let lastLayoutMode: LayoutMode | undefined;
let lastContentMode: ContentMode | undefined;
let lastThemeType: 'dark' | 'light' | undefined;
let lastShowPierre = false;
let lastBlameOverlayOpen = false;
let lastHeatmapOpen = false;
let lastLineDiffType: 'word-alt' | 'word' | 'char' | 'none' | undefined;
let lastBlameSignature = '';
let blameLinesCache: BlameLine[] = [];
let stackMode = false;
let workerPoolReady = false;
const stackByPath = new Map<
	string,
	{
		fileDiff: FileDiff;
		oldFile?: FileContents;
		newFile?: FileContents;
		section: HTMLElement;
		mount: HTMLElement;
	}
>();
let pendingFrame = 0;
let pendingModel: Model | null = null;
let slotObserver: ResizeObserver | undefined;
let portalMutationObserver: MutationObserver | undefined;
let observedSlot: HTMLElement | undefined;
let geometryListenersBound = false;
let lastForcedHeight = -1;
let shadowObservers = new WeakMap<ShadowRoot, MutationObserver>();

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
	lastSyncedModel = model;
	observePierreThemePreference(() => lastSyncedModel);
	pendingModel = model;
	void ensurePierreWorkerPool().then((pool) => {
		if (pool && !workerPoolReady) {
			workerPoolReady = true;
			// Recreate FileDiff instances so they attach to the worker pool.
			if (fileDiff) {
				fileDiff.cleanUp();
				fileDiff = undefined;
				lastShowPierre = false;
			}
			for (const entry of stackByPath.values()) {
				entry.fileDiff.cleanUp();
			}
			stackByPath.clear();
			if (pendingModel) {
				queuePierreFileDiffSync(pendingModel);
			}
		}
	});
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

function createFileDiff(
	layoutMode: LayoutMode,
	contentMode: ContentMode,
	themeType: 'dark' | 'light',
	blameOverlayOpen: boolean,
	heatmapOpen: boolean,
	lineDiffType: 'word-alt' | 'word' | 'char' | 'none',
	embeddedInStack = false,
): FileDiff {
	return new FileDiff(
		buildOptions(
			layoutMode,
			contentMode,
			themeType,
			blameOverlayOpen,
			heatmapOpen,
			lineDiffType,
			embeddedInStack,
		) as never,
		getPierreWorkerPool(),
	);
}

function syncFromModel(model: Model): void {
	blameLinesCache = model.blameOverlayOpen || model.heatmapOpen ? (model.blameLines as BlameLine[]) : [];

	if (model.rangeStackOpen) {
		const items = getRangeStackItems(model);
		const showStack = items.length > 0;
		if (!showStack && stackMode) {
			syncPortalGeometry(true);
			return;
		}
		syncRangeStack({
			items,
			layoutMode: model.layoutMode,
			contentMode: model.contentMode,
			showStack,
			themePreference: model.themePreference,
		});
		return;
	}

	if (stackMode) {
		clearRangeStack();
	}

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
		blameOverlayOpen: model.blameOverlayOpen,
		heatmapOpen: model.heatmapOpen,
		blameLines: blameLinesCache,
		themePreference: model.themePreference,
		lineDiffType: model.lineDiffType,
	});
}

type PierreDiffSyncArgs = {
	preview: DiffPreview | null;
	layoutMode: LayoutMode;
	contentMode: ContentMode;
	showPierre: boolean;
	blameOverlayOpen: boolean;
	heatmapOpen: boolean;
	blameLines: BlameLine[];
	themePreference: 'auto' | 'light' | 'dark';
	lineDiffType: 'word-alt' | 'word' | 'char' | 'none';
};

type RangeStackSyncArgs = {
	items: Array<{ relativePath: string; preview: DiffPreview }>;
	layoutMode: LayoutMode;
	contentMode: ContentMode;
	showStack: boolean;
	themePreference: 'auto' | 'light' | 'dark';
};

function syncRangeStack(args: RangeStackSyncArgs): void {
	const portal = ensurePortal();
	observeSlot();
	observePortalMutations(portal);
	portal.classList.add('is-range-stack');

	if (!args.showStack) {
		clearRangeStack();
		syncPortalGeometry(false);
		return;
	}

	if (!stackMode) {
		clearPierreFileDiff();
		stackMode = true;
	}

	const themeType = resolveThemeType(args.themePreference);
	const keep = new Set(args.items.map((item) => item.relativePath));
	for (const [path, entry] of stackByPath) {
		if (!keep.has(path)) {
			entry.fileDiff.cleanUp();
			entry.section.remove();
			stackByPath.delete(path);
		}
	}

	for (const item of args.items) {
		let entry = stackByPath.get(item.relativePath);
		if (!entry) {
			const section = document.createElement('section');
			section.className = 'pierre-stack-section';
			section.dataset.path = item.relativePath;
			const header = document.createElement('header');
			header.className = 'pierre-stack-header';
			const mount = document.createElement('div');
			mount.className = 'pierre-stack-mount';
			section.append(header, mount);
			portal.append(section);
			entry = {
				fileDiff: createFileDiff(args.layoutMode, args.contentMode, themeType, false, false, 'word-alt', true),
				section,
				mount,
			};
			stackByPath.set(item.relativePath, entry);
		}

		const stackEntry = entry!;
		const header = stackEntry.section.querySelector('.pierre-stack-header');
		if (header) {
			header.textContent = `${item.relativePath}  +${item.preview.additions}/−${item.preview.deletions}`;
		}

		const nextOldFile = stableFileContents(stackEntry.oldFile, {
			name: item.preview.beforePath || item.relativePath,
			contents: item.preview.beforeText ?? '',
			cacheKey: `old:${item.relativePath}:${hashText(item.preview.beforeText ?? '')}`,
			lang: languageFromPath(item.preview.beforePath || item.relativePath),
		});
		const nextNewFile = stableFileContents(stackEntry.newFile, {
			name: item.preview.afterPath || item.relativePath,
			contents: item.preview.afterText ?? '',
			cacheKey: `new:${item.relativePath}:${hashText(item.preview.afterText ?? '')}`,
			lang: languageFromPath(item.preview.afterPath || item.relativePath),
		});
		const optionsChanged =
			lastLayoutMode !== args.layoutMode || lastContentMode !== args.contentMode || lastThemeType !== themeType;
		if (optionsChanged) {
			stackEntry.fileDiff.setOptions(
				buildOptions(args.layoutMode, args.contentMode, themeType, false, false, 'word-alt', true) as never,
			);
		}
		if (
			nextOldFile !== stackEntry.oldFile ||
			nextNewFile !== stackEntry.newFile ||
			optionsChanged ||
			stackEntry.mount.childElementCount === 0
		) {
			stackEntry.fileDiff.render({
				oldFile: nextOldFile,
				newFile: nextNewFile,
				containerWrapper: stackEntry.mount,
				forceRender: optionsChanged,
			});
		}
		stackEntry.oldFile = nextOldFile;
		stackEntry.newFile = nextNewFile;
	}

	lastLayoutMode = args.layoutMode;
	lastContentMode = args.contentMode;
	lastThemeType = themeType;
	lastShowPierre = true;
	syncPortalGeometry(true);
	window.requestAnimationFrame(() => {
		if (lastShowPierre && stackMode) {
			syncPortalGeometry(true);
			repairPierreWrapRowSpans(portal);
		}
	});
}

function clearRangeStack(): void {
	for (const entry of stackByPath.values()) {
		entry.fileDiff.cleanUp();
		entry.section.remove();
	}
	stackByPath.clear();
	stackMode = false;
	const portal = document.getElementById(PIERRE_ROOT_ID);
	if (portal) {
		portal.classList.remove('is-range-stack');
		portal.replaceChildren();
	}
}

function syncPierreFileDiff(args: PierreDiffSyncArgs): void {
	const portal = ensurePortal();
	portal.classList.remove('is-range-stack');
	observeSlot();
	observePortalMutations(portal);

	if (!args.showPierre || !args.preview) {
		clearPierreFileDiff();
		lastShowPierre = false;
		syncPortalGeometry(false);
		return;
	}

	const themeType = resolveThemeType(args.themePreference);
	const optionsChanged =
		lastLayoutMode !== args.layoutMode ||
		lastContentMode !== args.contentMode ||
		lastThemeType !== themeType ||
		lastBlameOverlayOpen !== args.blameOverlayOpen ||
		lastHeatmapOpen !== args.heatmapOpen ||
		lastLineDiffType !== args.lineDiffType ||
		!lastShowPierre;

	const nextOldFile = stableFileContents(lastOldFile, {
		name: args.preview.beforePath || 'before',
		contents: args.preview.beforeText ?? '',
		cacheKey: `old:${args.preview.beforePath}:${hashText(args.preview.beforeText ?? '')}`,
		lang: languageFromPath(args.preview.beforePath || args.preview.afterPath || 'file.ts'),
	});
	const nextNewFile = stableFileContents(lastNewFile, {
		name: args.preview.afterPath || 'after',
		contents: args.preview.afterText ?? '',
		cacheKey: `new:${args.preview.afterPath}:${hashText(args.preview.afterText ?? '')}`,
		lang: languageFromPath(args.preview.afterPath || args.preview.beforePath || 'file.ts'),
	});

	const filesChanged = nextOldFile !== lastOldFile || nextNewFile !== lastNewFile;
	const blameSignaturePreview = `${args.blameOverlayOpen ? 'on' : 'off'}:${args.heatmapOpen ? 'heat' : 'noheat'}:${args.blameLines
		.map((line) => `${line.line}:${line.revision}:${line.authorTimestamp ?? ''}`)
		.join('|')}`;
	const blameChanged = blameSignaturePreview !== lastBlameSignature;

	// Size the portal before FileDiff paints so --pierre-portal-height is real
	// on first shadow stylesheet application (avoids height:100% collapse).
	syncPortalGeometry(true);

	const options = buildOptions(
		args.layoutMode,
		args.contentMode,
		themeType,
		args.blameOverlayOpen,
		args.heatmapOpen,
		args.lineDiffType,
	) as never;
	if (!fileDiff) {
		fileDiff = createFileDiff(
			args.layoutMode,
			args.contentMode,
			themeType,
			args.blameOverlayOpen,
			args.heatmapOpen,
			args.lineDiffType,
		);
	} else if (optionsChanged) {
		fileDiff.setOptions(options);
	}

	if (filesChanged || optionsChanged || blameChanged || portal.childElementCount === 0) {
		fileDiff.render({
			oldFile: nextOldFile,
			newFile: nextNewFile,
			containerWrapper: portal,
			forceRender: optionsChanged || blameChanged,
			lineAnnotations: buildPierreBlameAnnotations(args.heatmapOpen, args.blameLines) as never,
		});
	} else if (fileDiff && (args.blameOverlayOpen || args.heatmapOpen || lastBlameSignature)) {
		// Annotations can change without file/options churn — pass them through render.
		fileDiff.render({
			oldFile: nextOldFile,
			newFile: nextNewFile,
			containerWrapper: portal,
			lineAnnotations: buildPierreBlameAnnotations(args.heatmapOpen, args.blameLines) as never,
		});
	}

	lastOldFile = nextOldFile;
	lastNewFile = nextNewFile;
	lastLayoutMode = args.layoutMode;
	lastContentMode = args.contentMode;
	lastThemeType = themeType;
	lastBlameOverlayOpen = args.blameOverlayOpen;
	lastHeatmapOpen = args.heatmapOpen;
	lastLineDiffType = args.lineDiffType;
	lastShowPierre = true;
	lastBlameSignature = `${args.blameOverlayOpen ? 'on' : 'off'}:${args.heatmapOpen ? 'heat' : 'noheat'}:${args.blameLines
		.map((line) => `${line.line}:${line.revision}:${line.authorTimestamp ?? ''}`)
		.join('|')}`;
	const portalEl = ensurePortal();
	portalEl.classList.toggle('is-blame-open', args.blameOverlayOpen);
	portalEl.classList.toggle('is-heatmap-open', args.heatmapOpen);
	syncPortalGeometry(true);
	window.requestAnimationFrame(() => {
		if (lastShowPierre) {
			syncPortalGeometry(true);
			repairPierreWrapRowSpans(portal);
			paintPierreBlameHeatOverlays({
				portal,
				blameOverlayOpen: args.blameOverlayOpen,
				heatmapOpen: args.heatmapOpen,
				blameLines: args.blameLines,
			});
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
	lastBlameOverlayOpen = false;
	lastBlameSignature = '';
	lastForcedHeight = -1;

	const portal = document.getElementById(PIERRE_ROOT_ID);
	if (portal && !stackMode) {
		portal.replaceChildren();
		portal.hidden = true;
		portal.classList.add('is-pending');
		portal.classList.remove('is-range-stack');
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
	if (!portalMutationObserver) {
		portalMutationObserver = new MutationObserver(() => {
			if (!lastShowPierre) {
				return;
			}
			observePierreShadowRoots(portal);
			schedulePierreWrapRepair(portal);
		});
		portalMutationObserver.observe(portal, { childList: true, subtree: true });
	}
	observePierreShadowRoots(portal);
}

function observePierreShadowRoots(portal: HTMLElement): void {
	for (const host of portal.querySelectorAll('diffs-container')) {
		const root = host.shadowRoot;
		if (!root || shadowObservers.has(root)) {
			continue;
		}
		const observer = new MutationObserver(() => {
			if (lastShowPierre) {
				schedulePierreWrapRepair(portal);
			}
		});
		observer.observe(root, { childList: true, subtree: true, attributes: true });
		shadowObservers.set(root, observer);
	}
}

function schedulePierreWrapRepair(portal: HTMLElement): void {
	syncPortalGeometry(true);
	window.requestAnimationFrame(() => {
		repairPierreWrapRowSpans(portal);
		window.requestAnimationFrame(() => repairPierreWrapRowSpans(portal));
	});
	window.setTimeout(() => {
		if (lastShowPierre) {
			repairPierreWrapRowSpans(portal);
		}
	}, 50);
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

	if (portal.classList.contains('is-range-stack')) {
		// Single scrollbar on the stack portal (GitHub PR review style).
		// Do not cap each file mount — that creates nested independent scrollers.
		portal.style.setProperty('overflow', 'auto');
		for (const mount of portal.querySelectorAll('.pierre-stack-mount')) {
			if (!(mount instanceof HTMLElement)) {
				continue;
			}
			mount.style.removeProperty('max-height');
			mount.style.setProperty('overflow', 'visible');
			const hosts = mount.querySelectorAll('diffs-container');
			for (const host of hosts) {
				if (!(host instanceof HTMLElement)) {
					continue;
				}
				host.style.setProperty('display', 'block');
				host.style.setProperty('height', 'auto');
				host.style.removeProperty('max-height');
				host.style.setProperty('min-height', '0');
				host.style.setProperty('overflow', 'visible');
				host.style.setProperty('box-sizing', 'border-box');
				host.style.setProperty('width', '100%');
			}
		}
		return;
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

function findAdditionSideLineElement(root: ShadowRoot, lineNumber: number): HTMLElement | undefined {
	const nodes = [...root.querySelectorAll(`[data-line="${lineNumber}"]`)] as HTMLElement[];
	if (!nodes.length) {
		return undefined;
	}
	const addition = nodes.find((node) => node.dataset.lineType === 'addition');
	if (addition) {
		return addition;
	}
	const nonDeletion = nodes.filter((node) => node.dataset.lineType !== 'deletion');
	return nonDeletion.at(-1) ?? nodes.at(-1);
}

const HEAT_LINE_BACKGROUNDS: Record<HeatLevel, string> = {
	0: 'color-mix(in srgb, #58a6ff 10%, transparent)',
	1: 'color-mix(in srgb, #58a6ff 18%, transparent)',
	2: 'color-mix(in srgb, #3fb950 20%, transparent)',
	3: 'color-mix(in srgb, #d29922 24%, transparent)',
	4: 'color-mix(in srgb, #f85149 28%, transparent)',
};

/** Full-line heatmap paint on the additions-side code rows (timeline blame chips removed). */
export function paintPierreBlameHeatOverlays(args: {
	portal: HTMLElement;
	blameOverlayOpen: boolean;
	heatmapOpen: boolean;
	blameLines: BlameLine[];
}): void {
	const host = args.portal.querySelector('diffs-container');
	const root = host?.shadowRoot;
	if (!root) {
		return;
	}

	for (const stale of root.querySelectorAll('.jjplus-eol-blame')) {
		stale.remove();
	}
	for (const painted of root.querySelectorAll('[data-jjplus-heat]')) {
		if (painted instanceof HTMLElement) {
			painted.style.removeProperty('background-color');
			painted.removeAttribute('data-jjplus-heat');
			painted.classList.remove('jjplus-line-heat');
		}
	}

	if (!args.heatmapOpen) {
		return;
	}

	const heat = computeBlameHeatLevels(args.blameLines);
	for (const [lineNumber, level] of heat) {
		const lineEl = findAdditionSideLineElement(root, lineNumber);
		if (!lineEl) {
			continue;
		}
		lineEl.dataset.jjplusHeat = String(level);
		lineEl.classList.add('jjplus-line-heat');
		lineEl.style.backgroundColor = HEAT_LINE_BACKGROUNDS[level];
	}
}

function buildPierreBlameAnnotations(
	heatmapOpen: boolean,
	blameLines: BlameLine[],
): DiffLineAnnotation<BlameAnnotationMeta>[] {
	// Heat still uses Pierre annotation slots for a gutter accent; blame is EOL-painted.
	if (!heatmapOpen) {
		return [];
	}
	const heat = computeBlameHeatLevels(blameLines);
	return blameLines.map((entry) => ({
		side: 'additions' as const,
		lineNumber: entry.line,
		metadata: {
			...entry,
			heatLevel: heat.get(entry.line),
		},
	}));
}

function emitBlameLineClick(lineNumber: number, revisionHint?: string): void {
	const blame = findBlameForLine(blameLinesCache, lineNumber);
	const revision = revisionHint || blame?.revision;
	if (!revision) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent(PIERRE_BLAME_LINE_EVENT, {
			detail: {
				line: lineNumber,
				revision,
			},
		}),
	);
}

function buildOptions(
	layoutMode: LayoutMode,
	contentMode: ContentMode,
	themeType: 'dark' | 'light',
	blameOverlayOpen = false,
	heatmapOpen = false,
	lineDiffType: 'word-alt' | 'word' | 'char' | 'none' = 'word-alt',
	embeddedInStack = false,
) {
	const hostSizing = embeddedInStack
		? `
			:host {
				display: block !important;
				height: auto !important;
				min-height: 0 !important;
				max-height: none !important;
				overflow: visible !important;
				box-sizing: border-box !important;
			}
		`
		: `
			:host {
				display: block !important;
				height: var(--pierre-portal-height, 100%) !important;
				min-height: 0 !important;
				max-height: var(--pierre-portal-height, 100%) !important;
				overflow: auto !important;
				box-sizing: border-box !important;
			}
		`;
	return {
		theme: { dark: 'pierre-dark' as const, light: 'pierre-light' as const },
		themeType,
		diffStyle: layoutMode === 'unified' ? ('unified' as const) : ('split' as const),
		lineDiffType,
		// Blame/heatmap overlays — do not force whole-file expand.
		expandUnchanged: contentMode === 'full',
		disableFileHeader: true,
		hunkSeparators: 'line-info' as const,
		diffIndicators: 'bars' as const,
		// Wrap: content defines height; our host scrolls. Avoids Pierre's default
		// overflow:scroll + align-self:flex-start fighting a height:100% override.
		overflow: 'wrap' as const,
		onLineClick: blameOverlayOpen
			? (props: { lineNumber: number; annotationSide?: 'additions' | 'deletions' }) => {
					if (props.annotationSide && props.annotationSide !== 'additions') {
						return;
					}
					emitBlameLineClick(props.lineNumber);
				}
			: undefined,
		renderAnnotation: heatmapOpen
			? (annotation: DiffLineAnnotation<BlameAnnotationMeta>) => {
					const meta = annotation.metadata;
					if (!meta || typeof meta.heatLevel !== 'number') {
						return undefined;
					}
					const wrap = document.createElement('span');
					wrap.className = 'pierre-gutter-extras pierre-heat-wrap';
					wrap.classList.add(`pierre-heat-wrap--${meta.heatLevel}`);
					wrap.dataset.heat = String(meta.heatLevel);
					const heat = document.createElement('span');
					heat.className = `pierre-heat-bar ${heatLevelClass(meta.heatLevel)}`;
					heat.title = `Recency heat ${meta.heatLevel}/4 — newer lines glow hotter`;
					heat.setAttribute('aria-hidden', 'true');
					heat.dataset.heat = String(meta.heatLevel);
					wrap.appendChild(heat);
					return wrap;
				}
			: undefined,
		unsafeCSS: `
			${hostSizing}
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
			.pierre-gutter-extras {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				margin-left: 2px;
				vertical-align: middle;
			}
			.pierre-heat-wrap {
				padding-left: 2px;
				border-left: 3px solid transparent;
				margin-left: 0;
				align-self: stretch;
				min-height: 1.2em;
			}
			.pierre-heat-wrap--0 { border-left-color: color-mix(in srgb, #58a6ff 55%, transparent); background: color-mix(in srgb, #58a6ff 14%, transparent); }
			.pierre-heat-wrap--1 { border-left-color: color-mix(in srgb, #58a6ff 75%, transparent); background: color-mix(in srgb, #58a6ff 22%, transparent); }
			.pierre-heat-wrap--2 { border-left-color: color-mix(in srgb, #3fb950 85%, transparent); background: color-mix(in srgb, #3fb950 26%, transparent); }
			.pierre-heat-wrap--3 { border-left-color: color-mix(in srgb, #d29922 90%, transparent); background: color-mix(in srgb, #d29922 30%, transparent); }
			.pierre-heat-wrap--4 { border-left-color: color-mix(in srgb, #f85149 95%, transparent); background: color-mix(in srgb, #f85149 34%, transparent); }
			.pierre-heat-bar {
				display: inline-block;
				width: 10px;
				min-height: 14px;
				height: 1.15em;
				align-self: stretch;
				border-radius: 2px;
				flex: 0 0 auto;
			}
			.pierre-heat--0 { background: color-mix(in srgb, #58a6ff 55%, transparent); }
			.pierre-heat--1 { background: color-mix(in srgb, #58a6ff 75%, transparent); }
			.pierre-heat--2 { background: color-mix(in srgb, #3fb950 85%, transparent); }
			.pierre-heat--3 { background: color-mix(in srgb, #d29922 92%, transparent); }
			.pierre-heat--4 { background: color-mix(in srgb, #f85149 98%, transparent); }
			.jjplus-line-heat {
				border-radius: 2px;
			}
			.jjplus-eol-blame {
				display: inline;
				margin-left: 1.5em;
				padding: 0;
				border: 0;
				background: transparent;
				color: color-mix(in srgb, var(--vscode-descriptionForeground, #8b949e) 88%, transparent);
				font: italic 11px/1.35 var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
				white-space: nowrap;
				opacity: 0.78;
				cursor: pointer;
				user-select: none;
			}
			.jjplus-eol-blame:hover {
				opacity: 1;
				color: var(--vscode-foreground, #e6edf3);
			}
		`,
	};
}

function resolveThemeType(preference: PierreThemePreference = 'auto'): 'dark' | 'light' {
	const body = typeof document !== 'undefined' ? document.body : undefined;
	return resolvePierreThemeType(preference, {
		bodyClasses: body?.classList,
		themeKind: body?.dataset.vscodeThemeKind,
		prefersLight: typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: light)').matches : false,
		colorScheme: body && typeof getComputedStyle === 'function' ? getComputedStyle(body).colorScheme : undefined,
	});
}

function stableFileContents(previous: FileContents | undefined, next: FileContents): FileContents {
	if (
		previous &&
		previous.name === next.name &&
		previous.contents === next.contents &&
		previous.cacheKey === next.cacheKey &&
		previous.lang === next.lang
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

let themeObserver: MutationObserver | undefined;
let themeMedia: MediaQueryList | undefined;
let lastSyncedModel: Model | undefined;

/** Keep Pierre themeType in sync with VS Code body theme when preference is auto. */
export function observePierreThemePreference(getModel: () => Model | undefined): void {
	if (typeof document === 'undefined' || themeObserver) {
		return;
	}
	const resync = () => {
		const model = getModel() ?? lastSyncedModel;
		if (model) {
			lastSyncedModel = model;
			syncFromModel(model);
		}
	};
	themeObserver = new MutationObserver(resync);
	themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
	themeMedia = window.matchMedia('(prefers-color-scheme: light)');
	themeMedia.addEventListener('change', resync);
}
