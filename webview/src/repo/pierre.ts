import { FileDiff, type FileContents } from '@pierre/diffs';
import { languageFromPath } from '../../../src/shared/pierre-language.ts';
import type { RepoTimelineDiff } from './types.ts';
import { ensurePierreWorkerPool, getPierreWorkerPool } from '../pierre/worker-pool.ts';
import type { Model } from './model.ts';

const PORTAL_ID = 'repo-pierre-root';
const SLOT_ID = 'repo-pierre-slot';

type MountedFile = {
	instance: FileDiff;
	mount: HTMLElement;
	key: string;
};

let pendingModel: Model | undefined;
let frame = 0;
let mountedSignature = '';
let mountedFiles = new Map<string, MountedFile>();
let resizeBound = false;

export function queueRepoPierreDiffSync(model: Model): void {
	pendingModel = model;
	if (frame !== 0) return;
	frame = window.requestAnimationFrame(() => {
		frame = 0;
		const next = pendingModel;
		pendingModel = undefined;
		if (next) sync(next);
	});
	void ensurePierreWorkerPool().then(() => {
		if (!pendingModel) pendingModel = model;
		queueRepoPierreDiffSync(pendingModel);
	});
}

function sync(model: Model): void {
	const slot = document.getElementById(SLOT_ID);
	const diff = model.diff as RepoTimelineDiff | null;
	if (!(slot instanceof HTMLElement) || !diff || diff.files.length === 0) {
		const portal = document.getElementById(PORTAL_ID);
		if (portal instanceof HTMLElement) portal.hidden = true;
		return;
	}

	const portal = ensurePortal();
	positionPortal(portal, slot);
	portal.hidden = false;
	const signature = `${diff.revision}:${diff.files.map((file) => `${file.path}:${file.before.length}:${file.after.length}`).join('|')}`;
	if (mountedSignature === signature) return;

	for (const mounted of mountedFiles.values()) mounted.instance.cleanUp();
	mountedFiles = new Map();
	portal.replaceChildren();
	for (const file of diff.files) {
		const section = document.createElement('section');
		section.className = 'repo-pierre-file';
		const heading = document.createElement('header');
		heading.className = 'repo-pierre-file-header';
		heading.textContent = file.path;
		const mount = document.createElement('div');
		mount.className = 'repo-pierre-file-mount';
		section.append(heading, mount);
		portal.append(section);
		const instance = new FileDiff(
			{
				theme: { dark: 'pierre-dark', light: 'pierre-light' },
				themeType: resolveTheme(),
				diffStyle: 'unified',
				lineDiffType: 'word-alt',
				hunkSeparators: 'line-info',
				diffIndicators: 'bars',
				overflow: 'wrap',
				disableFileHeader: true,
				expandUnchanged: false,
				unsafeCSS: `
					:host { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
					code[data-code] { contain: none !important; }
					[data-diff-type="split"][data-overflow="wrap"],
					[data-diff-type="single"][data-overflow="wrap"] code[data-unified],
					[data-diff-type="single"][data-overflow="wrap"] [data-code] { grid-auto-rows: max-content !important; }
				`,
			} as never,
			getPierreWorkerPool(),
		);
		const oldFile = makeFile(file.path, file.before, 'before');
		const newFile = makeFile(file.path, file.after, 'after');
		instance.render({ oldFile, newFile, containerWrapper: mount });
		mountedFiles.set(file.path, { instance, mount, key: `${file.before.length}:${file.after.length}` });
	}
	mountedSignature = signature;
}

function makeFile(path: string, contents: string, side: string): FileContents {
	return { name: path, contents, lang: languageFromPath(path), cacheKey: `${side}:${path}:${contents.length}` };
}

function ensurePortal(): HTMLElement {
	let portal = document.getElementById(PORTAL_ID);
	if (!(portal instanceof HTMLElement)) {
		portal = document.createElement('div');
		portal.id = PORTAL_ID;
		portal.className = 'repo-pierre-root';
		document.body.append(portal);
	}
	if (!resizeBound) {
		resizeBound = true;
		window.addEventListener('resize', () => {
			const slot = document.getElementById(SLOT_ID);
			if (slot instanceof HTMLElement) positionPortal(portal!, slot);
		});
	}
	return portal;
}

function positionPortal(portal: HTMLElement, slot: HTMLElement): void {
	const rect = slot.getBoundingClientRect();
	portal.style.left = `${Math.round(rect.left)}px`;
	portal.style.top = `${Math.round(rect.top)}px`;
	portal.style.width = `${Math.max(0, Math.round(rect.width))}px`;
	portal.style.height = `${Math.max(0, Math.round(rect.height))}px`;
}

function resolveTheme(): 'dark' | 'light' {
	return document.body.classList.contains('vscode-light') || document.body.dataset.vscodeThemeKind === 'vscode-light' ? 'light' : 'dark';
}
