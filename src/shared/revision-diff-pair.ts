/**
 * Walk tipIndex downward until base→tip file contents differ.
 * Avoids empty vscode.diff when tip is `@` (or any rev) with identical content to its parent side.
 */
export async function resolveNonEmptyRevisionPair(args: {
	revisions: string[];
	tipIndex: number;
	showFile: (revset: string) => Promise<string>;
}): Promise<{
	tipIndex: number;
	base: string;
	tip: string;
	originalContent: string;
	modifiedContent: string;
} | null> {
	let tipIndex = Math.min(args.tipIndex, args.revisions.length - 1);
	while (tipIndex >= 1) {
		const tip = args.revisions[tipIndex];
		const base = args.revisions[tipIndex - 1];
		if (!tip || !base) {
			break;
		}
		const [originalContent, modifiedContent] = await Promise.all([args.showFile(base), args.showFile(tip)]);
		if (originalContent !== modifiedContent) {
			return { tipIndex, base, tip, originalContent, modifiedContent };
		}
		tipIndex -= 1;
	}
	return null;
}
