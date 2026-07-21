/** Normalize a user-entered jj revset; empty means "use default history". */
export function normalizeCustomRevset(value: string | null | undefined): string {
	return (value || '').trim();
}

export function isCustomRevsetActive(value: string | null | undefined): boolean {
	return normalizeCustomRevset(value).length > 0;
}

/** Combine an optional power-user revset with the default ancestor window. */
export function composeJjHistoryRevset(args: { defaultRevset: string; customRevset?: string | null }): string {
	const custom = normalizeCustomRevset(args.customRevset);
	if (!custom) {
		return args.defaultRevset;
	}
	return `(${custom}) & (${args.defaultRevset})`;
}
