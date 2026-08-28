import path from 'node:path';
import * as vscode from 'vscode';
import packageJson from '../../package.json' with { type: 'json' };
import { createCommandRunner } from './command-runner.ts';
import {
	CLI_SOURCE,
	DEFAULT_FROM_REVSET,
	DEFAULT_TO_REVSET,
	EXTENSION_ID,
	GET_TIMELINE_DEBUG_STATE_COMMAND,
	GET_DIFF_LAYOUT_METRICS_COMMAND,
	DEBUG_SELECT_TIMELINE_RANGE_COMMAND,
	DEBUG_SET_LAYOUT_MODE_COMMAND,
	HELPER_COMMAND,
	CLEAR_LINE_HISTORY_COMMAND,
	OPEN_FILE_RANGE_DIFF_COMMAND,
	OPEN_FILE_TIMELINE_COMMAND,
	OPEN_REPO_TIMELINE_COMMAND,
	OPEN_FILE_LINE_TIMELINE_COMMAND,
	OPEN_TIMELINE_AT_LINE_COMMAND,
	OPEN_CHANGES_WITH_PREVIOUS_COMMAND,
	OPEN_REVISION_DIFF_PREVIOUS_COMMAND,
	OPEN_REVISION_DIFF_NEXT_COMMAND,
	OPEN_REVISION_DIFF_TIMELINE_COMMAND,
	OPEN_MULTI_DIFF_COMMAND,
	PENDING_RANGE_DIFF_KEY,
	SNAPSHOT_SCHEME,
	TIMELINE_PREFERENCES_KEY,
} from './constants.ts';
import { createEditorBlameDecorations } from './blame-codelens.ts';
import { registerEditorExtraFeatures } from './editor-extra-features.ts';
import { resolveHistoryAdapter, resolveHistoryWorkspacePath } from './history-adapters.ts';
import { resolveCommandFilePath } from './resolve-file-path.ts';
import { createRevisionDiffNavigator, listFileRevisionIds } from './revision-diff-nav.ts';
import { createTimelinePanelController } from './timeline-panel.ts';
import { createRepoTimelinePanelController } from './repo-timeline-panel.ts';
import { createTimelineService, normalizeTimelinePreferences } from './timeline-service.ts';
import {
	areSamePath,
	createSnapshotUri,
	isRangeDiffUriTarget,
	parseRangeDiffUri,
	parseSnapshotUri,
	sanitizeRangeDiffArgs,
} from './uri-utils.ts';
import type { RangeDiffArgs } from './types.ts';

type FileRangeDiffArgs = RangeDiffArgs & {
	absolutePath?: string;
};

type WorkspaceFileTarget = {
	absolutePath: string;
	relativePath: string;
	fileName: string;
};

