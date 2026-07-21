import type { DiffPreview } from './timeline-types.ts';

export const RANGE_STACK_MAX_FILES = 5;

export function pickRangeStackPaths(
	items: Array<{ relativePath: string; changeCount: number; isCurrentFile?: boolean }>,
	currentRelativePath: string,
	limit = RANGE_STACK_MAX_FILES,
): string[] {
	const ranked = [...items].toSorted((left, right) => {
		const leftCurrent = left.isCurrentFile === true || left.relativePath === currentRelativePath;
		const rightCurrent = right.isCurrentFile === true || right.relativePath === currentRelativePath;
		if (leftCurrent !== rightCurrent) {
			return Number(rightCurrent) - Number(leftCurrent);
		}
		if (left.changeCount !== right.changeCount) {
			return right.changeCount - left.changeCount;
		}
		return left.relativePath.localeCompare(right.relativePath);
	});
	const paths = ranked.map((item) => item.relativePath).filter(Boolean);
	if (currentRelativePath && !paths.includes(currentRelativePath)) {
		paths.unshift(currentRelativePath);
	}
	return [...new Set(paths)].slice(0, limit);
}

export function rangeStackPreviewKey(relativePath: string, fromIndex: number, toIndex: number): string {
	return `${relativePath}:${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`;
}

export type RangeStackPreviewItem = {
	relativePath: string;
	preview: DiffPreview;
};
