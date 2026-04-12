// @ts-check

const { execFile } = require('node:child_process');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { textsMatchIgnoringLineEndings } = require('./lib/diff-helpers.js');
const { dedupeAdjacentEntriesByChangeId, getGitHubRemoteBaseUrl, normalizeSnapshotOperationKey, parseJjEvolutionSummaryEntries, parseJjSummaryChangedPaths, parseJjSummaryRenameLines } = require('./lib/history-helpers.js');
const packageJson = require('./package.json');
const { renderTimelineDocumentHtml } = require('./webview/timeline.template.js');

const EXTENSION_ID = 'astahmer.jj-range-diff';
const HELPER_COMMAND = 'jj-range-diff.openRangeMultiDiff';
const OPEN_FILE_TIMELINE_COMMAND = 'jj-range-diff.openFileRevisionTimeline';
const GET_TIMELINE_DEBUG_STATE_COMMAND = 'jj-range-diff._debug.getTimelineState';
const OPEN_RANGE_DIFF_URI_PATH = '/open-range-multi-diff';
const OPEN_MULTI_DIFF_COMMAND = '_workbench.openMultiDiffEditor';
const SNAPSHOT_SCHEME = 'jj-range-diff';
const PENDING_RANGE_DIFF_KEY = 'pendingRangeDiffArgs';
const TIMELINE_PREFERENCES_KEY = 'timelinePanelPreferences';
const CLI_SOURCE = 'cli';
const DEFAULT_FROM_REVSET = 'closest_bookmark(@)';
const DEFAULT_TO_REVSET = '@';
const MAX_TIMELINE_ENTRIES = 200;
const MAX_SNAPSHOT_HYDRATION_CHANGES = 8;
const EXTENSION_VERSION = packageJson.version;
const TIMELINE_PRESET_DAYS = {
  year: 365,
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

let timelineDebugState = createEmptyTimelineDebugState();

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
 * @property {string} authorName
 * @property {string} description
 * @property {boolean} isWorkingTree
 * @property {boolean} touchesFile
 * @property {number} timestamp
 * @property {string=} filePath
 * @property {string=} operationId
 * @property {number=} operationIndex
 * @property {string=} operationKey
 * @property {string=} remoteUrl
 */

/**
 * @typedef {object} TimelineSession
 * @property {HistoryBackend} backend
 * @property {string} workspacePath
 * @property {string} relativePath
 * @property {string} absolutePath
 * @property {string} fileName
 * @property {FileRevisionEntry[]} entries
 * @property {FileRevisionEntry[]} snapshotEntries
 * @property {Set<string>} snapshotLoadedChangeIds
 * @property {Set<string>} snapshotPendingChangeIds
 * @property {string[]} workspaceFiles
 * @property {Map<string, string>} contentCache
 * @property {Map<string, DiffPreview>} previewCache
 * @property {Map<string, string>} pathCache
 * @property {AbortController | undefined} activeActionAbortController
 */

/**
 * @typedef {object} TimelinePreferences
 * @property {number=} sidebarWidth
 * @property {boolean=} sidebarCollapsed
 * @property {number=} timelinePaneHeight
 * @property {boolean=} timelinePaneCollapsed
 * @property {'split' | 'unified'=} layoutMode
 * @property {'diffs' | 'full'=} contentMode
 * @property {'range' | 'step'=} comparisonMode
 * @property {'revision' | 'snapshot'=} comparisonSource
 * @property {boolean=} showIntermediateRevisions
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
 * @property {'revision' | 'snapshot'} comparisonSource
 * @property {DiffRow[]} rows
 * @property {string[]} nonTextualDetails
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
    vscode.commands.registerCommand(GET_TIMELINE_DEBUG_STATE_COMMAND, () => ({ ...timelineDebugState })),
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

  const hadExistingPanel = Boolean(timelinePanel);
  const shouldMaximize = shouldMaximizeTimelinePanel();
  const panel = getOrCreateTimelinePanel(context, session.fileName);
  const usesBundledWebview = hasBundledTimelineWebviewAssets();
  currentTimelineSession = session;
  panel.webview.html = getTimelineWebviewHtml(panel.webview);
  panel.title = `Revision Timeline: ${session.fileName}`;
  timelineDebugState = {
    panelOpen: true,
    panelTitle: panel.title,
    backend: session.backend,
    workspacePath: session.workspacePath,
    relativePath: session.relativePath,
    fileName: session.fileName,
    entryCount: session.entries.length,
    snapshotEntryCount: session.snapshotEntries.length,
    usesBundledWebview,
    viewReady: false,
    readyCount: 0,
    lastMessageCommand: '',
    lastReadyAt: 0,
  };

  if (!hadExistingPanel && shouldMaximize) {
    await maximizeTimelinePanel();
  }
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {string} fileName
 * @returns {vscode.WebviewPanel}
 */
function getOrCreateTimelinePanel(context, fileName) {
  if (timelinePanel) {
    timelinePanel.reveal(timelinePanel.viewColumn, true);
    return timelinePanel;
  }

  timelinePanel = vscode.window.createWebviewPanel(
    'jjRangeDiffTimeline',
    `Revision Timeline: ${fileName}`,
    getTimelineViewColumn(),
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: extensionContext
        ? [
            vscode.Uri.joinPath(extensionContext.extensionUri, 'webview'),
            vscode.Uri.joinPath(extensionContext.extensionUri, 'webview-dist'),
          ]
        : undefined,
    }
  );

  timelinePanel.onDidDispose(
    () => {
      currentTimelineSession?.activeActionAbortController?.abort();
      timelinePanel = undefined;
      currentTimelineSession = undefined;
      timelineDebugState = createEmptyTimelineDebugState();
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
 * @returns {{ backend: HistoryBackend, workspacePath: string, relativePath: string, fileName: string, version: string, presets: typeof TIMELINE_PRESET_DAYS, defaultIndex: number, latestIndex: number, preferences: TimelinePreferences, workspaceFiles: string[], hasIntermediateRevisions: boolean, entries: Array<Record<string, unknown>>, snapshotEntries: Array<Record<string, unknown>>, snapshotState: { loadedChangeIds: string[] } }}
 */
function buildTimelinePayload(session, preferences) {
  const mapPayloadEntries = (entries) => entries.map((entry, index) => ({
    ...entry,
    index,
    hasPreviousEntry: index > 0,
    monthLabel: formatEntryMonthLabel(entry.authorDate),
    shortDate: formatEntryShortDate(entry.authorDate),
    relativeDate: formatRelativeTime(entry.timestamp),
    remoteUrl: entry.remoteUrl,
  }));

  return {
    backend: session.backend,
    workspacePath: session.workspacePath,
    relativePath: session.relativePath,
    fileName: session.fileName,
    version: EXTENSION_VERSION,
    presets: TIMELINE_PRESET_DAYS,
    defaultIndex: Math.max(0, session.entries.length - 1),
    latestIndex: Math.max(0, session.entries.length - 1),
    preferences,
    workspaceFiles: session.workspaceFiles,
    hasIntermediateRevisions: session.entries.some((entry) => !entry.touchesFile),
    entries: mapPayloadEntries(session.entries),
    snapshotEntries: mapPayloadEntries(session.snapshotEntries),
    snapshotState: {
      loadedChangeIds: [...session.snapshotLoadedChangeIds],
    },
  };
}

/**
 * @param {string} authorDate
 * @returns {string}
 */
function formatEntryMonthLabel(authorDate) {
  const date = new Date(authorDate);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown month';
  }

  return new Intl.DateTimeFormat('en', { month: 'long' }).format(date);
}

/**
 * @param {string} authorDate
 * @returns {string}
 */
function formatEntryShortDate(authorDate) {
  const date = new Date(authorDate);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
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
    timelineDebugState = {
      ...timelineDebugState,
      viewReady: true,
      readyCount: timelineDebugState.readyCount + 1,
      lastMessageCommand: 'ready',
      lastReadyAt: Date.now(),
    };

    const comparisonSource = getTimelinePreferences(extensionContext).comparisonSource;
    if (comparisonSource === 'snapshot' && session.backend === 'jj' && session.snapshotLoadedChangeIds.size === 0) {
      await hydrateJjSnapshotEntries(session, [
        Math.max(0, session.entries.length - 2),
        Math.max(0, session.entries.length - 1),
      ]);
    }

    await postTimelineMessage(panel, {
      type: 'timeline-data',
      payload: buildTimelinePayload(session, getTimelinePreferences(extensionContext)),
    });
    return;
  }

  if (command === 'select-entry') {
    const fromIndex = Number(Reflect.get(message, 'fromIndex'));
    const toIndex = Number(Reflect.get(message, 'toIndex'));
    const comparisonSource = getComparisonSource(Reflect.get(message, 'comparisonSource'));
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return;
    }

    await sendTimelinePreview(panel, session, fromIndex, toIndex, comparisonSource);
    return;
  }

  if (command === 'hydrate-snapshot-entries') {
    const revisionIndexes = Reflect.get(message, 'revisionIndexes');
    if (!Array.isArray(revisionIndexes)) {
      return;
    }

    const didUpdate = await hydrateJjSnapshotEntries(
      session,
      revisionIndexes
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
    );

    if (!didUpdate) {
      return;
    }

    await postTimelineMessage(panel, {
      type: 'snapshot-entries',
      payload: {
        snapshotEntries: buildTimelinePayload(session, getTimelinePreferences(extensionContext)).snapshotEntries,
        snapshotState: {
          loadedChangeIds: [...session.snapshotLoadedChangeIds],
        },
      },
    });
    return;
  }

  if (command === 'resolve-nonempty-range') {
    const candidateIndexes = Reflect.get(message, 'candidateIndexes');
    if (!Array.isArray(candidateIndexes)) {
      return;
    }

    const resolvedRange = await findNearestNonEmptyVisibleRange(
      session,
      candidateIndexes
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
    );

    await postTimelineMessage(panel, {
      type: 'resolved-range',
      payload: resolvedRange,
    });
    return;
  }

  if (command === 'open-editor-diff') {
    const fromIndex = Number(Reflect.get(message, 'fromIndex'));
    const toIndex = Number(Reflect.get(message, 'toIndex'));
    const comparisonSource = getComparisonSource(Reflect.get(message, 'comparisonSource'));
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return;
    }

    await openRangeDiffInEditor(session, fromIndex, toIndex, comparisonSource);
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
    const comparisonSource = getComparisonSource(Reflect.get(message, 'comparisonSource'));
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return;
    }

    await openRangeFilesDiff(session, fromIndex, toIndex, comparisonSource);
    return;
  }

  if (command === 'open-revision-files-diff') {
    const entryIndex = Number(Reflect.get(message, 'entryIndex'));
    const comparisonSource = getComparisonSource(Reflect.get(message, 'comparisonSource'));
    if (!Number.isInteger(entryIndex)) {
      return;
    }

    await openRevisionFilesDiff(session, entryIndex, comparisonSource);
    return;
  }

  if (command === 'open-revision-remote') {
    const entryIndex = Number(Reflect.get(message, 'entryIndex'));
    const comparisonSource = getComparisonSource(Reflect.get(message, 'comparisonSource'));
    if (!Number.isInteger(entryIndex)) {
      return;
    }

    await openRevisionOnRemote(session, entryIndex, comparisonSource);
    return;
  }

  if (command === 'cancel-active-request') {
    session.activeActionAbortController?.abort();
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
      timelinePaneHeight: Number(Reflect.get(message, 'timelinePaneHeight')),
      timelinePaneCollapsed: Boolean(Reflect.get(message, 'timelinePaneCollapsed')),
      layoutMode: getLayoutMode(Reflect.get(message, 'layoutMode')),
      contentMode: getContentMode(Reflect.get(message, 'contentMode')),
      comparisonMode: getComparisonMode(Reflect.get(message, 'comparisonMode')),
      comparisonSource: getComparisonSource(Reflect.get(message, 'comparisonSource')),
      showIntermediateRevisions: Boolean(Reflect.get(message, 'showIntermediateRevisions')),
      preset: getPresetName(Reflect.get(message, 'preset')),
    });
    return;
  }

  if (command === 'refresh') {
    const nextSession = await buildTimelineSession(session.workspacePath, session.absolutePath);
    syncTimelineSession(session, nextSession);
    currentTimelineSession = session;
    await postTimelineMessage(panel, {
      type: 'timeline-data',
      payload: buildTimelinePayload(session, getTimelinePreferences(extensionContext)),
    });
  }
}

