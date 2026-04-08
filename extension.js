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
const DEFAULT_FROM_REVSET = 'branch_start(@)';
const DEFAULT_TO_REVSET = '@';

/** @type {vscode.OutputChannel | undefined} */
let outputChannel;

/**
 * @typedef {object} RangeDiffArgs
 * @property {string=} from
 * @property {string=} to
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
  outputChannel = vscode.window.createOutputChannel('VisualJJ Range Diff Helper');
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
        value: getFromValue(args),
        prompt: 'From change id or revset',
        placeHolder: DEFAULT_FROM_REVSET,
      });
      if (!base) {
        return;
      }

      const target = await resolveInput({
        value: getToValue(args),
        prompt: 'To change id or revset',
        placeHolder: DEFAULT_TO_REVSET,
      });
      if (!target) {
        return;
      }

      const title = args?.title?.trim() || `${base}..${target}`;

      try {
        const { resources, resolvedTitle } = await buildMultiDiffResources(
          workspaceUri.fsPath,
          base,
          target,
          title
        );
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
 * @param {string} title
 * @returns {Promise<{ resources: Array<{ originalUri: vscode.Uri, modifiedUri: vscode.Uri }>, resolvedTitle: string }>}
 */
async function buildMultiDiffResources(workspacePath, base, target, title) {
  let changedFiles = await listChangedFiles(workspacePath, base, target);
  let originalRevset = base;
  let modifiedRevset = target;
  let resolvedTitle = title;

  if (!changedFiles.length && target === '@' && base !== target) {
    // JJ range semantics can be empty even when the selected revision has its own patch.
    const revisionFiles = await listRevisionFiles(workspacePath, base);
    if (revisionFiles.length) {
      changedFiles = revisionFiles;
      originalRevset = `${base}-`;
      modifiedRevset = base;
      if (title === `${base}..${target}`) {
        resolvedTitle = base;
      }
    }
  }

  const resources = await Promise.all(
    changedFiles.map(async (relativePath) => ({
      originalUri: createSnapshotUri(workspacePath, originalRevset, relativePath),
      modifiedUri: await createTargetUri(workspacePath, modifiedRevset, relativePath),
    }))
  );

  return {
    resources,
    resolvedTitle,
  };
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
 * @param {string} revset
 * @returns {Promise<string[]>}
 */
async function listRevisionFiles(workspacePath, revset) {
  const { stdout } = await runJj(workspacePath, ['diff', '--name-only', '-r', revset]);

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
  logJjCommand(workspacePath, args);

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

  const input = await vscode.window.showInputBox({
    prompt: options.prompt,
    placeHolder: options.placeHolder,
    value: trimmed || options.placeHolder,
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
    from: args.from,
    to: args.to,
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
    from: getQueryParam(params, 'from') || getQueryParam(params, 'base'),
    to: getQueryParam(params, 'to') || getQueryParam(params, 'target'),
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

/**
 * @param {RangeDiffArgs | undefined} args
 * @returns {string | undefined}
 */
function getFromValue(args) {
  return args?.from?.trim() || args?.base?.trim() || DEFAULT_FROM_REVSET;
}

/**
 * @param {RangeDiffArgs | undefined} args
 * @returns {string | undefined}
 */
function getToValue(args) {
  return args?.to?.trim() || args?.target?.trim() || DEFAULT_TO_REVSET;
}

/**
 * @param {string} workspacePath
 * @param {string[]} args
 */
function logJjCommand(workspacePath, args) {
  if (!outputChannel) {
    return;
  }

  outputChannel.appendLine(`[${new Date().toISOString()}] cwd=${workspacePath}`);
  outputChannel.appendLine(`jj ${args.map(quoteShellArg).join(' ')}`);
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteShellArg(value) {
  if (/^[a-zA-Z0-9_@./:-]+$/u.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

module.exports = {
  activate,
  deactivate,
};
