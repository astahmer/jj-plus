// @ts-check

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const vscode = require('vscode');

const execFileAsync = promisify(execFile);

const EXTENSION_ID = 'astahmer.jj-range-diff';
const HELPER_COMMAND = 'jj-range-diff.openRangeMultiDiff';
const OPEN_FILE_TIMELINE_COMMAND = 'jj-range-diff.openFileRevisionTimeline';
const OPEN_RANGE_DIFF_URI_PATH = '/open-range-multi-diff';
const OPEN_MULTI_DIFF_COMMAND = '_workbench.openMultiDiffEditor';
const SNAPSHOT_SCHEME = 'jj-range-diff';
const PENDING_RANGE_DIFF_KEY = 'pendingRangeDiffArgs';
const CLI_SOURCE = 'cli';
const DEFAULT_FROM_REVSET = 'closest_bookmark(@)';
const DEFAULT_TO_REVSET = '@';
const MAX_TIMELINE_ENTRIES = 200;
const TIMELINE_PRESET_DAYS = {
  month: 30,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: Number.POSITIVE_INFINITY,
};

/** @type {vscode.OutputChannel | undefined} */
let outputChannel;

/** @type {vscode.WebviewPanel | undefined} */
let timelinePanel;

/** @type {TimelineSession | undefined} */
let currentTimelineSession;

/**
 * @typedef {object} RangeDiffArgs
 * @property {string=} from
 * @property {string=} to
 * @property {string=} base
 * @property {string=} target
 * @property {string=} title
 * @property {string=} workspacePath
 * @property {boolean=} confirm
 * @property {boolean=} verbose
 * @property {string=} source
 */

/**
 * @typedef {object} SnapshotQuery
 * @property {string} workspacePath
 * @property {string} filePath
 * @property {string} revset
 * @property {'jj' | 'git'=} backend
 */

/**
 * @typedef {'jj' | 'git'} HistoryBackend
 */

/**
 * @typedef {object} FileRevisionEntry
 * @property {string} id
 * @property {string} revision
 * @property {string} shortRevision
 * @property {string | undefined} changeId
 * @property {string} authorDate
 * @property {string} description
 * @property {boolean} isWorkingTree
 * @property {number} timestamp
 */

/**
 * @typedef {object} TimelineSession
 * @property {HistoryBackend} backend
 * @property {string} workspacePath
 * @property {string} relativePath
 * @property {string} absolutePath
 * @property {string} fileName
 * @property {FileRevisionEntry[]} entries
 */

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  outputChannel = vscode.window.createOutputChannel('JJ Range Diff');
  const provider = new SnapshotContentProvider();

  const openRangeMultiDiff =
    /** @param {RangeDiffArgs=} args */
    async (args) => {
      if (args?.verbose) {
        outputChannel?.show(true);
      }

      const workspaceUri = await resolveWorkspaceUri(context, args);
      if (workspaceUri === 'redirected') {
        return;
      }

      if (!workspaceUri) {
        void vscode.window.showErrorMessage('No workspace folder available');
        return;
      }

      const base = shouldPromptForInputs(args)
        ? await resolveInput({
            value: getFromValue(args),
            prompt: 'From change id or revset',
            placeHolder: DEFAULT_FROM_REVSET,
          })
        : getFromValue(args);
      if (!base) {
        return;
      }

      const target = shouldPromptForInputs(args)
        ? await resolveInput({
            value: getToValue(args),
            prompt: 'To change id or revset',
            placeHolder: DEFAULT_TO_REVSET,
          })
        : getToValue(args);
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
    vscode.commands.registerCommand(OPEN_FILE_TIMELINE_COMMAND, () =>
      openFileRevisionTimeline(context)
    ),
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
      return await showFileAtRevision(
        query.workspacePath,
        query.revset,
        query.filePath,
        query.backend || 'jj'
      );
    } catch {
      return '';
    }
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function openFileRevisionTimeline(context) {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor || activeEditor.document.isUntitled) {
    void vscode.window.showErrorMessage('Open a file in the editor to browse its revision timeline');
    return;
  }

  const documentUri = activeEditor.document.uri;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage('The active file must belong to a workspace folder');
    return;
  }

  if (documentUri.scheme !== 'file') {
    void vscode.window.showErrorMessage('The revision timeline only supports files on disk');
    return;
  }

  const session = await buildTimelineSession(workspaceFolder.uri.fsPath, documentUri.fsPath);
  if (!session.entries.length) {
    void vscode.window.showInformationMessage('No file revisions were found for the active file');
    return;
  }

  const panel = getOrCreateTimelinePanel(context, session.fileName);
  currentTimelineSession = session;
  panel.webview.html = getTimelineWebviewHtml(panel.webview);
  panel.title = `Revision Timeline: ${session.fileName}`;

  void panel.webview.postMessage({
    type: 'timeline-data',
    payload: buildTimelinePayload(session),
  });
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {string} fileName
 * @returns {vscode.WebviewPanel}
 */
