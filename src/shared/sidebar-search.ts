import type { FileRevisionEntry } from './timeline-types.ts';

export type SidebarSearchField = 'path' | 'author' | 'desc' | 'date' | 'revset' | 'text';

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

function entryFields(entry: FileRevisionEntry): Record<SidebarSearchField, string[]> {
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

function matchAtom(entry: FileRevisionEntry, atom: SidebarSearchAtom): boolean {
	if (!atom.value) {
		return !atom.negated;
	}
	const fields = entryFields(entry)[atom.field];
	const matched = fields.some((value) => includesInsensitive(value, atom.value));
	return atom.negated ? !matched : matched;
}

export function matchSidebarSearchNode(entry: FileRevisionEntry, node: SidebarSearchNode): boolean {
	if (node.kind === 'atom') {
		return matchAtom(entry, node);
	}
	if (node.op === 'and') {
		return node.children.every((child) => matchSidebarSearchNode(entry, child));
	}
	return node.children.some((child) => matchSidebarSearchNode(entry, child));
}

export function filterEntriesBySidebarSearch(
	entries: Array<FileRevisionEntry>,
	query: string,
): Array<FileRevisionEntry> {
	const node = parseSidebarSearchQuery(query);
	if (!node) {
		return entries;
	}
	return entries.filter((entry) => matchSidebarSearchNode(entry, node));
}
