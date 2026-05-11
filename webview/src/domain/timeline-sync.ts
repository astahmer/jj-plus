import type {
	ComparisonMode,
	ComparisonSource,
	DiffPreview,
	FileRevisionEntry,
	RangeOverviewItem,
	TimelineData,
} from '../types.ts';
import { getSidebarPreviewRequests } from './timeline-model.ts';
import { buildEntryDiffCountKey, normalizeSelection } from './timeline-selection.ts';

export type TimelineSyncPlan = {
	normalizedSelection?: { fromIndex: number; toIndex: number };
	previewRequest?: { fromIndex: number; toIndex: number; comparisonSource: ComparisonSource };
	rangeOverviewRequest?: {
		fromIndex: number;
		toIndex: number;
		comparisonSource: ComparisonSource;
		selectedEntryIndexes: Array<number>;
	};
	entryDiffCountsRequest?: { entryIndexes: Array<number>; comparisonSource: ComparisonSource };
	snapshotHydrationRequest?: { revisionIndexes: Array<number> };
	sidebarPreviewRequest?: {
		key: string;
		fromIndex: number;
		toIndex: number;
		comparisonSource: ComparisonSource;
	};
};

export function buildTimelineSyncPlan(args: {
	ready: boolean;
	data: TimelineData | null;
	visibleEntries: Array<FileRevisionEntry>;
	filteredSidebarEntries: Array<FileRevisionEntry>;
	fromIndex: number;
	toIndex: number;
	comparisonMode: ComparisonMode;
	comparisonSource: ComparisonSource;
	activePreviewKey: string;
	previewByRange: Record<string, DiffPreview>;
	activeRangeOverviewKey: string;
	rangeOverviewByRange: Record<string, Array<RangeOverviewItem>>;
	rangeOverviewLoadingKey: string;
	selectedEntryIndexes: Array<number>;
	entryDiffCountByKey: Record<string, number>;
	entryDiffCountLoadingKey: string;
	pendingSnapshotRevisionIndexes: Array<number>;
	sidebarPreviewInFlightKey: string;
}): TimelineSyncPlan {
	const plan: TimelineSyncPlan = {};
	if (!args.ready || !args.data) {
		return plan;
	}

	if (args.visibleEntries.length >= 2) {
		const [fromIndex, toIndex] = normalizeSelection(
			args.visibleEntries,
			args.fromIndex,
			args.toIndex,
			args.comparisonMode,
		);
		if (fromIndex !== args.fromIndex || toIndex !== args.toIndex) {
			return {
				normalizedSelection: { fromIndex, toIndex },
			};
		}

		if (!args.previewByRange[args.activePreviewKey]) {
			plan.previewRequest = {
				fromIndex,
				toIndex,
				comparisonSource: args.comparisonSource,
			};
		}

		if (
			args.rangeOverviewLoadingKey !== args.activeRangeOverviewKey &&
			!args.rangeOverviewByRange[args.activeRangeOverviewKey]
		) {
			plan.rangeOverviewRequest = {
				fromIndex,
				toIndex,
				comparisonSource: args.comparisonSource,
				selectedEntryIndexes: args.selectedEntryIndexes,
			};
		}
	}

	if (
		args.data.backend === 'jj' &&
		args.comparisonSource === 'snapshot' &&
		args.pendingSnapshotRevisionIndexes.length
	) {
		plan.snapshotHydrationRequest = { revisionIndexes: args.pendingSnapshotRevisionIndexes };
	}

	const pauseBackgroundRequests =
		args.data.backend === 'jj' &&
		args.comparisonSource === 'snapshot' &&
		args.pendingSnapshotRevisionIndexes.length > 0;

	if (!pauseBackgroundRequests && !args.entryDiffCountLoadingKey && args.filteredSidebarEntries.length) {
		const entryIndexes = args.filteredSidebarEntries
			.filter((entry) => entry.hasPreviousEntry)
			.map((entry) => entry.index)
			.filter(
				(entryIndex) =>
					args.entryDiffCountByKey[buildEntryDiffCountKey(entryIndex, args.comparisonSource)] === undefined,
			)
			.slice(0, 24);

		if (entryIndexes.length) {
			plan.entryDiffCountsRequest = {
				entryIndexes,
				comparisonSource: args.comparisonSource,
			};
		}
	}

	if (!pauseBackgroundRequests && args.visibleEntries.length >= 2 && !args.sidebarPreviewInFlightKey) {
		const [nextRequest] = getSidebarPreviewRequests(
			args.visibleEntries,
			args.comparisonSource,
			args.previewByRange,
			args.activePreviewKey,
			(fromIndex, toIndex, comparisonSource) =>
				`${comparisonSource}:${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`,
		).toSorted((left, right) => Math.abs(left.toIndex - args.toIndex) - Math.abs(right.toIndex - args.toIndex));

		if (nextRequest) {
			plan.sidebarPreviewRequest = nextRequest;
		}
	}

	return plan;
}
