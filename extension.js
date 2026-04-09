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
const TIMELINE_PREFERENCES_KEY = 'timelinePanelPreferences';
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

/** @type {vscode.ExtensionContext | undefined} */
let extensionContext;

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
 * @property {string[]} workspaceFiles
 * @property {Map<string, string>} contentCache
 * @property {Map<string, DiffPreview>} previewCache
 */

/**
 * @typedef {object} TimelinePreferences
 * @property {number=} sidebarWidth
 * @property {boolean=} sidebarCollapsed
 * @property {'split' | 'unified'=} layoutMode
 * @property {'diffs' | 'full'=} contentMode
 * @property {string=} preset
 */

/**
 * @typedef {object} DiffRow
 * @property {'context' | 'add' | 'remove' | 'skip'} type
 * @property {number | null} leftNumber
 * @property {number | null} rightNumber
 * @property {string} text
 */

/**
 * @typedef {object} DiffPreview
 * @property {number} index
 * @property {string} title
 * @property {string} subtitle
 * @property {number} additions
 * @property {number} deletions
 * @property {number} hunkCount
 * @property {boolean} hasChanges
 * @property {number} fromIndex
 * @property {number} toIndex
 * @property {DiffRow[]} rows
 */

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  extensionContext = context;
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
    vscode.commands.registerCommand(OPEN_FILE_TIMELINE_COMMAND, () => openFileRevisionTimeline(context)),
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
/**
 * @param {vscode.ExtensionContext} context
 * @param {string=} absolutePath
 */
async function openFileRevisionTimeline(context, absolutePath) {
  const activeEditor = vscode.window.activeTextEditor;
  const initialPath = absolutePath || activeEditor?.document.uri.fsPath;
  if (!initialPath) {
    void vscode.window.showErrorMessage('Open a file in the editor to browse its revision timeline');
    return;
  }

  const documentUri = vscode.Uri.file(initialPath);
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
    payload: buildTimelinePayload(session, getTimelinePreferences(context)),
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
      localResourceRoots: extensionContext
        ? [vscode.Uri.joinPath(extensionContext.extensionUri, 'webview')]
        : undefined,
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
 * @param {TimelinePreferences} preferences
 * @returns {{ backend: HistoryBackend, workspacePath: string, relativePath: string, fileName: string, presets: typeof TIMELINE_PRESET_DAYS, defaultIndex: number, latestIndex: number, preferences: TimelinePreferences, workspaceFiles: string[], entries: Array<Record<string, unknown>> }}
 */
function buildTimelinePayload(session, preferences) {
  return {
    backend: session.backend,
    workspacePath: session.workspacePath,
    relativePath: session.relativePath,
    fileName: session.fileName,
    presets: TIMELINE_PRESET_DAYS,
    defaultIndex: Math.max(0, session.entries.length - 1),
    latestIndex: Math.max(0, session.entries.length - 1),
    preferences,
    workspaceFiles: session.workspaceFiles,
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
      payload: buildTimelinePayload(session, getTimelinePreferences(extensionContext)),
    });
    await sendTimelinePreview(panel, session, Math.max(0, session.entries.length - 2), Math.max(0, session.entries.length - 1));
    return;
  }

  if (command === 'select-entry') {
    const fromIndex = Number(Reflect.get(message, 'fromIndex'));
    const toIndex = Number(Reflect.get(message, 'toIndex'));
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return;
    }

    await sendTimelinePreview(panel, session, fromIndex, toIndex);
    return;
  }

  if (command === 'open-editor-diff') {
    const fromIndex = Number(Reflect.get(message, 'fromIndex'));
    const toIndex = Number(Reflect.get(message, 'toIndex'));
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return;
    }

    await openRangeDiffInEditor(session, fromIndex, toIndex);
    return;
  }

  if (command === 'open-current-file') {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(session.absolutePath), {
      preview: true,
    });
    return;
  }

  if (command === 'open-range-files-diff') {
    const fromIndex = Number(Reflect.get(message, 'fromIndex'));
    const toIndex = Number(Reflect.get(message, 'toIndex'));
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return;
    }

    await openRangeFilesDiff(session, fromIndex, toIndex);
    return;
  }

  if (command === 'switch-file') {
    const relativePath = String(Reflect.get(message, 'relativePath') || '').trim();
    if (!relativePath) {
      return;
    }

    if (!extensionContext) {
      return;
    }

    await openFileRevisionTimeline(extensionContext, path.join(session.workspacePath, relativePath));
    return;
  }

  if (command === 'persist-state') {
    if (!extensionContext) {
      return;
    }

    await saveTimelinePreferences(extensionContext, {
      sidebarWidth: Number(Reflect.get(message, 'sidebarWidth')),
      sidebarCollapsed: Boolean(Reflect.get(message, 'sidebarCollapsed')),
      layoutMode: getLayoutMode(Reflect.get(message, 'layoutMode')),
      contentMode: getContentMode(Reflect.get(message, 'contentMode')),
      preset: getPresetName(Reflect.get(message, 'preset')),
    });
    return;
  }

  if (command === 'refresh') {
    const nextSession = await buildTimelineSession(session.workspacePath, session.absolutePath);
    syncTimelineSession(session, nextSession);
    currentTimelineSession = session;
    await panel.webview.postMessage({
      type: 'timeline-data',
      payload: buildTimelinePayload(session, getTimelinePreferences(extensionContext)),
    });
    await sendTimelinePreview(panel, session, Math.max(0, session.entries.length - 2), Math.max(0, session.entries.length - 1));
  }
}

