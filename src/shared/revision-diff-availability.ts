export type RevisionDiffSessionLike = {
	revisions: string[];
	/** Index of the "after" / tip side currently shown. */
	tipIndex: number;
	/** Nearest non-empty pair before the current one; null means the edge is known. */
	previousTipIndex?: number | null;
	/** Nearest non-empty pair after the current one; null means the edge is known. */
	nextTipIndex?: number | null;
};

export type RevisionDiffNavAvailability = {
	active: boolean;
	hasPrevious: boolean;
	hasNext: boolean;
};

/** tipIndex is the "after" side; a pair needs tipIndex >= 1. */
export function getRevisionDiffNavAvailability(
	session: RevisionDiffSessionLike | undefined,
): RevisionDiffNavAvailability {
	if (!session || session.revisions.length < 2) {
		return { active: false, hasPrevious: false, hasNext: false };
	}
	const hasPrevious = session.previousTipIndex === undefined ? session.tipIndex > 1 : session.previousTipIndex !== null;
	const hasNext =
		session.nextTipIndex === undefined
			? session.tipIndex < session.revisions.length - 1
			: session.nextTipIndex !== null;
	return {
		active: true,
		hasPrevious,
		hasNext,
	};
}
