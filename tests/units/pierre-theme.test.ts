import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFromPath } from '../../src/shared/pierre-language.ts';
import { resolvePierreThemeType } from '../../src/shared/pierre-theme.ts';

test('resolvePierreThemeType honors explicit preference', () => {
	assert.equal(resolvePierreThemeType('light'), 'light');
	assert.equal(resolvePierreThemeType('dark'), 'dark');
});

test('resolvePierreThemeType follows VS Code light body classes in auto', () => {
	assert.equal(
		resolvePierreThemeType('auto', {
			bodyClasses: ['vscode-light'],
		}),
		'light',
	);
	assert.equal(
		resolvePierreThemeType('auto', {
			bodyClasses: ['vscode-high-contrast-light'],
		}),
		'light',
	);
	assert.equal(
		resolvePierreThemeType('auto', {
			themeKind: 'vscode-light',
		}),
		'light',
	);
});

test('resolvePierreThemeType defaults to dark and only uses prefers-color-scheme with light colorScheme', () => {
	assert.equal(resolvePierreThemeType('auto', {}), 'dark');
	assert.equal(
		resolvePierreThemeType('auto', {
			prefersLight: true,
			colorScheme: 'light',
		}),
		'light',
	);
	assert.equal(
		resolvePierreThemeType('auto', {
			bodyClasses: ['vscode-dark'],
			prefersLight: true,
			colorScheme: 'light',
		}),
		'dark',
	);
});

test('languageFromPath picks pierre filetype from basename', () => {
	assert.equal(languageFromPath('src/foo.ts'), 'typescript');
	assert.equal(languageFromPath('apps/web/main.tsx'), 'tsx');
	assert.equal(languageFromPath('README.md'), 'markdown');
	assert.equal(languageFromPath('path\\nested\\file.py'), 'python');
});