export function activate(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel('JJ Plus');
	const runner = createCommandRunner({ outputChannel });
	const service = createTimelineService({ runner });
	const panelController = createTimelinePanelController({
		context,
		service,
		getPreferences: () => getTimelinePreferences(context),
		savePreferences: (nextPreferences) => saveTimelinePreferences(context, nextPreferences),
		version: packageJson.version,
	});
	const repoTimelineController = createRepoTimelinePanelController({
		context,
		runner,
		version: packageJson.version,
	});
	const provider = new SnapshotContentProvider({ runner });

	const openRangeMultiDiff = async (rawArgs?: RangeDiffArgs) => {
		if (rawArgs?.verbose) {
			outputChannel.show(true);
		}

		const workspaceUri = await resolveWorkspaceUri({ context, args: rawArgs });
		if (workspaceUri === 'redirected') {
			return;
		}

		if (!workspaceUri) {
			void vscode.window.showErrorMessage('No workspace folder available');
			return;
		}

		const base = shouldPromptForInputs(rawArgs)
			? await resolveInput({
					value: getFromValue(rawArgs),
					prompt: 'From change id or revset',
					placeHolder: DEFAULT_FROM_REVSET,
				})
			: getFromValue(rawArgs);
		if (!base) {
			return;
		}

		const target = shouldPromptForInputs(rawArgs)
			? await resolveInput({
					value: getToValue(rawArgs),
					prompt: 'To change id or revset',
					placeHolder: DEFAULT_TO_REVSET,
				})
			: getToValue(rawArgs);
		if (!target) {
			return;
		}

		const title = rawArgs?.title?.trim() || `${base}..${target}`;

		try {
			const { resolvedTitle, resources } = await buildWorkspaceMultiDiffResources({
				runner,
				workspacePath: workspaceUri.fsPath,
				base,
				target,
				title,
			});
			if (!resources.length) {
				void vscode.window.showInformationMessage(`No changes found for ${title}`);
				return;
			}

			await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
				title: resolvedTitle,
				resources,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to open JJ Plus range diff: ${message}`);
		}
	};

	const openFileRangeDiff = async (rawArgs?: FileRangeDiffArgs) => {
		if (rawArgs?.verbose) {
			outputChannel.show(true);
		}

		const workspaceUri = await resolveWorkspaceUri({ context, args: rawArgs });
		if (workspaceUri === 'redirected') {
			return;
		}

		if (!workspaceUri) {
			void vscode.window.showErrorMessage('No workspace folder available');
			return;
		}

		const fileTarget = await resolveFileDiffTarget({
			workspaceUri,
			absolutePath: rawArgs?.absolutePath,
		});
		if (!fileTarget) {
			void vscode.window.showErrorMessage('No workspace file available from the active editor or open tabs');
			return;
		}

		const base = shouldPromptForInputs(rawArgs)
			? await resolveInput({
					value: getFromValue(rawArgs),
					prompt: 'From change id or revset',
					placeHolder: DEFAULT_FROM_REVSET,
				})
			: getFromValue(rawArgs);
		if (!base) {
			return;
		}

		const target = shouldPromptForInputs(rawArgs)
			? await resolveInput({
					value: getToValue(rawArgs),
					prompt: 'To change id or revset',
					placeHolder: DEFAULT_TO_REVSET,
				})
			: getToValue(rawArgs);
		if (!target) {
			return;
		}

		const title = rawArgs?.title?.trim() || `${fileTarget.fileName}: ${base} -> ${target}`;

		try {
			const preferredWorkspacePath = path.dirname(fileTarget.absolutePath);
			const historyWorkspacePath = await resolveHistoryWorkspacePath({
				workspacePath: preferredWorkspacePath,
				runner,
			});
			const relativePath = toHistoryRelativePath({
				historyWorkspacePath,
				absolutePath: fileTarget.absolutePath,
			});
			if (!relativePath) {
				throw new Error('The selected file is outside the resolved repository root');
			}

			let adapter = await resolveHistoryAdapter({
				workspacePath: historyWorkspacePath,
				runner,
			});
			let resolvedWorkspacePath = historyWorkspacePath;
			let resolvedRelativePath = relativePath;
			let originalContent = '';
			let modifiedContent = '';

			try {
				[originalContent, modifiedContent] = await Promise.all([
					adapter.showFileAtRevision({
						workspacePath: resolvedWorkspacePath,
						revset: base,
						filePath: resolvedRelativePath,
					}),
					adapter.showFileAtRevision({
						workspacePath: resolvedWorkspacePath,
						revset: target,
						filePath: resolvedRelativePath,
					}),
				]);
			} catch (error) {
				const fallback = await resolveJjFileFallback({
					error,
					adapter,
					runner,
					absolutePath: fileTarget.absolutePath,
					base,
					target,
				});
				if (!fallback) {
					throw error;
				}

				adapter = fallback.adapter;
				resolvedWorkspacePath = fallback.workspacePath;
				resolvedRelativePath = fallback.relativePath;
				[originalContent, modifiedContent] = await Promise.all([
					adapter.showFileAtRevision({
						workspacePath: resolvedWorkspacePath,
						revset: base,
						filePath: resolvedRelativePath,
					}),
					adapter.showFileAtRevision({
						workspacePath: resolvedWorkspacePath,
						revset: target,
						filePath: resolvedRelativePath,
					}),
				]);
			}

			const originalUri = provider.createInlineContentUri({
				workspacePath: resolvedWorkspacePath,
				revset: base,
				relativePath: resolvedRelativePath,
				content: originalContent,
			});
			const modifiedUri = provider.createInlineContentUri({
				workspacePath: resolvedWorkspacePath,
				revset: target,
				relativePath: resolvedRelativePath,
				content: modifiedContent,
			});

			await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title, { preview: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to open file diff: ${message}`);
		}
	};

	const revisionDiffNav = createRevisionDiffNavigator({
		showFile: async ({ workspacePath, revset, filePath }) => {
			const adapter = await resolveHistoryAdapter({ workspacePath, runner });
			return adapter.showFileAtRevision({ workspacePath, revset, filePath });
		},
		createUri: (uriArgs) => provider.createInlineContentUri(uriArgs),
		listRevisions: async ({ workspacePath, relativePath, backend }) =>
			listFileRevisionIds({ runner, workspacePath, relativePath, backend }),
		resolveBackend: async ({ workspacePath }) => resolveHistoryAdapter({ workspacePath, runner }),
		resolveHistoryWorkspacePath: async ({ workspacePath }) => resolveHistoryWorkspacePath({ workspacePath, runner }),
		toRelativePath: toHistoryRelativePath,
	});

	context.subscriptions.push(
		outputChannel,
		vscode.workspace.registerTextDocumentContentProvider('jj-plus', provider),
		vscode.commands.registerCommand(HELPER_COMMAND, openRangeMultiDiff),
		vscode.commands.registerCommand(OPEN_FILE_RANGE_DIFF_COMMAND, openFileRangeDiff),
		vscode.commands.registerCommand(OPEN_CHANGES_WITH_PREVIOUS_COMMAND, (arg?: unknown) =>
			revisionDiffNav.openWithPrevious(arg),
		),
		vscode.commands.registerCommand(OPEN_REVISION_DIFF_PREVIOUS_COMMAND, () => revisionDiffNav.openPrevious()),
		vscode.commands.registerCommand(OPEN_REVISION_DIFF_NEXT_COMMAND, () => revisionDiffNav.openNext()),
		vscode.commands.registerCommand('jj-plus.openRevisionDiffPreviousUnavailable', () => undefined),
		vscode.commands.registerCommand('jj-plus.openRevisionDiffNextUnavailable', () => undefined),
		vscode.commands.registerCommand(OPEN_REVISION_DIFF_TIMELINE_COMMAND, () => revisionDiffNav.openTimelineHere()),
		vscode.commands.registerCommand(OPEN_FILE_TIMELINE_COMMAND, (arg?: unknown) =>
			panelController.openFileRevisionTimeline({ context, absolutePath: resolveCommandFilePath(arg) }),
		),
		vscode.commands.registerCommand(OPEN_REPO_TIMELINE_COMMAND, () => repoTimelineController.open()),
		vscode.commands.registerCommand(OPEN_FILE_LINE_TIMELINE_COMMAND, async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.scheme !== 'file') {
				void vscode.window.showErrorMessage('Open a workspace file and select lines to browse line history');
				return;
			}
			const startLine = Math.min(editor.selection.start.line, editor.selection.end.line) + 1;
			const endLine = Math.max(editor.selection.start.line, editor.selection.end.line) + 1;
			await panelController.openFileRevisionTimeline({
				context,
				absolutePath: editor.document.uri.fsPath,
				lineHistory: { startLine, endLine },
			});
		}),
		vscode.commands.registerCommand(CLEAR_LINE_HISTORY_COMMAND, () => panelController.clearLineHistoryFilter()),
		vscode.commands.registerCommand(
			OPEN_TIMELINE_AT_LINE_COMMAND,
			async (args?: { absolutePath?: string; line?: number } | string) => {
				const parsed =
					typeof args === 'string' ? (JSON.parse(args) as { absolutePath?: string; line?: number }) : args || {};
				const editor = vscode.window.activeTextEditor;
				const absolutePath = parsed.absolutePath || editor?.document.uri.fsPath;
				const line =
					typeof parsed.line === 'number' ? parsed.line : editor ? editor.selection.active.line + 1 : undefined;
				if (!absolutePath || !line) {
					void vscode.window.showErrorMessage('Place the cursor on a workspace file line to open timeline');
					return;
				}

				const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolutePath));
				if (!workspaceFolder) {
					void vscode.window.showErrorMessage('The file must belong to a workspace folder');
					return;
				}

				const relativePath = path.relative(workspaceFolder.uri.fsPath, absolutePath).replace(/\\/g, '/');
				const adapter = await resolveHistoryAdapter({
					workspacePath: workspaceFolder.uri.fsPath,
					runner,
				});
				const focusRevision = await service.resolveBlameRevisionForLine({
					workspacePath: workspaceFolder.uri.fsPath,
					relativePath,
					line,
					backend: adapter.backend,
				});

				await panelController.openFileRevisionTimeline({
					context,
					absolutePath,
					lineHistory: { startLine: line, endLine: line },
					focusRevision,
				});
			},
		),
		createEditorBlameDecorations({
			runner,
			resolveBackend: async ({ workspacePath }) =>
				resolveHistoryAdapter({
					workspacePath,
					runner,
				}),
		}),
		registerEditorExtraFeatures({
			context,
			runner,
			resolveBackend: async ({ workspacePath }) => resolveHistoryAdapter({ workspacePath, runner }),
			createInlineContentUri: (uriArgs) => provider.createInlineContentUri(uriArgs),
			showFileAtRevision: async ({ workspacePath, revset, filePath }) => {
				const adapter = await resolveHistoryAdapter({ workspacePath, runner });
				return adapter.showFileAtRevision({ workspacePath, revset, filePath });
			},
		}),
		revisionDiffNav,
		vscode.commands.registerCommand(GET_TIMELINE_DEBUG_STATE_COMMAND, () => panelController.getDebugState()),
		vscode.commands.registerCommand(GET_DIFF_LAYOUT_METRICS_COMMAND, () => panelController.getDiffLayoutMetrics()),
		vscode.commands.registerCommand(
			DEBUG_SELECT_TIMELINE_RANGE_COMMAND,
			(args: { fromIndex: number; toIndex: number; comparisonSource?: 'revision' | 'snapshot' }) =>
				panelController.selectTimelineRange(args),
		),
		vscode.commands.registerCommand(DEBUG_SET_LAYOUT_MODE_COMMAND, (layoutMode: 'split' | 'unified') =>
			panelController.setLayoutMode(layoutMode),
		),
		vscode.window.registerUriHandler({
			async handleUri(uri) {
				if (!isRangeDiffUriTarget({ uri, extensionId: EXTENSION_ID })) {
					return;
				}

				await openRangeMultiDiff(parseRangeDiffUri(uri));
			},
		}),
		{ dispose: () => panelController.dispose() },
		{ dispose: () => repoTimelineController.dispose() },
	);

	void resumePendingRangeDiff({ context, openRangeMultiDiff });
}

