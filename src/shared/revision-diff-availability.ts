export type RevisionDiffSessionLike = {
	revisions: string[];
	/** Index of the "after" / tip side currently shown. */
	tipIndex: number;
};

export type RevisionDiffNavAvailability = {
	active: boolean;
	hasPrevious: boolean;
	hasNext: boolean;
};

/** tipIndex is the "after" side; a pair needs tipIndex >= 1. Previous needs tipIndex > 1. */
export function getRevisionDiffNavAvailability(
	session: RevisionDiffSessionLike | undefined,
): RevisionDiffNavAvailability {
	if (!session || session.revisions.length < 2) {
		return { active: false, hasPrevious: false, hasNext: false };
	}
	return {
		active: true,
		hasPrevious: session.tipIndex > 1,
		hasNext: session.tipIndex < session.revisions.length - 1,
	};
}
