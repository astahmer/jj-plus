import { textsMatchIgnoringLineEndings } from './diff-helpers.ts';

export type NonTextualDetailArgs = {
	beforeText: string;
	afterText: string;
	beforePath: string;
	afterPath: string;
	isWorkingTree?: boolean;
	/** Optional file modes from git/jj (e.g. 100644 / 100755). */
	beforeMode?: string;
	afterMode?: string;
};

function stripAllWhitespace(value: string): string {
	return value.replace(/\s+/gu, '');
}

function textsMatchIgnoringWhitespace(beforeText: string, afterText: string): boolean {
	return stripAllWhitespace(beforeText) === stripAllWhitespace(afterText);
}

function looksBinary(text: string): boolean {
	return text.includes('\u0000');
}

/**
 * Explain why a selection has no textual line diff worth rendering in Pierre.
 * Always returns at least one human-readable reason when called for an empty preview.
 */
export function buildNonTextualDetails(args: NonTextualDetailArgs): string[] {
	const details: string[] = [];
	const before = args.beforeText ?? '';
	const after = args.afterText ?? '';
	const beforePath = args.beforePath || '';
	const afterPath = args.afterPath || '';

	if (beforePath && afterPath && beforePath !== afterPath) {
		details.push(`Path changed: ${beforePath} -> ${afterPath}`);
	}

	if (args.beforeMode && args.afterMode && args.beforeMode !== args.afterMode) {
		details.push(`File mode changed: ${args.beforeMode} -> ${args.afterMode}`);
	}

	if (!before && !after) {
		details.push('Both sides are empty for this path.');
		return details;
	}

	if (looksBinary(before) || looksBinary(after)) {
		details.push('Binary (or null-byte) content changed; inline text diff is skipped.');
		return details;
	}

	if (before !== after && textsMatchIgnoringLineEndings(before, after)) {
		details.push('Line endings changed.');
	}

	if (
		before !== after &&
		!textsMatchIgnoringLineEndings(before, after) &&
		textsMatchIgnoringWhitespace(before, after)
	) {
		details.push('Whitespace-only changes.');
	}

	if (!before && after) {
		details.push('File appeared (empty before, content after) but no line hunks were produced.');
	} else if (before && !after) {
		details.push('File disappeared (content before, empty after) but no line hunks were produced.');
	}

	if (!details.length && args.isWorkingTree) {
		details.push('The working tree differs in a way this preview does not render as a textual line diff.');
	}

	if (!details.length) {
		details.push(
			'This selection changed file metadata or another non-text detail that is not shown in the inline preview.',
		);
	}

	return details;
}
