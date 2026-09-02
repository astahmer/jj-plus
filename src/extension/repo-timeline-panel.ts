import fsSync from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { renderTimelineDocumentHtml } from '../webview/timeline-template.ts';
import type {
	RepoRevisionEntry,
	RepoTimelineCommand,
	RepoTimelineData,
	RepoTimelineDiff,
	RepoTimelineDiffFile,
	RepoTimelineInboundMessage,
	RepoTimelineSearchPayload,
	RepoTimelineSearchRequest,
	RepoTimelineSearchResult,
} from '../shared/repo-timeline-types.ts';
import type { FileRevisionEntry } from '../shared/timeline-types.ts';
import { resolveHistoryAdapter, resolveHistoryWorkspacePath } from './history-adapters.ts';
import type { CommandRunner } from './types.ts';
import { OPEN_FILE_RANGE_DIFF_COMMAND, SCM_GRAPH_VIEW_ID } from './constants.ts';

type RepoPanelState = {
	workspacePath: string;
	adapter: Awaited<ReturnType<typeof resolveHistoryAdapter>>;
	entries: Array<RepoRevisionEntry>;
	compact: boolean;
	revset: string;
	signature?: string;
	selectedRevision?: string;
	loading: boolean;
};

type RepoTimelineSurface = vscode.WebviewPanel | vscode.WebviewView;

function post(surface: RepoTimelineSurface, message: RepoTimelineInboundMessage): Thenable<boolean> {
	return surface.webview.postMessage(message);
}

function shortDate(timestamp: number): string {
	if (!timestamp) {
		return '';
	}
	return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp * 1000);
}

function relativeDate(timestamp: number): string {
	if (!timestamp) {
		return '';
	}
	const seconds = Math.max(0, Date.now() / 1000 - timestamp);
	if (seconds < 60) return 'just now';
	const units: Array<[number, string]> = [
		[60, 'minute'],
		[3600, 'hour'],
		[86400, 'day'],
		[604800, 'week'],
		[2592000, 'month'],
		[31536000, 'year'],
	];
	let selected = units[0];
	for (const unit of units) {
		if (seconds < unit[0]) break;
		selected = unit;
	}
	const count = Math.floor(seconds / selected[0]);
	return `${count} ${selected[1]}${count === 1 ? '' : 's'} ago`;
}

function mapEntry(entry: FileRevisionEntry, index: number, remoteBaseUrl?: string): RepoRevisionEntry {
	return {
		...entry,
		index,
		shortDate: shortDate(entry.timestamp),
		relativeDate: relativeDate(entry.timestamp),
		remoteUrl: remoteBaseUrl && !entry.isWorkingTree ? `${remoteBaseUrl}/commit/${entry.revision}` : undefined,
	};
}

function parseDiffFiles(patch: string): Array<string> {
	const files = new Set<string>();
	for (const line of patch.split(/\r?\n/u)) {
		const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
		if (match) {
			files.add(match[2]);
		}
	}
	return [...files];
}

