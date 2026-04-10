// @ts-check

/**
 * @param {string} output
 * @returns {Array<{ fromPath: string, toPath: string }>}
 */
function parseJjSummaryRenameLines(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((entries, line) => {
      const match = /^R\s+(.+?)\s+=>\s+(.+)$/u.exec(line);
      if (!match) {
        return entries;
      }

      entries.push({
        fromPath: match[1].trim(),
        toPath: match[2].trim(),
      });
      return entries;
    }, /** @type {Array<{ fromPath: string, toPath: string }>} */ ([]));
}

/**
 * @param {string} line
 * @returns {{ revision: string, changeId: string | undefined, authorDate: string, authorName: string, description: string, operationDescription: string }}
 */
function parseJjEvolutionLine(line) {
  const [revision = '', changeId = '', authorDate = '', authorName = '', operationDescription = '', ...descriptionParts] = line.split('\t');
  const description = descriptionParts.join('\t') || operationDescription || 'Snapshot';
  return {
    revision,
    changeId: changeId || undefined,
    authorDate,
    authorName: authorName || 'Unknown author',
    description,
    operationDescription: operationDescription || 'snapshot working copy',
  };
}

/**
 * @param {string} line
 * @returns {{ changeKey: string, changeId: string | undefined, operationIndex: number | undefined, authorDate: string, authorName: string, revision: string } | null}
 */
function parseJjEvolutionSummaryHeader(line) {
  const tokens = line.trim().split(/\s+/u);
  if (tokens.length < 5) {
    return null;
  }

  const dateIndex = tokens.findIndex((token) => /^\d{4}-\d{2}-\d{2}$/u.test(token));
  if (dateIndex < 2 || dateIndex + 2 >= tokens.length) {
    return null;
  }

  const timeToken = tokens[dateIndex + 1];
  if (!/^\d{2}:\d{2}:\d{2}$/u.test(timeToken)) {
    return null;
  }

  const revisionIndex = tokens.findLastIndex((token) => /^[0-9a-f]{8,}$/u.test(token));
  if (revisionIndex <= dateIndex + 1) {
    return null;
  }

  const changeKey = tokens[0];
  const [changeId = '', operationIndexRaw = ''] = changeKey.split('/');
  const operationIndex = Number.parseInt(operationIndexRaw, 10);

  return {
    changeKey,
    changeId: changeId || undefined,
    operationIndex: Number.isInteger(operationIndex) ? operationIndex : undefined,
    authorDate: `${tokens[dateIndex]}T${timeToken}`,
    authorName: tokens.slice(1, dateIndex).join(' ') || 'Unknown author',
    revision: tokens[revisionIndex] || '',
  };
}

/**
 * @param {string | undefined} changeKey
 * @returns {string | undefined}
 */
function normalizeSnapshotOperationKey(changeKey) {
  const trimmed = String(changeKey || '').trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.includes('/') ? trimmed : `${trimmed}/0`;
}

/**
 * @param {string} output
 * @returns {Array<{ changeKey: string, changeId: string | undefined, operationIndex: number | undefined, authorDate: string, authorName: string, revision: string, description: string, operationId: string | undefined, operationDescription: string, summaryLines: string[] }>}
 */
function parseJjEvolutionSummaryEntries(output) {
  const lines = output.split(/\r?\n/u);
  /** @type {Array<{ changeKey: string, changeId: string | undefined, operationIndex: number | undefined, authorDate: string, authorName: string, revision: string, description: string, operationId: string | undefined, operationDescription: string, summaryLines: string[] }>}
   */
  const entries = [];
  /** @type {{ changeKey: string, changeId: string | undefined, operationIndex: number | undefined, authorDate: string, authorName: string, revision: string, description: string, operationId: string | undefined, operationDescription: string, summaryLines: string[] } | null} */
  let current = null;
  let descriptionCaptured = false;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    entries.push(current);
    current = null;
    descriptionCaptured = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const header = parseJjEvolutionSummaryHeader(line);
    if (header) {
      pushCurrent();
      current = {
        ...header,
        description: 'Snapshot',
        operationId: undefined,
        operationDescription: 'snapshot working copy',
        summaryLines: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (!descriptionCaptured) {
      current.description = line;
      descriptionCaptured = true;
      continue;
    }

    const operationMatch = /^-- operation ([0-9a-f]+)\s*(.*)$/u.exec(line);
    if (operationMatch) {
      current.operationId = operationMatch[1] || undefined;
      current.operationDescription = operationMatch[2] || 'snapshot working copy';
      continue;
    }

    current.summaryLines.push(line);
  }

  pushCurrent();
  return entries;
}

/**
 * @param {string[] | string} summaryLines
 * @returns {string[]}
 */
function parseJjSummaryChangedPaths(summaryLines) {
  const lines = Array.isArray(summaryLines)
    ? summaryLines
    : String(summaryLines || '').split(/\r?\n/u);
  const renameLines = parseJjSummaryRenameLines(lines.join('\n'));
  const renamePaths = renameLines.flatMap((entry) => [entry.fromPath, entry.toPath]);
  const directPaths = lines.reduce((paths, rawLine) => {
    const line = rawLine.trim();
    if (!line || /^R\s+/u.test(line)) {
      return paths;
    }

    const match = /^[A-Z?]\s+(.+)$/u.exec(line);
    if (match) {
      paths.push(match[1].trim());
    }

    return paths;
  }, /** @type {string[]} */ ([]));

  return [...new Set([...directPaths, ...renamePaths])];
}

/**
 * @param {string} remote
 * @returns {string | undefined}
 */
function getGitHubRemoteBaseUrl(remote) {
  const trimmed = remote.trim();
  if (!trimmed) {
    return undefined;
  }

  const httpsMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(trimmed);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(trimmed);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }

  return undefined;
}

/**
 * @template T extends { changeId?: string }
 * @param {T[]} entries
 * @returns {T[]}
 */
function dedupeAdjacentEntriesByChangeId(entries) {
  return entries.filter((entry, index) => {
    if (!entry.changeId || index === 0) {
      return true;
    }

    return entries[index - 1].changeId !== entry.changeId;
  });
}

module.exports = {
  dedupeAdjacentEntriesByChangeId,
  getGitHubRemoteBaseUrl,
  normalizeSnapshotOperationKey,
  parseJjEvolutionLine,
  parseJjEvolutionSummaryEntries,
  parseJjSummaryChangedPaths,
  parseJjSummaryRenameLines,
};