/**
 * @param {vscode.WebviewPanel} panel
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 * @param {'revision' | 'snapshot'} comparisonSource
 */
async function sendTimelinePreview(panel, session, fromIndex, toIndex, comparisonSource = 'revision') {
  await postTimelineMessage(panel, {
    type: 'diff-preview',
    payload: await getDiffPreview(session, fromIndex, toIndex, comparisonSource),
  });
}

/**
 * @param {vscode.WebviewPanel} panel
 * @param {{ type: string, payload: unknown }} message
 * @returns {Promise<boolean>}
 */
async function postTimelineMessage(panel, message) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  return panel.webview.postMessage(message);
}

/**
 * @param {TimelineSession} session
 * @param {number[]} candidateIndexes
 * @returns {Promise<{ fromIndex: number, toIndex: number } | null>}
 */
async function findNearestNonEmptyVisibleRange(session, candidateIndexes) {
  if (candidateIndexes.length < 2) {
    return null;
  }

  for (let index = candidateIndexes.length - 1; index > 0; index -= 1) {
    const fromIndex = candidateIndexes[index - 1];
    const toIndex = candidateIndexes[index];
    const preview = await getDiffPreview(session, fromIndex, toIndex);
    if (preview.hasChanges) {
      return { fromIndex, toIndex };
    }
  }

  return null;
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
 * @returns {'range' | 'step'}
 */
function getComparisonMode(value) {
  return value === 'step' ? 'step' : 'range';
}

/**
 * @param {unknown} value
 * @returns {'revision' | 'snapshot'}
 */
function getComparisonSource(value) {
  return value === 'snapshot' ? 'snapshot' : 'revision';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function getPresetName(value) {
  const preset = String(value || '').trim();
  return Object.hasOwn(TIMELINE_PRESET_DAYS, preset) ? preset : 'year';
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
  target.snapshotEntries = source.snapshotEntries;
  target.snapshotLoadedChangeIds = source.snapshotLoadedChangeIds;
  target.snapshotPendingChangeIds = source.snapshotPendingChangeIds;
  target.workspaceFiles = source.workspaceFiles;
  target.contentCache = source.contentCache;
  target.previewCache = source.previewCache;
  target.pathCache = source.pathCache;
  target.activeActionAbortController = source.activeActionAbortController;
}

/**
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 */
async function openRangeDiffInEditor(session, fromIndex, toIndex) {
  const comparisonSource = arguments.length > 3 ? arguments[3] : 'revision';
  const sourceEntries = getEntriesForSource(session, comparisonSource);
  const comparison = getComparisonEntries(sourceEntries, fromIndex, toIndex);
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

  const originalUri = createSnapshotUri(session.workspacePath, fromEntry.revision, await resolveEntryFilePath(session, fromEntry, fromIndex), session.backend);
  const modifiedUri = createSnapshotUri(session.workspacePath, toEntry.revision, await resolveEntryFilePath(session, toEntry, toIndex), session.backend);
  const title = `${session.fileName}: ${fromEntry.shortRevision} -> ${toEntry.shortRevision}`;
  await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title, {
    preview: true,
  });
}

/**
 * @param {FileRevisionEntry[]} entries
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {{ fromEntry: FileRevisionEntry, toEntry: FileRevisionEntry } | undefined}
 */
function getComparisonEntries(entries, fromIndex, toIndex) {
  const normalizedFromIndex = Math.max(0, Math.min(fromIndex, toIndex));
  const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(fromIndex, toIndex));
  const fromEntry = entries[normalizedFromIndex];
  const toEntry = entries[normalizedToIndex];
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

  const entryIndex = session.entries.findIndex((candidate) => candidate.id === entry.id);
  const resolvedPath = await resolveEntryFilePath(session, entry, entryIndex);
  return createSnapshotUri(session.workspacePath, entry.revision, resolvedPath, session.backend);
}

