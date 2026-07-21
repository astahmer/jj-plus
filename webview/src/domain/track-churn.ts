export type TrackChurnSample = {
	entryIndex: number;
	churn: number;
};

export type TrackChurnBar = {
	entryIndex: number;
	/** 0–1 normalized height factor for the track anchor stem. */
	heightFactor: number;
	churn: number;
};

export function normalizeTrackChurnBars(
	samples: TrackChurnSample[],
	options?: { minFactor?: number; maxFactor?: number },
): TrackChurnBar[] {
	const minFactor = options?.minFactor ?? 0.2;
	const maxFactor = options?.maxFactor ?? 1;
	const peak = samples.reduce((max, sample) => Math.max(max, sample.churn), 0);
	if (peak <= 0) {
		return samples.map((sample) => ({
			entryIndex: sample.entryIndex,
			churn: sample.churn,
			heightFactor: minFactor,
		}));
	}

	return samples.map((sample) => {
		const ratio = sample.churn / peak;
		const heightFactor = minFactor + ratio * (maxFactor - minFactor);
		return {
			entryIndex: sample.entryIndex,
			churn: sample.churn,
			heightFactor,
		};
	});
}

export function churnFromDiffCount(diffCount: number | undefined): number {
	if (!diffCount || diffCount < 0) {
		return 0;
	}
	return diffCount;
}
