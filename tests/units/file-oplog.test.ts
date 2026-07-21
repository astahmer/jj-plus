import assert from 'node:assert/strict';
import test from 'node:test';
import { filterFileOpLogPeek, parseJjOpLogLine, parseJjOpLogOutput } from '../../src/shared/file-oplog.ts';

test('parseJjOpLogLine reads id description date', () => {
	const entry = parseJjOpLogLine('abcd1234\tsnapshot working copy\t2026-04-09T12:00:00');
	assert.deepEqual(entry, {
		operationId: 'abcd1234',
		description: 'snapshot working copy',
		authorDate: '2026-04-09T12:00:00',
	});
});

test('filterFileOpLogPeek keeps ops linked to file entries', () => {
	const filtered = filterFileOpLogPeek({
		opLog: parseJjOpLogOutput(
			[
				'aaaa1111\tunrelated op\t2026-04-09T12:00:00',
				'bbbb2222\tsnapshot working copy\t2026-04-09T12:01:00',
				'cccc3333\tedit src/example.ts\t2026-04-09T12:02:00',
			].join('\n'),
		),
		fileEntries: [
			{
				id: '1',
				revision: 'r1',
				shortRevision: 'r1',
				authorDate: '',
				authorName: '',
				description: '',
				isWorkingTree: false,
				touchesFile: true,
				timestamp: 0,
				operationId: 'bbbb2222ffff',
				index: 3,
				changeId: 'kqppukkm',
			},
		],
		relativePath: 'src/example.ts',
		limit: 10,
	});
	assert.equal(filtered.length, 2);
	assert.equal(filtered[0]?.operationId, 'bbbb2222');
	assert.equal(filtered[0]?.entryIndex, 3);
	assert.equal(filtered[1]?.operationId, 'cccc3333');
});
