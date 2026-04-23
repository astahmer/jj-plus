import { equal, match, ok } from 'node:assert/strict';
import { basename, join } from 'node:path';
import { Uri, commands, window, workspace } from 'vscode';

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
