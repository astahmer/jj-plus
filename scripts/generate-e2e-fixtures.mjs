import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const runtimeDir = path.join(rootDir, '.e2e-runtime');
const reposDir = path.join(runtimeDir, 'repos');
const outputDir = path.join(rootDir, 'webview', 'public', 'e2e');
const relativeFilePath = 'apps/backend/instructions/lazy-di-rollout-plan.md';

await fs.rm(runtimeDir, { recursive: true, force: true });
await fs.mkdir(reposDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });

const gitFixture = await generateGitFixture();
const jjFixture = await generateJjFixture();

await fs.writeFile(path.join(outputDir, 'git-basic.json'), JSON.stringify(gitFixture, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'jj-basic.json'), JSON.stringify(jjFixture, null, 2) + '\n');

async function generateGitFixture() {
  const repoDir = path.join(reposDir, 'git-basic');
  await fs.mkdir(repoDir, { recursive: true });
  await run('git', ['init'], repoDir);
  await run('git', ['config', 'user.name', 'Fixture User'], repoDir);
  await run('git', ['config', 'user.email', 'fixture@example.com'], repoDir);

  await commit(repoDir, '2026-04-08T10:00:00Z', 'initial plan', {
    [relativeFilePath]: baseFileContent('Initial revision', 'alpha line'),
  });
  await commit(repoDir, '2026-04-08T11:00:00Z', 'unrelated note', {
    'notes/todo.txt': 'unrelated note\n',
  });
  await commit(repoDir, '2026-04-09T10:00:00Z', 'plan refinement', {
    [relativeFilePath]: baseFileContent('Second revision', 'beta line'),
  });
  await commit(repoDir, '2026-04-10T10:00:00Z', 'finalized rollout', {
    [relativeFilePath]: baseFileContent('Third revision', 'gamma line'),
  });
  await writeFiles(repoDir, {
    [relativeFilePath]: baseFileContent('Working tree', 'delta line'),
  });

  return buildFixtureFromGitRepo(repoDir, 'git');
}

async function generateJjFixture() {
  const repoDir = path.join(reposDir, 'jj-basic');
  await fs.mkdir(repoDir, { recursive: true });
  await run('jj', ['git', 'init', '--colocate', repoDir], rootDir);
  await run('git', ['config', 'user.name', 'Fixture User'], repoDir);
  await run('git', ['config', 'user.email', 'fixture@example.com'], repoDir);

  await commit(repoDir, '2026-04-08T10:00:00Z', 'initial plan', {
    [relativeFilePath]: baseFileContent('Initial revision', 'alpha line'),
  });
  await commit(repoDir, '2026-04-08T11:00:00Z', 'unrelated note', {
    'notes/todo.txt': 'unrelated note\n',
  });
  await commit(repoDir, '2026-04-09T10:00:00Z', 'plan refinement', {
    [relativeFilePath]: baseFileContent('Second revision', 'beta line'),
  });
  await commit(repoDir, '2026-04-10T10:00:00Z', 'snapshot working copy', {
    [relativeFilePath]: baseFileContent('Third revision', 'gamma line'),
  });
  await writeFiles(repoDir, {
    [relativeFilePath]: baseFileContent('Working tree', 'delta line'),
  });

  return buildFixtureFromJjRepo(repoDir);
}

async function buildFixtureFromGitRepo(repoDir, backend) {
  const entries = await getGitEntries(repoDir);
  const workspaceFiles = await getWorkspaceFiles(repoDir);
  const fileName = path.basename(relativeFilePath);
  const previewMap = await buildPreviewMap(repoDir, entries, backend);
  return {
    timelineData: {
      backend,
      workspacePath: repoDir,
      relativePath: relativeFilePath,
      fileName,
      version: '0.0.2',
      presets: { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY },
      defaultIndex: entries.length - 1,
      latestIndex: entries.length - 1,
      preferences: {
        sidebarWidth: 280,
        layoutMode: 'split',
        contentMode: 'diffs',
        comparisonMode: 'range',
        comparisonSource: backend === 'jj' ? 'snapshot' : 'revision',
        preset: '90d',
        showIntermediateRevisions: true,
      },
      workspaceFiles,
      hasIntermediateRevisions: entries.some((entry) => !entry.touchesFile),
      entries,
      snapshotEntries: backend === 'jj' ? entries : entries,
      snapshotState: {
        loadedChangeIds: entries.map((entry) => entry.changeId).filter(Boolean),
      },
    },
    previews: previewMap,
  };
}

