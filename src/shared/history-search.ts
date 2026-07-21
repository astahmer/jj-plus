import { diffHunkContainsNeedle } from './diff-content-search.ts';

export type HistorySearchHit = {
	entryIndex: number;
	kind: 'introduced' | 'removed' | 'present';
};

export type HistorySearchResult = {
	query: string;
	hits: HistorySearchHit[];
	introducedAt: number | null;
	removedAt: number | null;
	purpose?: 'history' | 'sidebar';
};

export function normalizeHistorySearchQuery(query: string): string {
	return query.trim();
}

/**
 * Walk oldest→newest file contents and classify when `query` first appears / last disappears.
 * `contentsByIndex` maps absolute entry index → file text at that stop.
 */
export function searchHistoryContents(args: {
	query: string;
	orderedEntryIndexes: number[];
	contentsByIndex: Map<number, string>;
}): HistorySearchResult {
	const query = normalizeHistorySearchQuery(args.query);
	const hits: HistorySearchHit[] = [];
	let introducedAt: number | null = null;
	let removedAt: number | null = null;
	if (!query) {
		return { query, hits, introducedAt, removedAt };
	}

	let wasPresent = false;
	for (const entryIndex of args.orderedEntryIndexes) {
		const content = args.contentsByIndex.get(entryIndex) ?? '';
		const present = content.includes(query);
		if (present) {
			hits.push({ entryIndex, kind: wasPresent ? 'present' : 'introduced' });
			if (!wasPresent) {
				introducedAt = entryIndex;
			}
		} else if (wasPresent) {
			hits.push({ entryIndex, kind: 'removed' });
			removedAt = entryIndex;
		}
		wasPresent = present;
	}

	return { query, hits, introducedAt, removedAt };
}

/**
 * Sidebar `content:` matches — only revisions whose parent→self diff hunks contain the needle.
 */
export function searchHistoryDiffContents(args: {
	query: string;
	orderedEntryIndexes: number[];
	contentsByIndex: Map<number, string>;
}): HistorySearchResult {
	const query = normalizeHistorySearchQuery(args.query);
	const hits: HistorySearchHit[] = [];
	if (!query) {
		return { query, hits, introducedAt: null, removedAt: null, purpose: 'sidebar' };
	}

	let previousContent = '';
	for (const entryIndex of args.orderedEntryIndexes) {
		const content = args.contentsByIndex.get(entryIndex) ?? '';
		if (diffHunkContainsNeedle({ before: previousContent, after: content, needle: query })) {
			hits.push({ entryIndex, kind: 'present' });
		}
		previousContent = content;
	}

	return {
		query,
		hits,
		introducedAt: hits[0]?.entryIndex ?? null,
		removedAt: null,
		purpose: 'sidebar',
	};
}
