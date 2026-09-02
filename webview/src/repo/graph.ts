import type { RepoRevisionEntry } from './types.ts';

export type CompactGraphRow = {
	entry: RepoRevisionEntry;
	lane: number;
	lanes: string[];
};

export function buildCompactGraphRows(entries: RepoRevisionEntry[]): CompactGraphRow[] {
	const activeLanes: string[] = [];
	return entries.map((entry) => {
		let lane = activeLanes.indexOf(entry.revision);
		if (lane < 0) {
			activeLanes.unshift(entry.revision);
			lane = 0;
		}

		const lanes = [...activeLanes];
		const parents = (entry.parentRevisionIds || []).filter(Boolean);
		activeLanes.splice(lane, 1);
		for (const parent of parents.toReversed()) {
			const existingLane = activeLanes.indexOf(parent);
			if (existingLane >= 0) activeLanes.splice(existingLane, 1);
			activeLanes.splice(lane, 0, parent);
		}

		return { entry, lane, lanes };
	});
}