function getOrCreateTimelinePanel(context, fileName) {
  if (timelinePanel) {
    timelinePanel.reveal(vscode.ViewColumn.Beside, true);
    return timelinePanel;
  }

  timelinePanel = vscode.window.createWebviewPanel(
    'jjRangeDiffTimeline',
    `Revision Timeline: ${fileName}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
    }
  );

  timelinePanel.onDidDispose(
    () => {
      timelinePanel = undefined;
      currentTimelineSession = undefined;
    },
    undefined,
    context.subscriptions
  );

  timelinePanel.webview.onDidReceiveMessage(
    async (message) => {
      if (!currentTimelineSession || !timelinePanel) {
        return;
      }

      try {
        await handleTimelineMessage(timelinePanel, currentTimelineSession, message);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Timeline action failed: ${text}`);
      }
    },
    undefined,
    context.subscriptions
  );

  return timelinePanel;
}

/**
 * @param {TimelineSession} session
 * @returns {{ backend: HistoryBackend, workspacePath: string, relativePath: string, fileName: string, presets: typeof TIMELINE_PRESET_DAYS, entries: Array<Record<string, unknown>> }}
 */
function buildTimelinePayload(session) {
  return {
    backend: session.backend,
    workspacePath: session.workspacePath,
    relativePath: session.relativePath,
    fileName: session.fileName,
    presets: TIMELINE_PRESET_DAYS,
    entries: session.entries.map((entry, index) => ({
      ...entry,
      index,
      monthLabel: new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(entry.authorDate)),
      shortDate: new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
      }).format(new Date(entry.authorDate)),
      relativeDate: formatRelativeTime(entry.timestamp),
    })),
  };
}

/**
 * @param {vscode.WebviewPanel} panel
 * @param {TimelineSession} session
 * @param {unknown} message
 */
async function handleTimelineMessage(panel, session, message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const command = Reflect.get(message, 'command');
  if (command === 'ready') {
    await panel.webview.postMessage({
      type: 'timeline-data',
      payload: buildTimelinePayload(session),
    });
    return;
  }

  if (command === 'open-selection') {
    const nextIndex = Number(Reflect.get(message, 'index'));
    if (!Number.isInteger(nextIndex)) {
      return;
    }

    await openTimelineSelection(session, nextIndex);
    return;
  }

  if (command === 'refresh') {
    const nextSession = await buildTimelineSession(session.workspacePath, session.absolutePath);
    session.backend = nextSession.backend;
    session.entries = nextSession.entries;
    session.fileName = nextSession.fileName;
    session.relativePath = nextSession.relativePath;
    await panel.webview.postMessage({
      type: 'timeline-data',
      payload: buildTimelinePayload(session),
    });
  }
}

/**
 * @param {TimelineSession} session
 * @param {number} index
 */
async function openTimelineSelection(session, index) {
  const entry = session.entries[index];
  if (!entry) {
    return;
  }

  if (index === 0) {
    const uri = await createRevisionUri(session, entry);
    await vscode.commands.executeCommand('vscode.open', uri, {
      preview: true,
    });
    return;
  }

  const previousEntry = session.entries[index - 1];
  const originalUri = await createRevisionUri(session, previousEntry);
  const modifiedUri = await createRevisionUri(session, entry);
  const title = `${session.fileName}: ${previousEntry.shortRevision} -> ${entry.shortRevision}`;
  await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title, {
    preview: true,
  });
}

/**
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} entry
 * @returns {Promise<vscode.Uri>}
 */