/**
 * @param {TimelineSession} session
 * @param {'revision' | 'snapshot'} comparisonSource
 * @returns {FileRevisionEntry[]}
 */
function getEntriesForSource(session, comparisonSource) {
  if (session.backend !== 'jj' || comparisonSource !== 'snapshot') {
    return session.entries;
  }

  return composeSnapshotEntries(session.entries, session.snapshotEntries, session.snapshotLoadedChangeIds);
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
  const fileEntries = backend === 'jj'
    ? await getJjFileRevisionHistory(workspacePath, relativePath)
    : await getGitFileRevisionHistory(workspacePath, relativePath);
  const entries = await buildTimelineEntries(backend, workspacePath, absolutePath, relativePath, fileEntries);
  const snapshotEntries = backend === 'jj' ? [] : entries;
  const remoteBaseUrl = await resolveGitHubRemoteBaseUrl(workspacePath);

  if (remoteBaseUrl) {
    for (const entry of entries) {
      if (!entry.isWorkingTree) {
        entry.remoteUrl = `${remoteBaseUrl}/commit/${entry.revision}`;
      }
    }
  }

  return {
    backend,
    workspacePath,
    absolutePath,
    relativePath,
    fileName: path.basename(absolutePath),
    entries,
    snapshotEntries,
    snapshotLoadedChangeIds: new Set(),
    snapshotPendingChangeIds: new Set(),
    workspaceFiles,
    contentCache: new Map(),
    previewCache: new Map(),
    pathCache: new Map(),
    activeActionAbortController: undefined,
  };
}

/**
 * @param {string} workspacePath
 * @returns {Promise<string[]>}
 */
async function listWorkspaceFiles(workspacePath) {
  const gitFiles = await listGitVisibleFiles(workspacePath);
  if (gitFiles) {
    return gitFiles;
  }

  const matches = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspacePath, '**/*'),
    '**/{.git,.jj,node_modules,dist,build,out,coverage}/**',
    5000
  );

  return matches
    .filter((uri) => uri.scheme === 'file')
    .map((uri) => path.relative(workspacePath, uri.fsPath).replace(/\\/g, '/'))
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * @param {string} workspacePath
 * @returns {Promise<string[] | undefined>}
 */
async function listGitVisibleFiles(workspacePath) {
  try {
    const { stdout } = await runGit(workspacePath, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ]);

    return stdout
      .split('\u0000')
      .map((value) => value.trim())
      .filter(Boolean)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return undefined;
  }
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
    'author.name()',
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
    toJjRootFileFileset(relativePath),
  ]);

  return dedupeAdjacentEntriesByChangeId(stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJjHistoryLine)
    .toReversed());
}

/**
 * @param {string} line
 * @returns {FileRevisionEntry}
 */
function parseJjHistoryLine(line) {
  const [revision = '', changeId = '', authorDate = '', authorName = '', ...descriptionParts] = line.split('\t');
  const description = descriptionParts.join('\t') || 'No description';
  return {
    id: revision,
    revision,
    shortRevision: changeId || revision.slice(0, 8),
    changeId: changeId || undefined,
    authorDate,
    authorName: authorName || 'Unknown author',
    description,
    isWorkingTree: false,
    touchesFile: true,
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
    `--format=%H%x09%ad%x09%an%x09%s`,
    `--max-count=${MAX_TIMELINE_ENTRIES}`,
    '--',
    relativePath,
  ]);

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseGitHistoryLine)
    .toReversed();
}

/**
 * @param {string} line
 * @returns {FileRevisionEntry}
 */
function parseGitHistoryLine(line) {
  const [revision = '', authorDate = '', authorName = '', ...descriptionParts] = line.split('\t');
  const description = descriptionParts.join('\t') || 'No description';
  return {
    id: revision,
    revision,
    shortRevision: revision.slice(0, 8),
    changeId: undefined,
    authorDate,
    authorName: authorName || 'Unknown author',
    description,
    isWorkingTree: false,
    touchesFile: true,
    timestamp: Date.parse(authorDate) || 0,
  };
}

/**
 * @param {HistoryBackend} backend
 * @param {string} workspacePath
 * @returns {Promise<FileRevisionEntry[]>}
 */
async function getRepositoryRevisionHistory(backend, workspacePath) {
  if (backend === 'jj') {
    const template = [
      'commit_id.short()',
      '"\\t"',
      'change_id.shortest()',
      '"\\t"',
      'author.timestamp().format("%Y-%m-%dT%H:%M:%S%:z")',
      '"\\t"',
      'author.name()',
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
    ]);

    return dedupeAdjacentEntriesByChangeId(stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJjHistoryLine)
      .map((entry) => ({
        ...entry,
        touchesFile: false,
      }))
      .toReversed());
  }

  const { stdout } = await runGit(workspacePath, [
    'log',
    '--date=iso-strict',
    `--format=%H%x09%ad%x09%an%x09%s`,
    `--max-count=${MAX_TIMELINE_ENTRIES}`,
  ]);

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseGitHistoryLine)
    .map((entry) => ({
      ...entry,
      touchesFile: false,
    }))
    .toReversed();
}