async function buildFixtureFromJjRepo(repoDir) {
  const entries = await getJjEntries(repoDir);
  const workspaceFiles = await getWorkspaceFiles(repoDir);
  const previewMap = await buildPreviewMap(repoDir, entries, 'jj');
  return {
    timelineData: {
      backend: 'jj',
      workspacePath: repoDir,
      relativePath: relativeFilePath,
      fileName: path.basename(relativeFilePath),
      version: '0.0.2',
      presets: { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY },
      defaultIndex: entries.length - 1,
      latestIndex: entries.length - 1,
      preferences: {
        sidebarWidth: 280,
        layoutMode: 'split',
        contentMode: 'diffs',
        comparisonMode: 'range',
        comparisonSource: 'snapshot',
        preset: '90d',
        showIntermediateRevisions: true,
      },
      workspaceFiles,
      hasIntermediateRevisions: entries.some((entry) => !entry.touchesFile),
      entries,
      snapshotEntries: entries,
      snapshotState: {
        loadedChangeIds: entries.map((entry) => entry.changeId).filter(Boolean),
      },
    },
    previews: previewMap,
  };
}

async function getGitEntries(repoDir) {
  const { stdout } = await run('git', ['log', '--reverse', '--format=%H%x09%cI%x09%an%x09%s'], repoDir);
  const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const [index, line] of revisions.entries()) {
    const [revision, authorDate, authorName, description] = line.split('\t');
    const touchesFile = await gitTouchesFile(repoDir, revision);
    entries.push(makeEntry({
      id: revision,
      index,
      revision,
      shortRevision: revision.slice(0, 8),
      changeId: undefined,
      authorDate,
      authorName,
      description,
      touchesFile,
      isWorkingTree: false,
    }));
  }

  const workingTreeEntry = await makeWorkingTreeEntry(repoDir, entries.at(-1));
  if (workingTreeEntry) {
    entries.push(workingTreeEntry);
  }
  return entries;
}

async function getJjEntries(repoDir) {
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
  const { stdout } = await run('jj', ['log', '--no-graph', '--reversed', '-r', 'all() ~ root()', '-T', template], repoDir);
  const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const [index, line] of revisions.entries()) {
    const [revision, changeId, authorDate, authorName, description] = line.split('\t');
    const touchesFile = await jjTouchesFile(repoDir, revision);
    entries.push(makeEntry({
      id: revision,
      index,
      revision,
      shortRevision: changeId || revision.slice(0, 8),
      changeId: changeId || undefined,
      authorDate,
      authorName,
      description,
      touchesFile,
      isWorkingTree: false,
    }));
  }

  const lastEntry = entries.at(-1);
  if (lastEntry && (!lastEntry.description || lastEntry.description === '')) {
    lastEntry.shortRevision = 'Current';
    lastEntry.revision = 'WORKTREE';
    lastEntry.description = 'Working tree';
    lastEntry.isWorkingTree = true;
    lastEntry.changeId = undefined;
  }

  const workingTreeEntry = await makeWorkingTreeEntry(repoDir, entries.at(-1));
  if (workingTreeEntry) {
    entries.push(workingTreeEntry);
  }
  return entries;
}

async function buildPreviewMap(repoDir, entries, backend) {
  const previews = {};
  for (let toIndex = 1; toIndex < entries.length; toIndex += 1) {
    for (let fromIndex = 0; fromIndex < toIndex; fromIndex += 1) {
      previews[`${fromIndex}:${toIndex}`] = await buildPreview(repoDir, entries, backend, fromIndex, toIndex);
    }
  }
  return previews;
}

async function buildPreview(repoDir, entries, backend, fromIndex, toIndex) {
  const fromEntry = entries[fromIndex];
  const toEntry = entries[toIndex];
  const beforeText = await getEntryContent(repoDir, backend, fromEntry);
  const afterText = await getEntryContent(repoDir, backend, toEntry);
  const rows = buildRows(beforeText, afterText);
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'remove').length;
  const hunkCount = rows.some((row) => row.type === 'add' || row.type === 'remove') ? 1 : 0;
  return {
    index: toIndex,
    title: `${fromEntry.shortRevision} -> ${toEntry.shortRevision}`,
    subtitle: toEntry.isWorkingTree ? 'Working tree' : `${new Date(toEntry.authorDate).toLocaleString()} · ${toEntry.description}`,
    additions,
    deletions,
    hunkCount,
    hasChanges: additions > 0 || deletions > 0,
    fromIndex,
    toIndex,
    comparisonSource: backend === 'jj' ? 'snapshot' : 'revision',
    rows,
    nonTextualDetails: [],
  };
}

async function getEntryContent(repoDir, backend, entry) {
  if (entry.isWorkingTree) {
    return fs.readFile(path.join(repoDir, relativeFilePath), 'utf8');
  }
  if (backend === 'jj') {
    const { stdout } = await run('git', ['show', `${entry.revision}:${relativeFilePath}`], repoDir);
    return stdout;
  }
  const { stdout } = await run('git', ['show', `${entry.revision}:${relativeFilePath}`], repoDir);
  return stdout;
}