/**
 * @param {vscode.WebviewPanel} panel
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 */
async function sendTimelinePreview(panel, session, fromIndex, toIndex) {
  await panel.webview.postMessage({
    type: 'diff-preview',
    payload: await getDiffPreview(session, fromIndex, toIndex),
  });
}

/**
 * @param {unknown} value
 * @returns {'split' | 'unified'}
 */
function getLayoutMode(value) {
  return value === 'unified' ? 'unified' : 'split';
}

/**
 * @param {unknown} value
 * @returns {'diffs' | 'full'}
 */
function getContentMode(value) {
  return value === 'full' ? 'full' : 'diffs';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function getPresetName(value) {
  const preset = String(value || '').trim();
  return Object.hasOwn(TIMELINE_PRESET_DAYS, preset) ? preset : '90d';
}

/**
 * @param {TimelineSession} target
 * @param {TimelineSession} source
 */
function syncTimelineSession(target, source) {
  target.backend = source.backend;
  target.workspacePath = source.workspacePath;
  target.relativePath = source.relativePath;
  target.absolutePath = source.absolutePath;
  target.fileName = source.fileName;
  target.entries = source.entries;
  target.workspaceFiles = source.workspaceFiles;
  target.contentCache = source.contentCache;
  target.previewCache = source.previewCache;
}

/**
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 */
async function openRangeDiffInEditor(session, fromIndex, toIndex) {
  const comparison = getComparisonEntries(session, fromIndex, toIndex);
  if (!comparison) {
    return;
  }

  const { fromEntry, toEntry } = comparison;

  if (!fromEntry) {
    const uri = await createRevisionUri(session, toEntry);
    await vscode.commands.executeCommand('vscode.open', uri, {
      preview: true,
    });
    return;
  }

  const originalUri = await createRevisionUri(session, fromEntry);
  const modifiedUri = await createRevisionUri(session, toEntry);
  const title = `${session.fileName}: ${fromEntry.shortRevision} -> ${toEntry.shortRevision}`;
  await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title, {
    preview: true,
  });
}

/**
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {{ fromEntry: FileRevisionEntry, toEntry: FileRevisionEntry } | undefined}
 */
function getComparisonEntries(session, fromIndex, toIndex) {
  const normalizedFromIndex = Math.max(0, Math.min(fromIndex, toIndex));
  const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(fromIndex, toIndex));
  const fromEntry = session.entries[normalizedFromIndex];
  const toEntry = session.entries[normalizedToIndex];
  if (!fromEntry || !toEntry) {
    return undefined;
  }

  return {
    fromEntry,
    toEntry,
  };
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
  const workspaceFiles = await listWorkspaceFiles(workspacePath);
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
    workspaceFiles,
    contentCache: new Map(),
    previewCache: new Map(),
  };
}