export function deactivate(): void {}

class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
	private readonly runner;
	private readonly inlineContent = new Map<string, string>();

	constructor(args: { runner: ReturnType<typeof createCommandRunner> }) {
		this.runner = args.runner;
	}

	createInlineContentUri(args: {
		workspacePath: string;
		revset: string;
		relativePath: string;
		content: string;
	}): vscode.Uri {
		const contentId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		this.inlineContent.set(contentId, args.content);
		return vscode.Uri.from({
			scheme: SNAPSHOT_SCHEME,
			path: `/${args.relativePath}`,
			query: JSON.stringify({
				workspacePath: args.workspacePath,
				filePath: args.relativePath,
				revset: args.revset,
				contentId,
			}),
		});
	}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const query = parseSnapshotUri(uri);
		if (query.contentId) {
			return this.inlineContent.get(query.contentId) || '';
		}

		if (!query.workspacePath || !query.revset || !query.filePath) {
			return '';
		}

		try {
			const adapter = await resolveHistoryAdapter({
				workspacePath: query.workspacePath,
				runner: this.runner,
			});
			return await adapter.showFileAtRevision({
				workspacePath: query.workspacePath,
				revset: query.revset,
				filePath: query.filePath,
			});
		} catch {
			return '';
		}
	}
}

function getTimelinePreferences(context: vscode.ExtensionContext): ReturnType<typeof normalizeTimelinePreferences> {
	const rawValue = context.globalState.get(TIMELINE_PREFERENCES_KEY);
	return normalizeTimelinePreferences(rawValue as Record<string, unknown> | undefined);
}

