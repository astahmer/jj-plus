import type { Html } from 'foldkit/html';
import { html } from 'foldkit/html';
import type { FileRevisionEntry } from '../types.ts';

export function getRevisionIdentifierValue(
	entry: Pick<FileRevisionEntry, 'shortRevision' | 'changeId' | 'revision' | 'isWorkingTree'>,
): string {
	if (entry.isWorkingTree || !entry.changeId) {
		return entry.shortRevision;
	}
	if (entry.shortRevision === entry.changeId && entry.revision) {
		return `${entry.changeId}/${entry.revision.slice(0, 8)}`;
	}
	return entry.shortRevision;
}

export function revisionIdentifier<Message>(value: string, highlightPrefix?: string, plain?: boolean): Html {
	const h = html<Message>();
	const text = value || '';

	if (plain) {
		return h.span([h.Class('identifier')], [h.span([h.Class('identifier-plain')], [text])]);
	}

	if (!highlightPrefix || !text.startsWith(highlightPrefix)) {
		return h.span([h.Class('identifier')], [h.span([h.Class('identifier-prefix')], [text])]);
	}

	return h.span(
		[h.Class('identifier')],
		[
			h.span([h.Class('identifier-prefix')], [highlightPrefix]),
			h.span([h.Class('identifier-suffix')], [text.slice(highlightPrefix.length)]),
		],
	);
}