/**
 * @param {string} workspacePath
 * @returns {Promise<string[]>}
 */
async function listWorkspaceFiles(workspacePath) {
  const matches = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspacePath, '**/*'),
    '**/{.git,.jj,node_modules,dist,build,out,coverage}/**',
    5000
  );

  return matches
    .filter((uri) => uri.scheme === 'file')
    .map((uri) => path.relative(workspacePath, uri.fsPath).replace(/\\/g, '/'))
    .sort((left, right) => left.localeCompare(right));
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
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {Promise<DiffPreview>}
 */
async function getDiffPreview(session, fromIndex, toIndex) {
  const normalizedFromIndex = Math.max(0, Math.min(fromIndex, toIndex));
  const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(fromIndex, toIndex));
  const cacheKey = `${normalizedFromIndex}:${normalizedToIndex}`;
  const cached = session.previewCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const comparison = getComparisonEntries(session, normalizedFromIndex, normalizedToIndex);
  if (!comparison) {
    return {
      index: normalizedToIndex,
      title: 'No revision selected',
      subtitle: '',
      additions: 0,
      deletions: 0,
      hunkCount: 0,
      hasChanges: false,
      fromIndex: normalizedFromIndex,
      toIndex: normalizedToIndex,
      rows: [],
    };
  }

  const { fromEntry, toEntry } = comparison;
  const beforeText = fromEntry ? await getRevisionContent(session, fromEntry) : '';
  const afterText = await getRevisionContent(session, toEntry);
  const preview = buildDiffPreview(
    normalizedToIndex,
    fromEntry,
    toEntry,
    beforeText,
    afterText,
    normalizedFromIndex,
    session.entries.findIndex((entry) => entry.id === toEntry.id)
  );
  session.previewCache.set(cacheKey, preview);
  return preview;
}

/**
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} entry
 * @returns {Promise<string>}
 */
async function getRevisionContent(session, entry) {
  const cacheKey = entry.id;
  const cached = session.contentCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let content = '';
  if (entry.isWorkingTree) {
    content = await fs.readFile(session.absolutePath, 'utf8');
  } else {
    content = await showFileAtRevision(
      session.workspacePath,
      entry.revision,
      session.relativePath,
      session.backend
    );
  }

  session.contentCache.set(cacheKey, content);
  return content;
}

/**
 * @param {number} index
 * @param {FileRevisionEntry | undefined} previousEntry
 * @param {FileRevisionEntry} currentEntry
 * @param {string} beforeText
 * @param {string} afterText
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {DiffPreview}
 */
function buildDiffPreview(index, previousEntry, currentEntry, beforeText, afterText, fromIndex, toIndex) {
  const beforeLines = splitIntoLines(beforeText);
  const afterLines = splitIntoLines(afterText);
  const operations = diffLineOperations(beforeLines, afterLines);
  const rows = materializeDiffRows(operations);
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'remove').length;
  const hunkCount = countDiffHunks(rows);
  const title = previousEntry
    ? `${previousEntry.shortRevision} -> ${currentEntry.shortRevision}`
    : `Initial revision -> ${currentEntry.shortRevision}`;
  const subtitle = currentEntry.isWorkingTree
    ? 'Working tree'
    : `${new Date(currentEntry.authorDate).toLocaleString()} · ${currentEntry.description}`;

  return {
    index,
    title,
    subtitle,
    additions,
    deletions,
    hunkCount,
    hasChanges: additions > 0 || deletions > 0,
    fromIndex,
    toIndex,
    rows,
  };
}

/**
 * @param {vscode.ExtensionContext | undefined} context
 * @returns {TimelinePreferences}
 */
