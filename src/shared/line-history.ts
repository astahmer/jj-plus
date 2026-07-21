import { textsMatchIgnoringLineEndings } from './diff-helpers.ts';

export type LineHistoryRange = {
	startLine: number;
	endLine: number;
};

export function normalizeLineHistoryRange(startLine: number, endLine: number): LineHistoryRange | null {
	if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
		return null;
	}
	const start = Math.max(1, Math.floor(Math.min(startLine, endLine)));
	const end = Math.max(1, Math.floor(Math.max(startLine, endLine)));
	return { startLine: start, endLine: end };
}

export function formatLineHistoryLabel(range: LineHistoryRange): string {
	if (range.startLine === range.endLine) {
		return `Line ${range.startLine}`;
	}
	return `Lines ${range.startLine}–${range.endLine}`;
}

export function formatStatusBarLineHistoryChip(range: LineHistoryRange): string {
	if (range.startLine === range.endLine) {
		return `JJ Timeline L${range.startLine}`;
	}
	return `JJ Timeline L${range.startLine}–${range.endLine}`;
}

export function splitTextIntoLines(value: string): string[] {
	if (!value) {
		return [];
	}
	const normalized = value.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	if (lines.at(-1) === '') {
		lines.pop();
	}
	return lines;
}

/**
 * True when the diff between before/after changes any line whose
 * before-file or after-file line number falls in the inclusive 1-based range.
 */
export function diffTouchesLineRange(args: {
	beforeText: string;
	afterText: string;
	range: LineHistoryRange;
}): boolean {
	if (textsMatchIgnoringLineEndings(args.beforeText, args.afterText)) {
		return false;
	}

	const beforeLines = splitTextIntoLines(args.beforeText);
	const afterLines = splitTextIntoLines(args.afterText);

	if (!beforeLines.length && afterLines.length) {
		return lineRangeOverlaps(1, afterLines.length, args.range);
	}
	if (beforeLines.length && !afterLines.length) {
		return lineRangeOverlaps(1, beforeLines.length, args.range);
	}

	let beforeLine = 1;
	let afterLine = 1;
	const operations = buildLineOperations(beforeLines, afterLines);

	for (const operation of operations) {
		if (operation.type === 'context') {
			beforeLine += 1;
			afterLine += 1;
			continue;
		}
		if (operation.type === 'remove') {
			if (lineInRange(beforeLine, args.range)) {
				return true;
			}
			beforeLine += 1;
			continue;
		}
		if (lineInRange(afterLine, args.range)) {
			return true;
		}
		afterLine += 1;
	}

	return false;
}

export function filterEntriesTouchingLineRange<T extends { revision: string; isWorkingTree?: boolean }>(args: {
	entries: T[];
	range: LineHistoryRange;
	getContent: (entry: T) => string;
}): T[] {
	if (args.entries.length <= 1) {
		return [...args.entries];
	}

	const kept: T[] = [];
	for (let index = 1; index < args.entries.length; index += 1) {
		const previous = args.entries[index - 1];
		const entry = args.entries[index];
		if (
			diffTouchesLineRange({
				beforeText: args.getContent(previous),
				afterText: args.getContent(entry),
				range: args.range,
			})
		) {
			kept.push(entry);
		}
	}

	if (!kept.length) {
		const tip = args.entries.at(-1);
		return tip ? [tip] : [];
	}

	const tip = args.entries.at(-1);
	if (tip && kept.at(-1) !== tip) {
		kept.push(tip);
	}

	return kept;
}

/** Parse `git log -L` / `--format=%H` style stdout into ordered oldest→newest hashes. */
export function parseGitLineHistoryRevisions(stdout: string): string[] {
	return stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => /^[0-9a-f]{7,40}$/i.test(line))
		.toReversed();
}

export function buildGitLineHistoryArgs(args: {
	relativePath: string;
	range: LineHistoryRange;
	limit?: number;
}): string[] {
	return [
		'log',
		'--follow',
		`-L${args.range.startLine},${args.range.endLine}:${args.relativePath}`,
		'--date=iso-strict',
		'--format=%H',
		`--max-count=${args.limit ?? 200}`,
	];
}

function lineInRange(line: number, range: LineHistoryRange): boolean {
	return line >= range.startLine && line <= range.endLine;
}

function lineRangeOverlaps(start: number, end: number, range: LineHistoryRange): boolean {
	return start <= range.endLine && end >= range.startLine;
}

type LineOp = { type: 'context' | 'add' | 'remove'; text: string };

function buildLineOperations(beforeLines: string[], afterLines: string[]): LineOp[] {
	if (!beforeLines.length) {
		return afterLines.map((text) => ({ type: 'add' as const, text }));
	}
	if (!afterLines.length) {
		return beforeLines.map((text) => ({ type: 'remove' as const, text }));
	}
	if (beforeLines.length * afterLines.length > 1_200_000) {
		return buildFallbackLineOperations(beforeLines, afterLines);
	}

	const matrix = Array.from({ length: beforeLines.length + 1 }, () => new Uint32Array(afterLines.length + 1));
	for (let leftIndex = beforeLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
		for (let rightIndex = afterLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
			matrix[leftIndex][rightIndex] =
				beforeLines[leftIndex] === afterLines[rightIndex]
					? matrix[leftIndex + 1][rightIndex + 1] + 1
					: Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
		}
	}

	const operations: LineOp[] = [];
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < beforeLines.length && rightIndex < afterLines.length) {
		if (beforeLines[leftIndex] === afterLines[rightIndex]) {
			operations.push({ type: 'context', text: beforeLines[leftIndex] });
			leftIndex += 1;
			rightIndex += 1;
			continue;
		}
		if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
			operations.push({ type: 'remove', text: beforeLines[leftIndex] });
			leftIndex += 1;
			continue;
		}
		operations.push({ type: 'add', text: afterLines[rightIndex] });
		rightIndex += 1;
	}
	while (leftIndex < beforeLines.length) {
		operations.push({ type: 'remove', text: beforeLines[leftIndex] });
		leftIndex += 1;
	}
	while (rightIndex < afterLines.length) {
		operations.push({ type: 'add', text: afterLines[rightIndex] });
		rightIndex += 1;
	}
	return operations;
}

function buildFallbackLineOperations(beforeLines: string[], afterLines: string[]): LineOp[] {
	const operations: LineOp[] = [];
	let prefix = 0;
	while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
		prefix += 1;
	}
	let beforeSuffix = beforeLines.length - 1;
	let afterSuffix = afterLines.length - 1;
	while (beforeSuffix >= prefix && afterSuffix >= prefix && beforeLines[beforeSuffix] === afterLines[afterSuffix]) {
		beforeSuffix -= 1;
		afterSuffix -= 1;
	}
	for (const text of beforeLines.slice(0, prefix)) {
		operations.push({ type: 'context', text });
	}
	for (const text of beforeLines.slice(prefix, beforeSuffix + 1)) {
		operations.push({ type: 'remove', text });
	}
	for (const text of afterLines.slice(prefix, afterSuffix + 1)) {
		operations.push({ type: 'add', text });
	}
	for (const text of beforeLines.slice(beforeSuffix + 1)) {
		operations.push({ type: 'context', text });
	}
	return operations;
}