function matchesText(value: string, query: string, mode: RepoTimelineSearchRequest['matchMode']): boolean {
	if (!query) return true;
	if (mode === 'regex') {
		try {
			return new RegExp(query, 'iu').test(value);
		} catch {
			return false;
		}
	}
	if (mode === 'fuzzy') {
		let cursor = 0;
		const loweredValue = value.toLocaleLowerCase();
		for (const character of query.toLocaleLowerCase()) {
			cursor = loweredValue.indexOf(character, cursor);
			if (cursor < 0) return false;
			cursor += 1;
		}
		return true;
	}
	return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function timestampInRange(timestamp: number, request: RepoTimelineSearchRequest): boolean {
	const after = request.after ? Date.parse(request.after) / 1000 : Number.NEGATIVE_INFINITY;
	const until = request.until ? Date.parse(request.until) / 1000 + 86_399 : Number.POSITIVE_INFINITY;
	return (!Number.isFinite(after) || timestamp >= after) && (!Number.isFinite(until) || timestamp <= until);
}

function metadataMatches(entry: RepoRevisionEntry, request: RepoTimelineSearchRequest): boolean {
	if (!timestampInRange(entry.timestamp, request)) return false;
	// Repository entries are not file-scoped. Keep the path filter meaningful for
	// any adapter-provided file entry, but do not make metadata searches silently
	// return nothing just because the entry has no filePath.
	if (request.path && entry.filePath && !entry.filePath.toLocaleLowerCase().includes(request.path.toLocaleLowerCase())) return false;
	const haystack = [
		entry.revision,
		entry.changeId,
		entry.description,
		entry.authorName,
		...(entry.bookmarkNames ?? []),
		...(entry.branchNames ?? []),
	].filter(Boolean).join('\n');
	return matchesText(haystack, request.query.trim(), request.matchMode);
}

function addedLineMatches(patch: string, request: RepoTimelineSearchRequest): Array<{ filePath: string; line: number; detail: string }> {
	const results: Array<{ filePath: string; line: number; detail: string }> = [];
	let filePath = '';
	let line = 0;
	for (const rawLine of patch.split(/\r?\n/u)) {
		const fileHeader = /^\+\+\+ b\/(.+)$/u.exec(rawLine);
		if (fileHeader) {
			filePath = fileHeader[1] ?? '';
			continue;
		}
		if (rawLine.startsWith('@@')) {
			const match = /\+(\d+)/u.exec(rawLine);
			line = match ? Number(match[1]) : 0;
			continue;
		}
		if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
			const detail = rawLine.slice(1);
			if ((!request.path || filePath.toLocaleLowerCase().includes(request.path.toLocaleLowerCase())) && matchesText(detail, request.query.trim(), request.matchMode)) {
				results.push({ filePath, line, detail });
			}
			line += 1;
			continue;
		}
		if (rawLine.startsWith(' ')) line += 1;
	}
	return results;
}

function revisionParent(adapterBackend: string, revision: string): string {
	return adapterBackend === 'jj' ? `${revision}-` : `${revision}^`;
}

function getRepoWebviewHtml(args: { context: vscode.ExtensionContext; webview: vscode.Webview; compact?: boolean }): string {
	// Vite currently emits one shared stylesheet because cssCodeSplit is disabled
	// for the Pierre timeline. The repo view's styles are included in it too.
	const stylePath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'timeline-app.css');
	const scriptPath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'repo-timeline-app.js');
	const workerPath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'pierre-worker-portable.js');
	if (!fsSync.existsSync(stylePath.fsPath) || !fsSync.existsSync(scriptPath.fsPath)) {
		return '<!doctype html><html lang="en"><body><p>Repo Timeline bundle is missing. Run pnpm build:webview and reopen it.</p></body></html>';
	}
	return renderTimelineDocumentHtml({
		title: 'Repo Timeline',
		cspSource: args.webview.cspSource,
		styleHref: String(args.webview.asWebviewUri(stylePath)),
		appSrc: String(args.webview.asWebviewUri(scriptPath)),
		workerSrc: String(args.webview.asWebviewUri(workerPath)),
		bodyClass: args.compact ? 'repo-compact' : undefined,
	});
}

