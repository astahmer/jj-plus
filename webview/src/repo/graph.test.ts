import { expect, test } from 'vitest';
import type { RepoRevisionEntry } from './types.ts';
import { buildCompactGraphRows } from './graph.ts';

function entry(revision: string, parentRevisionIds: string[] = []): RepoRevisionEntry {
	return {
		id: revision,
		revision,
		shortRevision: revision,
		parentRevisionIds,
		authorDate: '2026-09-02T12:00:00Z',
		authorName: 'Agent',
		description: revision,
		isWorkingTree: false,
		touchesFile: false,
		timestamp: 0,
		index: 0,
	};
}

test('compact graph keeps sibling workspace heads in distinct lanes', () => {
	const rows = buildCompactGraphRows([
		entry('workspace-main', ['base']),
		entry('workspace-agent', ['base']),
		entry('base', ['root']),
		entry('root'),
	]);

	expect(rows.map((row) => row.lane)).toEqual([0, 0, 0, 0]);
	expect(rows[1]?.lanes).toEqual(['workspace-agent', 'base']);
	expect(rows[2]?.lanes).toEqual(['base']);
});

test('compact graph allocates both merge parents', () => {
	const rows = buildCompactGraphRows([
		entry('merge', ['left', 'right']),
		entry('right', ['base']),
		entry('left', ['base']),
		entry('base'),
	]);

	expect(rows[0]?.lanes).toEqual(['merge']);
	expect(rows[1]?.lanes).toEqual(['left', 'right']);
	expect(rows[2]?.lanes).toContain('left');
});
