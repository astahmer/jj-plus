import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

test('package.json command titles use jjplus: prefix and editor title actions', () => {
	const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
	const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
		contributes: {
			configuration: {
				properties: Record<string, { default?: unknown }>;
			};
			commands: Array<{ command: string; title: string; icon?: string; enablement?: string }>;
			menus: {
				'editor/title': Array<{ command: string; when?: string }>;
			};
		};
	};

	for (const command of pkg.contributes.commands) {
		assert.match(command.title, /^jjplus:/, command.command);
	}

	const titleCommands = pkg.contributes.menus['editor/title'].map((entry) => entry.command);
	assert.ok(titleCommands.includes('jj-plus.openChangesWithPrevious'));
	assert.ok(titleCommands.includes('jj-plus.openFileRevisionTimeline'));
	assert.ok(titleCommands.includes('jj-plus.openRevisionDiffPreviousUnavailable'));
	assert.ok(titleCommands.includes('jj-plus.openRevisionDiffNextUnavailable'));
	assert.ok(titleCommands.includes('jj-plus.toggleLineBlame') === false);

	const previous = pkg.contributes.commands.find((entry) => entry.command === 'jj-plus.openChangesWithPrevious');
	const timeline = pkg.contributes.commands.find((entry) => entry.command === 'jj-plus.openFileRevisionTimeline');
	const toggleBlame = pkg.contributes.commands.find((entry) => entry.command === 'jj-plus.toggleLineBlame');
	const prevDiff = pkg.contributes.commands.find((entry) => entry.command === 'jj-plus.openRevisionDiffPrevious');
	const nextDiff = pkg.contributes.commands.find((entry) => entry.command === 'jj-plus.openRevisionDiffNext');
	assert.equal(previous?.icon, '$(history)');
	assert.equal(timeline?.icon, '$(diff)');
	assert.ok(toggleBlame);
	assert.equal(prevDiff?.enablement, 'jjplus.revisionDiffHasPrevious');
	assert.equal(nextDiff?.enablement, 'jjplus.revisionDiffHasNext');
	assert.equal(pkg.contributes.configuration.properties['jjplus.codeActions']?.default, false);
});