/**
 * @param {HistoryBackend} backend
 * @param {string} workspacePath
 * @param {string} absolutePath
 * @param {string} relativePath
 * @param {FileRevisionEntry[]} fileEntries
 * @returns {Promise<FileRevisionEntry[]>}
 */
async function buildTimelineEntries(backend, workspacePath, absolutePath, relativePath, fileEntries) {
  const touchingEntries = fileEntries.map((entry) => ({
    ...entry,
    touchesFile: true,
  }));

  if (touchingEntries.length) {
    touchingEntries[touchingEntries.length - 1].filePath = relativePath;
  }

  let entries = touchingEntries;

  if (touchingEntries.length >= 2) {
    try {
      const repositoryEntries = await getRepositoryRevisionHistory(backend, workspacePath);
      entries = mergeTimelineEntries(repositoryEntries, touchingEntries);
    } catch {
      entries = touchingEntries;
    }
  }

  return appendWorkingTreeEntry(workspacePath, absolutePath, relativePath, backend, entries);
}

/**
 * @param {FileRevisionEntry[]} revisionEntries
 * @param {FileRevisionEntry[]} snapshotEntries
 * @param {Set<string>} loadedChangeIds
 * @returns {FileRevisionEntry[]}
 */
function composeSnapshotEntries(revisionEntries, snapshotEntries, loadedChangeIds) {
  if (!loadedChangeIds.size) {
    return revisionEntries;
  }

  const snapshotEntriesByChangeId = snapshotEntries.reduce((groups, entry) => {
    if (!entry.changeId) {
      return groups;
    }

    const existing = groups.get(entry.changeId) || [];
    existing.push(entry);
    groups.set(entry.changeId, existing);
    return groups;
  }, /** @type {Map<string, FileRevisionEntry[]>} */ (new Map()));

  return revisionEntries.flatMap((entry) => {
    if (entry.isWorkingTree || !entry.touchesFile || !entry.changeId || !loadedChangeIds.has(entry.changeId)) {
      return [entry];
    }

    const expandedEntries = snapshotEntriesByChangeId.get(entry.changeId);
    return expandedEntries && expandedEntries.length ? expandedEntries : [entry];
  });
}

/**
 * @param {TimelineSession} session
 * @param {number[]} revisionIndexes
 * @returns {Promise<boolean>}
 */
async function hydrateJjSnapshotEntries(session, revisionIndexes) {
  if (session.backend !== 'jj') {
    return false;
  }

  const targets = revisionIndexes
    .map((index) => session.entries[index])
    .filter((entry) => entry && !entry.isWorkingTree && entry.touchesFile && entry.changeId && !session.snapshotLoadedChangeIds.has(entry.changeId) && !session.snapshotPendingChangeIds.has(entry.changeId));
  const uniqueTargets = targets.reduce((entries, entry) => {
    if (!entry.changeId || entries.some((candidate) => candidate.changeId === entry.changeId)) {
      return entries;
    }

    entries.push(entry);
    return entries;
  }, /** @type {FileRevisionEntry[]} */ ([])).slice(-MAX_SNAPSHOT_HYDRATION_CHANGES);

  if (!uniqueTargets.length) {
    return false;
  }

  let didUpdate = false;
  for (const entry of uniqueTargets) {
    const changeId = entry.changeId;
    if (!changeId || session.snapshotLoadedChangeIds.has(changeId) || session.snapshotPendingChangeIds.has(changeId)) {
      continue;
    }

    session.snapshotPendingChangeIds.add(changeId);
    const expandedEntries = await getJjEvolutionHistoryForFile(session.workspacePath, session.relativePath, entry);
    session.snapshotPendingChangeIds.delete(changeId);
    session.snapshotLoadedChangeIds.add(changeId);

    if (expandedEntries.length) {
      session.snapshotEntries.push(...expandedEntries);
      didUpdate = true;
    }
  }

  if (!didUpdate) {
    return true;
  }

  session.snapshotEntries = session.snapshotEntries.toSorted((left, right) => left.timestamp - right.timestamp || left.revision.localeCompare(right.revision));
  for (const cacheKey of session.previewCache.keys()) {
    if (cacheKey.startsWith('snapshot:')) {
      session.previewCache.delete(cacheKey);
    }
  }
  return true;
}

/**
 * @param {string} workspacePath
 * @param {string} relativePath
 * @param {FileRevisionEntry} entry
 * @returns {Promise<FileRevisionEntry[]>}
 */
async function getJjEvolutionHistoryForFile(workspacePath, relativePath, entry) {
  try {
    const { stdout } = await runJj(workspacePath, [
      'evolog',
      '--no-graph',
      '--summary',
      '--limit',
      String(MAX_TIMELINE_ENTRIES),
      '-r',
      entry.revision,
    ]);
    const evolutionEntries = parseJjEvolutionSummaryEntries(stdout);

    return evolutionEntries
      .filter((evolutionEntry) => parseJjSummaryChangedPaths(evolutionEntry.summaryLines).includes(relativePath))
      .map((evolutionEntry) => ({
        id: `snapshot:${evolutionEntry.operationId || evolutionEntry.changeKey || evolutionEntry.revision}`,
        revision: evolutionEntry.revision,
        shortRevision: normalizeSnapshotOperationKey(evolutionEntry.changeKey) || evolutionEntry.revision.slice(0, 8),
        changeId: entry.changeId,
        authorDate: normalizeSnapshotAuthorDate(evolutionEntry.authorDate, entry.authorDate),
        authorName: evolutionEntry.authorName || entry.authorName,
        description: normalizeSnapshotDescription(evolutionEntry.description, evolutionEntry.operationDescription),
        isWorkingTree: false,
        touchesFile: true,
        timestamp: parseSnapshotTimestamp(evolutionEntry.authorDate, entry.timestamp),
        filePath: relativePath,
        operationId: evolutionEntry.operationId,
        operationIndex: evolutionEntry.operationIndex,
        operationKey: evolutionEntry.changeKey,
      }))
      .toReversed();
  } catch {
    return [];
  }
}

/**
 * @param {string} authorDate
 * @param {string} fallbackAuthorDate
 * @returns {string}
 */
