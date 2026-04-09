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
 * @property {Map<string, string>} contentCache
 * @property {Map<number, DiffPreview>} previewCache
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
 * @property {DiffRow[]} rows
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
 * @returns {{ backend: HistoryBackend, workspacePath: string, relativePath: string, fileName: string, presets: typeof TIMELINE_PRESET_DAYS, defaultIndex: number, entries: Array<Record<string, unknown>> }}
 */
function buildTimelinePayload(session) {
  return {
    backend: session.backend,
    workspacePath: session.workspacePath,
    relativePath: session.relativePath,
    fileName: session.fileName,
    presets: TIMELINE_PRESET_DAYS,
    defaultIndex: Math.max(0, session.entries.length - 1),
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
    await sendTimelinePreview(panel, session, Math.max(0, session.entries.length - 1));
    return;
  }

  if (command === 'select-entry') {
    const nextIndex = Number(Reflect.get(message, 'index'));
    if (!Number.isInteger(nextIndex)) {
      return;
    }

    await sendTimelinePreview(panel, session, nextIndex);
    return;
  }

  if (command === 'open-editor-diff') {
    const nextIndex = Number(Reflect.get(message, 'index'));
    if (!Number.isInteger(nextIndex)) {
      return;
    }

    await openTimelineSelectionInEditor(session, nextIndex);
    return;
  }

  if (command === 'refresh') {
    const nextSession = await buildTimelineSession(session.workspacePath, session.absolutePath);
    syncTimelineSession(session, nextSession);
    currentTimelineSession = session;
    await panel.webview.postMessage({
      type: 'timeline-data',
      payload: buildTimelinePayload(session),
    });
    await sendTimelinePreview(panel, session, Math.max(0, session.entries.length - 1));
  }
}

/**
 * @param {vscode.WebviewPanel} panel
 * @param {TimelineSession} session
 * @param {number} index
 */
async function sendTimelinePreview(panel, session, index) {
  await panel.webview.postMessage({
    type: 'diff-preview',
    payload: await getDiffPreview(session, index),
  });
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
  target.contentCache = source.contentCache;
  target.previewCache = source.previewCache;
}

/**
 * @param {TimelineSession} session
 * @param {number} index
 */
