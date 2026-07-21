/**
 * Common jj revset chips / compare targets.
 * Prefer built-ins + widely useful aliases (closest_bookmark, slice, tip, …).
 * Avoid fileset-confused / version-fragile helpers like tags() / heads(all()).
 */

export type RevsetSuggestion = { label: string; revset: string };

/** Single-revision targets for “compare file with …” quick picks. */
export const JJ_COMPARE_TARGET_SUGGESTIONS: ReadonlyArray<RevsetSuggestion> = [
	{ label: 'Parent', revset: '@-' },
	{ label: 'Trunk', revset: 'trunk()' },
	{ label: 'Closest bookmark', revset: 'closest_bookmark(@)' },
	{ label: 'Closest pushable', revset: 'closest_pushable(@)' },
	{ label: 'Tip', revset: 'tip' },
	{ label: 'Latest', revset: 'latest' },
	{ label: 'main@origin', revset: 'main@origin' },
];

/** Timeline View-menu revset filter chips (ranges + filters OK). */
export const JJ_TIMELINE_REVSET_SUGGESTIONS: ReadonlyArray<RevsetSuggestion> = [
	{ label: 'vs bookmark', revset: 'trunk()..closest_bookmark(@)' },
	{ label: 'vs pushable', revset: 'trunk()..closest_pushable(@)' },
	{ label: 'Slice', revset: 'slice()' },
	{ label: 'Tip', revset: 'tip' },
	{ label: 'Latest', revset: 'latest' },
	{ label: 'Mine', revset: 'mine()' },
	{ label: 'Bookmarks', revset: 'bookmarks()' },
	{ label: 'Remote bookmarks', revset: 'remote_bookmarks()' },
	{ label: 'Branch start', revset: 'branch_start(@)' },
	{ label: 'Trunk…@', revset: 'trunk()..@' },
	{ label: 'Mutable', revset: 'mutable()' },
	{ label: 'Immutable', revset: 'immutable()' },
	{ label: 'Conflicts', revset: 'conflicts()' },
	{ label: 'Empty', revset: 'empty()' },
	{ label: 'Ancestors', revset: 'ancestors(@)' },
];

export function mergeCompareQuickPickValues(bookmarkNames: ReadonlyArray<string>): string[] {
	const seeded = JJ_COMPARE_TARGET_SUGGESTIONS.map((entry) => entry.revset);
	return [...new Set([...seeded, ...bookmarkNames.map((name) => name.trim()).filter(Boolean)])];
}
