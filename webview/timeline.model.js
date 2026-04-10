(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.TimelineModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * @param {{ backend?: string, entries?: unknown[], snapshotEntries?: unknown[] } | null | undefined} data
   * @param {'revision' | 'snapshot'} comparisonSource
   * @returns {unknown[]}
   */
  function getEntriesForSource(data, comparisonSource) {
    if (!data) {
      return [];
    }

    if (data.backend === 'jj' && comparisonSource === 'snapshot') {
      const revisionEntries = Array.isArray(data.entries) ? data.entries : [];
      const snapshotEntries = Array.isArray(data.snapshotEntries) ? data.snapshotEntries : [];
      const loadedChangeIds = new Set(
        Array.isArray(data.snapshotState?.loadedChangeIds)
          ? data.snapshotState.loadedChangeIds
          : []
      );

      if (!loadedChangeIds.size) {
        return revisionEntries;
      }

      const snapshotEntriesByChangeId = snapshotEntries.reduce((groups, entry) => {
        if (!entry || !entry.changeId) {
          return groups;
        }

        const existing = groups.get(entry.changeId) || [];
        existing.push(entry);
        groups.set(entry.changeId, existing);
        return groups;
      }, new Map());

      const composedEntries = revisionEntries.flatMap((entry) => {
        if (!entry || entry.isWorkingTree || !entry.touchesFile || !entry.changeId || !loadedChangeIds.has(entry.changeId)) {
          return [entry];
        }

        const expandedEntries = snapshotEntriesByChangeId.get(entry.changeId);
        return expandedEntries && expandedEntries.length ? expandedEntries : [entry];
      });

      return composedEntries.map((entry, index) => ({
        ...entry,
        index,
      }));
    }

    return Array.isArray(data.entries) ? data.entries : [];
  }

  /**
   * @param {Array<{ index: number }>} visibleEntries
   * @param {number} entryIndex
   * @returns {{ fromIndex: number, toIndex: number } | null}
   */
  function getUnitPreviewRange(visibleEntries, entryIndex) {
    const visibleIndex = visibleEntries.findIndex((entry) => entry.index === entryIndex);
    if (visibleIndex <= 0) {
      return null;
    }

    return {
      fromIndex: visibleEntries[visibleIndex - 1].index,
      toIndex: visibleEntries[visibleIndex].index,
    };
  }

  /**
   * @param {Array<{ index: number }>} visibleEntries
   * @param {number} fromIndex
   * @param {number} toIndex
   * @returns {number}
   */
  function getSelectedEntryCount(visibleEntries, fromIndex, toIndex) {
    const minIndex = Math.min(fromIndex, toIndex);
    const maxIndex = Math.max(fromIndex, toIndex);
    return visibleEntries.filter((entry) => entry.index >= minIndex && entry.index <= maxIndex).length;
  }

  /**
   * @param {Array<{ timestamp?: number }>} visibleEntries
   * @param {number} visibleIndex
   * @returns {number}
   */
  function getTimelineAnchorPercent(visibleEntries, visibleIndex) {
    if (!visibleEntries.length) {
      return 0;
    }

    const denominator = Math.max(1, visibleEntries.length - 1);
    return (Math.min(Math.max(visibleIndex, 0), visibleEntries.length - 1) / denominator) * 100;
  }

  /**
   * @param {Array<{ index: number, changeId?: string, touchesFile?: boolean, isWorkingTree?: boolean }>} revisionEntries
   * @param {Set<string>} loadedChangeIds
   * @param {number} limit
   * @param {number[]=} preferredIndexes
   * @returns {number[]}
   */
  function getPendingSnapshotRevisionIndexes(revisionEntries, loadedChangeIds, limit, preferredIndexes = []) {
    const preferredIndexSet = new Set(preferredIndexes);
    const seenChangeIds = new Set();
    const orderedEntries = [
      ...revisionEntries.filter((entry) => preferredIndexSet.has(entry.index)),
      ...revisionEntries,
    ];

    return orderedEntries.reduce((indexes, entry) => {
      if (
        !entry
        || !entry.touchesFile
        || entry.isWorkingTree
        || !entry.changeId
        || loadedChangeIds.has(entry.changeId)
        || seenChangeIds.has(entry.changeId)
      ) {
        return indexes;
      }

      seenChangeIds.add(entry.changeId);
      indexes.push(entry.index);
      return indexes.length >= limit ? indexes : indexes;
    }, /** @type {number[]} */ ([])).slice(0, limit);
  }

  /**
   * @param {Array<{ index: number }>} visibleEntries
   * @param {'revision' | 'snapshot'} comparisonSource
   * @param {Record<string, unknown>} previewByRange
   * @param {string} inFlightKey
   * @param {(fromIndex: number, toIndex: number, comparisonSource: 'revision' | 'snapshot') => string} makePreviewKey
   * @param {number=} limit
   * @returns {Array<{ key: string, fromIndex: number, toIndex: number, comparisonSource: 'revision' | 'snapshot' }>}
   */
  function getSidebarPreviewRequests(visibleEntries, comparisonSource, previewByRange, inFlightKey, makePreviewKey, limit = 24) {
    /** @type {Array<{ key: string, fromIndex: number, toIndex: number, comparisonSource: 'revision' | 'snapshot' }>} */
    const requests = [];

    for (let index = 1; index < visibleEntries.length; index += 1) {
      const range = getUnitPreviewRange(visibleEntries, visibleEntries[index].index);
      if (!range) {
        continue;
      }

      const key = makePreviewKey(range.fromIndex, range.toIndex, comparisonSource);
      if (previewByRange[key] || inFlightKey === key) {
        continue;
      }

      requests.push({
        key,
        fromIndex: range.fromIndex,
        toIndex: range.toIndex,
        comparisonSource,
      });

      if (requests.length >= limit) {
        break;
      }
    }

    return requests;
  }

  return {
    getEntriesForSource,
    getPendingSnapshotRevisionIndexes,
    getTimelineAnchorPercent,
    getSelectedEntryCount,
    getSidebarPreviewRequests,
    getUnitPreviewRange,
  };
});