function buildRows(beforeText, afterText) {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  if (beforeText === afterText) {
    return buildContextRows(afterLines);
  }

  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1;
  }

  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (endBefore >= start && endAfter >= start && beforeLines[endBefore] === afterLines[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const rows = [];
  rows.push(...buildContextRows(beforeLines.slice(0, start), 0, 0));
  for (let index = start; index <= endBefore; index += 1) {
    rows.push({ type: 'remove', leftNumber: index + 1, rightNumber: null, text: beforeLines[index] });
  }
  for (let index = start; index <= endAfter; index += 1) {
    rows.push({ type: 'add', leftNumber: null, rightNumber: index + 1, text: afterLines[index] });
  }
  const trailingContext = afterLines.slice(endAfter + 1);
  const trailingStartLeft = endBefore + 1;
  const trailingStartRight = endAfter + 1;
  rows.push(...buildContextRows(trailingContext, trailingStartLeft, trailingStartRight));
  return rows;
}

function buildContextRows(lines, leftOffset = 0, rightOffset = 0) {
  if (lines.length <= 6) {
    return lines.map((line, index) => ({
      type: 'context',
      leftNumber: leftOffset + index + 1,
      rightNumber: rightOffset + index + 1,
      text: line,
    }));
  }

  const head = lines.slice(0, 3).map((line, index) => ({
    type: 'context',
    leftNumber: leftOffset + index + 1,
    rightNumber: rightOffset + index + 1,
    text: line,
  }));
  const tail = lines.slice(-3).map((line, index) => ({
    type: 'context',
    leftNumber: leftOffset + lines.length - 3 + index + 1,
    rightNumber: rightOffset + lines.length - 3 + index + 1,
    text: line,
  }));
  return [
    ...head,
    { type: 'skip', leftNumber: null, rightNumber: null, text: `Show ${lines.length - 6} unchanged lines` },
    ...tail,
  ];
}

function splitLines(value) {
  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n');
}

async function gitTouchesFile(repoDir, revision) {
  const { stdout } = await run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', revision, '--', relativeFilePath], repoDir);
  return stdout.trim().length > 0;
}

async function jjTouchesFile(repoDir, revision) {
  const { stdout } = await run('jj', ['show', '--summary', '-r', revision], repoDir);
  return stdout.includes(relativeFilePath);
}

async function getWorkspaceFiles(repoDir) {
  const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], repoDir);
  return stdout.split(/\r?\n/).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function makeWorkingTreeEntry(repoDir, previousEntry) {
  const content = await fs.readFile(path.join(repoDir, relativeFilePath), 'utf8');
  const previousContent = previousEntry ? await getEntryContent(repoDir, 'git', previousEntry) : '';
  if (content === previousContent) {
    return null;
  }

  const authorDate = '2026-04-11T12:00:00Z';
  return makeEntry({
    id: 'working-tree',
    index: previousEntry ? previousEntry.index + 1 : 0,
    revision: 'WORKTREE',
    shortRevision: 'Current',
    changeId: undefined,
    authorDate,
    authorName: 'Fixture User',
    description: 'Working tree',
    touchesFile: true,
    isWorkingTree: true,
  });
}

function makeEntry({ id, index, revision, shortRevision, changeId, authorDate, authorName, description, touchesFile, isWorkingTree }) {
  const timestamp = Date.parse(authorDate);
  return {
    id,
    index,
    revision,
    shortRevision,
    changeId,
    authorDate,
    authorName,
    description: description || '',
    isWorkingTree,
    touchesFile,
    timestamp,
    monthLabel: new Intl.DateTimeFormat('en', { month: 'long' }).format(timestamp),
    shortDate: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp),
    relativeDate: relativeTime(timestamp),
    hasPreviousEntry: index > 0,
  };
}

function relativeTime(timestamp) {
  const now = Date.parse('2026-04-11T12:00:00Z');
  const hours = Math.round((now - timestamp) / (1000 * 60 * 60));
  if (hours <= 1) {
    return 'this minute';
  }
  if (hours < 36) {
    return 'yesterday';
  }
  return `${Math.round(hours / 24)} days ago`;
}

async function commit(repoDir, date, message, files) {
  await writeFiles(repoDir, files);
  await run('git', ['add', '.'], repoDir);
  await run('git', ['commit', '-m', message], repoDir, {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

async function writeFiles(repoDir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(repoDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);
  }
}

function baseFileContent(title, line) {
  return `## ${title}\n\n1. Inventory\n${line}\n`;
}

async function run(command, args, cwd, env = {}) {
  return execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
  });
}
