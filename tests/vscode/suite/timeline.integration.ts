import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { basename, join } from 'node:path';
import { Uri, commands, window, workspace } from 'vscode';
import { parseSnapshotUri } from '../../../src/extension/uri-utils.ts';

type TimelineDebugState = {
	panelOpen?: boolean;
	panelCount?: number;
	viewReady?: boolean;
	backend?: 'git' | 'jj';
	relativePath?: string;
	fileName?: string;
	panelTitle?: string;
	usesBundledWebview?: boolean;
	entryCount?: number;
};

const DEBUG_COMMAND = 'jj-range-diff._debug.getTimelineState';
const OPEN_FILE_DIFF_COMMAND = 'jj-range-diff.openFileRangeDiff';
const OPEN_TIMELINE_COMMAND = 'jj-range-diff.openFileRevisionTimeline';
const TARGET_RELATIVE_PATH = 'apps/backend/instructions/lazy-di-rollout-plan.md';
const SECONDARY_RELATIVE_PATH = 'apps/backend/src/service.ts';

suite('Revision Timeline integration', () => {
	teardown(async () => {
		await commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('opens and initializes the timeline webview for the current workspace', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		const expectedBackend = basename(workspaceFolder.uri.fsPath) === 'jj-basic' ? 'jj' : 'git';
		const fileUri = Uri.file(join(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH));
		const document = await workspace.openTextDocument(fileUri);
		await window.showTextDocument(document, { preview: false });

		await commands.executeCommand(OPEN_TIMELINE_COMMAND);

		const state = await waitForTimelineReady();
		equal(state.panelOpen, true);
		equal(state.viewReady, true);
		equal(state.backend, expectedBackend);
		equal(state.relativePath, TARGET_RELATIVE_PATH);
		equal(state.fileName, 'lazy-di-rollout-plan.md');
		equal(state.usesBundledWebview, true);
		ok(state.entryCount && state.entryCount >= 2, `expected at least 2 timeline entries, got ${state.entryCount}`);
		match(state.panelTitle || '', /^Revision Timeline: lazy-di-rollout-plan\.md$/u);
	});

	test('opens a new timeline panel when opening a different workspace file', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		await openWorkspaceFile(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH);
		await commands.executeCommand(OPEN_TIMELINE_COMMAND);
		await waitForTimelineState(
			(state) => state?.viewReady === true && state.relativePath === TARGET_RELATIVE_PATH && state.panelCount === 1,
		);

		await openWorkspaceFile(workspaceFolder.uri.fsPath, SECONDARY_RELATIVE_PATH);
		await commands.executeCommand(OPEN_TIMELINE_COMMAND);

		const state = await waitForTimelineState(
			(candidate) =>
				candidate?.panelOpen === true &&
				candidate.relativePath === SECONDARY_RELATIVE_PATH &&
				candidate.panelCount === 2,
		);
		equal(state.relativePath, SECONDARY_RELATIVE_PATH);
		equal(state.fileName, 'service.ts');
		equal(state.panelCount, 2);
		match(state.panelTitle || '', /^Revision Timeline: service\.ts$/u);
	});

	test('prompts for a workspace file when the active editor is outside the workspace', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		await openWorkspaceFile(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH);
		const untitledDocument = await workspace.openTextDocument({ content: 'scratch', language: 'plaintext' });
		await window.showTextDocument(untitledDocument, { preview: false });

		const windowApi = window as typeof window & {
			showQuickPick: typeof window.showQuickPick;
		};
		const originalShowQuickPick = windowApi.showQuickPick;
		windowApi.showQuickPick = (async (items: Array<{ description?: string; path?: string }>) => {
			return items.find((item) => item.description === TARGET_RELATIVE_PATH) || items[0];
		}) as unknown as typeof window.showQuickPick;

		try {
			await commands.executeCommand(OPEN_TIMELINE_COMMAND);

			const state = await waitForTimelineState(
				(candidate) => candidate?.viewReady === true && candidate.relativePath === TARGET_RELATIVE_PATH,
			);
			equal(state.relativePath, TARGET_RELATIVE_PATH);
			equal(state.panelCount, 1);
		} finally {
			windowApi.showQuickPick = originalShowQuickPick;
		}
	});

	test('opens a single-file diff for the active editor after prompting for two revisions', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}
		const expectedBackend = basename(workspaceFolder.uri.fsPath) === 'jj-basic' ? 'jj' : 'git';

		await openWorkspaceFile(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH);

		const windowApi = window as typeof window & {
			showInputBox: typeof window.showInputBox;
		};
		const commandsApi = commands as typeof commands & {
			executeCommand: typeof commands.executeCommand;
		};
		const originalShowInputBox = windowApi.showInputBox;
		const originalExecuteCommand = commandsApi.executeCommand.bind(commandsApi);
		const prompts: string[] = [];
		const inputValues = expectedBackend === 'jj' ? ['@-', '@'] : ['HEAD~1', 'HEAD'];
		let diffCall:
			| {
					originalUri: Uri;
					modifiedUri: Uri;
					title: string;
			  }
			| undefined;

		windowApi.showInputBox = (async (options) => {
			prompts.push(options.prompt || '');
			return inputValues.shift();
		}) as unknown as typeof window.showInputBox;
		commandsApi.executeCommand = (async (command: string, ...args: unknown[]) => {
			if (command === 'vscode.diff') {
				diffCall = {
					originalUri: args[0] as Uri,
					modifiedUri: args[1] as Uri,
					title: args[2] as string,
				};
				return undefined;
			}

			return originalExecuteCommand(command, ...args);
		}) as unknown as typeof commands.executeCommand;

		try {
			await originalExecuteCommand(OPEN_FILE_DIFF_COMMAND);
		} finally {
			windowApi.showInputBox = originalShowInputBox;
			commandsApi.executeCommand = originalExecuteCommand as typeof commands.executeCommand;
		}

		deepEqual(prompts, ['From change id or revset', 'To change id or revset']);
		ok(diffCall, 'expected the command to invoke vscode.diff');
		equal(
			diffCall?.title,
			expectedBackend === 'jj' ? 'lazy-di-rollout-plan.md: @- -> @' : 'lazy-di-rollout-plan.md: HEAD~1 -> HEAD',
		);
		equal(diffCall?.originalUri.scheme, 'jj-range-diff');
		equal(diffCall?.modifiedUri.scheme, 'jj-range-diff');

		const originalSnapshot = diffCall ? parseSnapshotUri(diffCall.originalUri) : undefined;
		const modifiedSnapshot = diffCall ? parseSnapshotUri(diffCall.modifiedUri) : undefined;
		equal(originalSnapshot?.workspacePath, workspaceFolder.uri.fsPath);
		equal(originalSnapshot?.filePath, TARGET_RELATIVE_PATH);
		equal(originalSnapshot?.revset, expectedBackend === 'jj' ? '@-' : 'HEAD~1');
		ok(originalSnapshot?.contentId, 'expected the original uri to reference cached content');
		equal(modifiedSnapshot?.workspacePath, workspaceFolder.uri.fsPath);
		equal(modifiedSnapshot?.filePath, TARGET_RELATIVE_PATH);
		equal(modifiedSnapshot?.revset, expectedBackend === 'jj' ? '@' : 'HEAD');
		ok(modifiedSnapshot?.contentId, 'expected the modified uri to reference cached content');

		const originalDocument = await workspace.openTextDocument(diffCall!.originalUri);
		const modifiedDocument = await workspace.openTextDocument(diffCall!.modifiedUri);
		ok(originalDocument.getText().length > 0, 'expected the original cached document to contain text');
		ok(modifiedDocument.getText().length > 0, 'expected the modified cached document to contain text');
	});
});

async function openWorkspaceFile(workspacePath: string, relativePath: string): Promise<void> {
	const fileUri = Uri.file(join(workspacePath, relativePath));
	const document = await workspace.openTextDocument(fileUri);
	await window.showTextDocument(document, { preview: false });
}

async function waitForTimelineReady(): Promise<TimelineDebugState> {
	return waitForTimelineState((state) => state?.viewReady === true);
}

async function waitForTimelineState(
	predicate: (state: TimelineDebugState | undefined) => boolean,
): Promise<TimelineDebugState> {
	const deadline = Date.now() + 15000;
	let lastState: TimelineDebugState | undefined;

	while (Date.now() < deadline) {
		lastState = (await commands.executeCommand(DEBUG_COMMAND)) as TimelineDebugState | undefined;
		if (predicate(lastState)) {
			return lastState as TimelineDebugState;
		}

		await delay(200);
	}

	throw new Error(`timeline webview did not initialize in time; last state: ${JSON.stringify(lastState)}`);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
