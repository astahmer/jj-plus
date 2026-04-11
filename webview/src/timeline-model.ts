import type { ComparisonSource, FileRevisionEntry, TimelineData } from './types';

export function getEntriesForSource(data: TimelineData | null, comparisonSource: ComparisonSource): FileRevisionEntry[] {
  if (!data) {
    return [];
  }

  if (data.backend === 'jj' && comparisonSource === 'snapshot') {
    const revisionEntries = Array.isArray(data.entries) ? data.entries : [];
    const snapshotEntries = Array.isArray(data.snapshotEntries) ? data.snapshotEntries : [];
    const loadedChangeIds = new Set(Array.isArray(data.snapshotState?.loadedChangeIds) ? data.snapshotState.loadedChangeIds : []);

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
    }, new Map<string, FileRevisionEntry[]>());

    return revisionEntries.flatMap((entry) => {
      if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile || !loadedChangeIds.has(entry.changeId)) {
        return [entry];
      }
      return snapshotEntriesByChangeId.get(entry.changeId) || [entry];
    }).map((entry, index) => ({ ...entry, index }));
  }

  return Array.isArray(data.entries) ? data.entries : [];
}

export function getSelectedEntryCount(visibleEntries: FileRevisionEntry[], fromIndex: number, toIndex: number): number {
  const minIndex = Math.min(fromIndex, toIndex);
  const maxIndex = Math.max(fromIndex, toIndex);
  return visibleEntries.filter((entry) => entry.index >= minIndex && entry.index <= maxIndex).length;
}

export function getTimelineAnchorPercent(visibleEntries: FileRevisionEntry[], visibleIndex: number): number {
  if (!visibleEntries.length) {
    return 0;
  }

  const denominator = Math.max(1, visibleEntries.length - 1);
  return (Math.min(Math.max(visibleIndex, 0), visibleEntries.length - 1) / denominator) * 100;
}

export function getPendingSnapshotRevisionIndexes(
  revisionEntries: FileRevisionEntry[],
  loadedChangeIds: Set<string>,
  limit: number,
  preferredIndexes: number[] = []
): number[] {
  const preferredIndexSet = new Set(preferredIndexes);
  const seenChangeIds = new Set<string>();
  const orderedEntries = [
    ...revisionEntries.filter((entry) => preferredIndexSet.has(entry.index)),
    ...revisionEntries,
  ];

  return orderedEntries.reduce<number[]>((indexes, entry) => {
    if (
      !entry.touchesFile
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
  }, []).slice(0, limit);
}
