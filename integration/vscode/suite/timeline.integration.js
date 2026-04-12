const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const DEBUG_COMMAND = 'jj-range-diff._debug.getTimelineState';
const OPEN_TIMELINE_COMMAND = 'jj-range-diff.openFileRevisionTimeline';
const TARGET_RELATIVE_PATH = 'apps/backend/instructions/lazy-di-rollout-plan.md';

suite('Revision Timeline integration', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('opens and initializes the timeline webview for the current workspace', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'expected the integration test workspace to be open');

    const expectedBackend = path.basename(workspaceFolder.uri.fsPath) === 'jj-basic' ? 'jj' : 'git';
    const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, TARGET_RELATIVE_PATH));
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });

    await vscode.commands.executeCommand(OPEN_TIMELINE_COMMAND);

    const state = await waitForTimelineReady();
    assert.equal(state.panelOpen, true);
    assert.equal(state.viewReady, true);
    assert.equal(state.backend, expectedBackend);
    assert.equal(state.relativePath, TARGET_RELATIVE_PATH);
    assert.equal(state.fileName, 'lazy-di-rollout-plan.md');
    assert.equal(state.usesBundledWebview, true);
    assert.ok(state.entryCount >= 2, `expected at least 2 timeline entries, got ${state.entryCount}`);
    assert.match(state.panelTitle, /^Revision Timeline: lazy-di-rollout-plan\.md$/u);
  });
});

async function waitForTimelineReady() {
  const deadline = Date.now() + 15000;
  let lastState;

  while (Date.now() < deadline) {
    lastState = await vscode.commands.executeCommand(DEBUG_COMMAND);
    if (lastState?.viewReady) {
      return lastState;
    }

    await delay(200);
  }

  assert.fail(`timeline webview did not initialize in time; last state: ${JSON.stringify(lastState)}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
