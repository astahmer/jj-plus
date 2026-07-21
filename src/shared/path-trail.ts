import type { FileRevisionEntry } from './timeline-types.ts';

export type PathTrailStep = {
	relativePath: string;
	fromIndex: number;
	toIndex: number;
};

/** Collapse consecutive same paths into trail segments (oldest → newest). */
export function buildFilePathTrail(
	entries: Array<Pick<FileRevisionEntry, 'filePath' | 'index'> & { relativePathFallback?: string }>,
	fallbackRelativePath: string,
): PathTrailStep[] {
	const steps: PathTrailStep[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const relativePath = entry.filePath || entry.relativePathFallback || fallbackRelativePath;
		const entryIndex = entry.index ?? index;
		const previous = steps.at(-1);
		if (previous && previous.relativePath === relativePath) {
			previous.toIndex = entryIndex;
			continue;
		}
		steps.push({ relativePath, fromIndex: entryIndex, toIndex: entryIndex });
	}
	return steps;
}

/** Full consecutive trail (may ping-pong on renames). */
export function formatFilePathTrailFull(steps: PathTrailStep[]): string {
	if (steps.length <= 1) {
		return steps[0]?.relativePath || '';
	}
	return steps.map((step) => step.relativePath).join(' → ');
}

/**
 * Display trail: unique paths in first-seen order.
 * Collapses rename ping-pong (a→b→a→b) to `a → b` so the title stays readable.
 */
export function formatFilePathTrail(steps: PathTrailStep[]): string {
	if (steps.length <= 1) {
		return steps[0]?.relativePath || '';
	}
	const unique: string[] = [];
	for (const step of steps) {
		if (!unique.includes(step.relativePath)) {
			unique.push(step.relativePath);
		}
	}
	return unique.join(' → ');
}

export function pathTrailChanged(steps: PathTrailStep[]): boolean {
	return steps.length > 1;
}
