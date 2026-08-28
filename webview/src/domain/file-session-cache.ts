import type { Model } from '../model.ts';
import type {
	ComparisonMode,
	ComparisonSource,
	ContentMode,
	DiffPreview,
	LayoutMode,
	RangeOverviewItem,
	TimelineData,
	TimelinePreset,
} from '../types.ts';

export type FileSessionSnapshot = {
	data: TimelineData;
	previewByRange: Record<string, DiffPreview>;
	rangeOverviewByRange: Record<string, Array<RangeOverviewItem>>;
	entryDiffCountByKey: Record<string, number>;
	fromIndex: number;
	toIndex: number;
	comparisonMode: ComparisonMode;
	comparisonSource: ComparisonSource;
	layoutMode: LayoutMode;
	contentMode: ContentMode;
	preset: TimelinePreset;
	showIntermediateRevisions: boolean;
	customRevset: string;
	fileInputValue: string;
	oldestFirst: boolean;
};

export function snapshotFileSession(model: Model): FileSessionSnapshot | null {
	const data = model.data as TimelineData | null;
	if (!data?.relativePath) {
		return null;
	}
	return {
		data,
		previewByRange: { ...(model.previewByRange as Record<string, DiffPreview>) },
		rangeOverviewByRange: {
			...(model.rangeOverviewByRange as Record<string, Array<RangeOverviewItem>>),
		},
		entryDiffCountByKey: { ...(model.entryDiffCountByKey as Record<string, number>) },
		fromIndex: model.fromIndex,
		toIndex: model.toIndex,
		comparisonMode: model.comparisonMode,
		comparisonSource: model.comparisonSource,
		layoutMode: model.layoutMode,
		contentMode: model.contentMode,
		preset: model.preset,
		showIntermediateRevisions: model.showIntermediateRevisions,
		customRevset: model.customRevset,
		fileInputValue: model.fileInputValue || data.relativePath,
		oldestFirst: model.oldestFirst,
	};
}

export function rememberFileSession(
	cache: Record<string, FileSessionSnapshot>,
	model: Model,
): Record<string, FileSessionSnapshot> {
	const snapshot = snapshotFileSession(model);
	if (!snapshot) {
		return cache;
	}
	return {
		...cache,
		[snapshot.data.relativePath]: snapshot,
	};
}

export function readCachedFileSession(
	cache: Record<string, FileSessionSnapshot>,
	relativePath: string,
): FileSessionSnapshot | null {
	return cache[relativePath] || null;
}

export function mergePreviewCaches(
	cached: Record<string, DiffPreview> | undefined,
	incoming: Record<string, DiffPreview> | undefined,
): Record<string, DiffPreview> {
	return {
		...cached,
		...incoming,
	};
}
