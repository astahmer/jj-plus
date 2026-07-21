import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

test('package.json command titles use jjplus: prefix and editor title actions', () => {
	const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
	const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
		contributes: {
			commands: Array<{ command: string; title: string; icon?: string }>;
			menus: {
				'editor/title': Array<{ command: string; when?: string }>;
			};
		};
	};

	for (const command of pkg.contributes.commands) {
		assert.match(command.title, /^jjplus:/, command.command);
	}

	const titleCommands = pkg.contributes.menus['editor/title'].map((entry) => entry.command);
	assert.ok(titleCommands.includes('jj-range-diff.openChangesWithPrevious'));
	assert.ok(titleCommands.includes('jj-range-diff.openFileRevisionTimeline'));

	const previous = pkg.contributes.commands.find((entry) => entry.command === 'jj-range-diff.openChangesWithPrevious');
	assert.ok(previous?.icon);
});