async function createRevisionUri(session, entry) {
  if (entry.isWorkingTree) {
    const fileUri = vscode.Uri.file(session.absolutePath);
    if (await fileExists(fileUri.fsPath)) {
      return fileUri;
    }
  }

  return createSnapshotUri(session.workspacePath, entry.revision, session.relativePath, session.backend);
}

/**
 * @param {string} workspacePath
 * @param {string} absolutePath
 * @returns {Promise<TimelineSession>}
 */
async function buildTimelineSession(workspacePath, absolutePath) {
  const relativePath = path.relative(workspacePath, absolutePath).replace(/\\/g, '/');
  const backend = await resolveHistoryBackend(workspacePath);
  const entries = backend === 'jj'
    ? await getJjFileRevisionHistory(workspacePath, relativePath)
    : await getGitFileRevisionHistory(workspacePath, relativePath);

  return {
    backend,
    workspacePath,
    absolutePath,
    relativePath,
    fileName: path.basename(absolutePath),
    entries: await appendWorkingTreeEntry(absolutePath, entries),
  };
}

/**
 * @param {string} workspacePath
 * @returns {Promise<HistoryBackend>}
 */
async function resolveHistoryBackend(workspacePath) {
  try {
    await runJj(workspacePath, ['root']);
    return 'jj';
  } catch {
    return 'git';
  }
}

/**
 * @param {string} workspacePath
 * @param {string} relativePath
 * @returns {Promise<FileRevisionEntry[]>}
 */
async function getJjFileRevisionHistory(workspacePath, relativePath) {
  const template = [
    'commit_id.short()',
    '"\\t"',
    'change_id.shortest()',
    '"\\t"',
    'author.timestamp().format("%Y-%m-%dT%H:%M:%S%:z")',
    '"\\t"',
    'description.first_line()',
    '"\\n"',
  ].join(' ++ ');
  const { stdout } = await runJj(workspacePath, [
    'log',
    '--no-graph',
    '--limit',
    String(MAX_TIMELINE_ENTRIES),
    '-T',
    template,
    relativePath,
  ]);

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJjHistoryLine)
    .reverse();
}

/**
 * @param {string} line
 * @returns {FileRevisionEntry}
 */
function parseJjHistoryLine(line) {
  const [revision = '', changeId = '', authorDate = '', ...descriptionParts] = line.split('\t');
  const description = descriptionParts.join('\t') || 'No description';
  return {
    id: revision,
    revision,
    shortRevision: changeId || revision.slice(0, 8),
    changeId: changeId || undefined,
    authorDate,
    description,
    isWorkingTree: false,
    timestamp: Date.parse(authorDate) || 0,
  };
}

/**
 * @param {string} workspacePath
 * @param {string} relativePath
 * @returns {Promise<FileRevisionEntry[]>}
 */
async function getGitFileRevisionHistory(workspacePath, relativePath) {
  const { stdout } = await runGit(workspacePath, [
    'log',
    '--follow',
    '--date=iso-strict',
    `--format=%H%x09%ad%x09%s`,
    `--max-count=${MAX_TIMELINE_ENTRIES}`,
    '--',
    relativePath,
  ]);

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [revision = '', authorDate = '', ...descriptionParts] = line.split('\t');
      const description = descriptionParts.join('\t') || 'No description';
      return {
        id: revision,
        revision,
        shortRevision: revision.slice(0, 8),
        changeId: undefined,
        authorDate,
        description,
        isWorkingTree: false,
        timestamp: Date.parse(authorDate) || 0,
      };
    })
    .reverse();
}

/**
 * @param {string} absolutePath
 * @param {FileRevisionEntry[]} entries
 * @returns {Promise<FileRevisionEntry[]>}
 */