export function createRepoTimelinePanelController(args: {
	context: vscode.ExtensionContext;
	runner: CommandRunner;
	version: string;
}) {
	const surfaces = new Map<RepoTimelineSurface, RepoPanelState>();
	const panels = new Set<vscode.WebviewPanel>();
	let scmView: vscode.WebviewView | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;

	return {
		dispose() {
			if (refreshTimer) clearInterval(refreshTimer);
			for (const panel of panels) panel.dispose();
			panels.clear();
			surfaces.clear();
		},
		registerScmView() {
			return vscode.window.registerWebviewViewProvider(
				SCM_GRAPH_VIEW_ID,
				{
					resolveWebviewView: (view) => attachScmView(view),
				},
				{ webviewOptions: { retainContextWhenHidden: true } },
			);
		},
		async refreshScmView() {
			const state = scmView ? surfaces.get(scmView) : undefined;
			if (scmView && state) await load(scmView, state, state.revset);
		},
		async open() {
			const workspaceFolder = resolveWorkspaceFolder();
			if (!workspaceFolder) {
				void vscode.window.showErrorMessage('Open a workspace folder to browse its repository timeline');
				return;
			}

			const preferredRoot = await resolveHistoryWorkspacePath({
				workspacePath: workspaceFolder.uri.fsPath,
				runner: args.runner,
			});
			const adapter = await resolveHistoryAdapter({ workspacePath: preferredRoot, runner: args.runner });
			const panel = vscode.window.createWebviewPanel(
				'jjPlusRepoTimeline',
				`Repo Timeline: ${path.basename(preferredRoot)}`,
				vscode.ViewColumn.Active,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					enableFindWidget: true,
					localResourceRoots: [vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist')],
				},
			);
			panel.webview.html = getRepoWebviewHtml({ context: args.context, webview: panel.webview });
			panels.add(panel);
			surfaces.set(panel, {
				workspacePath: preferredRoot,
				adapter,
				entries: [],
				compact: false,
				revset: 'ancestors(@)',
				loading: false,
			});
			panel.onDidDispose(() => {
				panels.delete(panel);
				surfaces.delete(panel);
			}, undefined, args.context.subscriptions);
			panel.webview.onDidReceiveMessage(
				(message: RepoTimelineCommand | unknown) => void handleCommand(panel, message).catch((error) => sendError(panel, error)),
				undefined,
				args.context.subscriptions,
			);
		},
	};

	async function attachScmView(view: vscode.WebviewView): Promise<void> {
		scmView = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist')],
		};
		const workspaceFolder = resolveWorkspaceFolder();
		if (!workspaceFolder) {
			view.webview.html = '<!doctype html><html lang="en"><body><p>Open a workspace folder to browse JJ history.</p></body></html>';
			return;
		}

		try {
			const preferredRoot = await resolveHistoryWorkspacePath({
				workspacePath: workspaceFolder.uri.fsPath,
				runner: args.runner,
			});
			const adapter = await resolveHistoryAdapter({ workspacePath: preferredRoot, runner: args.runner });
			view.webview.html = getRepoWebviewHtml({ context: args.context, webview: view.webview, compact: true });
			surfaces.set(view, {
				workspacePath: preferredRoot,
				adapter,
				entries: [],
				compact: true,
				revset: 'ancestors(working_copies(), 25) | present(trunk())',
				loading: false,
			});
			view.webview.onDidReceiveMessage(
				(message: RepoTimelineCommand | unknown) => void handleCommand(view, message).catch((error) => sendError(view, error)),
				undefined,
				args.context.subscriptions,
			);
			view.onDidDispose(() => {
				if (scmView === view) scmView = undefined;
				surfaces.delete(view);
				if (refreshTimer) clearInterval(refreshTimer);
				refreshTimer = undefined;
			}, undefined, args.context.subscriptions);
			view.onDidChangeVisibility(() => updateAutoRefresh(), undefined, args.context.subscriptions);
			updateAutoRefresh();
		} catch (error) {
			const message = String(error)
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#39;');
			view.webview.html = `<!doctype html><html lang="en"><body><p>${message}</p></body></html>`;
		}
	}

	function updateAutoRefresh(): void {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		if (!scmView?.visible) return;
		refreshTimer = setInterval(() => {
			const state = scmView ? surfaces.get(scmView) : undefined;
			if (!scmView || !state || state.loading) return;
			void load(scmView, state, state.revset, true).catch((error) => sendError(scmView!, error));
		}, 5_000);
	}

	async function handleCommand(surface: RepoTimelineSurface, rawMessage: RepoTimelineCommand | unknown): Promise<void> {
		const state = surfaces.get(surface);
		if (!state || !rawMessage || typeof rawMessage !== 'object') return;
		const command = Reflect.get(rawMessage, 'command');
		if (command === 'ready' || command === 'refresh') {
			const revset = String(Reflect.get(rawMessage, 'revset') || state.revset);
			await load(surface, state, revset);
			return;
		}
		if (command === 'select-revision') {
			const index = Number(Reflect.get(rawMessage, 'index'));
			const entry = state.entries[index];
			if (!entry) return;
			state.selectedRevision = entry.revision;
			await post(surface, { type: 'repo-timeline-diff', payload: await buildDiff(state, entry) });
			return;
		}
		if (command === 'search') {
			const request = Reflect.get(rawMessage, 'request') as RepoTimelineSearchRequest;
			await post(surface, { type: 'repo-timeline-search', payload: await search(state, request) });
			return;
		}
		if (command === 'open-revision-remote') {
			const index = Number(Reflect.get(rawMessage, 'index'));
			const url = state.entries[index]?.remoteUrl;
			if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
			return;
		}
		if (command === 'open-file-result') {
			const entryIndex = Number(Reflect.get(rawMessage, 'entryIndex'));
			const filePath = String(Reflect.get(rawMessage, 'filePath') || '').replaceAll('\\', '/');
			const line = Math.max(1, Number(Reflect.get(rawMessage, 'line')) || 1);
			const entry = state.entries[entryIndex];
			if (!entry || !filePath || path.isAbsolute(filePath) || filePath.split('/').includes('..')) return;
			const uri = vscode.Uri.from({
				scheme: 'jj-plus',
				path: `/${filePath}`,
				query: JSON.stringify({ workspacePath: state.workspacePath, filePath, revset: entry.revision }),
			});
			const document = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(document, { preview: true });
			const position = new vscode.Position(Math.min(line - 1, Math.max(0, document.lineCount - 1)), 0);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
			return;
		}
		if (command === 'open-file-diff') {
			const entryIndex = Number(Reflect.get(rawMessage, 'entryIndex'));
			const filePath = String(Reflect.get(rawMessage, 'filePath') || '').replaceAll('\\', '/');
			const entry = state.entries[entryIndex];
			if (!entry || !filePath || path.isAbsolute(filePath) || filePath.split('/').includes('..')) return;
			await vscode.commands.executeCommand(OPEN_FILE_RANGE_DIFF_COMMAND, {
				workspacePath: state.workspacePath,
				from: entry.parentRevisionIds?.[0] || revisionParent(state.adapter.backend, entry.revision),
				to: entry.revision,
				title: `${filePath}: ${entry.changeId || entry.shortRevision}`,
				absolutePath: path.join(state.workspacePath, filePath),
				confirm: false,
			});
		}
	}

	async function load(surface: RepoTimelineSurface, state: RepoPanelState, revset: string, automatic = false): Promise<void> {
		state.loading = true;
		state.revset = revset;
		try {
			const limit = state.compact ? 80 : 200;
			const entries = await state.adapter.getRepositoryRevisionHistory({
				workspacePath: state.workspacePath,
				limit,
				customRevset: revset,
			});
			const signature = entries.map((entry) => entry.revision).join('\n');
			if (automatic && signature === state.signature) return;
			state.signature = signature;
			const remoteBaseUrl = await state.adapter.getRemoteBaseUrl({ workspacePath: state.workspacePath });
			state.entries = entries.map((entry, index) => mapEntry(entry, index, remoteBaseUrl));
			const selected =
				state.entries.find((entry) => entry.revision === state.selectedRevision) ||
				state.entries.find((entry) => entry.isCurrentWorkingCopy) ||
				state.entries.at(-1);
			if (selected) state.selectedRevision = selected.revision;
			const payload: RepoTimelineData = {
				backend: state.adapter.backend,
				workspacePath: state.workspacePath,
				repositoryName: path.basename(state.workspacePath),
				version: args.version,
				entries: state.entries,
				bookmarks: [
					...new Set(
						state.entries.flatMap((entry) => [
							...(entry.bookmarkNames ?? []),
							...(entry.branchNames ?? []),
						]),
					),
				].toSorted(),
				truncated: state.entries.length >= limit,
				selectedIndex: selected?.index,
			};
			await post(surface, { type: 'repo-timeline-data', payload });
			if (selected) {
				await post(surface, { type: 'repo-timeline-diff', payload: await buildDiff(state, selected) });
			}
		} finally {
			state.loading = false;
		}
	}

	async function buildDiff(state: RepoPanelState, entry: RepoRevisionEntry): Promise<RepoTimelineDiff> {
		const patch = state.compact
			? ''
			: await state.adapter.getRevisionDiff({ workspacePath: state.workspacePath, revision: entry.revision });
		const paths = await state.adapter.listRevisionFiles({ workspacePath: state.workspacePath, revision: entry.revision });
		const files = paths.length ? paths : parseDiffFiles(patch);
		if (state.compact) {
			return { revision: entry.revision, patch, files: files.map((filePath) => ({ path: filePath, before: '', after: '' })) };
		}
		const parent = revisionParent(state.adapter.backend, entry.revision);
		const fileDiffs: Array<RepoTimelineDiffFile> = [];
		for (const filePath of files) {
			const [before, after] = await Promise.all([
				readFileAtRevision(state, parent, filePath),
				readFileAtRevision(state, entry.revision, filePath),
			]);
			fileDiffs.push({ path: filePath, before, after });
		}
		return { revision: entry.revision, patch, files: fileDiffs };
	}

	async function search(state: RepoPanelState, request: RepoTimelineSearchRequest): Promise<RepoTimelineSearchPayload> {
		const query = request.query.trim();
		if (request.mode === 'all') {
			const [metadata, changes, snapshot] = await Promise.all([
				search(state, { ...request, mode: 'metadata' }),
				search(state, { ...request, mode: 'changes' }),
				search(state, { ...request, mode: 'snapshot' }),
			]);
			const results = [...metadata.results, ...changes.results, ...snapshot.results].slice(0, 500);
			return { requestId: request.requestId, mode: request.mode, results, truncated: metadata.truncated || changes.truncated || snapshot.truncated || results.length < metadata.results.length + changes.results.length + snapshot.results.length };
		}
		if (request.mode === 'metadata') {
			return {
				requestId: request.requestId,
				mode: request.mode,
				results: state.entries.flatMap((entry, entryIndex) => metadataMatches(entry, { ...request, query }) ? [{ entryIndex, lane: 'metadata' as const }] : []),
				truncated: false,
			};
		}

		if (!query) return { requestId: request.requestId, mode: request.mode, results: [], truncated: false };
		const results: Array<RepoTimelineSearchResult> = [];
		const candidates = state.entries.filter((entry) => timestampInRange(entry.timestamp, request));
		if (request.mode === 'changes') {
			for (const entry of candidates) {
				const patch = await state.adapter.getRevisionDiff({ workspacePath: state.workspacePath, revision: entry.revision });
				for (const match of addedLineMatches(patch, request)) {
					results.push({ entryIndex: entry.index, lane: 'changes', filePath: match.filePath, line: match.line, detail: match.detail });
				}
			}
		} else {
			const entry = state.entries[request.selectedIndex ?? state.entries.length - 1];
			if (entry) {
				const files = await state.adapter.listRevisionTreeFiles({ workspacePath: state.workspacePath, revision: entry.revision });
				for (const filePath of files) {
					if (request.path && !filePath.toLocaleLowerCase().includes(request.path.toLocaleLowerCase())) continue;
					const content = await readFileAtRevision(state, entry.revision, filePath);
					for (const [lineIndex, detail] of content.split(/\r?\n/u).entries()) {
						if (matchesText(detail, query, request.matchMode)) {
							results.push({ entryIndex: entry.index, lane: 'snapshot', filePath, line: lineIndex + 1, detail });
						}
					}
				}
			}
		}
		const limit = 500;
		return { requestId: request.requestId, mode: request.mode, results: results.slice(0, limit), truncated: results.length > limit };
	}

	async function readFileAtRevision(state: RepoPanelState, revset: string, filePath: string): Promise<string> {
		try {
			return await state.adapter.showFileAtRevision({ workspacePath: state.workspacePath, revset, filePath });
		} catch {
			// A root revision has no parent, and deleted files do not exist in the
			// selected snapshot. Pierre can still render those sides as empty.
			return '';
		}
	}
}

function resolveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const editor = vscode.window.activeTextEditor;
	if (editor?.document.uri.scheme === 'file') {
		const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (folder) return folder;
	}
	return vscode.workspace.workspaceFolders?.[0];
}

function sendError(panel: RepoTimelineSurface, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	void post(panel, { type: 'repo-timeline-error', payload: { message } });
}