function normalizeSnapshotAuthorDate(authorDate, fallbackAuthorDate) {
  const value = authorDate.trim();
  if (value && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  return fallbackAuthorDate;
}

/**
 * @param {string} authorDate
 * @param {number} fallbackTimestamp
 * @returns {number}
 */
function parseSnapshotTimestamp(authorDate, fallbackTimestamp) {
  const timestamp = Date.parse(authorDate);
  return Number.isNaN(timestamp) ? fallbackTimestamp : timestamp;
}

/**
 * @param {string} description
 * @param {string} operationDescription
 * @returns {string}
 */
function normalizeSnapshotDescription(description, operationDescription) {
  const trimmed = String(description || '').trim();
  if (!trimmed || trimmed === '(no description set)' || trimmed === '(empty) (no description set)') {
    return operationDescription || 'Snapshot';
  }

  return trimmed;
}

/**
 * @param {FileRevisionEntry[]} repositoryEntries
 * @param {FileRevisionEntry[]} fileEntries
 * @returns {FileRevisionEntry[]}
 */
function mergeTimelineEntries(repositoryEntries, fileEntries) {
  const touchingByRevision = new Map(fileEntries.map((entry) => [entry.revision, entry]));
  const repoIndexes = fileEntries
    .map((entry) => repositoryEntries.findIndex((candidate) => candidate.revision === entry.revision))
    .filter((index) => index >= 0);

  if (!repoIndexes.length) {
    return fileEntries;
  }

  const startIndex = Math.min(...repoIndexes);
  const endIndex = Math.max(...repoIndexes);
  const merged = repositoryEntries
    .slice(startIndex, endIndex + 1)
    .map((entry) => touchingByRevision.get(entry.revision) || entry);

  for (const entry of fileEntries) {
    if (!merged.some((candidate) => candidate.revision === entry.revision)) {
      merged.push(entry);
    }
  }

  return merged.toSorted((left, right) => left.timestamp - right.timestamp || left.revision.localeCompare(right.revision));
}

/**
 * @param {string} workspacePath
 * @param {string} absolutePath
 * @param {string} relativePath
 * @param {HistoryBackend} backend
 * @param {FileRevisionEntry[]} entries
 * @returns {Promise<FileRevisionEntry[]>}
 */
async function appendWorkingTreeEntry(workspacePath, absolutePath, relativePath, backend, entries) {
  if (!(await fileExists(absolutePath))) {
    return entries;
  }

  const lastEntry = entries[entries.length - 1];
  const lastTouchingEntry = entries.filter((entry) => entry.touchesFile && !entry.isWorkingTree).at(-1);
  const now = new Date();
  const workingTreeEntry = {
    id: 'working-tree',
    revision: 'WORKTREE',
    shortRevision: 'Current',
    changeId: undefined,
    authorDate: now.toISOString(),
    authorName: '',
    description: 'Working tree',
    isWorkingTree: true,
    touchesFile: true,
    timestamp: now.getTime(),
    filePath: relativePath,
  };

  if (lastEntry?.isWorkingTree) {
    return entries;
  }

  if (lastTouchingEntry) {
    const currentContent = await fs.readFile(absolutePath, 'utf8');
    const previousContent = await showFileAtRevision(
      workspacePath,
      lastTouchingEntry.revision,
      lastTouchingEntry.filePath || relativePath,
      backend
    );
    if (currentContent === previousContent && (lastTouchingEntry.filePath || relativePath) === relativePath) {
      return entries;
    }
  }

  return [...entries, workingTreeEntry];
}

/**
 * @param {TimelineSession} session
 * @param {number} fromIndex
 * @param {number} toIndex
 * @param {'revision' | 'snapshot'=} comparisonSource
 * @returns {Promise<DiffPreview>}
 */
async function getDiffPreview(session, fromIndex, toIndex, comparisonSource = 'revision') {
  const sourceEntries = getEntriesForSource(session, comparisonSource);
  const normalizedFromIndex = Math.max(0, Math.min(fromIndex, toIndex));
  const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(fromIndex, toIndex));
  const cacheKey = `${comparisonSource}:${normalizedFromIndex}:${normalizedToIndex}`;
  const cached = session.previewCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (session.backend === 'jj' && comparisonSource === 'snapshot') {
    const canonicalKey = `${comparisonSource}:${normalizedToIndex}:${normalizedToIndex}`;
    const canonicalPreview = session.previewCache.get(canonicalKey) || await getJjSnapshotPreview(session, normalizedToIndex);
    session.previewCache.set(canonicalKey, canonicalPreview);

    const preview = {
      ...canonicalPreview,
      fromIndex: normalizedFromIndex,
      toIndex: normalizedToIndex,
    };
    session.previewCache.set(cacheKey, preview);
    return preview;
  }

  const comparison = getComparisonEntries(sourceEntries, normalizedFromIndex, normalizedToIndex);
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
      comparisonSource,
      rows: [],
      nonTextualDetails: [],
    };
  }

  const { fromEntry, toEntry } = comparison;
  const beforePath = fromEntry ? await resolveEntryFilePath(session, fromEntry, normalizedFromIndex) : '';
  const afterPath = await resolveEntryFilePath(session, toEntry, normalizedToIndex);
  const beforeText = fromEntry ? await getRevisionContent(session, fromEntry, normalizedFromIndex) : '';
  const afterText = await getRevisionContent(session, toEntry, normalizedToIndex);
  const preview = buildDiffPreview(
    normalizedToIndex,
    fromEntry,
    toEntry,
    beforeText,
    afterText,
    normalizedFromIndex,
    sourceEntries.findIndex((entry) => entry.id === toEntry.id),
    beforePath,
    afterPath
  );
  session.previewCache.set(cacheKey, preview);
  return preview;
}

/**
 * @param {TimelineSession} session
 * @param {number} entryIndex
 * @returns {Promise<DiffPreview>}
 */
async function getJjSnapshotPreview(session, entryIndex) {
  const sourceEntries = getEntriesForSource(session, 'snapshot');
  const entry = sourceEntries[entryIndex];
  if (!entry) {
    return {
      index: entryIndex,
      title: 'No revision selected',
      subtitle: '',
      additions: 0,
      deletions: 0,
      hunkCount: 0,
      hasChanges: false,
      fromIndex: entryIndex,
      toIndex: entryIndex,
      comparisonSource: 'snapshot',
      rows: [],
      nonTextualDetails: [],
    };
  }

  const afterPath = await resolveEntryFilePath(session, entry, entryIndex);
  const previousEntryIndex = Math.max(0, entryIndex - 1);
  const previousEntry = entryIndex > 0 ? sourceEntries[previousEntryIndex] : undefined;
  const previousPath = entry.isWorkingTree
    ? previousEntry
      ? await resolveEntryFilePath(session, previousEntry, previousEntryIndex)
      : session.relativePath
    : await resolvePreviousPathAcrossRevision(session, entry, afterPath);
  const beforeText = entry.isWorkingTree
    ? previousEntry
      ? await getRevisionContent(session, previousEntry, previousEntryIndex)
      : ''
    : await getContentForRevset(session, `${entry.revision}-`, previousPath);
  const afterText = await getRevisionContent(session, entry, entryIndex);
  const preview = buildDiffPreview(
    entryIndex,
    previousEntry,
    entry,
    beforeText,
    afterText,
    previousEntryIndex,
    entryIndex,
    previousPath,
    afterPath
  );

  preview.title = entry.isWorkingTree
    ? `Snapshot @ ${entry.shortRevision}`
    : `Snapshot ${entry.shortRevision}`;
  preview.subtitle = entry.isWorkingTree
    ? 'Current working-copy patch'
    : `${formatEntryDateTime(entry.authorDate)} · patch introduced by ${entry.shortRevision}`;
  preview.comparisonSource = 'snapshot';
  return preview;
}