async function openTimelineSelectionInEditor(session, index) {
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
    contentCache: new Map(),
    previewCache: new Map(),
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
 * @param {TimelineSession} session
 * @param {number} index
 * @returns {Promise<DiffPreview>}
 */
async function getDiffPreview(session, index) {
  const cached = session.previewCache.get(index);
  if (cached) {
    return cached;
  }

  const currentEntry = session.entries[index];
  if (!currentEntry) {
    return {
      index,
      title: 'No revision selected',
      subtitle: '',
      additions: 0,
      deletions: 0,
      hunkCount: 0,
      hasChanges: false,
      rows: [],
    };
  }

  const previousEntry = index > 0 ? session.entries[index - 1] : undefined;
  const beforeText = previousEntry ? await getRevisionContent(session, previousEntry) : '';
  const afterText = await getRevisionContent(session, currentEntry);
  const preview = buildDiffPreview(index, previousEntry, currentEntry, beforeText, afterText);
  session.previewCache.set(index, preview);
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
 * @returns {DiffPreview}
 */
function buildDiffPreview(index, previousEntry, currentEntry, beforeText, afterText) {
  const beforeLines = splitIntoLines(beforeText);
  const afterLines = splitIntoLines(afterText);
  const operations = diffLineOperations(beforeLines, afterLines);
  const numberedRows = materializeDiffRows(operations);
  const rows = collapseDiffRows(numberedRows, 3);
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'remove').length;
  const hunkCount = rows.filter((row) => row.type === 'skip').length + (additions || deletions ? 1 : 0);
  const title = previousEntry
    ? `${previousEntry.shortRevision} -> ${currentEntry.shortRevision}`
    : `Initial revision -> ${currentEntry.shortRevision}`;
  const subtitle = currentEntry.isWorkingTree
    ? 'Comparing the working tree with the previous recorded revision.'
    : `${new Date(currentEntry.authorDate).toLocaleString()} · ${currentEntry.description}`;

  return {
    index,
    title,
    subtitle,
    additions,
    deletions,
    hunkCount: additions || deletions ? hunkCount : 0,
    hasChanges: additions > 0 || deletions > 0,
    rows: additions > 0 || deletions > 0 ? rows : buildNoChangeRows(afterLines),
  };
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
        --bg: var(--vscode-editor-background, #11151c);
        --panel: var(--vscode-sideBar-background, #171c24);
        --panel-alt: var(--vscode-editorWidget-background, #1d232d);
        --panel-soft: rgba(255, 255, 255, 0.03);
        --text: var(--vscode-foreground, #e8ecf3);
        --muted: var(--vscode-descriptionForeground, #9da7b5);
        --border: var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
        --accent: var(--vscode-focusBorder, #5d91ff);
        --accent-soft: rgba(93, 145, 255, 0.14);
        --success: #4cc38a;
        --danger: #ff7b72;
        --shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        --code-font: "SFMono-Regular", "Cascadia Code", "JetBrains Mono", monospace;
        --ui-font: "SF Pro Text", "Segoe UI Variable", "Aptos", sans-serif;
      }

      html,
      body {
        height: 100%;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: var(--ui-font);
        color: var(--text);
        background: var(--bg);
        padding: 10px;
      }

      .app {
        height: calc(100vh - 20px);
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 10px;
      }

      .panel {
        background: linear-gradient(180deg, var(--panel), var(--panel-alt));
        border: 1px solid var(--border);
        border-radius: 14px;
        box-shadow: var(--shadow);
        min-width: 0;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        padding: 12px 14px;
      }

      .title {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .eyebrow {
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .title strong {
        font-size: 20px;
        letter-spacing: -0.02em;
        font-weight: 650;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .title-path {
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .button {
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text);
        border-radius: 999px;
        padding: 6px 11px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }

      .button:hover {
        border-color: rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
      }

      .timeline-wrap {
        padding: 12px 14px 14px;
        display: grid;
        gap: 10px;
      }

      .timeline-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .range-label {
        font-size: 15px;
        letter-spacing: -0.02em;
        font-weight: 600;
      }

      .supporting {
        color: var(--muted);
        font-size: 12px;
      }

      .preset-row {
        display: inline-flex;
        gap: 4px;
        padding: 3px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--border);
        border-radius: 999px;
      }

      .preset {
        border: 0;
        color: var(--muted);
        background: transparent;
        border-radius: 999px;
        padding: 5px 10px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }

      .preset.active {
        background: var(--accent-soft);
        color: var(--text);
      }

      .scrubber {
        position: relative;
        display: grid;
        gap: 8px;
      }

      .track {
        position: absolute;
        left: 0;
        right: 0;
        top: 24px;
        height: 8px;
        border-radius: 999px;
        background:
          linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03)),
          repeating-linear-gradient(
            90deg,
            rgba(255,255,255,0.06) 0,
            rgba(255,255,255,0.06) 1px,
            transparent 1px,
            transparent 8px
          );
        border: 1px solid var(--border);
      }

      input[type='range'] {
        appearance: none;
        width: 100%;
        margin: 0;
        background: transparent;
        position: relative;
        z-index: 2;
        padding-top: 14px;
      }

      input[type='range']::-webkit-slider-runnable-track {
        height: 8px;
        background: transparent;
      }

      input[type='range']::-webkit-slider-thumb {
        appearance: none;
        width: 16px;
        height: 16px;
        margin-top: -4px;
        border-radius: 999px;
        background: var(--accent);
        border: 2px solid var(--bg);
        box-shadow: 0 0 0 3px rgba(93, 145, 255, 0.16);
      }

      input[type='range']::-moz-range-track {
        height: 8px;
        background: transparent;
      }

      input[type='range']::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: var(--accent);
        border: 2px solid var(--bg);
        box-shadow: 0 0 0 3px rgba(93, 145, 255, 0.16);
      }

      .selection-pill {
        position: absolute;
        top: -2px;
        transform: translateX(-50%);
        background: var(--panel-alt);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 4px 10px;
        color: var(--text);
        font-size: 11px;
        white-space: nowrap;
        z-index: 1;
      }

      .month-row {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        color: var(--muted);
        font-size: 11px;
      }

      .month-row strong {
        color: var(--text);
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
        gap: 10px;
        min-height: 0;
      }

      .sidebar,
      .diff-panel {
        min-height: 0;
        display: grid;
      }

      .sidebar {
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
      }

      .selection-card {
        padding: 12px 14px;
        display: grid;
        gap: 8px;
      }

      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        font-size: 11px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--border);
        color: var(--muted);
      }

      .chip--accent {
        background: var(--accent-soft);
        color: var(--text);
        border-color: transparent;
      }

      .selection-title {
        margin: 0;
        font-size: 18px;
        line-height: 1.25;
        letter-spacing: -0.02em;
      }

      .selection-copy {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .history-panel {
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
      }

      .history-head {
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
      }

      .history-list {
        overflow: auto;
        padding: 8px;
        display: grid;
        gap: 6px;
      }

      .history-item {
        border: 1px solid transparent;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 12px;
        padding: 10px 11px;
        cursor: pointer;
        text-align: left;
      }

      .history-item:hover {
        border-color: var(--border);
      }

      .history-item.active {
        border-color: rgba(93, 145, 255, 0.34);
        background: rgba(93, 145, 255, 0.09);
      }

      .history-top,
      .history-bottom {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }

      .history-top {
        margin-bottom: 4px;
        font-size: 12px;
        font-weight: 600;
      }

      .history-description {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
        min-height: 18px;
      }

      .history-meta {
        color: var(--muted);
        font-size: 11px;
      }

      .history-stats {
        display: grid;
        grid-auto-flow: column;
        gap: 8px;
        justify-content: start;
      }

      .diff-panel {
        grid-template-rows: auto minmax(0, 1fr);
      }

      .diff-head {
        padding: 12px 14px;
        display: grid;
        gap: 8px;
        border-bottom: 1px solid var(--border);
      }

      .diff-title-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }

      .diff-title {
        margin: 0;
        font-size: 16px;
        letter-spacing: -0.02em;
      }

      .stat {
        font-family: var(--code-font);
        font-size: 11px;
        color: var(--muted);
      }

      .stat--plus {
        color: var(--success);
      }

      .stat--minus {
        color: var(--danger);
      }

      .diff-subtitle {
        color: var(--muted);
        font-size: 12px;
      }

      .diff-rows {
        min-height: 0;
        overflow: auto;
        font-family: var(--code-font);
        font-size: 12px;
        line-height: 1.55;
      }

      .diff-row {
        display: grid;
        grid-template-columns: 18px 52px 52px minmax(0, 1fr);
        align-items: start;
        border-bottom: 1px solid rgba(255, 255, 255, 0.02);
      }

      .diff-row--context {
        background: transparent;
      }

      .diff-row--add {
        background: rgba(76, 195, 138, 0.08);
      }

      .diff-row--remove {
        background: rgba(255, 123, 114, 0.08);
      }

      .diff-row--skip {
        grid-template-columns: 1fr;
        background: rgba(255, 255, 255, 0.03);
        color: var(--muted);
      }

      .cell {
        padding: 3px 8px;
        min-width: 0;
      }

      .marker,
      .line-number {
        color: var(--muted);
        text-align: right;
        user-select: none;
      }

      .line-number {
        font-variant-numeric: tabular-nums;
      }

      .diff-row--add .marker {
        color: var(--success);
      }

      .diff-row--remove .marker {
        color: var(--danger);
      }

      .code {
        white-space: pre;
        overflow-x: auto;
      }

      .empty,
      .empty-diff {
        text-align: center;
        color: var(--muted);
        padding: 28px 16px;
      }

      @media (max-width: 980px) {
        body {
          padding: 8px;
        }

        .layout {
          grid-template-columns: 1fr;
        }

        .sidebar {
          grid-template-rows: auto auto;
        }

        .history-panel {
          max-height: 240px;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <section class="panel topbar">
        <div class="title">
          <div class="eyebrow">Revision Timeline</div>
          <strong id="fileName">Loading…</strong>
          <div class="title-path" id="filePath"></div>
        </div>
        <div class="toolbar">
          <button class="button" id="openEditorButton">Open In Editor</button>
          <button class="button" id="refreshButton">Refresh</button>
        </div>
      </section>

      <section class="panel timeline-wrap">
        <div class="timeline-head">
          <div>
            <div class="range-label" id="rangeLabel">Loading revisions…</div>
            <div class="supporting" id="rangeSubtitle"></div>
          </div>
          <div class="preset-row" id="presets"></div>
        </div>
        <div class="scrubber">
          <div class="track"></div>
          <div class="selection-pill" id="selectionPill">Select a revision</div>
          <input id="slider" type="range" min="0" max="0" value="0" />
          <div class="month-row" id="monthRow"></div>
        </div>
      </section>

      <section class="layout">
        <div class="sidebar">
          <section class="panel selection-card">
            <div class="eyebrow">Selected Revision</div>
            <div class="chip-row" id="selectedChips"></div>
            <h2 class="selection-title" id="headline"></h2>
            <div class="selection-copy" id="supporting"></div>
          </section>

          <section class="panel history-panel">
            <div class="history-head">
              <div class="eyebrow">Visible Revisions</div>
            </div>
            <div class="history-list" id="historyList"></div>
          </section>
        </div>

        <section class="panel diff-panel">
          <div class="diff-head">
            <div class="diff-title-row">
              <h3 class="diff-title" id="diffTitle">Loading diff…</h3>
              <div class="history-stats" id="diffStats"></div>
            </div>
            <div class="diff-subtitle" id="diffSubtitle"></div>
          </div>
          <div class="diff-rows" id="diffRows"></div>
        </section>
      </section>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = {
        data: null,
        preview: null,
        previewByIndex: {},
        preset: '90d',
        visibleEntries: [],
        selectedIndex: 0,
        previewTimer: undefined,
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
        openEditorButton: document.getElementById('openEditorButton'),
        refreshButton: document.getElementById('refreshButton'),
        selectedChips: document.getElementById('selectedChips'),
        diffTitle: document.getElementById('diffTitle'),
        diffSubtitle: document.getElementById('diffSubtitle'),
        diffStats: document.getElementById('diffStats'),
        diffRows: document.getElementById('diffRows'),
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
        if (message?.type === 'timeline-data') {
          state.data = message.payload;
          state.selectedIndex = state.data.defaultIndex || 0;
          state.preview = null;

          if (!state.data.entries.length) {
            renderEmpty();
            return;
          }

          elements.fileName.textContent = state.data.fileName;
          elements.filePath.textContent = state.data.relativePath;
          applyPreset(state.preset, true, true);
          return;
        }

        if (message?.type !== 'diff-preview') {
          return;
        }

        state.preview = message.payload;
        state.previewByIndex[String(message.payload.index)] = message.payload;
        renderPreview();
        renderHistoryList();
      });

      elements.slider.addEventListener('input', () => {
        const nextVisibleIndex = Number(elements.slider.value);
        const nextEntry = state.visibleEntries[nextVisibleIndex];
        if (!nextEntry) {
          return;
        }

        state.selectedIndex = nextEntry.index;
        renderSelection();
        requestPreview(70);
      });

      elements.slider.addEventListener('change', () => {
        requestPreview(0);
      });

      elements.openEditorButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'open-editor-diff', index: state.selectedIndex });
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

      function applyPreset(preset, resetSelection, suppressPreviewRequest) {
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
        if (!suppressPreviewRequest) {
          requestPreview(0);
        }
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
        const knownPreview = state.previewByIndex[String(selected.index)];

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
        elements.headline.textContent = selected.description;
        elements.supporting.textContent = selected.isWorkingTree
          ? 'Comparing the current file on disk against the previous recorded revision.'
          : selected.relativeDate + ' · ' + new Date(selected.authorDate).toLocaleString() + (previous && previous.id !== selected.id ? ' · Diff target: ' + previous.shortRevision : '');

        elements.selectedChips.innerHTML = [
          renderChip(state.data.backend.toUpperCase() + ' backend', false),
          renderChip(selected.isWorkingTree ? 'Current working tree' : selected.shortRevision, true),
          knownPreview ? renderChip('+' + String(knownPreview.additions), false, 'stat--plus') : '',
          knownPreview ? renderChip('-' + String(knownPreview.deletions), false, 'stat--minus') : '',
        ].join('');

        renderMonths();
        renderHistoryList();
        renderPreview();
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
        if (!state.visibleEntries.length) {
          elements.historyList.innerHTML = '<div class="empty">No revisions in the current filter.</div>';
          return;
        }

        elements.historyList.innerHTML = '';
        for (const entry of state.visibleEntries.slice().reverse()) {
          const preview = state.previewByIndex[String(entry.index)];
          const button = document.createElement('button');
          button.className = 'history-item' + (entry.index === state.selectedIndex ? ' active' : '');
          button.type = 'button';
          button.addEventListener('click', () => {
            state.selectedIndex = entry.index;
            renderSelection();
            requestPreview(0);
          });

          button.innerHTML = [
            '<div class="history-top">',
            '<strong>' + escapeHtml(entry.shortRevision) + '</strong>',
            '<span>' + escapeHtml(entry.shortDate) + '</span>',
            '</div>',
            '<div class="history-description">' + escapeHtml(entry.description) + '</div>',
            '<div class="history-bottom">',
            '<span class="history-meta">' + escapeHtml(entry.relativeDate) + '</span>',
            '<span class="history-stats">' + (preview ? renderStatChips(preview) : '') + '</span>',
            '</div>',
          ].join('');
          elements.historyList.appendChild(button);
        }
      }

      function renderPreview() {
        if (!state.data) {
          return;
        }

        const selected = state.data.entries[state.selectedIndex];
        if (!selected) {
          elements.diffTitle.textContent = 'No diff available';
          elements.diffSubtitle.textContent = '';
          elements.diffStats.innerHTML = '';
          elements.diffRows.innerHTML = '<div class="empty-diff">Pick a revision to inspect it.</div>';
          return;
        }

        if (!state.preview || state.preview.index !== state.selectedIndex) {
          elements.diffTitle.textContent = 'Loading diff…';
          elements.diffSubtitle.textContent = selected.description;
          elements.diffStats.innerHTML = '';
          elements.diffRows.innerHTML = '<div class="empty-diff">Computing diff preview…</div>';
          return;
        }

        elements.diffTitle.textContent = state.preview.title;
        elements.diffSubtitle.textContent = state.preview.subtitle;
        elements.diffStats.innerHTML = renderStatChips(state.preview);

        if (!state.preview.rows.length) {
          elements.diffRows.innerHTML = '<div class="empty-diff">No textual changes in this selection.</div>';
          return;
        }

        elements.diffRows.innerHTML = state.preview.rows.map((row) => renderDiffRow(row)).join('');
      }

      function renderEmpty() {
        elements.rangeLabel.textContent = 'No revisions found';
        elements.rangeSubtitle.textContent = '';
        elements.headline.textContent = 'No recorded history for this file';
        elements.supporting.textContent = '';
        elements.historyList.innerHTML = '<div class="empty">Make a change and commit it, then reopen the timeline.</div>';
        elements.diffTitle.textContent = 'No diff available';
        elements.diffSubtitle.textContent = '';
        elements.diffStats.innerHTML = '';
        elements.diffRows.innerHTML = '<div class="empty-diff">Make a change and commit it, then reopen the timeline.</div>';
      }

      function requestPreview(delay) {
        if (state.previewTimer) {
          window.clearTimeout(state.previewTimer);
        }

        state.previewTimer = window.setTimeout(() => {
          vscode.postMessage({ command: 'select-entry', index: state.selectedIndex });
        }, delay);
      }

      function renderChip(text, accent, extraClass) {
        return '<span class="chip' + (accent ? ' chip--accent' : '') + (extraClass ? ' ' + extraClass : '') + '">' + escapeHtml(text) + '</span>';
      }

      function renderStatChips(preview) {
        return [
          '<span class="stat stat--plus">+' + String(preview.additions) + '</span>',
          '<span class="stat stat--minus">-' + String(preview.deletions) + '</span>',
          '<span class="stat">' + String(preview.hunkCount) + ' hunks</span>',
        ].join('');
      }

      function renderDiffRow(row) {
        if (row.type === 'skip') {
          return '<div class="diff-row diff-row--skip"><div class="cell">' + escapeHtml(row.text) + '</div></div>';
        }

        const marker = row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' ';
        return [
          '<div class="diff-row diff-row--' + row.type + '">',
          '<div class="cell marker">' + marker + '</div>',
          '<div class="cell line-number">' + formatLineNumber(row.leftNumber) + '</div>',
          '<div class="cell line-number">' + formatLineNumber(row.rightNumber) + '</div>',
          '<div class="cell code">' + escapeHtml(row.text || ' ') + '</div>',
          '</div>',
        ].join('');
      }

      function formatLineNumber(value) {
        return value == null ? '' : String(value);
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
