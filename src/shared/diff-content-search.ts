/**
 * True when `needle` appears on a line that was added or removed between before→after.
 * Full-file presence alone does not match (avoids content: hits on unchanged context).
 */
export function diffHunkContainsNeedle(args: { before: string; after: string; needle: string }): boolean {
	const needle = args.needle.trim();
	if (!needle) {
		return false;
	}
	const beforeCounts = countLines(args.before);
	const afterCounts = countLines(args.after);
	for (const [line, afterCount] of afterCounts) {
		const beforeCount = beforeCounts.get(line) ?? 0;
		if (afterCount > beforeCount && line.includes(needle)) {
			return true;
		}
	}
	for (const [line, beforeCount] of beforeCounts) {
		const afterCount = afterCounts.get(line) ?? 0;
		if (beforeCount > afterCount && line.includes(needle)) {
			return true;
		}
	}
	return false;
}

function countLines(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const line of text.split(/\r?\n/u)) {
		counts.set(line, (counts.get(line) ?? 0) + 1);
	}
	return counts;
}
