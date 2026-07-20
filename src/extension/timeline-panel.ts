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

async function buildSelectedEntryMultiDiffPlan(request: {
	adapter: ExtensionTimelineSession['adapter'];
	workspacePath: string;
	sourceEntries: FileRevisionEntry[];
	comparisonSource: ComparisonSource;
	entryIndexes: number[];
	title: string;
	signal?: AbortSignal;
}) {
	const files: Array<{
		relativePath: string;
		originalRevset: string;
		modifiedRevset: string;
		backend: 'git' | 'jj';
	}> = [];

	for (const entryIndex of request.entryIndexes) {
		const entry = request.sourceEntries[entryIndex];
		if (!entry) {
			continue;
		}

		let plan = {
			title: request.title,
			files: [] as Array<{
				relativePath: string;
				originalRevset: string;
				modifiedRevset: string;
				backend: 'git' | 'jj';
			}>,
		};
		if (entry.isWorkingTree) {
			const previousEntry = request.sourceEntries[entryIndex - 1];
			if (!previousEntry) {
				continue;
			}

			plan = await request.adapter.buildRangeMultiDiffPlan({
				workspacePath: request.workspacePath,
				fromEntry: previousEntry,
				toEntry: entry,
				comparisonSource: request.comparisonSource,
				sourceEntries: request.sourceEntries,
				signal: request.signal,
			});
		} else {
			plan = await request.adapter.buildRevisionMultiDiffPlan({
				workspacePath: request.workspacePath,
				entry,
				entryIndex,
				comparisonSource: request.comparisonSource,
				sourceEntries: request.sourceEntries,
				signal: request.signal,
			});
		}

		files.push(...plan.files);
	}

	return {
		title: request.title,
		files,
	};
}

async function resolveTimelineSourcePath(request: { absolutePath?: string }): Promise<string | undefined> {
	if (request.absolutePath) {
		return request.absolutePath;
	}

	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor && isWorkspaceFileUri(activeEditor.document.uri)) {
		return activeEditor.document.uri.fsPath;
	}

	return pickOpenWorkspaceEditorPath();
}

async function pickOpenWorkspaceEditorPath(): Promise<string | undefined> {
	const candidates = getOpenWorkspaceEditorCandidates();
	if (!candidates.length) {
		return undefined;
	}

	const selection = await vscode.window.showQuickPick(
		candidates.map((candidate) => ({
			label: candidate.label,
			description: candidate.description,
			detail: candidate.detail,
			path: candidate.absolutePath,
		})),
		{
			placeHolder: 'Select a workspace file to open its revision timeline',
		},
	);

	return selection?.path;
}

function getOpenWorkspaceEditorCandidates(): Array<{
	label: string;
	description: string;
	detail: string;
	absolutePath: string;
}> {
	const candidates: Array<{
		label: string;
		description: string;
		detail: string;
		absolutePath: string;
	}> = [];
	const seenPaths = new Set<string>();

	for (const group of vscode.window.tabGroups?.all || []) {
		for (const tab of group.tabs) {
			const uri = getTabUri(tab);
			if (!uri || uri.scheme !== 'file') {
				continue;
			}

			const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
			if (!workspaceFolder) {
				continue;
			}

			const absolutePath = uri.fsPath;
			if (seenPaths.has(absolutePath)) {
				continue;
			}

			const relativePath = path.relative(workspaceFolder.uri.fsPath, absolutePath).replace(/\\/g, '/');
			if (!relativePath || relativePath.startsWith('..')) {
				continue;
			}

			seenPaths.add(absolutePath);
			candidates.push({
				label: path.basename(absolutePath),
				description: relativePath,
				detail: workspaceFolder.name,
				absolutePath,
			});
		}
	}

	return candidates;
}

function isWorkspaceFileUri(uri: vscode.Uri): boolean {
	return uri.scheme === 'file' && Boolean(vscode.workspace.getWorkspaceFolder(uri));
}

function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
	const input = tab.input as { uri?: vscode.Uri } | undefined;
	return input?.uri;
}

