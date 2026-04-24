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
	HELPER_COMMAND,
	OPEN_FILE_RANGE_DIFF_COMMAND,
	OPEN_FILE_TIMELINE_COMMAND,
	OPEN_MULTI_DIFF_COMMAND,
	PENDING_RANGE_DIFF_KEY,
	SNAPSHOT_SCHEME,
	TIMELINE_PREFERENCES_KEY,
} from './constants.ts';
import { resolveHistoryAdapter, resolveHistoryWorkspacePath } from './history-adapters.ts';
import { createTimelinePanelController } from './timeline-panel.ts';
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
	const outputChannel = vscode.window.createOutputChannel('JJ Range Diff');
	const runner = createCommandRunner({ outputChannel });
	const service = createTimelineService({ runner });
	const panelController = createTimelinePanelController({
		context,
		service,
		getPreferences: () => getTimelinePreferences(context),
		savePreferences: (nextPreferences) => saveTimelinePreferences(context, nextPreferences),
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
			void vscode.window.showErrorMessage(`Failed to open JJ range diff: ${message}`);
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
			const historyWorkspacePath = await resolveHistoryWorkspacePath({
				workspacePath: workspaceUri.fsPath,
				runner,
			});
			const relativePath = toHistoryRelativePath({
				historyWorkspacePath,
				absolutePath: fileTarget.absolutePath,
			});
			if (!relativePath) {
				throw new Error('The selected file is outside the resolved repository root');
			}

			const adapter = await resolveHistoryAdapter({
				workspacePath: historyWorkspacePath,
				runner,
			});
			const [originalContent, modifiedContent] = await Promise.all([
				adapter.showFileAtRevision({
					workspacePath: historyWorkspacePath,
					revset: base,
					filePath: relativePath,
				}),
				adapter.showFileAtRevision({
					workspacePath: historyWorkspacePath,
					revset: target,
					filePath: relativePath,
				}),
			]);

			const originalUri = provider.createInlineContentUri({
				workspacePath: historyWorkspacePath,
				revset: base,
				relativePath: relativePath,
				content: originalContent,
			});
			const modifiedUri = provider.createInlineContentUri({
				workspacePath: historyWorkspacePath,
				revset: target,
				relativePath: relativePath,
				content: modifiedContent,
			});

			await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title, { preview: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to open file diff: ${message}`);
		}
	};

	context.subscriptions.push(
		outputChannel,
		vscode.workspace.registerTextDocumentContentProvider('jj-range-diff', provider),
		vscode.commands.registerCommand(HELPER_COMMAND, openRangeMultiDiff),
		vscode.commands.registerCommand(OPEN_FILE_RANGE_DIFF_COMMAND, openFileRangeDiff),
		vscode.commands.registerCommand(OPEN_FILE_TIMELINE_COMMAND, (absolutePath?: string) =>
			panelController.openFileRevisionTimeline({ context, absolutePath }),
		),
		vscode.commands.registerCommand(GET_TIMELINE_DEBUG_STATE_COMMAND, () => panelController.getDebugState()),
		vscode.window.registerUriHandler({
			async handleUri(uri) {
				if (!isRangeDiffUriTarget({ uri, extensionId: EXTENSION_ID })) {
					return;
				}

				await openRangeMultiDiff(parseRangeDiffUri(uri));
			},
		}),
		{ dispose: () => panelController.dispose() },
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
		placeHolder: 'Select the workspace to open the JJ range diff in',
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
