import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { basename, join } from 'node:path';
import { Position, Selection, Uri, commands, window, workspace } from 'vscode';
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
	lineHistory?: { startLine: number; endLine: number } | null;
	entries?: Array<{ index: number; description: string; shortRevision: string }>;
};

type DiffLayoutMetrics = {
	viewportH: number;
	portalH: number;
	hostH: number;
	hostScrollH: number;
	rowsH: number;
	timelineH: number;
	maxLineH: number;
	minLineH: number;
	lineCount: number;
	maxCodeScrollH: number;
	minCodeClientH: number;
	portalFillRatio: number;
	lineTopSpan: number;
	uniqueLineTops: number;
	isCrushed: boolean;
};

const DEBUG_COMMAND = 'jj-plus._debug.getTimelineState';
const LAYOUT_COMMAND = 'jj-plus._debug.getDiffLayoutMetrics';
const SELECT_COMMAND = 'jj-plus._debug.selectTimelineRange';
const SET_LAYOUT_COMMAND = 'jj-plus._debug.setLayoutMode';
const OPEN_FILE_DIFF_COMMAND = 'jj-plus.openFileRangeDiff';
const OPEN_TIMELINE_COMMAND = 'jj-plus.openFileRevisionTimeline';
const OPEN_LINE_TIMELINE_COMMAND = 'jj-plus.openFileLineTimeline';
const OPEN_TIMELINE_AT_LINE_COMMAND = 'jj-plus.openTimelineAtLine';
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

	test('opens line-filtered timeline from the editor selection', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		const fileUri = Uri.file(join(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH));
		const document = await workspace.openTextDocument(fileUri);
		const editor = await window.showTextDocument(document, { preview: false });
		editor.selection = new Selection(new Position(0, 0), new Position(2, 0));

		await commands.executeCommand(OPEN_TIMELINE_COMMAND);
		const fullState = await waitForTimelineReady();
		const fullCount = fullState.entryCount || 0;
		await commands.executeCommand('workbench.action.closeAllEditors');

		const again = await workspace.openTextDocument(fileUri);
		const againEditor = await window.showTextDocument(again, { preview: false });
		againEditor.selection = new Selection(new Position(0, 0), new Position(2, 0));
		await commands.executeCommand(OPEN_LINE_TIMELINE_COMMAND);

		const state = await waitForTimelineState(
			(candidate) =>
				candidate?.viewReady === true && candidate.lineHistory?.startLine === 1 && candidate.lineHistory?.endLine === 3,
		);
		deepEqual(state.lineHistory, { startLine: 1, endLine: 3 });
		match(state.panelTitle || '', /L1–3/u);
		ok((state.entryCount || 0) >= 1, `expected filtered entries, got ${JSON.stringify(state)}`);
		ok(
			(state.entryCount || 0) <= fullCount,
			`line history should not expand entries (${state.entryCount} vs full ${fullCount})`,
		);
	});

	test('openTimelineAtLine filters to the cursor line via blame path', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		const fileUri = Uri.file(join(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH));
		const document = await workspace.openTextDocument(fileUri);
		await window.showTextDocument(document, { preview: false });

		await commands.executeCommand(OPEN_TIMELINE_AT_LINE_COMMAND, {
			absolutePath: fileUri.fsPath,
			line: 1,
		});

		const state = await waitForTimelineState(
			(candidate) =>
				candidate?.viewReady === true && candidate.lineHistory?.startLine === 1 && candidate.lineHistory?.endLine === 1,
		);
		deepEqual(state.lineHistory, { startLine: 1, endLine: 1 });
		match(state.panelTitle || '', /L1/u);
		ok((state.entryCount || 0) >= 1, `expected timeline entries, got ${JSON.stringify(state)}`);
	});

	test('diff portal fills vertical space inside the real VS Code webview', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		await openWorkspaceFile(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH);
		await commands.executeCommand(OPEN_TIMELINE_COMMAND);
		await waitForTimelineReady();

		const layout = await waitForDiffLayout((metrics) => {
			return (
				metrics.portalH > 200 &&
				metrics.lineCount > 3 &&
				metrics.hostH >= metrics.portalH - 16 &&
				!metrics.isCrushed &&
				metrics.minLineH > 8 &&
				metrics.maxLineH < 40
			);
		});

		ok(layout.portalFillRatio > 0.25, `portal should own vertical space, got ${JSON.stringify(layout)}`);
		ok(layout.hostH >= layout.portalH - 16, `host must fill portal: ${JSON.stringify(layout)}`);
		ok(!layout.isCrushed, `pierre content crushed inside VS Code webview: ${JSON.stringify(layout)}`);
		ok(layout.minLineH > 8, `lines crushed: ${JSON.stringify(layout)}`);
		ok(
			Math.max(layout.maxCodeScrollH, layout.hostScrollH, layout.minCodeClientH, layout.lineCount * layout.minLineH) >
				40,
			`diff content missing: ${JSON.stringify(layout)}`,
		);
	});

	test('large main.ts rewrite is not crushed inside the real VS Code webview', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		const largePath = 'apps/web/src/main.ts';
		await openWorkspaceFile(workspaceFolder.uri.fsPath, largePath);
		await commands.executeCommand(OPEN_TIMELINE_COMMAND);
		const state = await waitForTimelineState(
			(candidate) => candidate?.viewReady === true && candidate.relativePath === largePath,
		);
		ok((state.entryCount || 0) >= 2, `expected main.ts history, got ${JSON.stringify(state)}`);

		const entries = state.entries || [];
		const toEntry = entries.find((entry) => /vector search/i.test(entry.description));
		const fromEntry =
			entries.find((entry) => /componentize/i.test(entry.description)) ||
			(toEntry ? entries.find((entry) => entry.index < toEntry.index) : undefined);
		ok(toEntry && fromEntry, `missing rewrite endpoints: ${JSON.stringify(entries)}`);

		await commands.executeCommand(SELECT_COMMAND, {
			fromIndex: fromEntry!.index,
			toIndex: toEntry!.index,
			comparisonSource: 'revision',
		});

		const layout = await waitForDiffLayout(
			(metrics) =>
				metrics.lineCount > 40 &&
				metrics.portalH > 200 &&
				!metrics.isCrushed &&
				metrics.uniqueLineTops > 10 &&
				metrics.hostScrollH > metrics.portalH + 40 &&
				metrics.minLineH > 8 &&
				metrics.minLineH < 40,
		);
		ok(layout.hostH >= layout.portalH - 16, `host must fill portal: ${JSON.stringify(layout)}`);
		ok(layout.minLineH > 8 && layout.minLineH < 40, `line height weird: ${JSON.stringify(layout)}`);
		ok(layout.lineTopSpan > layout.portalH * 0.8, `line tops clustered/crushed: ${JSON.stringify(layout)}`);
		ok(layout.hostScrollH > layout.portalH + 40, `wrap content not scrolling: ${JSON.stringify(layout)}`);
		ok(!layout.isCrushed, `pierre crushed on large rewrite: ${JSON.stringify(layout)}`);
	});

	test('large main.ts rewrite is not crushed in unified layout', async () => {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('expected the integration test workspace to be open');
		}

		const largePath = 'apps/web/src/main.ts';
		await openWorkspaceFile(workspaceFolder.uri.fsPath, largePath);
		await commands.executeCommand(OPEN_TIMELINE_COMMAND);
		const state = await waitForTimelineState(
			(candidate) => candidate?.viewReady === true && candidate.relativePath === largePath,
		);
		ok((state.entryCount || 0) >= 2, `expected main.ts history, got ${JSON.stringify(state)}`);

		const entries = state.entries || [];
		const toEntry = entries.find((entry) => /vector search/i.test(entry.description));
		const fromEntry =
			entries.find((entry) => /componentize/i.test(entry.description)) ||
			(toEntry ? entries.find((entry) => entry.index < toEntry.index) : undefined);
		ok(toEntry && fromEntry, `missing rewrite endpoints: ${JSON.stringify(entries)}`);

		await commands.executeCommand(SELECT_COMMAND, {
			fromIndex: fromEntry!.index,
			toIndex: toEntry!.index,
			comparisonSource: 'revision',
		});
		await commands.executeCommand(SET_LAYOUT_COMMAND, 'unified');

		const layout = await waitForDiffLayout(
			(metrics) =>
				metrics.lineCount > 40 &&
				metrics.portalH > 200 &&
				!metrics.isCrushed &&
				metrics.uniqueLineTops > 10 &&
				metrics.hostScrollH > metrics.portalH + 40 &&
				metrics.minLineH > 8 &&
				metrics.minLineH < 40,
		);
		ok(layout.hostScrollH > layout.portalH + 40, `unified wrap not scrolling: ${JSON.stringify(layout)}`);
		ok(layout.lineTopSpan > layout.portalH * 0.8, `unified line tops clustered: ${JSON.stringify(layout)}`);
		ok(!layout.isCrushed, `pierre crushed on unified large rewrite: ${JSON.stringify(layout)}`);
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
		equal(diffCall?.originalUri.scheme, 'jj-plus');
		equal(diffCall?.modifiedUri.scheme, 'jj-plus');

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

async function waitForDiffLayout(predicate: (metrics: DiffLayoutMetrics) => boolean): Promise<DiffLayoutMetrics> {
	const deadline = Date.now() + 20000;
	let lastError: unknown;
	let lastMetrics: DiffLayoutMetrics | undefined;

	while (Date.now() < deadline) {
		try {
			lastMetrics = (await commands.executeCommand(LAYOUT_COMMAND)) as DiffLayoutMetrics;
			if (predicate(lastMetrics)) {
				return lastMetrics;
			}
		} catch (error) {
			lastError = error;
		}
		await delay(250);
	}

	throw new Error(
		`diff layout metrics never became healthy; last=${JSON.stringify(lastMetrics)}; error=${String(lastError)}`,
	);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
