import fsSync from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { renderTimelineDocumentHtml } from '../webview/timeline-template.ts';
import type { RepoRevisionEntry, RepoTimelineCommand, RepoTimelineData, RepoTimelineInboundMessage } from '../shared/repo-timeline-types.ts';
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

function getRepoWebviewHtml(args: { context: vscode.ExtensionContext; webview: vscode.Webview }): string {
	// Vite currently emits one shared stylesheet because cssCodeSplit is disabled
	// for the Pierre timeline. The repo view's styles are included in it too.
	const stylePath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'timeline-app.css');
	const scriptPath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'repo-timeline-app.js');
	if (!fsSync.existsSync(stylePath.fsPath) || !fsSync.existsSync(scriptPath.fsPath)) {
		return '<!doctype html><html lang="en"><body><p>Repo Timeline bundle is missing. Run pnpm build:webview and reopen it.</p></body></html>';
	}
	return renderTimelineDocumentHtml({
		title: 'Repo Timeline',
		cspSource: args.webview.cspSource,
		styleHref: String(args.webview.asWebviewUri(stylePath)),
		appSrc: String(args.webview.asWebviewUri(scriptPath)),
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
			const [patch, files] = await Promise.all([
				state.adapter.getRevisionDiff({ workspacePath: state.workspacePath, revision: entry.revision }),
				state.adapter.listRevisionFiles({ workspacePath: state.workspacePath, revision: entry.revision }),
			]);
			await post(panel, { type: 'repo-timeline-diff', payload: { revision: entry.revision, patch, files: files.length ? files : parseDiffFiles(patch) } });
			return;
		}
		if (command === 'open-revision-remote') {
			const index = Number(Reflect.get(rawMessage, 'index'));
			const url = state.entries[index]?.remoteUrl;
			if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
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
			const [patch, files] = await Promise.all([
				state.adapter.getRevisionDiff({ workspacePath: state.workspacePath, revision: first.revision }),
				state.adapter.listRevisionFiles({ workspacePath: state.workspacePath, revision: first.revision }),
			]);
			await post(panel, { type: 'repo-timeline-diff', payload: { revision: first.revision, patch, files: files.length ? files : parseDiffFiles(patch) } });
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
