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

type RepoPanelState = {
	workspacePath: string;
	adapter: Awaited<ReturnType<typeof resolveHistoryAdapter>>;
	entries: Array<RepoRevisionEntry>;
};

function post(panel: vscode.WebviewPanel, message: RepoTimelineInboundMessage): Thenable<boolean> {
	return panel.webview.postMessage(message);
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

function getRepoWebviewHtml(args: { context: vscode.ExtensionContext; webview: vscode.Webview }): string {
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
	});
}

export function createRepoTimelinePanelController(args: {
	context: vscode.ExtensionContext;
	runner: CommandRunner;
	version: string;
}) {
	const panels = new Map<vscode.WebviewPanel, RepoPanelState>();

	return {
		dispose() {
			for (const panel of panels.keys()) panel.dispose();
			panels.clear();
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
			panels.set(panel, { workspacePath: preferredRoot, adapter, entries: [] });
			panel.onDidDispose(() => panels.delete(panel), undefined, args.context.subscriptions);
			panel.webview.onDidReceiveMessage(
				(message: RepoTimelineCommand | unknown) => void handleCommand(panel, message).catch((error) => sendError(panel, error)),
				undefined,
				args.context.subscriptions,
			);
		},
	};

	async function handleCommand(panel: vscode.WebviewPanel, rawMessage: RepoTimelineCommand | unknown): Promise<void> {
		const state = panels.get(panel);
		if (!state || !rawMessage || typeof rawMessage !== 'object') return;
		const command = Reflect.get(rawMessage, 'command');
		if (command === 'ready' || command === 'refresh') {
			const revset = command === 'refresh' ? String(Reflect.get(rawMessage, 'revset') || 'ancestors(@)') : 'ancestors(@)';
			await load(panel, state, revset);
			return;
		}
		if (command === 'select-revision') {
			const index = Number(Reflect.get(rawMessage, 'index'));
			const entry = state.entries[index];
			if (!entry) return;
			await post(panel, { type: 'repo-timeline-diff', payload: await buildDiff(state, entry) });
			return;
		}
		if (command === 'search') {
			const request = Reflect.get(rawMessage, 'request') as RepoTimelineSearchRequest;
			await post(panel, { type: 'repo-timeline-search', payload: await search(state, request) });
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
		}
	}

	async function load(panel: vscode.WebviewPanel, state: RepoPanelState, revset: string): Promise<void> {
		const entries = await state.adapter.getRepositoryRevisionHistory({ workspacePath: state.workspacePath, limit: 200, customRevset: revset });
		const remoteBaseUrl = await state.adapter.getRemoteBaseUrl({ workspacePath: state.workspacePath });
		state.entries = entries.map((entry, index) => mapEntry(entry, index, remoteBaseUrl));
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
			truncated: state.entries.length >= 200,
		};
		await post(panel, { type: 'repo-timeline-data', payload });
		const first = state.entries.at(-1);
		if (first) {
			await post(panel, { type: 'repo-timeline-diff', payload: await buildDiff(state, first) });
		}
	}

	async function buildDiff(state: RepoPanelState, entry: RepoRevisionEntry): Promise<RepoTimelineDiff> {
		const patch = await state.adapter.getRevisionDiff({ workspacePath: state.workspacePath, revision: entry.revision });
		const paths = await state.adapter.listRevisionFiles({ workspacePath: state.workspacePath, revision: entry.revision });
		const files = paths.length ? paths : parseDiffFiles(patch);
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

function sendError(panel: vscode.WebviewPanel, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	void post(panel, { type: 'repo-timeline-error', payload: { message } });
}