/**
 * @param {string} authorDate
 * @returns {string}
 */
function formatEntryDateTime(authorDate) {
  const date = new Date(authorDate);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return date.toLocaleString();
}

/**
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} entry
 * @param {number} entryIndex
 * @returns {Promise<string>}
 */
async function getRevisionContent(session, entry, entryIndex) {
  const resolvedPath = entry.isWorkingTree
    ? session.relativePath
    : await resolveEntryFilePath(session, entry, entryIndex);
  const cacheKey = `${entry.id}:${resolvedPath}`;
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
      resolvedPath,
      session.backend
    );
  }

  session.contentCache.set(cacheKey, content);
  return content;
}

/**
 * @param {TimelineSession} session
 * @param {string} revset
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function getContentForRevset(session, revset, filePath) {
  const cacheKey = `revset:${revset}:${filePath}`;
  const cached = session.contentCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const content = await showFileAtRevision(session.workspacePath, revset, filePath, session.backend);
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
 * @param {string} beforePath
 * @param {string} afterPath
 * @returns {DiffPreview}
 */
function buildDiffPreview(index, previousEntry, currentEntry, beforeText, afterText, fromIndex, toIndex, beforePath, afterPath) {
  const textsMatch = textsMatchIgnoringLineEndings(beforeText, afterText);
  const title = previousEntry
    ? `${previousEntry.shortRevision} -> ${currentEntry.shortRevision}`
    : `Initial revision -> ${currentEntry.shortRevision}`;
  const subtitle = currentEntry.isWorkingTree
    ? 'Working tree'
    : `${new Date(currentEntry.authorDate).toLocaleString()} · ${currentEntry.description}`;

  if (textsMatch) {
    const rows = buildNoChangeRows(splitIntoLines(afterText));
    return {
      index,
      title,
      subtitle,
      additions: 0,
      deletions: 0,
      hunkCount: 0,
      hasChanges: false,
      fromIndex,
      toIndex,
      comparisonSource: 'revision',
      rows,
      nonTextualDetails: buildNonTextualDetails(previousEntry, currentEntry, beforeText, afterText, beforePath, afterPath),
    };
  }

  const beforeLines = splitIntoLines(beforeText);
  const afterLines = splitIntoLines(afterText);
  const operations = diffLineOperations(beforeLines, afterLines);
  const rows = materializeDiffRows(operations);
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'remove').length;
  const hunkCount = countDiffHunks(rows);
  const hasChanges = additions > 0 || deletions > 0;

  return {
    index,
    title,
    subtitle,
    additions,
    deletions,
    hunkCount,
    hasChanges,
    fromIndex,
    toIndex,
    comparisonSource: 'revision',
    rows,
    nonTextualDetails: hasChanges ? [] : buildNonTextualDetails(previousEntry, currentEntry, beforeText, afterText, beforePath, afterPath),
  };
}

/**
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} entry
 * @param {number} entryIndex
 * @returns {Promise<string>}
 */
async function resolveEntryFilePath(session, entry, entryIndex) {
  if (entry.isWorkingTree) {
    return session.relativePath;
  }

  if (entry.filePath) {
    return entry.filePath;
  }

  await ensureEntryFilePath(session, entryIndex);
  return entry.filePath || session.relativePath;
}

/**
 * @param {TimelineSession} session
 * @param {number} entryIndex
 * @returns {Promise<void>}
 */
async function ensureEntryFilePath(session, entryIndex) {
  const targetEntry = session.entries[entryIndex];
  if (!targetEntry || targetEntry.filePath || targetEntry.isWorkingTree) {
    return;
  }

  let knownIndex = -1;
  for (let index = entryIndex + 1; index < session.entries.length; index += 1) {
    if (session.entries[index]?.filePath) {
      knownIndex = index;
      break;
    }
  }

  if (knownIndex < 0) {
    targetEntry.filePath = session.relativePath;
    return;
  }

  let currentPath = session.entries[knownIndex].filePath || session.relativePath;
  for (let index = knownIndex; index > entryIndex; index -= 1) {
    const currentEntry = session.entries[index];
    const previousEntry = session.entries[index - 1];
    if (!previousEntry) {
      break;
    }

    if (!previousEntry.filePath) {
      let previousPath = currentPath;
      if (currentEntry.touchesFile && !currentEntry.isWorkingTree) {
        previousPath = await resolvePreviousPathAcrossRevision(session, currentEntry, currentPath);
      }
      previousEntry.filePath = previousPath;
    }

    currentPath = previousEntry.filePath || currentPath;
  }
}

/**
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} entry
 * @param {string} currentPath
 * @returns {Promise<string>}
 */
async function resolvePreviousPathAcrossRevision(session, entry, currentPath) {
  const cacheKey = `${entry.revision}:${currentPath}`;
  const cached = session.pathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const previousPath = session.backend === 'git'
    ? await resolveGitPreviousPath(session.workspacePath, entry.revision, currentPath)
    : await resolveJjPreviousPath(session.workspacePath, entry.revision, currentPath);

  session.pathCache.set(cacheKey, previousPath);
  return previousPath;
}

/**
 * @param {string} workspacePath
 * @param {string} revision
 * @param {string} currentPath
 * @returns {Promise<string>}
 */
async function resolveGitPreviousPath(workspacePath, revision, currentPath) {
  const { stdout } = await runGit(workspacePath, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-status',
    '--find-renames',
    '-r',
    revision,
  ]);

  const rename = parseRenameStatusLines(stdout).find((entry) => entry.toPath === currentPath);
  return rename ? rename.fromPath : currentPath;
}

/**
 * @param {string} workspacePath
 * @param {string} revision
 * @param {string} currentPath
 * @returns {Promise<string>}
 */
async function resolveJjPreviousPath(workspacePath, revision, currentPath) {
  try {
    const { stdout } = await runJj(workspacePath, ['diff', '--summary', '-r', revision]);
    const rename = parseJjSummaryRenameLines(stdout).find((entry) => entry.toPath === currentPath);
    return rename ? rename.fromPath : currentPath;
  } catch {
    return currentPath;
  }
}

/**
 * @param {string} output
 * @param {boolean=} isJj
 * @returns {Array<{ fromPath: string, toPath: string }>}
 */
function parseRenameStatusLines(output, isJj = false) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status = '', ...parts] = line.split('\t');
      if (!status.startsWith('R') && !status.startsWith('C')) {
        return null;
      }

      if (!isJj && parts.length >= 2) {
        return {
          fromPath: parts[0],
          toPath: parts[1],
        };
      }

      if (!parts.length) {
        return null;
      }

      return parseJjDisplayDiffPath(parts.join('\t'));
    })
    .filter((entry) => entry !== null);
}

/**
 * @param {string} value
 * @returns {{ fromPath: string, toPath: string } | null}
 */
