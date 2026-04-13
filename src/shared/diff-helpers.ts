export function normalizeTextForComparison(value: string): string {
	return value.replace(/\r\n/g, '\n');
}

export function textsMatchIgnoringLineEndings(beforeText: string, afterText: string): boolean {
	return beforeText === afterText || normalizeTextForComparison(beforeText) === normalizeTextForComparison(afterText);
}
