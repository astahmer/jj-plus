import type { FileRevisionEntry } from './timeline-types.ts';

export type SidebarSearchableEntry = Pick<
	FileRevisionEntry,
	| 'shortRevision'
	| 'revision'
	| 'changeId'
	| 'description'
	| 'authorName'
	| 'authorDate'
	| 'shortDate'
	| 'relativeDate'
	| 'monthLabel'
	| 'filePath'
	| 'operationId'
	| 'operationIndex'
	| 'operationKey'
	| 'bookmarkNames'
	| 'branchNames'
>;

export type SidebarSearchField = 'path' | 'author' | 'desc' | 'date' | 'revset' | 'content' | 'text';

export type SidebarSearchAtom = {
	kind: 'atom';
	field: SidebarSearchField;
	value: string;
	negated: boolean;
};

export type SidebarSearchGroup = {
	kind: 'group';
	op: 'and' | 'or';
	children: SidebarSearchNode[];
};

export type SidebarSearchNode = SidebarSearchAtom | SidebarSearchGroup;

const FIELD_ALIASES: Record<string, SidebarSearchField> = {
	path: 'path',
	file: 'path',
	author: 'author',
	user: 'author',
	desc: 'desc',
	description: 'desc',
	message: 'desc',
	date: 'date',
	when: 'date',
	revset: 'revset',
	rev: 'revset',
	revision: 'revset',
	change: 'revset',
	content: 'content',
	body: 'content',
};

function tokenize(query: string): string[] {
	const tokens: string[] = [];
	const pattern = /"([^"]*)"|'([^']*)'|\(|\)|\bAND\b|\bOR\b|[^\s()]+/giu;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(query))) {
		if (match[1] !== undefined) {
			tokens.push(match[1]);
			continue;
		}
		if (match[2] !== undefined) {
			tokens.push(match[2]);
			continue;
		}
		tokens.push(match[0]);
	}
	return tokens;
}

function parseAtom(token: string): SidebarSearchAtom {
	const negated = token.startsWith('-');
	const raw = negated ? token.slice(1) : token;
	const colon = raw.indexOf(':');
	if (colon > 0) {
		const fieldKey = raw.slice(0, colon).toLowerCase();
		const field = FIELD_ALIASES[fieldKey];
		if (field) {
			return {
				kind: 'atom',
				field,
				value: raw.slice(colon + 1).trim(),
				negated,
			};
		}
	}
	return {
		kind: 'atom',
		field: 'text',
		value: raw,
		negated,
	};
}

function parseOr(tokens: string[], index: { at: number }): SidebarSearchNode {
	const children: SidebarSearchNode[] = [parseAnd(tokens, index)];
	while (index.at < tokens.length && tokens[index.at]?.toUpperCase() === 'OR') {
		index.at += 1;
		children.push(parseAnd(tokens, index));
	}
	if (children.length === 1) {
		return children[0]!;
	}
	return { kind: 'group', op: 'or', children };
}

function parseAnd(tokens: string[], index: { at: number }): SidebarSearchNode {
	const children: SidebarSearchNode[] = [];
	while (index.at < tokens.length) {
		const token = tokens[index.at]!;
		const upper = token.toUpperCase();
		if (upper === 'OR' || token === ')') {
			break;
		}
		if (upper === 'AND') {
			index.at += 1;
			continue;
		}
		children.push(parsePrimary(tokens, index));
	}
	if (children.length === 0) {
		return { kind: 'atom', field: 'text', value: '', negated: false };
	}
	if (children.length === 1) {
		return children[0]!;
	}
	return { kind: 'group', op: 'and', children };
}

function parsePrimary(tokens: string[], index: { at: number }): SidebarSearchNode {
	const token = tokens[index.at];
	if (!token) {
		return { kind: 'atom', field: 'text', value: '', negated: false };
	}
	if (token === '(') {
		index.at += 1;
		const group = parseOr(tokens, index);
		if (tokens[index.at] === ')') {
			index.at += 1;
		}
		return group;
	}
	index.at += 1;
	return parseAtom(token);
}

export function parseSidebarSearchQuery(query: string): SidebarSearchNode | null {
	const trimmed = query.trim();
	if (!trimmed) {
		return null;
	}
	const tokens = tokenize(trimmed);
	if (!tokens.length) {
		return null;
	}
	return parseOr(tokens, { at: 0 });
}

