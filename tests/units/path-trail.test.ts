import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildFilePathTrail,
	formatFilePathTrail,
	formatFilePathTrailFull,
	pathTrailChanged,
} from '../../src/shared/path-trail.ts';

test('buildFilePathTrail collapses consecutive identical paths', () => {
	const steps = buildFilePathTrail(
		[
			{ filePath: 'a.ts', index: 0 },
			{ filePath: 'a.ts', index: 1 },
			{ filePath: 'b.ts', index: 2 },
			{ filePath: 'b.ts', index: 3 },
			{ filePath: 'c.ts', index: 4 },
		],
		'c.ts',
	);
	assert.deepEqual(steps, [
		{ relativePath: 'a.ts', fromIndex: 0, toIndex: 1 },
		{ relativePath: 'b.ts', fromIndex: 2, toIndex: 3 },
		{ relativePath: 'c.ts', fromIndex: 4, toIndex: 4 },
	]);
	assert.equal(pathTrailChanged(steps), true);
	assert.equal(formatFilePathTrail(steps), 'a.ts → b.ts → c.ts');
});

test('formatFilePathTrail collapses rename ping-pong for display', () => {
	const steps = buildFilePathTrail(
		[
			{ filePath: 'apps/api/src/spec.ts', index: 0 },
			{ filePath: 'apps/api/src/api.ts', index: 1 },
			{ filePath: 'apps/api/src/spec.ts', index: 2 },
			{ filePath: 'apps/api/src/api.ts', index: 3 },
			{ filePath: 'apps/api/src/spec.ts', index: 4 },
			{ filePath: 'apps/api/src/api.ts', index: 5 },
		],
		'apps/api/src/api.ts',
	);
	assert.equal(formatFilePathTrail(steps), 'apps/api/src/spec.ts → apps/api/src/api.ts');
	assert.match(formatFilePathTrailFull(steps), /spec\.ts → apps\/api\/src\/api\.ts → apps\/api\/src\/spec\.ts/);
});

test('buildFilePathTrail falls back when filePath missing', () => {
	const steps = buildFilePathTrail([{ index: 0 }, { filePath: 'renamed.ts', index: 1 }], 'original.ts');
	assert.deepEqual(steps, [
		{ relativePath: 'original.ts', fromIndex: 0, toIndex: 0 },
		{ relativePath: 'renamed.ts', fromIndex: 1, toIndex: 1 },
	]);
});

test('pathTrailChanged is false for a single path', () => {
	const steps = buildFilePathTrail(
		[
			{ filePath: 'only.ts', index: 0 },
			{ filePath: 'only.ts', index: 1 },
		],
		'only.ts',
	);
	assert.equal(pathTrailChanged(steps), false);
	assert.equal(formatFilePathTrail(steps), 'only.ts');
});
