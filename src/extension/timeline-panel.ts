import fsSync from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { renderTimelineDocumentHtml } from '../webview/timeline-template.ts';
import type {
	ComparisonSource,
	FileRevisionEntry,
	TimelineCommand,
	TimelineInboundMessage,
	TimelinePreferences,
} from '../shared/timeline-types.ts';
import { OPEN_MULTI_DIFF_COMMAND, TIMELINE_PRESET_DAYS } from './constants.ts';
import { createTimelineService } from './timeline-service.ts';
import { createSnapshotUri } from './uri-utils.ts';
import type { ExtensionTimelineSession, TimelineDebugState, TimelinePanelController } from './types.ts';

type TimelineService = ReturnType<typeof createTimelineService>;

const LARGE_MULTI_DIFF_CONFIRMATION_THRESHOLD = 200;

function postTimelineMessage(request: {
	panel: vscode.WebviewPanel;
	message: TimelineInboundMessage;
}): Promise<boolean> {
	// oxlint-disable-next-line unicorn/require-post-message-target-origin
	return Promise.resolve(request.panel.webview.postMessage(request.message));
}

export function createTimelinePanelController(args: {
	context: vscode.ExtensionContext;
	service: TimelineService;
	getPreferences: () => TimelinePreferences;
	savePreferences: (nextPreferences: TimelinePreferences) => Promise<void>;
	version: string;
}): TimelinePanelController {
	let timelinePanel: vscode.WebviewPanel | undefined;
	let currentTimelineSession: ExtensionTimelineSession | undefined;
	let timelineDebugState = createEmptyTimelineDebugState();

	return {
		dispose() {
			timelinePanel?.dispose();
			timelinePanel = undefined;
			currentTimelineSession = undefined;
			timelineDebugState = createEmptyTimelineDebugState();
		},
		getDebugState() {
			return { ...timelineDebugState };
		},
		async openFileRevisionTimeline({ absolutePath }) {
			const activeEditor = vscode.window.activeTextEditor;
			const initialPath = absolutePath || activeEditor?.document.uri.fsPath;
			if (!initialPath) {
				void vscode.window.showErrorMessage('Open a file in the editor to browse its revision timeline');
				return;
			}

			const documentUri = vscode.Uri.file(initialPath);
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
			if (!workspaceFolder) {
				void vscode.window.showErrorMessage('The active file must belong to a workspace folder');
				return;
			}

			if (documentUri.scheme !== 'file') {
				void vscode.window.showErrorMessage('The revision timeline only supports files on disk');
				return;
			}

			const session = await args.service.buildSession({
				workspacePath: workspaceFolder.uri.fsPath,
				absolutePath: documentUri.fsPath,
			});
			if (!session.entries.length) {
				void vscode.window.showInformationMessage('No file revisions were found for the active file');
				return;
			}

			const hadExistingPanel = Boolean(timelinePanel);
			const panel = getOrCreateTimelinePanel({ fileName: session.fileName });
			currentTimelineSession = session;
			panel.webview.html = getTimelineWebviewHtml({
				context: args.context,
				webview: panel.webview,
			});
			panel.title = `Revision Timeline: ${session.fileName}`;
			timelineDebugState = createDebugState({ panel, session, lastMessageCommand: '' });

			if (!hadExistingPanel && shouldMaximizeTimelinePanel()) {
				await maximizeTimelinePanel();
			}
		},
	};

	function getOrCreateTimelinePanel(request: { fileName: string }): vscode.WebviewPanel {
		if (timelinePanel) {
			timelinePanel.reveal(timelinePanel.viewColumn, true);
			return timelinePanel;
		}

		timelinePanel = vscode.window.createWebviewPanel(
			'jjRangeDiffTimeline',
			`Revision Timeline: ${request.fileName}`,
			getTimelineViewColumn(),
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				enableFindWidget: true,
				localResourceRoots: [
					vscode.Uri.joinPath(args.context.extensionUri, 'webview'),
					vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist'),
				],
			},
		);

		timelinePanel.onDidDispose(
			() => {
				currentTimelineSession?.activeActionAbortController?.abort();
				timelinePanel = undefined;
				currentTimelineSession = undefined;
				timelineDebugState = createEmptyTimelineDebugState();
			},
			undefined,
			args.context.subscriptions,
		);

		timelinePanel.webview.onDidReceiveMessage(
			async (message: TimelineCommand | unknown) => {
				if (!currentTimelineSession || !timelinePanel) {
					return;
				}

				try {
					await handleTimelineMessage({
						panel: timelinePanel,
						session: currentTimelineSession,
						message,
					});
				} catch (error) {
					const text = error instanceof Error ? error.message : String(error);
					void vscode.window.showErrorMessage(`Timeline action failed: ${text}`);
				}
			},
			undefined,
			args.context.subscriptions,
		);

		return timelinePanel;
	}

	async function handleTimelineMessage(request: {
		panel: vscode.WebviewPanel;
		session: ExtensionTimelineSession;
		message: TimelineCommand | unknown;
	}): Promise<void> {
		if (!request.message || typeof request.message !== 'object') {
			return;
		}

		const command = Reflect.get(request.message, 'command');
		if (typeof command !== 'string') {
			return;
		}

		if (command === 'ready') {
			timelineDebugState = {
				...timelineDebugState,
				viewReady: true,
				readyCount: timelineDebugState.readyCount + 1,
				lastMessageCommand: 'ready',
				lastReadyAt: Date.now(),
			};

			const comparisonSource = normalizeComparisonSource(args.getPreferences().comparisonSource);
			if (
				comparisonSource === 'snapshot' &&
				request.session.backend === 'jj' &&
				request.session.snapshotLoadedChangeIds.size === 0
			) {
				await args.service.hydrateSnapshotEntries({
					session: request.session,
					revisionIndexes: [
						Math.max(0, request.session.entries.length - 2),
						Math.max(0, request.session.entries.length - 1),
					],
				});
			}

			await postTimelineMessage({
				panel: request.panel,
				message: {
					type: 'timeline-data',
					payload: buildPayload(request.session),
				},
			});
			return;
		}

		if (command === 'select-entry') {
			const fromIndex = Number(Reflect.get(request.message, 'fromIndex'));
			const toIndex = Number(Reflect.get(request.message, 'toIndex'));
			const comparisonSource = normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource'));
			if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
				return;
			}

			await sendTimelinePreview({
				panel: request.panel,
				session: request.session,
				fromIndex,
				toIndex,
				comparisonSource,
			});
			return;
		}

		if (command === 'load-range-overview') {
			const fromIndex = Number(Reflect.get(request.message, 'fromIndex'));
			const toIndex = Number(Reflect.get(request.message, 'toIndex'));
			const comparisonSource = normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource'));
			if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
				return;
			}

			await sendRangeOverview({
				panel: request.panel,
				session: request.session,
				fromIndex,
				toIndex,
				comparisonSource,
			});
			return;
		}

		if (command === 'hydrate-snapshot-entries') {
			const revisionIndexes = Reflect.get(request.message, 'revisionIndexes');
			if (!Array.isArray(revisionIndexes)) {
				return;
			}

			const didUpdate = await args.service.hydrateSnapshotEntries({
				session: request.session,
				revisionIndexes: revisionIndexes.map((value) => Number(value)).filter((value) => Number.isInteger(value)),
			});

			if (!didUpdate) {
				return;
			}

			const payload = buildPayload(request.session);
			await postTimelineMessage({
				panel: request.panel,
				message: {
					type: 'snapshot-entries',
					payload: {
						snapshotEntries: payload.snapshotEntries,
						snapshotState: payload.snapshotState,
					},
				},
			});
			return;
		}

		if (command === 'resolve-nonempty-range') {
			const candidateIndexes = Reflect.get(request.message, 'candidateIndexes');
			if (!Array.isArray(candidateIndexes)) {
				return;
			}

			const resolvedRange = await args.service.findNearestNonEmptyVisibleRange({
				session: request.session,
				candidateIndexes: candidateIndexes.map((value) => Number(value)).filter((value) => Number.isInteger(value)),
			});

			await postTimelineMessage({
				panel: request.panel,
				message: { type: 'resolved-range', payload: resolvedRange },
			});
			return;
		}

		if (command === 'open-editor-diff') {
			const fromIndex = Number(Reflect.get(request.message, 'fromIndex'));
			const toIndex = Number(Reflect.get(request.message, 'toIndex'));
			const comparisonSource = normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource'));
			if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
				return;
			}

			await openRangeDiffInEditor({
				session: request.session,
				fromIndex,
				toIndex,
				comparisonSource,
			});
			return;
		}

		if (command === 'open-current-file') {
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(request.session.absolutePath), {
				preview: true,
			});
			return;
		}

		if (command === 'open-range-files-diff') {
			const fromIndex = Number(Reflect.get(request.message, 'fromIndex'));
			const toIndex = Number(Reflect.get(request.message, 'toIndex'));
			const comparisonSource = normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource'));
			if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
				return;
			}

			await openRangeFilesDiff({
				session: request.session,
				fromIndex,
				toIndex,
				comparisonSource,
			});
			return;
		}

		if (command === 'open-revision-files-diff') {
			const entryIndex = Number(Reflect.get(request.message, 'entryIndex'));
			const comparisonSource = normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource'));
			if (!Number.isInteger(entryIndex)) {
				return;
			}

			await openRevisionFilesDiff({
				session: request.session,
				entryIndex,
				comparisonSource,
			});
			return;
		}

		if (command === 'open-revision-remote') {
			const entryIndex = Number(Reflect.get(request.message, 'entryIndex'));
			const comparisonSource = normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource'));
			if (!Number.isInteger(entryIndex)) {
				return;
			}

			await openRevisionOnRemote({
				session: request.session,
				entryIndex,
				comparisonSource,
			});
			return;
		}

		if (command === 'cancel-active-request') {
			request.session.activeActionAbortController?.abort();
			return;
		}

		if (command === 'switch-file') {
			const relativePath = String(Reflect.get(request.message, 'relativePath') || '').trim();
			if (!relativePath) {
				return;
			}

			const nextSession = await args.service.buildSession({
				workspacePath: request.session.workspacePath,
				absolutePath: path.join(request.session.workspacePath, relativePath),
			});
			if (!nextSession.entries.length) {
				void vscode.window.showInformationMessage('No file revisions were found for the selected file');
				return;
			}

			args.service.syncSession({ target: request.session, source: nextSession });
			currentTimelineSession = request.session;
			request.panel.title = `Revision Timeline: ${request.session.fileName}`;
			timelineDebugState = createDebugState({
				panel: request.panel,
				session: request.session,
				lastMessageCommand: 'switch-file',
			});

			await postTimelineMessage({
				panel: request.panel,
				message: {
					type: 'timeline-data',
					payload: buildPayload(request.session),
				},
			});
			return;
		}

		if (command === 'persist-state') {
			await args.savePreferences({
				sidebarWidth: Number(Reflect.get(request.message, 'sidebarWidth')),
				sidebarCollapsed: Boolean(Reflect.get(request.message, 'sidebarCollapsed')),
				timelinePaneHeight: Number(Reflect.get(request.message, 'timelinePaneHeight')),
				timelinePaneCollapsed: Boolean(Reflect.get(request.message, 'timelinePaneCollapsed')),
				layoutMode: Reflect.get(request.message, 'layoutMode') === 'unified' ? 'unified' : 'split',
				contentMode: Reflect.get(request.message, 'contentMode') === 'full' ? 'full' : 'diffs',
				comparisonMode: Reflect.get(request.message, 'comparisonMode') === 'step' ? 'step' : 'range',
				comparisonSource: normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource')),
				showIntermediateRevisions: Boolean(Reflect.get(request.message, 'showIntermediateRevisions')),
				preset: normalizeTimelinePreset(Reflect.get(request.message, 'preset')),
			});
			return;
		}

		if (command === 'refresh') {
			const nextSession = await args.service.buildSession({
				workspacePath: request.session.workspacePath,
				absolutePath: request.session.absolutePath,
			});
			args.service.syncSession({ target: request.session, source: nextSession });
			currentTimelineSession = request.session;
			timelineDebugState = createDebugState({
				panel: request.panel,
				session: request.session,
				lastMessageCommand: 'refresh',
			});
			await postTimelineMessage({
				panel: request.panel,
				message: {
					type: 'timeline-data',
					payload: buildPayload(request.session),
				},
			});
		}
	}

	function buildPayload(session: ExtensionTimelineSession) {
		return args.service.buildPayload({
			session,
			preferences: args.getPreferences(),
			version: args.version,
			presets: TIMELINE_PRESET_DAYS,
		});
	}

	async function sendTimelinePreview(request: {
		panel: vscode.WebviewPanel;
		session: ExtensionTimelineSession;
		fromIndex: number;
		toIndex: number;
		comparisonSource: ComparisonSource;
	}): Promise<void> {
		await postTimelineMessage({
			panel: request.panel,
			message: {
				type: 'diff-preview',
				payload: await args.service.getDiffPreview(request),
			},
		});
	}

	async function sendRangeOverview(request: {
		panel: vscode.WebviewPanel;
		session: ExtensionTimelineSession;
		fromIndex: number;
		toIndex: number;
		comparisonSource: ComparisonSource;
	}): Promise<void> {
		const normalizedFromIndex = Math.max(0, Math.min(request.fromIndex, request.toIndex));
		const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(request.fromIndex, request.toIndex));
		await postTimelineMessage({
			panel: request.panel,
			message: {
				type: 'range-overview',
				payload: {
					fromIndex: normalizedFromIndex,
					toIndex: normalizedToIndex,
					comparisonSource: request.comparisonSource,
					items: await args.service.getRangeOverview({
						session: request.session,
						fromIndex: normalizedFromIndex,
						toIndex: normalizedToIndex,
						comparisonSource: request.comparisonSource,
					}),
				},
			},
		});
	}

	async function openRangeDiffInEditor(request: {
		session: ExtensionTimelineSession;
		fromIndex: number;
		toIndex: number;
		comparisonSource: ComparisonSource;
	}): Promise<void> {
		const sourceEntries = args.service.getEntriesForSource({
			session: request.session,
			comparisonSource: request.comparisonSource,
		});
		const comparison = args.service.getComparisonEntries({
			entries: sourceEntries,
			fromIndex: request.fromIndex,
			toIndex: request.toIndex,
		});
		if (!comparison) {
			return;
		}

		if (!comparison.fromEntry) {
			const uri = await createRevisionUri({
				session: request.session,
				entry: comparison.toEntry,
			});
			await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
			return;
		}

		const originalUri = createSnapshotUri({
			workspacePath: request.session.workspacePath,
			revset: comparison.fromEntry.revision,
			relativePath: await args.service.resolveEntryFilePath({
				session: request.session,
				entry: comparison.fromEntry,
				entryIndex: Math.max(0, Math.min(request.fromIndex, request.toIndex)),
			}),
			backend: request.session.backend,
		});
		const modifiedUri = createSnapshotUri({
			workspacePath: request.session.workspacePath,
			revset: comparison.toEntry.revision,
			relativePath: await args.service.resolveEntryFilePath({
				session: request.session,
				entry: comparison.toEntry,
				entryIndex: Math.max(request.fromIndex, request.toIndex),
			}),
			backend: request.session.backend,
		});
		const title = `${request.session.fileName}: ${comparison.fromEntry.shortRevision} -> ${comparison.toEntry.shortRevision}`;
		await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title, { preview: true });
	}

	async function openRangeFilesDiff(request: {
		session: ExtensionTimelineSession;
		fromIndex: number;
		toIndex: number;
		comparisonSource: ComparisonSource;
	}): Promise<void> {
		await args.service.runSessionAction({
			session: request.session,
			action: async (signal) => {
				const sourceEntries = args.service.getEntriesForSource({
					session: request.session,
					comparisonSource: request.comparisonSource,
				});
				const comparison = args.service.getComparisonEntries({
					entries: sourceEntries,
					fromIndex: request.fromIndex,
					toIndex: request.toIndex,
				});
				if (!comparison) {
					return;
				}

				const plan = await request.session.adapter.buildRangeMultiDiffPlan({
					workspacePath: request.session.workspacePath,
					fromEntry: comparison.fromEntry,
					toEntry: comparison.toEntry,
					comparisonSource: request.comparisonSource,
					sourceEntries,
					signal,
				});

				if (!plan.files.length) {
					void vscode.window.showInformationMessage(`No changes found for ${plan.title}`);
					return;
				}

				if (!(await confirmMultiDiffOpen({ title: plan.title, fileCount: plan.files.length }))) {
					return;
				}

				if (signal.aborted) {
					return;
				}

				await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
					title: plan.title,
					resources: await buildMultiDiffResources({
						workspacePath: request.session.workspacePath,
						files: plan.files,
					}),
				});
			},
		});
	}

	async function openRevisionFilesDiff(request: {
		session: ExtensionTimelineSession;
		entryIndex: number;
		comparisonSource: ComparisonSource;
	}): Promise<void> {
		await args.service.runSessionAction({
			session: request.session,
			action: async (signal) => {
				const sourceEntries = args.service.getEntriesForSource({
					session: request.session,
					comparisonSource: request.comparisonSource,
				});
				const entry = sourceEntries[request.entryIndex];
				if (!entry) {
					return;
				}

				if (entry.isWorkingTree) {
					await openRangeFilesDiff({
						session: request.session,
						fromIndex: Math.max(0, request.entryIndex - 1),
						toIndex: request.entryIndex,
						comparisonSource: request.comparisonSource,
					});
					return;
				}

				const plan = await request.session.adapter.buildRevisionMultiDiffPlan({
					workspacePath: request.session.workspacePath,
					entry,
					entryIndex: request.entryIndex,
					comparisonSource: request.comparisonSource,
					sourceEntries,
					signal,
				});

				if (!plan.files.length) {
					void vscode.window.showInformationMessage(`No files changed in ${entry.shortRevision}`);
					return;
				}

				if (!(await confirmMultiDiffOpen({ title: plan.title, fileCount: plan.files.length }))) {
					return;
				}

				if (signal.aborted) {
					return;
				}

				await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
					title: plan.title,
					resources: await buildMultiDiffResources({
						workspacePath: request.session.workspacePath,
						files: plan.files,
					}),
				});
			},
		});
	}

	async function openRevisionOnRemote(request: {
		session: ExtensionTimelineSession;
		entryIndex: number;
		comparisonSource: ComparisonSource;
	}): Promise<void> {
		const entry = args.service.getEntriesForSource({
			session: request.session,
			comparisonSource: request.comparisonSource,
		})[request.entryIndex];
		if (!entry?.remoteUrl) {
			void vscode.window.showInformationMessage('No GitHub remote URL is available for this revision.');
			return;
		}

		await vscode.env.openExternal(vscode.Uri.parse(entry.remoteUrl));
	}

	async function buildMultiDiffResources(request: {
		workspacePath: string;
		files: Array<{
			relativePath: string;
			originalRevset: string;
			modifiedRevset: string;
			backend: 'git' | 'jj';
		}>;
	}) {
		return Promise.all(
			request.files.map(async (file) => ({
				originalUri: createSnapshotUri({
					workspacePath: request.workspacePath,
					revset: file.originalRevset,
					relativePath: file.relativePath,
					backend: file.backend,
				}),
				modifiedUri: await createTargetUri({
					workspacePath: request.workspacePath,
					revset: file.modifiedRevset,
					relativePath: file.relativePath,
					backend: file.backend,
				}),
			})),
		);
	}

	async function confirmMultiDiffOpen(request: { title: string; fileCount: number }): Promise<boolean> {
		if (request.fileCount <= LARGE_MULTI_DIFF_CONFIRMATION_THRESHOLD) {
			return true;
		}

		const confirmLabel = `Open ${request.fileCount} diffs`;
		const selection = await vscode.window.showWarningMessage(
			`Open ${request.fileCount} file diffs?`,
			{
				modal: true,
				detail: `${request.title} touches a large number of files. Opening every diff at once may be slow and create a lot of editors.`,
			},
			confirmLabel,
		);

		return selection === confirmLabel;
	}

	async function createTargetUri(request: {
		workspacePath: string;
		revset: string;
		relativePath: string;
		backend: 'git' | 'jj';
	}): Promise<vscode.Uri> {
		if (request.revset === '@') {
			const fileUri = vscode.Uri.file(path.join(request.workspacePath, request.relativePath));
			if (
				await vscode.workspace.fs.stat(fileUri).then(
					() => true,
					() => false,
				)
			) {
				return fileUri;
			}
		}

		return createSnapshotUri({
			workspacePath: request.workspacePath,
			revset: request.revset,
			relativePath: request.relativePath,
			backend: request.backend,
		});
	}

	async function createRevisionUri(request: {
		session: ExtensionTimelineSession;
		entry: FileRevisionEntry;
	}): Promise<vscode.Uri> {
		if (request.entry.isWorkingTree) {
			const fileUri = vscode.Uri.file(request.session.absolutePath);
			if (
				await vscode.workspace.fs.stat(fileUri).then(
					() => true,
					() => false,
				)
			) {
				return fileUri;
			}
		}

		const entryIndex = request.session.entries.findIndex((candidate) => candidate.id === request.entry.id);
		const resolvedPath = await args.service.resolveEntryFilePath({
			session: request.session,
			entry: request.entry,
			entryIndex,
		});
		return createSnapshotUri({
			workspacePath: request.session.workspacePath,
			revset: request.entry.revision,
			relativePath: resolvedPath,
			backend: request.session.backend,
		});
	}
}