function parseJjDisplayDiffPath(value) {
  const braceMatch = value.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/u);
  if (braceMatch) {
    return {
      fromPath: `${braceMatch[1]}${braceMatch[2]}${braceMatch[4]}`,
      toPath: `${braceMatch[1]}${braceMatch[3]}${braceMatch[4]}`,
    };
  }

  const arrowMatch = value.match(/^(.+?) => (.+)$/u) || value.match(/^(.+?) -> (.+)$/u);
  if (!arrowMatch) {
    return null;
  }

  return {
    fromPath: arrowMatch[1],
    toPath: arrowMatch[2],
  };
}

/**
 * @param {FileRevisionEntry | undefined} previousEntry
 * @param {FileRevisionEntry} currentEntry
 * @param {string} beforeText
 * @param {string} afterText
 * @param {string} beforePath
 * @param {string} afterPath
 * @returns {string[]}
 */
function buildNonTextualDetails(previousEntry, currentEntry, beforeText, afterText, beforePath, afterPath) {
  const details = [];

  if (previousEntry && beforePath && afterPath && beforePath !== afterPath) {
    details.push(`Path changed: ${beforePath} -> ${afterPath}`);
  }

  if (beforeText !== afterText && textsMatchIgnoringLineEndings(beforeText, afterText)) {
    details.push('Line endings changed.');
  }

  if (!details.length && currentEntry.isWorkingTree) {
    details.push('The working tree differs in a way this preview does not render as a textual line diff.');
  }

  if (!details.length) {
    details.push('This selection changed file metadata or another non-text detail that is not shown in the inline preview.');
  }

  return details;
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
      timelinePaneHeight: 278,
      timelinePaneCollapsed: false,
      layoutMode: 'split',
      contentMode: 'diffs',
      comparisonMode: 'range',
      comparisonSource: 'revision',
      showIntermediateRevisions: false,
      preset: 'year',
    };
  }

  const value = /** @type {TimelinePreferences} */ (rawValue);
  return {
    sidebarWidth: typeof value.sidebarWidth === 'number' ? value.sidebarWidth : 276,
    sidebarCollapsed: value.sidebarCollapsed === true,
    timelinePaneHeight: typeof value.timelinePaneHeight === 'number' ? value.timelinePaneHeight : 278,
    timelinePaneCollapsed: value.timelinePaneCollapsed === true,
    layoutMode: getLayoutMode(value.layoutMode),
    contentMode: getContentMode(value.contentMode),
    comparisonMode: getComparisonMode(value.comparisonMode),
    comparisonSource: getComparisonSource(value.comparisonSource),
    showIntermediateRevisions: value.showIntermediateRevisions === true,
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
  const comparisonSource = arguments.length > 3 ? arguments[3] : 'revision';
  await runSessionAction(session, async (signal) => {
    const sourceEntries = getEntriesForSource(session, comparisonSource);
    const comparison = getComparisonEntries(sourceEntries, fromIndex, toIndex);
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
        title,
        signal
      );

      if (signal.aborted) {
        return;
      }

      await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
        title: resolvedTitle,
        resources,
      });
      return;
    }

    const resources = await buildGitMultiDiffResources(session, fromEntry, toEntry, signal);
    if (!resources.length) {
      void vscode.window.showInformationMessage(`No changes found for ${title}`);
      return;
    }

    if (signal.aborted) {
      return;
    }

    await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
      title,
      resources,
    });
  });
}

/**
 * @param {TimelineSession} session
 * @param {number} entryIndex
 */
async function openRevisionFilesDiff(session, entryIndex) {
  const comparisonSource = arguments.length > 2 ? arguments[2] : 'revision';
  await runSessionAction(session, async (signal) => {
    const sourceEntries = getEntriesForSource(session, comparisonSource);
    const entry = sourceEntries[entryIndex];
    if (!entry) {
      return;
    }

    if (entry.isWorkingTree) {
      await openRangeFilesDiff(session, Math.max(0, entryIndex - 1), entryIndex, comparisonSource);
      return;
    }

    if (session.backend === 'jj') {
      const baseRevision = comparisonSource === 'snapshot'
        ? (sourceEntries[Math.max(0, entryIndex - 1)]?.revision || `${entry.revision}-`)
        : `${entry.revision}-`;
      const { resources, resolvedTitle } = await buildMultiDiffResources(
        session.workspacePath,
        baseRevision,
        entry.revision,
        entry.shortRevision,
        signal
      );

      if (!resources.length) {
        void vscode.window.showInformationMessage(`No files changed in ${entry.shortRevision}`);
        return;
      }

      if (signal.aborted) {
        return;
      }

      await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
        title: resolvedTitle,
        resources,
      });
      return;
    }

    const resources = await buildGitRevisionMultiDiffResources(session, entry, signal);
    if (!resources.length) {
      void vscode.window.showInformationMessage(`No files changed in ${entry.shortRevision}`);
      return;
    }

    if (signal.aborted) {
      return;
    }

    await vscode.commands.executeCommand(OPEN_MULTI_DIFF_COMMAND, {
      title: entry.shortRevision,
      resources,
    });
  });
}

/**
 * @param {TimelineSession} session
 * @param {(signal: AbortSignal) => Promise<void>} action
 */
async function runSessionAction(session, action) {
  session.activeActionAbortController?.abort();
  const controller = new AbortController();
  session.activeActionAbortController = controller;

  try {
    await action(controller.signal);
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      return;
    }
    throw error;
  } finally {
    if (session.activeActionAbortController === controller) {
      session.activeActionAbortController = undefined;
    }
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isAbortError(error) {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message));
}

/**
 * @param {TimelineSession} session
 * @param {number} entryIndex
 */
async function openRevisionOnRemote(session, entryIndex) {
  const comparisonSource = arguments.length > 2 ? arguments[2] : 'revision';
  const entry = getEntriesForSource(session, comparisonSource)[entryIndex];
  if (!entry || !entry.remoteUrl) {
    void vscode.window.showInformationMessage('No GitHub remote URL is available for this revision.');
    return;
  }

  await vscode.env.openExternal(vscode.Uri.parse(entry.remoteUrl));
}

/**
 * @param {string} workspacePath
 * @returns {Promise<string | undefined>}
 */
async function resolveGitHubRemoteBaseUrl(workspacePath) {
  try {
    const { stdout } = await runGit(workspacePath, ['remote', 'get-url', 'origin']);
    return getGitHubRemoteBaseUrl(stdout);
  } catch {
    return undefined;
  }
}

/**
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} fromEntry
 * @param {FileRevisionEntry} toEntry
 * @returns {Promise<Array<{ originalUri: vscode.Uri, modifiedUri: vscode.Uri }>>}
 */