export function createTimelinePanelController(args: {
	context: vscode.ExtensionContext;
	service: TimelineService;
	getPreferences: () => TimelinePreferences;
	savePreferences: (nextPreferences: TimelinePreferences) => Promise<void>;
	version: string;
}): TimelinePanelController {
	const timelineSessions = new Map<vscode.WebviewPanel, ExtensionTimelineSession>();
	const panelViewReady = new WeakMap<vscode.WebviewPanel, boolean>();
	const panelLoadGeneration = new WeakMap<vscode.WebviewPanel, number>();
	let activeTimelinePanel: vscode.WebviewPanel | undefined;
	let timelineDebugState = createEmptyTimelineDebugState();

	return {
		dispose() {
			for (const panel of timelineSessions.keys()) {
				panel.dispose();
			}
			timelineSessions.clear();
			activeTimelinePanel = undefined;
			timelineDebugState = createEmptyTimelineDebugState();
		},
		getDebugState() {
			return { ...timelineDebugState };
		},
		async openFileRevisionTimeline({ absolutePath }) {
			const initialPath = await resolveTimelineSourcePath({ absolutePath });
			if (!initialPath) {
				void vscode.window.showErrorMessage('Open a workspace file to browse its revision timeline');
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

			const fileName = path.basename(documentUri.fsPath);
			const hadExistingPanel = timelineSessions.size > 0;
			const panel = createTimelinePanel({ fileName });
			activeTimelinePanel = panel;
			panel.webview.html = getTimelineWebviewHtml({
				context: args.context,
				webview: panel.webview,
			});
			panel.title = `Revision Timeline: ${fileName}`;
			timelineDebugState = {
				...createEmptyTimelineDebugState(),
				panelOpen: true,
				panelCount: timelineSessions.size + 1,
				panelTitle: panel.title,
				workspacePath: workspaceFolder.uri.fsPath,
				relativePath: path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath).replace(/\\/g, '/'),
				fileName,
				usesBundledWebview: hasBundledTimelineWebviewAssets({ context: args.context }),
			};

			if (!hadExistingPanel && shouldMaximizeTimelinePanel()) {
				await maximizeTimelinePanel();
			}

			await loadSessionIntoPanel({
				panel,
				workspacePath: workspaceFolder.uri.fsPath,
				absolutePath: documentUri.fsPath,
			});
		},
	};

	async function loadSessionIntoPanel(request: {
		panel: vscode.WebviewPanel;
		workspacePath: string;
		absolutePath: string;
	}): Promise<void> {
		const generation = (panelLoadGeneration.get(request.panel) || 0) + 1;
		panelLoadGeneration.set(request.panel, generation);

		const session = await args.service.buildSession({
			workspacePath: request.workspacePath,
			absolutePath: request.absolutePath,
		});

		if (panelLoadGeneration.get(request.panel) !== generation || request.panel.webview.html === '') {
			return;
		}

		if (!session.entries.length) {
			void vscode.window.showInformationMessage('No file revisions were found for the active file');
			if (!timelineSessions.has(request.panel)) {
				request.panel.dispose();
			}
			return;
		}

		timelineSessions.set(request.panel, session);
		activeTimelinePanel = request.panel;
		request.panel.title = `Revision Timeline: ${session.fileName}`;
		timelineDebugState = createDebugState({
			panel: request.panel,
			session,
			lastMessageCommand: timelineDebugState.lastMessageCommand,
			panelCount: timelineSessions.size,
		});
		timelineDebugState = {
			...timelineDebugState,
			viewReady: panelViewReady.get(request.panel) === true,
		};

		if (panelViewReady.get(request.panel)) {
			await eagerlyBootstrapTimeline({
				panel: request.panel,
				session,
			});
		}
	}

	function createTimelinePanel(request: { fileName: string }): vscode.WebviewPanel {
		const panel = vscode.window.createWebviewPanel(
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

		panel.onDidDispose(
			() => {
				timelineSessions.get(panel)?.activeActionAbortController?.abort();
				timelineSessions.delete(panel);

				if (activeTimelinePanel === panel) {
					const fallback = [...timelineSessions.entries()].at(-1);
					if (!fallback) {
						activeTimelinePanel = undefined;
						timelineDebugState = createEmptyTimelineDebugState();
						return;
					}

					activeTimelinePanel = fallback[0];
					timelineDebugState = createDebugState({
						panel: fallback[0],
						session: fallback[1],
						lastMessageCommand: timelineDebugState.lastMessageCommand,
						panelCount: timelineSessions.size,
					});
					return;
				}

				timelineDebugState = {
					...timelineDebugState,
					panelCount: timelineSessions.size,
				};
			},
			undefined,
			args.context.subscriptions,
		);

		panel.webview.onDidReceiveMessage(
			async (message: TimelineCommand | unknown) => {
				try {
					activeTimelinePanel = panel;
					const command = message && typeof message === 'object' ? Reflect.get(message, 'command') : undefined;

					if (command === 'ready') {
						panelViewReady.set(panel, true);
						const session = timelineSessions.get(panel);
						timelineDebugState = {
							...(session
								? createDebugState({
										panel,
										session,
										lastMessageCommand: 'ready',
										panelCount: timelineSessions.size,
									})
								: timelineDebugState),
							viewReady: true,
							readyCount: (timelineDebugState.readyCount || 0) + 1,
							lastReadyAt: Date.now(),
							lastMessageCommand: 'ready',
							panelOpen: true,
							panelTitle: panel.title,
						};

						if (session?.entries.length) {
							await eagerlyBootstrapTimeline({
								panel,
								session,
							});
						}
						return;
					}

					const session = timelineSessions.get(panel);
					if (!session) {
						return;
					}

					await handleTimelineMessage({
						panel,
						session,
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

		return panel;
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
			const selectedEntryIndexes = Array.isArray(Reflect.get(request.message, 'selectedEntryIndexes'))
				? (Reflect.get(request.message, 'selectedEntryIndexes') as unknown[])
						.map((value) => Number(value))
						.filter((value) => Number.isInteger(value))
				: [];
			if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
				return;
			}

			await sendRangeOverview({
				panel: request.panel,
				session: request.session,
				fromIndex,
				toIndex,
				comparisonSource,
				selectedEntryIndexes,
			});
			return;
		}

		if (command === 'load-entry-diff-counts') {
			const comparisonSource = normalizeComparisonSource(Reflect.get(request.message, 'comparisonSource'));
			const entryIndexes = Array.isArray(Reflect.get(request.message, 'entryIndexes'))
				? (Reflect.get(request.message, 'entryIndexes') as unknown[])
						.map((value) => Number(value))
						.filter((value) => Number.isInteger(value))
				: [];
			if (!entryIndexes.length) {
				return;
			}

			await postTimelineMessage({
				panel: request.panel,
				message: {
					type: 'entry-diff-counts',
					payload: {
						comparisonSource,
						counts: await args.service.getEntryDiffCounts({
							session: request.session,
							entryIndexes,
							comparisonSource,
						}),
					},
				},
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
			const selectedEntryIndexes = Array.isArray(Reflect.get(request.message, 'selectedEntryIndexes'))
				? (Reflect.get(request.message, 'selectedEntryIndexes') as unknown[])
						.map((value) => Number(value))
						.filter((value) => Number.isInteger(value))
				: [];
			if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
				return;
			}

			await openRangeFilesDiff({
				session: request.session,
				fromIndex,
				toIndex,
				comparisonSource,
				selectedEntryIndexes,
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

			await loadSessionIntoPanel({
				panel: request.panel,
				workspacePath: request.session.workspacePath,
				absolutePath: path.join(request.session.workspacePath, relativePath),
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
			await loadSessionIntoPanel({
				panel: request.panel,
				workspacePath: request.session.workspacePath,
				absolutePath: request.session.absolutePath,
			});
		}
	}

	async function eagerlyBootstrapTimeline(request: {
		panel: vscode.WebviewPanel;
		session: ExtensionTimelineSession;
	}): Promise<void> {
		const comparisonSource = normalizeComparisonSource(args.getPreferences().comparisonSource);
		if (
			comparisonSource === 'snapshot' &&
			request.session.backend === 'jj' &&
			request.session.snapshotLoadedChangeIds.size === 0
		) {
			await args.service.hydrateSnapshotEntries({
				session: request.session,
				revisionIndexes: collectPendingSnapshotHydrationIndexes(request.session),
			});
		}

		const payload = buildPayload(request.session);
		await postTimelineMessage({
			panel: request.panel,
			message: {
				type: 'timeline-data',
				payload,
			},
		});

		const defaultFromIndex = Math.max(0, payload.defaultIndex - 1);
		await sendTimelinePreview({
			panel: request.panel,
			session: request.session,
			fromIndex: defaultFromIndex,
			toIndex: payload.defaultIndex,
			comparisonSource,
		});

		void enrichSessionInBackground({
			panel: request.panel,
			session: request.session,
		});
	}

	async function enrichSessionInBackground(request: {
		panel: vscode.WebviewPanel;
		session: ExtensionTimelineSession;
	}): Promise<void> {
		const generation = panelLoadGeneration.get(request.panel);
		const isCurrent = () =>
			panelLoadGeneration.get(request.panel) === generation && timelineSessions.get(request.panel) === request.session;

		try {
			if (await args.service.ensureWorkspaceFiles({ session: request.session })) {
				if (!isCurrent()) {
					return;
				}
				await postTimelineMessage({
					panel: request.panel,
					message: {
						type: 'workspace-files',
						payload: { workspaceFiles: request.session.workspaceFiles },
					},
				});
			}

			const expanded = await args.service.expandFileHistory({ session: request.session });
			const intermediates = await args.service.ensureIntermediateRevisions({ session: request.session });
			if (!isCurrent() || (!expanded && !intermediates)) {
				return;
			}

			await postTimelineMessage({
				panel: request.panel,
				message: {
					type: 'entries-updated',
					payload: {
						entries: args.service.mapEntriesForPayload(request.session.entries),
						hasIntermediateRevisions: request.session.entries.some((entry) => !entry.touchesFile),
					},
				},
			});
		} catch {
			// Background enrichment is best-effort; first paint already succeeded.
		}
	}

	function collectPendingSnapshotHydrationIndexes(session: ExtensionTimelineSession): number[] {
		return session.entries.reduce<number[]>((indexes, entry, index) => {
			if (
				entry &&
				!entry.isWorkingTree &&
				entry.touchesFile &&
				entry.changeId &&
				!session.snapshotLoadedChangeIds.has(entry.changeId)
			) {
				indexes.push(index);
			}
			return indexes;
		}, []);
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
		selectedEntryIndexes?: number[];
	}): Promise<void> {
		const normalizedFromIndex = Math.max(0, Math.min(request.fromIndex, request.toIndex));
		const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(request.fromIndex, request.toIndex));
		const selectedEntryIndexes = request.selectedEntryIndexes || [];
		await postTimelineMessage({
			panel: request.panel,
			message: {
				type: 'range-overview',
				payload: {
					fromIndex: normalizedFromIndex,
					toIndex: normalizedToIndex,
					comparisonSource: request.comparisonSource,
					selectedEntryIndexes,
					items: await args.service.getRangeOverview({
						session: request.session,
						fromIndex: normalizedFromIndex,
						toIndex: normalizedToIndex,
						comparisonSource: request.comparisonSource,
						selectedEntryIndexes,
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
		selectedEntryIndexes?: number[];
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

				const plan = request.selectedEntryIndexes?.length
					? await buildSelectedEntryMultiDiffPlan({
							adapter: request.session.adapter,
							workspacePath: request.session.workspacePath,
							sourceEntries,
							comparisonSource: request.comparisonSource,
							entryIndexes: request.selectedEntryIndexes,
							title: `${comparison.fromEntry.shortRevision}..${comparison.toEntry.shortRevision}`,
							signal,
						})
					: await request.session.adapter.buildRangeMultiDiffPlan({
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
		panelCount: 0,
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
	panelCount: number;
}): TimelineDebugState {
	return {
		panelOpen: true,
		panelCount: args.panelCount,
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
