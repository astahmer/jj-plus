type RevisionPairArgs = {
	revisions: string[];
	tipIndex: number;
	showFile: (revset: string) => Promise<string>;
};

export type NonEmptyRevisionPair = {
	tipIndex: number;
	base: string;
	tip: string;
	originalContent: string;
	modifiedContent: string;
};

/**
 * Walk tipIndex downward until base→tip file contents differ.
 * Avoids empty vscode.diff when tip is `@` (or any rev) with identical content to its parent side.
 */
export async function resolveNonEmptyRevisionPair(args: RevisionPairArgs): Promise<NonEmptyRevisionPair | null> {
	return resolveNonEmptyRevisionPairInDirection({ ...args, direction: 'backward' });
}

/** Walk tipIndex upward to the next non-empty pair after the current diff. */
export async function resolveNextNonEmptyRevisionPair(args: RevisionPairArgs): Promise<NonEmptyRevisionPair | null> {
	return resolveNonEmptyRevisionPairInDirection({ ...args, direction: 'forward' });
}

async function resolveNonEmptyRevisionPairInDirection(
	args: RevisionPairArgs & { direction: 'backward' | 'forward' },
): Promise<NonEmptyRevisionPair | null> {
	let tipIndex =
		args.direction === 'backward' ? Math.min(args.tipIndex, args.revisions.length - 1) : Math.max(1, args.tipIndex);
	const step = args.direction === 'backward' ? -1 : 1;

	while (tipIndex >= 1 && tipIndex < args.revisions.length) {
		const tip = args.revisions[tipIndex];
		const base = args.revisions[tipIndex - 1];
		if (!tip || !base) {
			break;
		}
		const [originalContent, modifiedContent] = await Promise.all([args.showFile(base), args.showFile(tip)]);
		if (originalContent !== modifiedContent) {
			return { tipIndex, base, tip, originalContent, modifiedContent };
		}
		tipIndex += step;
	}
	return null;
}