async function buildGitMultiDiffResources(session, fromEntry, toEntry) {
  const signal = arguments.length > 3 ? arguments[3] : undefined;
  const changedFiles = await listGitChangedFiles(session.workspacePath, fromEntry, toEntry, signal);
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
 * @param {TimelineSession} session
 * @param {FileRevisionEntry} entry
 * @returns {Promise<Array<{ originalUri: vscode.Uri, modifiedUri: vscode.Uri }>>}
 */
async function buildGitRevisionMultiDiffResources(session, entry) {
  const signal = arguments.length > 2 ? arguments[2] : undefined;
  const changedFiles = await listGitRevisionFiles(session.workspacePath, entry.revision, signal);
  if (!changedFiles.length) {
    return [];
  }

  const parentRevision = await resolveGitParentRevision(session.workspacePath, entry.revision, signal);
  return changedFiles.map((relativePath) => ({
    originalUri: createSnapshotUri(session.workspacePath, parentRevision || 'EMPTY', relativePath, 'git'),
    modifiedUri: createSnapshotUri(session.workspacePath, entry.revision, relativePath, 'git'),
  }));
}

/**
 * @param {string} workspacePath
 * @param {FileRevisionEntry} fromEntry
 * @param {FileRevisionEntry} toEntry
 * @returns {Promise<string[]>}
 */
async function listGitChangedFiles(workspacePath, fromEntry, toEntry) {
  const signal = arguments.length > 3 ? arguments[3] : undefined;
  const args = toEntry.isWorkingTree
    ? ['diff', '--name-only', fromEntry.revision, '--']
    : ['diff', '--name-only', fromEntry.revision, toEntry.revision, '--'];
  const { stdout } = await runGit(workspacePath, args, { signal });
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string} workspacePath
 * @param {string} revision
 * @returns {Promise<string[]>}
 */
async function listGitRevisionFiles(workspacePath, revision) {
  const signal = arguments.length > 2 ? arguments[2] : undefined;
  const { stdout } = await runGit(workspacePath, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    revision,
  ], { signal });

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string} workspacePath
 * @param {string} revision
 * @returns {Promise<string | undefined>}
 */
async function resolveGitParentRevision(workspacePath, revision) {
  const signal = arguments.length > 2 ? arguments[2] : undefined;
  try {
    const { stdout } = await runGit(workspacePath, ['rev-parse', `${revision}^`], { signal });
    const parentRevision = stdout.trim();
    return parentRevision || undefined;
  } catch {
    return undefined;
  }
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
  const signal = arguments.length > 4 ? arguments[4] : undefined;
  let changedFiles = await listChangedFiles(workspacePath, base, target, signal);
  let originalRevset = base;
  let modifiedRevset = target;
  let resolvedTitle = title;

  if (!changedFiles.length && target === '@' && base !== target) {
    // JJ range semantics can be empty even when the selected revision has its own patch.
    const revisionFiles = await listRevisionFiles(workspacePath, base, signal);
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
  const signal = arguments.length > 3 ? arguments[3] : undefined;
  const { stdout } = await runJj(
    workspacePath,
    ['diff', '--name-only', '--from', base, '--to', target],
    { signal }
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
  const signal = arguments.length > 2 ? arguments[2] : undefined;
  const { stdout } = await runJj(workspacePath, ['diff', '--name-only', '-r', revset], { signal });

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
  if (revset === 'EMPTY') {
    return '';
  }

  if (backend === 'git') {
    try {
      const { stdout } = await runGit(workspacePath, ['show', `${revset}:${filePath}`]);
      return stdout;
    } catch (error) {
      if (isMissingFileAtRevisionError(error)) {
        return '';
      }
      throw error;
    }
  }

  try {
    const { stdout } = await runJj(workspacePath, ['file', 'show', '-r', revset, filePath]);
    return stdout;
  } catch (error) {
    if (isMissingFileAtRevisionError(error)) {
      return '';
    }
    throw error;
  }
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
function toJjRootFileFileset(relativePath) {
  return `root-file:${JSON.stringify(relativePath)}`;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingFileAtRevisionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /exists on disk, but not in/i.test(message)
    || /path .* does not exist in/i.test(message)
    || /no such path/i.test(message)
    || /no matching entries/i.test(message)
    || /No such file or directory/i.test(message);
}

/**
 * @param {string} workspacePath
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runJj(workspacePath, args, options = {}) {
  logJjCommand(workspacePath, args);

  return runCommand('jj', workspacePath, args, options);
}

/**
 * @param {string} workspacePath
 * @param {string[]} args
 * @param {{ signal?: AbortSignal }=} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runGit(workspacePath, args, options = {}) {
  logGitCommand(workspacePath, args);

  return runCommand('git', workspacePath, args, options);
}

/**
 * @param {'jj' | 'git'} command
 * @param {string} workspacePath
 * @param {string[]} args
 * @param {{ signal?: AbortSignal }=} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runCommand(command, workspacePath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      cwd: workspacePath,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      signal: options.signal,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });

    if (options.signal) {
      const abort = () => {
        child.kill();
      };

      if (options.signal.aborted) {
        abort();
      } else {
        options.signal.addEventListener('abort', abort, { once: true });
      }
    }
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

async function maximizeTimelinePanel() {
  try {
    await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
  } catch {
    // Ignore if the command is unavailable in the current host.
  }
}

/**
 * @returns {boolean}
 */
function shouldMaximizeTimelinePanel() {
  return getEditorGroupCount() > 1;
}

/**
 * @returns {vscode.ViewColumn}
 */
function getTimelineViewColumn() {
  return shouldMaximizeTimelinePanel() ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
}

/**
 * @returns {number}
 */
function getEditorGroupCount() {
  const groups = vscode.window.tabGroups?.all;
  return Array.isArray(groups) && groups.length ? groups.length : 1;
}

/**
 * @param {vscode.Webview} webview
 * @returns {string}
 */
function getTimelineWebviewHtml(webview) {
  if (!extensionContext) {
    return '<!DOCTYPE html><html><body>Extension context unavailable.</body></html>';
  }

  if (!hasBundledTimelineWebviewAssets()) {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Revision Timeline</title>
  </head>
  <body>
    <p>Webview bundle is missing. Run pnpm build:webview and reopen the timeline.</p>
  </body>
</html>`;
  }

  const appStylePath = vscode.Uri.joinPath(extensionContext.extensionUri, 'webview-dist', 'timeline-app.css');
  const appScriptPath = vscode.Uri.joinPath(extensionContext.extensionUri, 'webview-dist', 'timeline-app.js');

  return renderTimelineDocumentHtml({
    title: 'Revision Timeline',
    cspSource: webview.cspSource,
    styleHref: String(webview.asWebviewUri(appStylePath)),
    appSrc: String(webview.asWebviewUri(appScriptPath)),
  });
}

function hasBundledTimelineWebviewAssets() {
  if (!extensionContext) {
    return false;
  }

  const appStylePath = vscode.Uri.joinPath(extensionContext.extensionUri, 'webview-dist', 'timeline-app.css');
  const appScriptPath = vscode.Uri.joinPath(extensionContext.extensionUri, 'webview-dist', 'timeline-app.js');
  return fsSync.existsSync(appStylePath.fsPath) && fsSync.existsSync(appScriptPath.fsPath);
}

function createEmptyTimelineDebugState() {
  return {
    panelOpen: false,
    panelTitle: '',
    backend: '',
    workspacePath: '',
    relativePath: '',
    fileName: '',
    entryCount: 0,
    snapshotEntryCount: 0,
    usesBundledWebview: false,
    viewReady: false,
    readyCount: 0,
    lastMessageCommand: '',
    lastReadyAt: 0,
  };
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