function getTimelinePreferences(context) {
  const rawValue = context?.globalState.get(TIMELINE_PREFERENCES_KEY);
  if (!rawValue || typeof rawValue !== 'object') {
    return {
      sidebarWidth: 276,
      sidebarCollapsed: false,
      layoutMode: 'split',
      contentMode: 'diffs',
      preset: '90d',
    };
  }

  const value = /** @type {TimelinePreferences} */ (rawValue);
  return {
    sidebarWidth: typeof value.sidebarWidth === 'number' ? value.sidebarWidth : 276,
    sidebarCollapsed: value.sidebarCollapsed === true,
    layoutMode: getLayoutMode(value.layoutMode),
    contentMode: getContentMode(value.contentMode),
    preset: getPresetName(value.preset),
  };
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {TimelinePreferences} nextValue
 */
async function saveTimelinePreferences(context, nextValue) {
  const currentValue = getTimelinePreferences(context);
  await context.globalState.update(TIMELINE_PREFERENCES_KEY, {
    ...currentValue,
    ...nextValue,
  });
}

/**
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 */
async function openRangeFilesDiff(session, fromIndex, toIndex) {
  const comparison = getComparisonEntries(session, fromIndex, toIndex);
  if (!comparison) {
    return;
  }

  const { fromEntry, toEntry } = comparison;
  const title = `${fromEntry.shortRevision}..${toEntry.shortRevision}`;

  if (session.backend === 'jj') {
    const { resources, resolvedTitle } = await buildMultiDiffResources(
      session.workspacePath,
      fromEntry.revision,
      toEntry.isWorkingTree ? '@' : toEntry.revision,
      title
    );

    await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
      title: resolvedTitle,
      resources,
    });
    return;
  }

  const resources = await buildGitMultiDiffResources(session, fromEntry, toEntry);
  if (!resources.length) {
    void vscode.window.showInformationMessage(`No changes found for ${title}`);
    return;
  }

  await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
    title,
    resources,
  });
}

/**
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} fromEntry
 * @param {FileRevisionEntry} toEntry
 * @returns {Promise<Array<{ originalUri: vscode.Uri, modifiedUri: vscode.Uri }>>}
 */
async function buildGitMultiDiffResources(session, fromEntry, toEntry) {
  const changedFiles = await listGitChangedFiles(session.workspacePath, fromEntry, toEntry);
  return Promise.all(
    changedFiles.map(async (relativePath) => ({
      originalUri: createSnapshotUri(session.workspacePath, fromEntry.revision, relativePath, 'git'),
      modifiedUri: toEntry.isWorkingTree
        ? await createTargetUri(session.workspacePath, '@', relativePath, 'git')
        : createSnapshotUri(session.workspacePath, toEntry.revision, relativePath, 'git'),
    }))
  );
}

/**
 * @param {string} workspacePath
 * @param {FileRevisionEntry} fromEntry
 * @param {FileRevisionEntry} toEntry
 * @returns {Promise<string[]>}
 */