async function saveTimelinePreferences(
	context: vscode.ExtensionContext,
	nextPreferences: Record<string, unknown>,
): Promise<void> {
	const currentPreferences = getTimelinePreferences(context);
	await context.globalState.update(TIMELINE_PREFERENCES_KEY, {
		...currentPreferences,
		...nextPreferences,
	});
}

async function buildWorkspaceMultiDiffResources(args: {
	runner: ReturnType<typeof createCommandRunner>;
	workspacePath: string;
	base: string;
	target: string;
	title: string;
}): Promise<{
	resolvedTitle: string;
	resources: Array<{ originalUri: vscode.Uri; modifiedUri: vscode.Uri }>;
}> {
	let changedFiles = await listChangedFiles(args);
	let originalRevset = args.base;
	let modifiedRevset = args.target;
	let resolvedTitle = args.title;

	if (!changedFiles.length && args.target === '@' && args.base !== args.target) {
		const revisionFiles = await listRevisionFiles({
			runner: args.runner,
			workspacePath: args.workspacePath,
			revision: args.base,
		});
		if (revisionFiles.length) {
			changedFiles = revisionFiles;
			originalRevset = `${args.base}-`;
			modifiedRevset = args.base;
			if (args.title === `${args.base}..${args.target}`) {
				resolvedTitle = args.base;
			}
		}
	}

	return {
		resolvedTitle,
		resources: await Promise.all(
			changedFiles.map(async (relativePath) => ({
				originalUri: createSnapshotUri({
					workspacePath: args.workspacePath,
					revset: originalRevset,
					relativePath,
				}),
				modifiedUri: await createTargetUri({
					workspacePath: args.workspacePath,
					revset: modifiedRevset,
					relativePath,
				}),
			})),
		),
	};
}

