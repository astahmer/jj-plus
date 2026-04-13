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
	OPEN_FILE_TIMELINE_COMMAND,
	OPEN_MULTI_DIFF_COMMAND,
	PENDING_RANGE_DIFF_KEY,
	TIMELINE_PREFERENCES_KEY,
} from './constants.ts';
import { resolveHistoryAdapter } from './history-adapters.ts';
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

	context.subscriptions.push(
		outputChannel,
		vscode.workspace.registerTextDocumentContentProvider('jj-range-diff', provider),
		vscode.commands.registerCommand(HELPER_COMMAND, openRangeMultiDiff),
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

	constructor(args: { runner: ReturnType<typeof createCommandRunner> }) {
		this.runner = args.runner;
	}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const query = parseSnapshotUri(uri);

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