function includesInsensitive(haystack: string | number | undefined | null, needle: string): boolean {
	if (!needle) {
		return true;
	}
	if (haystack === undefined || haystack === null) {
		return false;
	}
	return String(haystack).toLowerCase().includes(needle.toLowerCase());
}

function entryFields(entry: SidebarSearchableEntry): Record<Exclude<SidebarSearchField, 'content'>, string[]> {
	return {
		path: [entry.filePath || ''].filter(Boolean),
		author: [entry.authorName || ''].filter(Boolean),
		desc: [entry.description || ''].filter(Boolean),
		date: [entry.shortDate || '', entry.relativeDate || '', entry.authorDate || '', entry.monthLabel || ''].filter(
			Boolean,
		),
		revset: [
			entry.shortRevision,
			entry.revision,
			entry.changeId || '',
			entry.operationId || '',
			entry.operationKey || '',
			...(entry.bookmarkNames || []),
			...(entry.branchNames || []),
		].filter(Boolean),
		text: [
			entry.shortRevision,
			entry.description,
			entry.changeId,
			...(entry.bookmarkNames || []),
			...(entry.branchNames || []),
			entry.shortDate,
			entry.authorName,
			entry.operationId,
			entry.operationIndex,
			entry.operationKey,
			entry.monthLabel,
			entry.filePath,
			entry.revision,
		]
			.filter(Boolean)
			.map(String),
	};
}

export type SidebarSearchMatchOptions = {
	/** Entry indexes whose file contents matched the active `content:` needle(s). */
	contentMatchIndexes?: ReadonlySet<number> | ReadonlyArray<number>;
	/** Optional raw file text by entry index (unit tests / offline). */
	contentsByIndex?: ReadonlyMap<number, string> | Record<number, string>;
};

function contentHaystack(
	entry: SidebarSearchableEntry & { index?: number },
	options: SidebarSearchMatchOptions,
): string {
	const index = typeof entry.index === 'number' ? entry.index : undefined;
	if (index === undefined) {
		return '';
	}
	if (options.contentsByIndex instanceof Map) {
		return options.contentsByIndex.get(index) ?? '';
	}
	if (options.contentsByIndex) {
		return Reflect.get(options.contentsByIndex, index) ?? '';
	}
	return '';
}

function matchAtom(
	entry: SidebarSearchableEntry & { index?: number },
	atom: SidebarSearchAtom,
	options: SidebarSearchMatchOptions,
): boolean {
	if (!atom.value) {
		return !atom.negated;
	}
	if (atom.field === 'content') {
		const indexes = options.contentMatchIndexes
			? options.contentMatchIndexes instanceof Set
				? options.contentMatchIndexes
				: new Set(options.contentMatchIndexes)
			: null;
		let matched = false;
		if (indexes && typeof entry.index === 'number') {
			matched = indexes.has(entry.index);
		} else {
			matched = includesInsensitive(contentHaystack(entry, options), atom.value);
		}
		return atom.negated ? !matched : matched;
	}
	const fields = entryFields(entry)[atom.field];
	const matched = fields.some((value) => includesInsensitive(value, atom.value));
	return atom.negated ? !matched : matched;
}

export function matchSidebarSearchNode(
	entry: SidebarSearchableEntry & { index?: number },
	node: SidebarSearchNode,
	options: SidebarSearchMatchOptions = {},
): boolean {
	if (node.kind === 'atom') {
		return matchAtom(entry, node, options);
	}
	if (node.op === 'and') {
		return node.children.every((child) => matchSidebarSearchNode(entry, child, options));
	}
	return node.children.some((child) => matchSidebarSearchNode(entry, child, options));
}

export function filterEntriesBySidebarSearch<T extends SidebarSearchableEntry & { index?: number }>(
	entries: Array<T>,
	query: string,
	options: SidebarSearchMatchOptions = {},
): Array<T> {
	const node = parseSidebarSearchQuery(query);
	if (!node) {
		return entries;
	}
	return entries.filter((entry) => matchSidebarSearchNode(entry, node, options));
}

/** First non-empty `content:` needle in the query (sidebar host search). */
export function extractSidebarContentNeedle(query: string): string | null {
	const node = parseSidebarSearchQuery(query);
	if (!node) {
		return null;
	}
	const needles: string[] = [];
	const walk = (current: SidebarSearchNode) => {
		if (current.kind === 'atom') {
			if (current.field === 'content' && current.value && !current.negated) {
				needles.push(current.value);
			}
			return;
		}
		for (const child of current.children) {
			walk(child);
		}
	};
	walk(node);
	return needles[0] ?? null;
}
