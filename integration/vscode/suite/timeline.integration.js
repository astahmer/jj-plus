import { ok, equal, match, fail } from 'node:assert/strict';
import { basename, join } from 'node:path';
import { commands, workspace, Uri, window } from 'vscode';

const DEBUG_COMMAND = 'jj-range-diff._debug.getTimelineState';
const OPEN_TIMELINE_COMMAND = 'jj-range-diff.openFileRevisionTimeline';
const TARGET_RELATIVE_PATH = 'apps/backend/instructions/lazy-di-rollout-plan.md';
const SECONDARY_RELATIVE_PATH = 'apps/backend/src/service.ts';

/**
 * @typedef {object} TimelineDebugState
 * @property {boolean=} panelOpen
 * @property {boolean=} viewReady
 * @property {'git' | 'jj'=} backend
 * @property {string=} relativePath
 * @property {string=} fileName
 * @property {string=} panelTitle
 * @property {boolean=} usesBundledWebview
 * @property {number=} entryCount
 */

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
		ok(state.entryCount >= 2, `expected at least 2 timeline entries, got ${state.entryCount}`);
		match(state.panelTitle, /^Revision Timeline: lazy-di-rollout-plan\.md$/u);
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
		match(state.panelTitle, /^Revision Timeline: service\.ts$/u);
	});
});

async function openWorkspaceFile(workspacePath, relativePath) {
	const fileUri = Uri.file(join(workspacePath, relativePath));
	const document = await workspace.openTextDocument(fileUri);
	await window.showTextDocument(document, { preview: false });
}

async function waitForTimelineReady() {
	return waitForTimelineState((state) => state?.viewReady === true);
}

/**
 * @param {(state: TimelineDebugState | undefined) => boolean} predicate
 * @returns {Promise<TimelineDebugState>}
 */
async function waitForTimelineState(predicate) {
	const deadline = Date.now() + 15000;
	/** @type {TimelineDebugState | undefined} */
	let lastState;

	while (Date.now() < deadline) {
		lastState = /** @type {TimelineDebugState | undefined} */ (await commands.executeCommand(DEBUG_COMMAND));
		if (predicate(lastState)) {
			return lastState;
		}

		await delay(200);
	}

	fail(`timeline webview did not initialize in time; last state: ${JSON.stringify(lastState)}`);
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
