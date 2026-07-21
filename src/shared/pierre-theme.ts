export type PierreThemePreference = 'auto' | 'light' | 'dark';

export type PierreThemeHints = {
	bodyClasses?: Iterable<string>;
	themeKind?: string | null;
	prefersLight?: boolean;
	colorScheme?: string | null;
};

/** Resolve Pierre themeType from explicit preference or VS Code / system hints. */
export function resolvePierreThemeType(
	preference: PierreThemePreference = 'auto',
	hints: PierreThemeHints = {},
): 'dark' | 'light' {
	if (preference === 'light') {
		return 'light';
	}
	if (preference === 'dark') {
		return 'dark';
	}
	const classes = new Set(hints.bodyClasses ?? []);
	if (classes.has('vscode-light') || classes.has('vscode-high-contrast-light') || hints.themeKind === 'vscode-light') {
		return 'light';
	}
	if (hints.prefersLight && !classes.has('vscode-dark') && hints.colorScheme === 'light') {
		return 'light';
	}
	return 'dark';
}
