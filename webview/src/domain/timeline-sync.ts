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
	sidebarPreviewRequests?: Array<{
		key: string;
		fromIndex: number;
		toIndex: number;
		comparisonSource: ComparisonSource;
	}>;
};

/** Prefetch this many step neighbors on each side of the current tip. */
export const NEIGHBOR_PREFETCH_RADIUS = 2;
/** Cap concurrent neighbor preview fetches per sync tick. Keep low so nav stays snappy. */
export const NEIGHBOR_PREFETCH_BATCH = 1;

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
	sidebarPreviewInFlightKeys: Record<string, boolean>;
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
		!args.previewByRange[args.activePreviewKey] ||
		(args.data.backend === 'jj' &&
			args.comparisonSource === 'snapshot' &&
			args.pendingSnapshotRevisionIndexes.length > 0);

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

	if (!pauseBackgroundRequests && args.visibleEntries.length >= 2) {
		const currentVisibleIndex = args.visibleEntries.findIndex((entry) => entry.index === args.toIndex);
		const requests = getSidebarPreviewRequests(
			args.visibleEntries,
			args.comparisonSource,
			args.previewByRange,
			args.activePreviewKey,
			(fromIndex, toIndex, comparisonSource) =>
				`${comparisonSource}:${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`,
		)
			.filter((request) => !args.sidebarPreviewInFlightKeys[request.key])
			.map((request) => {
				const visibleIndex = args.visibleEntries.findIndex((entry) => entry.index === request.toIndex);
				const distance =
					currentVisibleIndex < 0 || visibleIndex < 0
						? Number.POSITIVE_INFINITY
						: Math.abs(visibleIndex - currentVisibleIndex);
				return { request, distance };
			})
			.filter(({ distance }) => distance <= NEIGHBOR_PREFETCH_RADIUS)
			.toSorted((left, right) => left.distance - right.distance)
			.slice(0, NEIGHBOR_PREFETCH_BATCH)
			.map(({ request }) => request);

		if (requests.length) {
			plan.sidebarPreviewRequests = requests;
		}
	}

	return plan;
}
