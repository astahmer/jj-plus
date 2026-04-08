// @ts-check

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const vscode = require('vscode');

const execFileAsync = promisify(execFile);

const EXTENSION_ID = 'astahmer.visualjj-range-diff-helper';
const HELPER_COMMAND = 'visualjj.openRangeMultiDiff';
const OPEN_RANGE_DIFF_URI_PATH = '/open-range-multi-diff';
const OPEN_MULTI_DIFF_COMMAND = '_workbench.openMultiDiffEditor';
const SNAPSHOT_SCHEME = 'visualjj-range-diff-helper';
const PENDING_RANGE_DIFF_KEY = 'pendingRangeDiffArgs';

/**
 * @typedef {object} RangeDiffArgs
 * @property {string=} base
 * @property {string=} target
 * @property {string=} title
 * @property {string=} workspacePath
 */

/**
 * @typedef {object} SnapshotQuery
 * @property {string} workspacePath
 * @property {string} filePath
 * @property {string} revset
 */

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const provider = new SnapshotContentProvider();

  const openRangeMultiDiff =
    /** @param {RangeDiffArgs=} args */
    async (args) => {
      const workspaceUri = await resolveWorkspaceUri(context, args);
      if (workspaceUri === 'redirected') {
        return;
      }

      if (!workspaceUri) {
        void vscode.window.showErrorMessage('No workspace folder available');
        return;
      }

      const base = await resolveInput({
        value: args?.base,
        prompt: 'Base change id or revset',
        placeHolder: 'branch_start(@)',
      });
      if (!base) {
        return;
      }

      const target = await resolveInput({
        value: args?.target,
        prompt: 'Target change id or revset',
        placeHolder: '@',
      });
      if (!target) {
        return;
      }

      const title = args?.title?.trim() || `${base}..${target}`;

      try {
        const resources = await buildMultiDiffResources(workspaceUri.fsPath, base, target);
        if (!resources.length) {
          void vscode.window.showInformationMessage(`No changes found for ${title}`);
          return;
        }

        await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
          title,
          resources,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to open JJ range diff: ${message}`);
      }
    };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SNAPSHOT_SCHEME, provider),
    vscode.commands.registerCommand(HELPER_COMMAND, openRangeMultiDiff),
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        if (uri.authority !== EXTENSION_ID || uri.path !== OPEN_RANGE_DIFF_URI_PATH) {
          return;
        }

        await openRangeMultiDiff(parseRangeDiffUri(uri));
      },
    })
  );

  void resumePendingRangeDiff(context, openRangeMultiDiff);
}

function deactivate() {}

class SnapshotContentProvider {
  /**
   * @param {vscode.Uri} uri
   * @returns {Promise<string>}
   */
  async provideTextDocumentContent(uri) {
    const query = parseSnapshotUri(uri);

    try {
      return await showFileAtRevision(query.workspacePath, query.revset, query.filePath);
    } catch {
      return '';
    }
  }
}

/**
 * @param {string} workspacePath
 * @param {string} base
 * @param {string} target
 * @returns {Promise<Array<{ originalUri: vscode.Uri, modifiedUri: vscode.Uri }>>}
 */
async function buildMultiDiffResources(workspacePath, base, target) {
  const changedFiles = await listChangedFiles(workspacePath, base, target);

  return Promise.all(
    changedFiles.map(async (relativePath) => ({
      originalUri: createSnapshotUri(workspacePath, base, relativePath),
      modifiedUri: await createTargetUri(workspacePath, target, relativePath),
    }))
  );
}

/**
 * @param {string} workspacePath
 * @param {string} base
 * @param {string} target
 * @returns {Promise<string[]>}
 */
async function listChangedFiles(workspacePath, base, target) {
  const { stdout } = await runJj(
    workspacePath,
    ['diff', '--name-only', '--from', base, '--to', target]
  );

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string} workspacePath
 * @param {string} target
 * @param {string} relativePath
 * @returns {Promise<vscode.Uri>}
 */
async function createTargetUri(workspacePath, target, relativePath) {
  if (target === '@') {
    const fileUri = vscode.Uri.file(path.join(workspacePath, relativePath));
    if (await fileExists(fileUri.fsPath)) {
      return fileUri;
    }
  }

  return createSnapshotUri(workspacePath, target, relativePath);
}

/**
 * @param {string} workspacePath
 * @param {string} revset
 * @param {string} relativePath
 * @returns {vscode.Uri}
 */
function createSnapshotUri(workspacePath, revset, relativePath) {
  return vscode.Uri.from({
    scheme: SNAPSHOT_SCHEME,
    path: `/${relativePath}`,
    query: JSON.stringify({
      workspacePath,
      filePath: relativePath,
      revset,
    }),
  });
}

/**
 * @param {string} workspacePath
 * @param {string} revset
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function showFileAtRevision(workspacePath, revset, filePath) {
  const { stdout } = await runJj(workspacePath, ['file', 'show', '-r', revset, filePath]);
  return stdout;
}

/**
 * @param {string} workspacePath
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runJj(workspacePath, args) {
  return execFileAsync('jj', args, {
    cwd: workspacePath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
 * @param {vscode.ExtensionContext} context
 * @param {RangeDiffArgs | undefined} args
 * @returns {Promise<vscode.Uri | 'redirected' | undefined>}
 */
async function resolveWorkspaceUri(context, args) {
  const explicitUri = getExplicitWorkspaceUri(args?.workspacePath);
  if (explicitUri) {
    const openWorkspaceUri = getOpenWorkspaceUri(explicitUri);
    if (openWorkspaceUri) {
      return openWorkspaceUri;
    }

    await context.globalState.update(PENDING_RANGE_DIFF_KEY, sanitizeRangeDiffArgs(args));
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

/**
 * @param {vscode.ExtensionContext} context
 * @param {(args?: RangeDiffArgs) => Promise<void>} openRangeMultiDiff
 */
async function resumePendingRangeDiff(context, openRangeMultiDiff) {
  const pendingArgs = context.globalState.get(PENDING_RANGE_DIFF_KEY);
  if (!pendingArgs || typeof pendingArgs !== 'object') {
    return;
  }

  const args = /** @type {RangeDiffArgs} */ (pendingArgs);
  const explicitUri = getExplicitWorkspaceUri(args.workspacePath);
  if (!explicitUri) {
    await context.globalState.update(PENDING_RANGE_DIFF_KEY, undefined);
    return;
  }

  if (!getOpenWorkspaceUri(explicitUri)) {
    return;
  }

  await context.globalState.update(PENDING_RANGE_DIFF_KEY, undefined);
  await openRangeMultiDiff(args);
}

/**
 * @param {vscode.Uri} explicitUri
 * @returns {vscode.Uri | undefined}
 */
function getOpenWorkspaceUri(explicitUri) {
  const matchingFolder = vscode.workspace.workspaceFolders?.find((folder) =>
    areSamePath(folder.uri.fsPath, explicitUri.fsPath)
  );

  return matchingFolder?.uri;
}

/**
 * @param {RangeDiffArgs | undefined} args
 * @returns {RangeDiffArgs | undefined}
 */
function sanitizeRangeDiffArgs(args) {
  if (!args) {
    return undefined;
  }

  return {
    base: args.base,
    target: args.target,
    title: args.title,
    workspacePath: args.workspacePath,
  };
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function areSamePath(left, right) {
  return normalizePath(left) === normalizePath(right);
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

/**
 * @param {string | undefined} workspacePath
 * @returns {vscode.Uri | undefined}
 */
function getExplicitWorkspaceUri(workspacePath) {
  const trimmed = workspacePath?.trim();
  if (!trimmed) {
    return undefined;
  }

  return vscode.Uri.file(trimmed);
}

/**
 * @param {vscode.Uri} uri
 * @returns {RangeDiffArgs}
 */
function parseRangeDiffUri(uri) {
  const params = new URLSearchParams(uri.query);

  return {
    base: getQueryParam(params, 'base'),
    target: getQueryParam(params, 'target'),
    title: getQueryParam(params, 'title'),
    workspacePath: getQueryParam(params, 'workspacePath'),
  };
}

/**
 * @param {vscode.Uri} uri
 * @returns {SnapshotQuery}
 */
function parseSnapshotUri(uri) {
  return /** @type {SnapshotQuery} */ (JSON.parse(uri.query));
}

/**
 * @param {URLSearchParams} params
 * @param {string} name
 * @returns {string | undefined}
 */
function getQueryParam(params, name) {
  const value = params.get(name)?.trim();
  return value || undefined;
}

module.exports = {
  activate,
  deactivate,
};
