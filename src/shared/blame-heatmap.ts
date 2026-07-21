import type { BlameLine } from './blame.ts';

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Map blame author timestamps onto 0..4 heat (4 = newest in the set).
 * Lines without timestamps get 0.
 */
export function computeBlameHeatLevels(
	lines: ReadonlyArray<Pick<BlameLine, 'line' | 'authorTimestamp'>>,
	nowMs = Date.now(),
): Map<number, HeatLevel> {
	const withTime = lines.filter(
		(line): line is typeof line & { authorTimestamp: number } =>
			typeof line.authorTimestamp === 'number' && Number.isFinite(line.authorTimestamp),
	);
	const result = new Map<number, HeatLevel>();
	if (!withTime.length) {
		for (const line of lines) {
			result.set(line.line, 0);
		}
		return result;
	}

	const timestamps = withTime.map((line) => line.authorTimestamp);
	const minTs = Math.min(...timestamps);
	const maxTs = Math.max(...timestamps);
	const span = Math.max(1, maxTs - minTs);
	const nowSec = Math.floor(nowMs / 1000);

	for (const line of lines) {
		const ts = line.authorTimestamp;
		if (typeof ts !== 'number' || !Number.isFinite(ts)) {
			result.set(line.line, 0);
			continue;
		}
		// Prefer relative recency within the blamed file; clamp future timestamps.
		const clamped = Math.min(ts, nowSec);
		const ratio = (clamped - minTs) / span;
		const level = Math.max(0, Math.min(4, Math.round(ratio * 4))) as HeatLevel;
		result.set(line.line, level);
	}
	return result;
}

export function heatLevelClass(level: HeatLevel): string {
	return `pierre-heat pierre-heat--${level}`;
}