function getTimelineWebviewHtml(args: { context: vscode.ExtensionContext; webview: vscode.Webview }): string {
	if (!hasBundledTimelineWebviewAssets({ context: args.context })) {
		return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Revision Timeline</title>
  </head>
  <body>
    <p>Webview bundle is missing. Run pnpm build:webview and reopen the timeline.</p>
  </body>
</html>`;
	}

	const appStylePath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'timeline-app.css');
	const appScriptPath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'timeline-app.js');

	return renderTimelineDocumentHtml({
		title: 'Revision Timeline',
		cspSource: args.webview.cspSource,
		styleHref: String(args.webview.asWebviewUri(appStylePath)),
		appSrc: String(args.webview.asWebviewUri(appScriptPath)),
	});
}

function hasBundledTimelineWebviewAssets(args: { context: vscode.ExtensionContext }): boolean {
	const appStylePath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'timeline-app.css');
	const appScriptPath = vscode.Uri.joinPath(args.context.extensionUri, 'webview-dist', 'timeline-app.js');
	return fsSync.existsSync(appStylePath.fsPath) && fsSync.existsSync(appScriptPath.fsPath);
}

function createEmptyTimelineDebugState(): TimelineDebugState {
	return {
		panelOpen: false,
		panelTitle: '',
		backend: '',
		workspacePath: '',
		relativePath: '',
		fileName: '',
		entryCount: 0,
		snapshotEntryCount: 0,
		usesBundledWebview: false,
		viewReady: false,
		readyCount: 0,
		lastMessageCommand: '',
		lastReadyAt: 0,
	};
}

function createDebugState(args: {
	panel: vscode.WebviewPanel;
	session: ExtensionTimelineSession;
	lastMessageCommand: string;
}): TimelineDebugState {
	return {
		panelOpen: true,
		panelTitle: args.panel.title,
		backend: args.session.backend,
		workspacePath: args.session.workspacePath,
		relativePath: args.session.relativePath,
		fileName: args.session.fileName,
		entryCount: args.session.entries.length,
		snapshotEntryCount: args.session.snapshotEntries.length,
		usesBundledWebview: true,
		viewReady: false,
		readyCount: 0,
		lastMessageCommand: args.lastMessageCommand,
		lastReadyAt: 0,
	};
}

function normalizeComparisonSource(value: unknown): ComparisonSource {
	return value === 'snapshot' ? 'snapshot' : 'revision';
}

function normalizeTimelinePreset(value: unknown): keyof typeof TIMELINE_PRESET_DAYS {
	return typeof value === 'string' && value in TIMELINE_PRESET_DAYS
		? (value as keyof typeof TIMELINE_PRESET_DAYS)
		: 'year';
}

async function maximizeTimelinePanel(): Promise<void> {
	try {
		await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
	} catch {
		// Ignore if unavailable.
	}
}

function shouldMaximizeTimelinePanel(): boolean {
	return getEditorGroupCount() > 1;
}

function getTimelineViewColumn(): vscode.ViewColumn {
	return shouldMaximizeTimelinePanel() ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
}

function getEditorGroupCount(): number {
	const groups = vscode.window.tabGroups?.all;
	return Array.isArray(groups) && groups.length ? groups.length : 1;
}
