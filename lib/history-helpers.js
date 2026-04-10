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
  parseJjSummaryRenameLines,
};