async function listChangedFiles(args: {
	runner: ReturnType<typeof createCommandRunner>;
	workspacePath: string;
	base: string;
	target: string;
}): Promise<string[]> {
	const { stdout } = await args.runner.runJj({
		workspacePath: args.workspacePath,
		args: ['diff', '--name-only', '--from', args.base, '--to', args.target],
	});

	return stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function listRevisionFiles(args: {
	runner: ReturnType<typeof createCommandRunner>;
	workspacePath: string;
	revision: string;
}): Promise<string[]> {
	const { stdout } = await args.runner.runJj({
		workspacePath: args.workspacePath,
		args: ['diff', '--name-only', '-r', args.revision],
	});

	return stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function createTargetUri(args: {
	workspacePath: string;
	revset: string;
	relativePath: string;
}): Promise<vscode.Uri> {
	if (args.revset === '@') {
		const fileUri = vscode.Uri.file(path.join(args.workspacePath, args.relativePath));
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
		workspacePath: args.workspacePath,
		revset: args.revset,
		relativePath: args.relativePath,
	});
}

function toHistoryRelativePath(args: { historyWorkspacePath: string; absolutePath: string }): string | undefined {
	const relativePath = path.relative(args.historyWorkspacePath, args.absolutePath).replace(/\\/g, '/');
	if (!relativePath || relativePath.startsWith('..')) {
		return undefined;
	}

	return relativePath;
}

async function resolveJjFileFallback(args: {
	error: unknown;
	adapter: Awaited<ReturnType<typeof resolveHistoryAdapter>>;
	runner: ReturnType<typeof createCommandRunner>;
	absolutePath: string;
	base: string;
	target: string;
}): Promise<
	| {
			adapter: Awaited<ReturnType<typeof resolveHistoryAdapter>>;
			workspacePath: string;
			relativePath: string;
	  }
	| undefined
> {
	if (args.adapter.backend !== 'git') {
		return undefined;
	}

	if (!looksLikeGitRejectedJjRevset({ error: args.error, base: args.base, target: args.target })) {
		return undefined;
	}

	const preferredWorkspacePath = path.dirname(args.absolutePath);
	const { stdout } = await args.runner.runJj({
		workspacePath: preferredWorkspacePath,
		args: ['root'],
	});
	const jjRoot = stdout.trim();
	if (!jjRoot) {
		return undefined;
	}

	const relativePath = toHistoryRelativePath({
		historyWorkspacePath: jjRoot,
		absolutePath: args.absolutePath,
	});
	if (!relativePath) {
		return undefined;
	}

	const adapter = await resolveHistoryAdapter({
		workspacePath: jjRoot,
		runner: args.runner,
	});
	if (adapter.backend !== 'jj') {
		return undefined;
	}

	return {
		adapter,
		workspacePath: jjRoot,
		relativePath,
	};
}

function looksLikeGitRejectedJjRevset(args: { error: unknown; base: string; target: string }): boolean {
	const errorMessage = args.error instanceof Error ? args.error.message : String(args.error || '');
	const gitRejectedRevision = /invalid\s+object\s+name|unknown\s+revision|ambiguous\s+argument/iu.test(errorMessage);
	if (!gitRejectedRevision) {
		return false;
	}

	return [args.base, args.target].some((candidate) => isLikelyJjRevset(candidate));
}

function isLikelyJjRevset(value: string): boolean {
	const revset = value.trim();
	if (!revset) {
		return false;
	}

	if (revset.includes('closest_bookmark(') || revset.includes('latest(') || revset.includes('::')) {
		return true;
	}

	if (revset === '@' || revset.startsWith('@-') || revset.startsWith('@+')) {
		return true;
	}

	return /^@[0-9]+$/u.test(revset);
}

async function resolveFileDiffTarget(args: {
	workspaceUri: vscode.Uri;
	absolutePath?: string;
}): Promise<WorkspaceFileTarget | undefined> {
	const explicitTarget = getWorkspaceFileTargetFromAbsolutePath(args);
	if (explicitTarget) {
		return explicitTarget;
	}

	const activeEditorTarget = getActiveWorkspaceFileTarget(args.workspaceUri);
	if (activeEditorTarget) {
		return activeEditorTarget;
	}

	return pickOpenWorkspaceFileTarget(args.workspaceUri);
}

function getWorkspaceFileTargetFromAbsolutePath(args: {
	workspaceUri: vscode.Uri;
	absolutePath?: string;
}): WorkspaceFileTarget | undefined {
	const trimmedPath = args.absolutePath?.trim();
	if (!trimmedPath) {
		return undefined;
	}

	return toWorkspaceFileTarget({
		workspaceUri: args.workspaceUri,
		fileUri: vscode.Uri.file(trimmedPath),
	});
}

function getActiveWorkspaceFileTarget(workspaceUri: vscode.Uri): WorkspaceFileTarget | undefined {
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		return undefined;
	}

	return toWorkspaceFileTarget({
		workspaceUri,
		fileUri: activeEditor.document.uri,
	});
}

