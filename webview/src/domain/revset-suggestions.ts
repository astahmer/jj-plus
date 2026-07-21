/** Common jj revset chips for the View menu — click to fill the input. */
export const COMMON_REVSET_SUGGESTIONS: ReadonlyArray<{ label: string; revset: string }> = [
	{ label: 'All ancestors', revset: 'ancestors(@)' },
	{ label: 'Bookmarks', revset: 'bookmarks()' },
	{ label: 'Remote bookmarks', revset: 'remote_bookmarks()' },
	{ label: 'Trunk…@', revset: 'trunk()..@' },
	{ label: 'Mutable', revset: 'mutable()' },
	{ label: 'Immutable', revset: 'immutable()' },
	{ label: 'Conflicts', revset: 'conflicts()' },
	{ label: 'Empty', revset: 'empty()' },
	{ label: 'Mine', revset: 'mine()' },
	{ label: 'Description', revset: 'description(exact:"")' },
	{ label: 'Tagged', revset: 'tags()' },
	{ label: 'Heads', revset: 'heads(all())' },
];
