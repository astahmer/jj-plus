import { textsMatchIgnoringLineEndings } from './diff-helpers.ts';

export type DiffStats = {
	additions: number;
	deletions: number;
	hunkCount: number;
	hasChanges: boolean;
};

type DiffOperation = { type: 'context' | 'add' | 'remove'; text: string };

export function computeDiffStats(beforeText: string, afterText: string): DiffStats {
	if (textsMatchIgnoringLineEndings(beforeText, afterText)) {
		return { additions: 0, deletions: 0, hunkCount: 0, hasChanges: false };
	}

	const operations = diffLineOperations({
		beforeLines: splitIntoLines(beforeText),
		afterLines: splitIntoLines(afterText),
	});
	const additions = operations.filter((operation) => operation.type === 'add').length;
	const deletions = operations.filter((operation) => operation.type === 'remove').length;
	return {
		additions,
		deletions,
		hunkCount: countDiffHunks(operations),
		hasChanges: additions > 0 || deletions > 0,
	};
}

function countDiffHunks(operations: DiffOperation[]): number {
	let hunks = 0;
	let inChange = false;

	for (const operation of operations) {
		const isChange = operation.type === 'add' || operation.type === 'remove';
		if (isChange && !inChange) {
			hunks += 1;
			inChange = true;
			continue;
		}

		if (!isChange) {
			inChange = false;
		}
	}

	return hunks;
}

function splitIntoLines(value: string): string[] {
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

function diffLineOperations(args: { beforeLines: string[]; afterLines: string[] }): DiffOperation[] {
	if (!args.beforeLines.length) {
		return args.afterLines.map((text) => ({ type: 'add' as const, text }));
	}

	if (!args.afterLines.length) {
		return args.beforeLines.map((text) => ({ type: 'remove' as const, text }));
	}

	if (args.beforeLines.length * args.afterLines.length > 1_200_000) {
		return buildFallbackOperations(args);
	}

	const matrix = Array.from({ length: args.beforeLines.length + 1 }, () => new Uint32Array(args.afterLines.length + 1));

	for (let leftIndex = args.beforeLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
		for (let rightIndex = args.afterLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
			matrix[leftIndex][rightIndex] =
				args.beforeLines[leftIndex] === args.afterLines[rightIndex]
					? matrix[leftIndex + 1][rightIndex + 1] + 1
					: Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
		}
	}

	const operations: DiffOperation[] = [];
	let leftIndex = 0;
	let rightIndex = 0;

	while (leftIndex < args.beforeLines.length && rightIndex < args.afterLines.length) {
		if (args.beforeLines[leftIndex] === args.afterLines[rightIndex]) {
			operations.push({ type: 'context', text: args.beforeLines[leftIndex] });
			leftIndex += 1;
			rightIndex += 1;
			continue;
		}

		if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
			operations.push({ type: 'remove', text: args.beforeLines[leftIndex] });
			leftIndex += 1;
			continue;
		}

		operations.push({ type: 'add', text: args.afterLines[rightIndex] });
		rightIndex += 1;
	}

	while (leftIndex < args.beforeLines.length) {
		operations.push({ type: 'remove', text: args.beforeLines[leftIndex] });
		leftIndex += 1;
	}

	while (rightIndex < args.afterLines.length) {
		operations.push({ type: 'add', text: args.afterLines[rightIndex] });
		rightIndex += 1;
	}

	return operations;
}

function buildFallbackOperations(args: { beforeLines: string[]; afterLines: string[] }): DiffOperation[] {
	const operations: DiffOperation[] = [];
	let prefix = 0;
	while (
		prefix < args.beforeLines.length &&
		prefix < args.afterLines.length &&
		args.beforeLines[prefix] === args.afterLines[prefix]
	) {
		prefix += 1;
	}

	let beforeSuffix = args.beforeLines.length - 1;
	let afterSuffix = args.afterLines.length - 1;
	while (
		beforeSuffix >= prefix &&
		afterSuffix >= prefix &&
		args.beforeLines[beforeSuffix] === args.afterLines[afterSuffix]
	) {
		beforeSuffix -= 1;
		afterSuffix -= 1;
	}

	for (const text of args.beforeLines.slice(0, prefix)) {
		operations.push({ type: 'context', text });
	}
	for (const text of args.beforeLines.slice(prefix, beforeSuffix + 1)) {
		operations.push({ type: 'remove', text });
	}
	for (const text of args.afterLines.slice(prefix, afterSuffix + 1)) {
		operations.push({ type: 'add', text });
	}
	for (const text of args.beforeLines.slice(beforeSuffix + 1)) {
		operations.push({ type: 'context', text });
	}

	return operations;
}
