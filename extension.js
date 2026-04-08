// @ts-check

const vscode = require('vscode');

const HELPER_COMMAND = 'visualjj.openRangeMultiDiff';
const VISUALJJ_COMMAND = 'visualjj.open-multi-diff';

/**
 * @typedef {object} RangeDiffArgs
 * @property {string=} base
 * @property {string=} target
 * @property {string=} title
 * @property {string=} workspacePath
 */

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      HELPER_COMMAND,
      /** @param {RangeDiffArgs=} args */
      async (args) => {
        const folder = await resolveWorkspaceFolder(args);
        if (!folder) {
          void vscode.window.showErrorMessage('No workspace folder available');
          return;
        }

        const base = await resolveInput({
          value: args?.base,
          prompt: 'Base change id or revset',
          placeHolder: 'yvspkqrx',
        });
        if (!base) {
          return;
        }

        const target = await resolveInput({
          value: args?.target,
          prompt: 'Target change id or revset',
          placeHolder: 'mvvosnsv',
        });
        if (!target) {
          return;
        }

        const title = args?.title?.trim() || `${base}..${target}`;

        try {
          await vscode.commands.executeCommand(
            VISUALJJ_COMMAND,
            folder.uri,
            target,
            base,
            title
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(
            `Failed to open VisualJJ range diff: ${message}`
          );
        }
      }
    )
  );
}

function deactivate() {}

/**
 * @param {{ value?: string, prompt: string, placeHolder: string }} options
 * @returns {Promise<string | undefined>}
 */
async function resolveInput(options) {
  const trimmed = options.value?.trim();
  if (trimmed) {
    return trimmed;
  }

  const input = await vscode.window.showInputBox({
    prompt: options.prompt,
    placeHolder: options.placeHolder,
    ignoreFocusOut: true,
    validateInput(value) {
      return value.trim() ? undefined : 'Value is required';
    },
  });

  return input?.trim() || undefined;
}

/**
 * @param {RangeDiffArgs | undefined} args
 * @returns {Promise<vscode.WorkspaceFolder | undefined>}
 */
async function resolveWorkspaceFolder(args) {
  const explicitFolder = args?.workspacePath
    ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(args.workspacePath))
    : undefined;
  if (explicitFolder) {
    return explicitFolder;
  }

  const activeEditorFolder = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined;
  if (activeEditorFolder) {
    return activeEditorFolder;
  }

  if (vscode.workspace.workspaceFolders?.length === 1) {
    return vscode.workspace.workspaceFolders[0];
  }

  if (!vscode.workspace.workspaceFolders?.length) {
    return undefined;
  }

  const selected = await vscode.window.showWorkspaceFolderPick({
    placeHolder: 'Select the workspace to open the VisualJJ range diff in',
  });
  return selected || undefined;
}

module.exports = {
  activate,
  deactivate,
};