async function listGitChangedFiles(workspacePath, fromEntry, toEntry) {
  const args = toEntry.isWorkingTree
    ? ['diff', '--name-only', fromEntry.revision, '--']
    : ['diff', '--name-only', fromEntry.revision, toEntry.revision, '--'];
  const { stdout } = await runGit(workspacePath, args);
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {DiffRow[]} rows
 * @returns {number}
 */
function countDiffHunks(rows) {
  let hunks = 0;
  let inChange = false;

  for (const row of rows) {
    const isChange = row.type === 'add' || row.type === 'remove';
    if (isChange && !inChange) {
      hunks += 1;
      inChange = true;
      continue;
    }

    if (!isChange) {
      inChange = false;
    }
  }

  return hunks;
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitIntoLines(value) {
  if (!value) {
    return [];
  }

  const normalized = value.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * @param {string[]} beforeLines
 * @param {string[]} afterLines
 * @returns {Array<{ type: 'context' | 'add' | 'remove', text: string }>}
 */
function diffLineOperations(beforeLines, afterLines) {
  if (!beforeLines.length) {
    return afterLines.map((text) => ({ type: 'add', text }));
  }

  if (!afterLines.length) {
    return beforeLines.map((text) => ({ type: 'remove', text }));
  }

  if (beforeLines.length * afterLines.length > 1200000) {
    return buildFallbackOperations(beforeLines, afterLines);
  }

  const matrix = Array.from(
    { length: beforeLines.length + 1 },
    () => new Uint32Array(afterLines.length + 1)
  );

  for (let leftIndex = beforeLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = afterLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (beforeLines[leftIndex] === afterLines[rightIndex]) {
        matrix[leftIndex][rightIndex] = matrix[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        matrix[leftIndex][rightIndex] = Math.max(
          matrix[leftIndex + 1][rightIndex],
          matrix[leftIndex][rightIndex + 1]
        );
      }
    }
  }

  /** @type {Array<{ type: 'context' | 'add' | 'remove', text: string }>} */
  const operations = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < beforeLines.length && rightIndex < afterLines.length) {
    if (beforeLines[leftIndex] === afterLines[rightIndex]) {
      operations.push({ type: 'context', text: beforeLines[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
    } else if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
      operations.push({ type: 'remove', text: beforeLines[leftIndex] });
      leftIndex += 1;
    } else {
      operations.push({ type: 'add', text: afterLines[rightIndex] });
      rightIndex += 1;
    }
  }

  while (leftIndex < beforeLines.length) {
    operations.push({ type: 'remove', text: beforeLines[leftIndex] });
    leftIndex += 1;
  }

  while (rightIndex < afterLines.length) {
    operations.push({ type: 'add', text: afterLines[rightIndex] });
    rightIndex += 1;
  }

  return operations;
}

/**
 * @param {string[]} beforeLines
 * @param {string[]} afterLines
 * @returns {Array<{ type: 'context' | 'add' | 'remove', text: string }>}
 */
function buildFallbackOperations(beforeLines, afterLines) {
  /** @type {Array<{ type: 'context' | 'add' | 'remove', text: string }>} */
  const operations = [];
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  for (const text of beforeLines.slice(0, prefix)) {
    operations.push({ type: 'context', text });
  }

  for (const text of beforeLines.slice(prefix, beforeSuffix + 1)) {
    operations.push({ type: 'remove', text });
  }

  for (const text of afterLines.slice(prefix, afterSuffix + 1)) {
    operations.push({ type: 'add', text });
  }

  for (const text of beforeLines.slice(beforeSuffix + 1)) {
    operations.push({ type: 'context', text });
  }

  return operations;
}

/**
 * @param {Array<{ type: 'context' | 'add' | 'remove', text: string }>} operations
 * @returns {DiffRow[]}
 */
function materializeDiffRows(operations) {
  /** @type {DiffRow[]} */
  const rows = [];
  let leftNumber = 1;
  let rightNumber = 1;

  for (const operation of operations) {
    if (operation.type === 'context') {
      rows.push({
        type: 'context',
        leftNumber,
        rightNumber,
        text: operation.text,
      });
      leftNumber += 1;
      rightNumber += 1;
      continue;
    }

    if (operation.type === 'remove') {
      rows.push({
        type: 'remove',
        leftNumber,
        rightNumber: null,
        text: operation.text,
      });
      leftNumber += 1;
      continue;
    }

    rows.push({
      type: 'add',
      leftNumber: null,
      rightNumber,
      text: operation.text,
    });
    rightNumber += 1;
  }

  return rows;
}

/**
 * @param {DiffRow[]} rows
 * @param {number} contextSize
 * @returns {DiffRow[]}
 */
function collapseDiffRows(rows, contextSize) {
  const changeIndexes = rows
    .map((row, index) => (row.type === 'add' || row.type === 'remove' ? index : -1))
    .filter((index) => index >= 0);

  if (!changeIndexes.length) {
    return rows.slice(0, 80);
  }

  /** @type {Array<[number, number]>} */
  const ranges = [];
  for (const changeIndex of changeIndexes) {
    const start = Math.max(0, changeIndex - contextSize);
    const end = Math.min(rows.length - 1, changeIndex + contextSize);
    const previousRange = ranges[ranges.length - 1];
    if (!previousRange || start > previousRange[1] + 1) {
      ranges.push([start, end]);
    } else {
      previousRange[1] = Math.max(previousRange[1], end);
    }
  }

  /** @type {DiffRow[]} */
  const collapsed = [];
  for (const [rangeIndex, range] of ranges.entries()) {
    const [start, end] = range;
    if (rangeIndex > 0) {
      collapsed.push({
        type: 'skip',
        leftNumber: null,
        rightNumber: null,
        text: `… ${start - ranges[rangeIndex - 1][1] - 1} unchanged lines`,
      });
    }

    collapsed.push(...rows.slice(start, end + 1));
  }

  return collapsed;
}

/**
 * @param {string[]} afterLines
 * @returns {DiffRow[]}
 */
function buildNoChangeRows(afterLines) {
  return afterLines.slice(0, 80).map((text, index) => ({
    type: 'context',
    leftNumber: index + 1,
    rightNumber: index + 1,
    text,
  }));
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
 * @param {HistoryBackend=} backend
 * @returns {Promise<vscode.Uri>}
 */
async function createTargetUri(workspacePath, target, relativePath, backend = 'jj') {
  if (target === '@') {
    const fileUri = vscode.Uri.file(path.join(workspacePath, relativePath));
    if (await fileExists(fileUri.fsPath)) {
      return fileUri;
    }
  }

  return createSnapshotUri(workspacePath, target, relativePath, backend);
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
  if (!extensionContext) {
    return '<!DOCTYPE html><html><body>Extension context unavailable.</body></html>';
  }

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionContext.extensionUri, 'webview', 'timeline.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionContext.extensionUri, 'webview', 'timeline.js')
  );

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Revision Timeline</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div class="app">
      <section class="workspace" id="workspace">
        <aside class="panel sidebar" id="sidebar">
          <div class="sidebar-head">
            <div class="eyebrow">Revisions</div>
            <div class="sidebar-hint" id="sidebarHint"></div>
          </div>
          <div class="history-list" id="historyList"></div>
        </aside>
        <div class="resize-handle" id="resizeHandle"></div>
        <section class="panel diff-panel">
          <div class="diff-head">
            <div class="diff-head-top">
              <div class="file-switcher">
                <div class="eyebrow">Revision Timeline</div>
                <div class="file-switcher-row">
                  <div class="file-title" id="fileName">Loading...</div>
                  <div class="title-path" id="filePath"></div>
                </div>
                <input class="file-input" id="fileSwitcher" list="workspaceFilesList" placeholder="Switch file..." />
                <datalist id="workspaceFilesList"></datalist>
              </div>
              <div class="head-actions">
                <div class="menu-wrap">
                  <button class="menu-button" id="actionsButton" type="button">...</button>
                  <div class="menu" id="actionsMenu">
                    <button class="menu-item" id="toggleSidebarAction" type="button">Hide Sidebar</button>
                    <button class="menu-item" id="openCurrentFileAction" type="button">Open File</button>
                    <button class="menu-item" id="openEditorButton" type="button">Open File Range Diff</button>
                    <button class="menu-item" id="openRangeFilesButton" type="button">Open Range Files Diff</button>
                    <button class="menu-item" id="refreshButton" type="button">Refresh</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="timeline-head">
              <div>
                <div class="range-label" id="rangeLabel">Loading revisions...</div>
                <div class="range-subtitle" id="rangeSubtitle"></div>
              </div>
              <div class="control-row">
                <div class="segmented" id="layoutModes"></div>
                <div class="segmented" id="contentModes"></div>
                <div class="segmented" id="presets"></div>
              </div>
            </div>

            <div class="timeline">
              <div class="timeline-labels">
                <div class="handle-pills">
                  <span class="handle-pill from" id="fromHandleLabel">From</span>
                  <span class="handle-pill to" id="toHandleLabel">To</span>
                </div>
                <div class="selection-meta" id="selectionMeta"></div>
              </div>
              <div class="track"></div>
              <div class="range-fill" id="rangeFill"></div>
              <div class="selection-pill from" id="fromPill">From</div>
              <div class="selection-pill to" id="toPill">To</div>
              <div class="sliders">
                <input id="fromSlider" type="range" min="0" max="0" value="0" />
                <input id="toSlider" type="range" min="0" max="0" value="0" />
              </div>
              <div class="month-row" id="monthRow"></div>
            </div>

            <div class="diff-title-row">
              <div>
                <div class="eyebrow" id="diffModeEyebrow">Diff</div>
                <h3 class="diff-title" id="diffTitle">Loading diff...</h3>
              </div>
              <div class="history-stats" id="diffStats"></div>
            </div>
            <div class="diff-subtitle" id="diffSubtitle"></div>
          </div>
          <div class="diff-rows" id="diffRows"></div>
        </section>
      </section>
    </div>
    <script src="${scriptUri}"></script>
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
