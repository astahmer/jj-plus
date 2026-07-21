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

export function formatFilePathTrail(steps: PathTrailStep[]): string {
	if (steps.length <= 1) {
		return steps[0]?.relativePath || '';
	}
	return steps.map((step) => step.relativePath).join(' → ');
}

export function pathTrailChanged(steps: PathTrailStep[]): boolean {
	return steps.length > 1;
}