async function pickOpenWorkspaceFileTarget(workspaceUri: vscode.Uri): Promise<WorkspaceFileTarget | undefined> {
	const candidates = getOpenWorkspaceFileTargets(workspaceUri);
	if (!candidates.length) {
		return undefined;
	}

	const selection = await vscode.window.showQuickPick(
		candidates.map((candidate) => ({
			label: candidate.fileName,
			description: candidate.relativePath,
			detail: path.dirname(candidate.relativePath) === '.' ? undefined : path.dirname(candidate.relativePath),
			target: candidate,
		})),
		{
			placeHolder: 'Select a workspace file to diff between revisions',
		},
	);

	return selection?.target;
}

function getOpenWorkspaceFileTargets(workspaceUri: vscode.Uri): WorkspaceFileTarget[] {
	const candidates: WorkspaceFileTarget[] = [];
	const seenPaths = new Set<string>();

	for (const group of vscode.window.tabGroups?.all || []) {
		for (const tab of group.tabs) {
			const uri = getTabUri(tab);
			if (!uri || uri.scheme !== 'file') {
				continue;
			}

			const absolutePath = uri.fsPath;
			if (seenPaths.has(absolutePath)) {
				continue;
			}

			const target = toWorkspaceFileTarget({ workspaceUri, fileUri: uri });
			if (!target) {
				continue;
			}

			seenPaths.add(absolutePath);
			candidates.push(target);
		}
	}

	return candidates;
}

