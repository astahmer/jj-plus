import { FileDiff, type FileContents } from '@pierre/diffs';
import type { Model } from '../model.ts';
import { getPreview } from '../selectors.ts';
import type { ContentMode, DiffPreview, LayoutMode } from '../types.ts';

const PIERRE_ROOT_ID = 'pierre-diff-root';

let fileDiff: FileDiff | undefined;
let lastRoot: HTMLElement | undefined;
let lastOldFile: FileContents | undefined;
let lastNewFile: FileContents | undefined;
let lastLayoutMode: LayoutMode | undefined;
let lastContentMode: ContentMode | undefined;
let lastThemeType: 'dark' | 'light' | undefined;
let lastShowPierre = false;
let pendingFrame = 0;
let pendingModel: Model | null = null;

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
	const root = document.getElementById(PIERRE_ROOT_ID);
	if (!(root instanceof HTMLElement)) {
		clearPierreFileDiff();
		return;
	}

	if (!args.showPierre || !args.preview) {
		clearPierreFileDiff();
		lastShowPierre = false;
		return;
	}

	const themeType = resolveThemeType();
	const rootChanged = lastRoot !== root;
	const optionsChanged =
		lastLayoutMode !== args.layoutMode ||
		lastContentMode !== args.contentMode ||
		lastThemeType !== themeType ||
		rootChanged ||
		!lastShowPierre;

	const nextOldFile = stableFileContents(lastOldFile, {
		name: args.preview.beforePath || 'before',
		contents: args.preview.beforeText,
		cacheKey: `old:${args.preview.beforePath}:${hashText(args.preview.beforeText)}`,
	});
	const nextNewFile = stableFileContents(lastNewFile, {
		name: args.preview.afterPath || 'after',
		contents: args.preview.afterText,
		cacheKey: `new:${args.preview.afterPath}:${hashText(args.preview.afterText)}`,
	});

	const filesChanged = nextOldFile !== lastOldFile || nextNewFile !== lastNewFile;

	if (!fileDiff || rootChanged) {
		fileDiff?.cleanUp();
		fileDiff = new FileDiff(buildOptions(args.layoutMode, args.contentMode, themeType));
	} else if (optionsChanged) {
		fileDiff.setOptions(buildOptions(args.layoutMode, args.contentMode, themeType));
	}

	if (filesChanged || optionsChanged || root.childElementCount === 0) {
		fileDiff.render({
			oldFile: nextOldFile,
			newFile: nextNewFile,
			containerWrapper: root,
			forceRender: optionsChanged || rootChanged,
		});
	}

	stretchPierreMount(root);

	lastRoot = root;
	lastOldFile = nextOldFile;
	lastNewFile = nextNewFile;
	lastLayoutMode = args.layoutMode;
	lastContentMode = args.contentMode;
	lastThemeType = themeType;
	lastShowPierre = true;
}

export function clearPierreFileDiff(): void {
	fileDiff?.cleanUp();
	fileDiff = undefined;
	lastRoot = undefined;
	lastOldFile = undefined;
	lastNewFile = undefined;
	lastLayoutMode = undefined;
	lastContentMode = undefined;
	lastThemeType = undefined;
	lastShowPierre = false;

	const root = document.getElementById(PIERRE_ROOT_ID);
	if (root) {
		root.replaceChildren();
	}
}

function stretchPierreMount(root: HTMLElement): void {
	root.style.minHeight = '0';
	root.style.height = '100%';
	for (const child of Array.from(root.children)) {
		if (!(child instanceof HTMLElement)) {
			continue;
		}
		child.style.minHeight = '0';
		child.style.height = '100%';
		child.style.flex = '1 1 auto';
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
		overflow: 'scroll' as const,
		unsafeCSS: `
			:host, diffs-container, pre, .diffs-container {
				height: 100% !important;
				min-height: 0 !important;
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