async function appendWorkingTreeEntry(absolutePath, entries) {
  if (!(await fileExists(absolutePath))) {
    return entries;
  }

  const lastEntry = entries[entries.length - 1];
  const now = new Date();
  const workingTreeEntry = {
    id: 'working-tree',
    revision: 'WORKTREE',
    shortRevision: 'Current',
    changeId: undefined,
    authorDate: now.toISOString(),
    description: 'Working tree',
    isWorkingTree: true,
    timestamp: now.getTime(),
  };

  if (lastEntry?.isWorkingTree) {
    return entries;
  }

  return [...entries, workingTreeEntry];
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
 * @param {HistoryBackend=} backend
 * @returns {vscode.Uri}
 */
function createSnapshotUri(workspacePath, revset, relativePath, backend = 'jj') {
  return vscode.Uri.from({
    scheme: SNAPSHOT_SCHEME,
    path: `/${relativePath}`,
    query: JSON.stringify({
      workspacePath,
      filePath: relativePath,
      revset,
      backend,
    }),
  });
}

/**
 * @param {string} workspacePath
 * @param {string} revset
 * @param {string} filePath
 * @param {HistoryBackend=} backend
 * @returns {Promise<string>}
 */
async function showFileAtRevision(workspacePath, revset, filePath, backend = 'jj') {
  if (backend === 'git') {
    const { stdout } = await runGit(workspacePath, ['show', `${revset}:${filePath}`]);
    return stdout;
  }

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
 * @param {string} workspacePath
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runGit(workspacePath, args) {
  logGitCommand(workspacePath, args);

  return execFileAsync('git', args, {
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
    confirm: args.confirm,
    verbose: args.verbose,
    source: args.source,
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
    confirm: getBooleanQueryParam(params, 'confirm'),
    verbose: getBooleanQueryParam(params, 'verbose'),
    source: getQueryParam(params, 'source'),
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
 * @param {URLSearchParams} params
 * @param {string} name
 * @returns {boolean | undefined}
 */
function getBooleanQueryParam(params, name) {
  const value = params.get(name)?.trim().toLowerCase();
  if (!value) {
    return undefined;
  }

  if (value === '1' || value === 'true' || value === 'yes') {
    return true;
  }

  if (value === '0' || value === 'false' || value === 'no') {
    return false;
  }

  return undefined;
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
function logGitCommand(workspacePath, args) {
  if (!outputChannel) {
    return;
  }

  outputChannel.appendLine(`[${new Date().toISOString()}] cwd=${workspacePath}`);
  outputChannel.appendLine(`git ${args.map(quoteShellArg).join(' ')}`);
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  /** @type {Array<[Intl.RelativeTimeFormatUnit, number]>} */
  const divisions = [
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];

  for (const [unit, amount] of divisions) {
    if (Math.abs(deltaSeconds) >= amount || unit === 'minute') {
      return formatter.format(Math.round(deltaSeconds / amount), unit);
    }
  }

  return formatter.format(deltaSeconds, 'second');
}

/**
 * @param {vscode.Webview} webview
 * @returns {string}
 */
function getTimelineWebviewHtml(webview) {
  const nonce = String(Date.now());
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Revision Timeline</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b0f19;
        --panel: rgba(19, 26, 40, 0.92);
        --panel-strong: rgba(28, 36, 54, 0.98);
        --line: rgba(136, 160, 201, 0.16);
        --text: #edf3ff;
        --muted: #90a3c4;
        --accent: #79d2a6;
        --accent-soft: rgba(121, 210, 166, 0.18);
        --chip: rgba(255, 255, 255, 0.06);
        --shadow: 0 28px 90px rgba(0, 0, 0, 0.34);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: ui-rounded, "SF Pro Rounded", "Avenir Next", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(96, 129, 255, 0.22), transparent 30%),
          radial-gradient(circle at top right, rgba(121, 210, 166, 0.18), transparent 28%),
          linear-gradient(180deg, #121826 0%, #0b0f19 100%);
        padding: 24px;
      }

      .shell {
        max-width: 1100px;
        margin: 0 auto;
        padding: 22px 22px 18px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 28px;
        background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
        box-shadow: var(--shadow);
        backdrop-filter: blur(20px);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        margin-bottom: 18px;
      }

      .title {
        display: grid;
        gap: 4px;
      }

      .title strong {
        font-size: 22px;
        letter-spacing: -0.03em;
      }

      .title span {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.16em;
      }

      .preset-row {
        display: inline-flex;
        gap: 6px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.06);
        padding: 5px;
        border-radius: 16px;
      }

      .preset {
        border: 0;
        color: var(--muted);
        background: transparent;
        border-radius: 12px;
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
      }

      .preset.active {
        background: rgba(255,255,255,0.08);
        color: var(--text);
      }

      .timeline-card {
        border: 1px solid rgba(255,255,255,0.06);
        background: var(--panel);
        border-radius: 22px;
        padding: 18px;
      }

      .meta-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
        margin-bottom: 18px;
      }

      .range-label {
        font-size: 18px;
        letter-spacing: -0.02em;
      }

      .range-subtitle {
        color: var(--muted);
        font-size: 13px;
      }

      .actions {
        display: flex;
        gap: 8px;
      }

      .ghost {
        border: 1px solid rgba(255,255,255,0.08);
        color: var(--text);
        background: rgba(255,255,255,0.04);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
      }

      .scrubber {
        position: relative;
        padding: 14px 0 8px;
      }

      .track {
        position: absolute;
        inset: 31px 16px auto;
        height: 14px;
        border-radius: 999px;
        background:
          linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
          repeating-linear-gradient(
            90deg,
            rgba(255,255,255,0.08) 0,
            rgba(255,255,255,0.08) 1px,
            transparent 1px,
            transparent 10px
          );
        border: 1px solid rgba(255,255,255,0.08);
      }

      input[type='range'] {
        appearance: none;
        width: 100%;
        margin: 0;
        background: transparent;
        position: relative;
        z-index: 2;
      }

      input[type='range']::-webkit-slider-runnable-track {
        height: 14px;
        background: transparent;
      }

      input[type='range']::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        margin-top: -3px;
        border-radius: 999px;
        background: linear-gradient(180deg, #ffffff, #b2ebd0);
        border: 2px solid #12382a;
        box-shadow: 0 6px 18px rgba(121, 210, 166, 0.35);
      }

      input[type='range']::-moz-range-track {
        height: 14px;
        background: transparent;
      }

      input[type='range']::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 999px;
        background: linear-gradient(180deg, #ffffff, #b2ebd0);
        border: 2px solid #12382a;
        box-shadow: 0 6px 18px rgba(121, 210, 166, 0.35);
      }

      .selection-pill {
        position: absolute;
        top: 20px;
        transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.94);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 999px;
        padding: 10px 16px;
        color: var(--text);
        font-size: 13px;
        white-space: nowrap;
        z-index: 1;
        box-shadow: 0 10px 28px rgba(0,0,0,0.3);
      }

      .month-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
        color: var(--muted);
        font-size: 13px;
      }

      .month-row strong {
        color: var(--text);
      }

      .detail-grid {
        display: grid;
        grid-template-columns: 1.4fr 0.9fr;
        gap: 16px;
        margin-top: 18px;
      }

      .detail-card,
      .history-card {
        background: var(--panel-strong);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 20px;
        padding: 18px;
      }

      .eyebrow {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 11px;
        margin-bottom: 8px;
      }

      .revision-line {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        padding: 7px 10px;
        font-size: 12px;
      }

      .headline {
        font-size: 20px;
        line-height: 1.2;
        margin: 0 0 12px;
      }

      .supporting {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }

      .history-list {
        display: grid;
        gap: 10px;
        max-height: 320px;
        overflow: auto;
      }

      .history-item {
        border: 1px solid rgba(255,255,255,0.06);
        background: rgba(255,255,255,0.02);
        border-radius: 16px;
        padding: 12px 14px;
        cursor: pointer;
      }

      .history-item.active {
        border-color: rgba(121, 210, 166, 0.4);
        background: rgba(121, 210, 166, 0.12);
      }

      .history-item-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 6px;
        font-size: 13px;
      }

      .history-item p {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .empty {
        text-align: center;
        color: var(--muted);
        padding: 28px;
      }

      @media (max-width: 860px) {
        body {
          padding: 14px;
        }

        .topbar,
        .meta-row,
        .detail-grid {
          grid-template-columns: 1fr;
          display: grid;
        }

        .preset-row,
        .actions {
          justify-content: start;
          flex-wrap: wrap;
        }

        .month-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="topbar">
        <div class="title">
          <span id="filePath">Revision timeline</span>
          <strong id="fileName">Loading…</strong>
        </div>
        <div class="preset-row" id="presets"></div>
      </div>

      <div class="timeline-card">
        <div class="meta-row">
          <div>
            <div class="range-label" id="rangeLabel">Loading revisions…</div>
            <div class="range-subtitle" id="rangeSubtitle"></div>
          </div>
          <div class="actions">
            <button class="ghost" id="openButton">Open diff</button>
            <button class="ghost" id="refreshButton">Refresh</button>
          </div>
        </div>

        <div class="scrubber">
          <div class="track"></div>
          <div class="selection-pill" id="selectionPill">Select a revision</div>
          <input id="slider" type="range" min="0" max="0" value="0" />
          <div class="month-row" id="monthRow"></div>
        </div>

        <div class="detail-grid">
          <section class="detail-card">
            <div class="eyebrow">Selected revision</div>
            <div class="revision-line">
              <span class="badge" id="backendBadge"></span>
              <span class="badge" id="revisionBadge"></span>
            </div>
            <h2 class="headline" id="headline"></h2>
            <div class="supporting" id="supporting"></div>
          </section>

          <aside class="history-card">
            <div class="eyebrow">Visible revisions</div>
            <div class="history-list" id="historyList"></div>
          </aside>
        </div>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = {
        data: null,
        preset: '90d',
        visibleEntries: [],
        selectedIndex: 0,
      };

      const elements = {
        fileName: document.getElementById('fileName'),
        filePath: document.getElementById('filePath'),
        rangeLabel: document.getElementById('rangeLabel'),
        rangeSubtitle: document.getElementById('rangeSubtitle'),
        selectionPill: document.getElementById('selectionPill'),
        slider: document.getElementById('slider'),
        monthRow: document.getElementById('monthRow'),
        headline: document.getElementById('headline'),
        supporting: document.getElementById('supporting'),
        historyList: document.getElementById('historyList'),
        presets: document.getElementById('presets'),
        openButton: document.getElementById('openButton'),
        refreshButton: document.getElementById('refreshButton'),
        backendBadge: document.getElementById('backendBadge'),
        revisionBadge: document.getElementById('revisionBadge'),
      };

      const presetLabels = {
        month: 'This month',
        '7d': 'Last 7D',
        '30d': '30D',
        '90d': '90D',
        all: 'All',
      };

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'timeline-data') {
          return;
        }

        state.data = message.payload;
        if (!state.data.entries.length) {
          renderEmpty();
          return;
        }

        renderPresets();
        elements.fileName.textContent = state.data.fileName;
        elements.filePath.textContent = state.data.relativePath;
        state.selectedIndex = state.data.entries.length - 1;
        applyPreset(state.preset, false);
      });

      elements.slider.addEventListener('input', () => {
        const nextVisibleIndex = Number(elements.slider.value);
        const nextEntry = state.visibleEntries[nextVisibleIndex];
        if (!nextEntry) {
          return;
        }

        state.selectedIndex = nextEntry.index;
        renderSelection();
      });

      elements.slider.addEventListener('change', () => {
        vscode.postMessage({ command: 'open-selection', index: state.selectedIndex });
      });

      elements.openButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'open-selection', index: state.selectedIndex });
      });

      elements.refreshButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'refresh' });
      });

      function renderPresets() {
        elements.presets.innerHTML = '';
        for (const [key, value] of Object.entries(state.data.presets)) {
          const button = document.createElement('button');
          button.className = 'preset' + (state.preset === key ? ' active' : '');
          button.textContent = presetLabels[key] || String(value);
          button.addEventListener('click', () => applyPreset(key, true));
          elements.presets.appendChild(button);
        }
      }

      function applyPreset(preset, resetSelection) {
        state.preset = preset;
        const allEntries = state.data.entries;
        const lastEntry = allEntries[allEntries.length - 1];
        const windowDays = state.data.presets[preset];
        const cutoff = Number.isFinite(windowDays)
          ? lastEntry.timestamp - windowDays * 24 * 60 * 60 * 1000
          : Number.NEGATIVE_INFINITY;

        const filtered = allEntries.filter((entry) => entry.timestamp >= cutoff);
        state.visibleEntries = filtered.length >= 2 ? filtered : allEntries;

        if (resetSelection || !state.visibleEntries.some((entry) => entry.index === state.selectedIndex)) {
          state.selectedIndex = state.visibleEntries[state.visibleEntries.length - 1].index;
        }

        renderPresets();
        renderSelection();
      }

      function renderSelection() {
        if (!state.visibleEntries.length) {
          renderEmpty();
          return;
        }

        const selectedVisibleIndex = Math.max(
          0,
          state.visibleEntries.findIndex((entry) => entry.index === state.selectedIndex)
        );
        const selected = state.visibleEntries[selectedVisibleIndex];
        const first = state.visibleEntries[0];
        const last = state.visibleEntries[state.visibleEntries.length - 1];
        const previous = state.data.entries[Math.max(0, selected.index - 1)];

        elements.slider.max = String(Math.max(0, state.visibleEntries.length - 1));
        elements.slider.value = String(selectedVisibleIndex);
        elements.selectionPill.style.left = String(
          state.visibleEntries.length === 1
            ? 0
            : (selectedVisibleIndex / Math.max(1, state.visibleEntries.length - 1)) * 100
        ) + '%';
        elements.selectionPill.textContent = selected.isWorkingTree
          ? 'Working tree'
          : selected.shortDate + ' · ' + selected.shortRevision;
        elements.rangeLabel.textContent = first.shortDate + ' - ' + (last.isWorkingTree ? 'Today' : last.shortDate);
        elements.rangeSubtitle.textContent = String(state.visibleEntries.length) + ' revisions in ' + state.data.backend.toUpperCase() + ' history';
        elements.backendBadge.textContent = state.data.backend.toUpperCase() + ' backend';
        elements.revisionBadge.textContent = selected.isWorkingTree
          ? 'Current working tree'
          : selected.shortRevision + (selected.changeId ? ' · ' + selected.revision : '');
        elements.headline.textContent = selected.description;
        elements.supporting.textContent = selected.isWorkingTree
          ? 'Comparing the current file on disk against the previous recorded revision.'
          : selected.relativeDate + ' · ' + new Date(selected.authorDate).toLocaleString() + (previous && previous.id !== selected.id ? ' · Diff target: ' + previous.shortRevision : '');

        renderMonths();
        renderHistoryList();
      }

      function renderMonths() {
        const labels = [];
        const seen = new Set();
        for (const entry of state.visibleEntries) {
          if (seen.has(entry.monthLabel)) {
            continue;
          }
          seen.add(entry.monthLabel);
          labels.push(entry.monthLabel);
        }

        const compact = labels.slice(-4);
        elements.monthRow.innerHTML = compact
          .map((label) => {
            const active = state.visibleEntries.some(
              (entry) => entry.index === state.selectedIndex && entry.monthLabel === label
            );
            return '<div>' + (active ? '<strong>' + label + '</strong>' : label) + '</div>';
          })
          .join('');
      }

      function renderHistoryList() {
        elements.historyList.innerHTML = '';
        for (const entry of state.visibleEntries.slice().reverse()) {
          const button = document.createElement('button');
          button.className = 'history-item' + (entry.index === state.selectedIndex ? ' active' : '');
          button.type = 'button';
          button.addEventListener('click', () => {
            state.selectedIndex = entry.index;
            renderSelection();
            vscode.postMessage({ command: 'open-selection', index: state.selectedIndex });
          });

          button.innerHTML = [
            '<div class="history-item-top">',
            '<strong>' + escapeHtml(entry.shortRevision) + '</strong>',
            '<span>' + escapeHtml(entry.shortDate) + '</span>',
            '</div>',
            '<p>' + escapeHtml(entry.description) + '</p>',
          ].join('');
          elements.historyList.appendChild(button);
        }
      }

      function renderEmpty() {
        elements.rangeLabel.textContent = 'No revisions found';
        elements.rangeSubtitle.textContent = '';
        elements.headline.textContent = 'No recorded history for this file';
        elements.supporting.textContent = '';
        elements.historyList.innerHTML = '<div class="empty">Make a change and commit it, then reopen the timeline.</div>';
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      vscode.postMessage({ command: 'ready' });
    </script>
  </body>
</html>`;
}

/**
 * @param {RangeDiffArgs | undefined} args
 * @returns {boolean}
 */
function shouldPromptForInputs(args) {
  return args?.source !== CLI_SOURCE || args?.confirm === true;
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
