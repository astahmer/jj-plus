import { equal, fail, match, ok } from 'node:assert/strict';
import { basename, join } from 'node:path';
import { Uri, commands, window, workspace } from 'vscode';

type TimelineDebugState = {
	panelOpen?: boolean;
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
		ok(workspaceFolder, 'expected the integration test workspace to be open');

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

	test('reuses the existing timeline panel when opening a different workspace file', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		ok(workspaceFolder, 'expected the integration test workspace to be open');

		await openWorkspaceFile(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH);
		await commands.executeCommand(OPEN_TIMELINE_COMMAND);
		await waitForTimelineState((state) => state?.viewReady === true && state.relativePath === TARGET_RELATIVE_PATH);

		await openWorkspaceFile(workspaceFolder.uri.fsPath, SECONDARY_RELATIVE_PATH);
		await commands.executeCommand(OPEN_TIMELINE_COMMAND);

		const state = await waitForTimelineState(
			(candidate) => candidate?.panelOpen === true && candidate.relativePath === SECONDARY_RELATIVE_PATH,
		);
		equal(state.relativePath, SECONDARY_RELATIVE_PATH);
		equal(state.fileName, 'service.ts');
		match(state.panelTitle || '', /^Revision Timeline: service\.ts$/u);
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
			return lastState;
		}

		await delay(200);
	}

	fail(`timeline webview did not initialize in time; last state: ${JSON.stringify(lastState)}`);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