function toWorkspaceFileTarget(args: {
	workspaceUri: vscode.Uri;
	fileUri: vscode.Uri;
}): WorkspaceFileTarget | undefined {
	if (args.fileUri.scheme !== 'file') {
		return undefined;
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(args.fileUri);
	if (!workspaceFolder || !areSamePath({ left: workspaceFolder.uri.fsPath, right: args.workspaceUri.fsPath })) {
		return undefined;
	}

	const relativePath = path.relative(args.workspaceUri.fsPath, args.fileUri.fsPath).replace(/\\/g, '/');
	if (!relativePath || relativePath.startsWith('..')) {
		return undefined;
	}

	return {
		absolutePath: args.fileUri.fsPath,
		relativePath,
		fileName: path.basename(args.fileUri.fsPath),
	};
}

function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
	const input = tab.input as { uri?: vscode.Uri } | undefined;
	return input?.uri;
}

async function resolveWorkspaceUri(args: {
	context: vscode.ExtensionContext;
	args?: RangeDiffArgs;
}): Promise<vscode.Uri | 'redirected' | undefined> {
	const explicitUri = getExplicitWorkspaceUri(args.args?.workspacePath);
	if (explicitUri) {
		const openWorkspaceUri = getOpenWorkspaceUri(explicitUri);
		if (openWorkspaceUri) {
			return openWorkspaceUri;
		}

		await args.context.globalState.update(PENDING_RANGE_DIFF_KEY, sanitizeRangeDiffArgs(args.args));
		await vscode.commands.executeCommand('vscode.openFolder', explicitUri, {
			forceReuseWindow: true,
			noRecentEntry: true,
		});

		return 'redirected';
	}

	const activeEditorFolder = vscode.window.activeTextEditor
		? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
		: undefined;
	if (activeEditorFolder) {
		return activeEditorFolder.uri;
	}

	if (vscode.workspace.workspaceFolders?.length === 1) {
		return vscode.workspace.workspaceFolders[0].uri;
	}

	if (!vscode.workspace.workspaceFolders?.length) {
		return undefined;
	}

	const selected = await vscode.window.showWorkspaceFolderPick({
		placeHolder: 'Select the workspace to open the JJ Plus range diff in',
	});
	return selected?.uri;
}

async function resumePendingRangeDiff(args: {
	context: vscode.ExtensionContext;
	openRangeMultiDiff: (rangeDiffArgs?: RangeDiffArgs) => Promise<void>;
}): Promise<void> {
	const pendingArgs = args.context.globalState.get(PENDING_RANGE_DIFF_KEY) as RangeDiffArgs | undefined;
	if (!pendingArgs) {
		return;
	}

	const explicitUri = getExplicitWorkspaceUri(pendingArgs.workspacePath);
	if (!explicitUri) {
		await args.context.globalState.update(PENDING_RANGE_DIFF_KEY, undefined);
		return;
	}

	if (!getOpenWorkspaceUri(explicitUri)) {
		return;
	}

	await args.context.globalState.update(PENDING_RANGE_DIFF_KEY, undefined);
	await args.openRangeMultiDiff(pendingArgs);
}

function getExplicitWorkspaceUri(workspacePath: string | undefined): vscode.Uri | undefined {
	const trimmed = workspacePath?.trim();
	return trimmed ? vscode.Uri.file(trimmed) : undefined;
}

function getOpenWorkspaceUri(explicitUri: vscode.Uri): vscode.Uri | undefined {
	const matchingFolder = vscode.workspace.workspaceFolders?.find((folder) =>
		areSamePath({ left: folder.uri.fsPath, right: explicitUri.fsPath }),
	);
	return matchingFolder?.uri;
}

function getFromValue(args?: RangeDiffArgs): string {
	return args?.from?.trim() || args?.base?.trim() || DEFAULT_FROM_REVSET;
}

function getToValue(args?: RangeDiffArgs): string {
	return args?.to?.trim() || args?.target?.trim() || DEFAULT_TO_REVSET;
}

function shouldPromptForInputs(args?: RangeDiffArgs): boolean {
	return args?.source !== CLI_SOURCE || args?.confirm === true;
}

async function resolveInput(args: {
	value?: string;
	prompt: string;
	placeHolder: string;
}): Promise<string | undefined> {
	const input = await vscode.window.showInputBox({
		prompt: args.prompt,
		placeHolder: args.placeHolder,
		value: args.value?.trim() || args.placeHolder,
		ignoreFocusOut: true,
		validateInput(value) {
			return value.trim() ? undefined : 'Value is required';
		},
	});

	return input?.trim() || undefined;
}
