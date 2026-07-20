import { Array } from 'effect';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry, SendHostCommand } from '../commands.ts';
import {
	BootedApp,
	CompletedPersistState,
	CompletedScrollToEntry,
	CompletedSendHost,
	GotHostMessage,
} from '../messages.ts';
import type { Model } from '../model.ts';
import type { DiffPreview, FileRevisionEntry, TimelineData } from '../types.ts';
import { init, update } from '../update.ts';

export function makeEntry(overrides: Partial<FileRevisionEntry> & Pick<FileRevisionEntry, 'index'>): FileRevisionEntry {
	return {
		id: overrides.id || `entry-${overrides.index}`,
		revision: overrides.revision || `rev-${overrides.index}`.padEnd(40, '0'),
		shortRevision: overrides.shortRevision || `r${overrides.index}`,
		changeId: overrides.changeId,
		authorDate: overrides.authorDate || '2026-04-10T16:07:57+02:00',
		authorName: overrides.authorName || 'Alex',
		description: overrides.description || `entry ${overrides.index}`,
		isWorkingTree: overrides.isWorkingTree === true,
		touchesFile: overrides.touchesFile !== false,
		timestamp: overrides.timestamp ?? overrides.index * 1_000,
		filePath: overrides.filePath,
		operationId: overrides.operationId,
		operationIndex: overrides.operationIndex,
		operationKey: overrides.operationKey,
		remoteUrl: overrides.remoteUrl,
		hasPreviousEntry: overrides.hasPreviousEntry,
		monthLabel: overrides.monthLabel || 'Apr',
		shortDate: overrides.shortDate || `Apr ${10 + overrides.index}`,
		relativeDate: overrides.relativeDate || `${overrides.index}d ago`,
		index: overrides.index,
	};
}

export function makeTimelineData(entries: FileRevisionEntry[], overrides: Partial<TimelineData> = {}): TimelineData {
	return {
		backend: 'git',
		workspacePath: '/tmp/repo',
		relativePath: 'src/example.ts',
		fileName: 'example.ts',
		version: '0.0.0-test',
		presets: { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY },
		defaultIndex: entries.at(-1)?.index || 0,
		latestIndex: entries.at(-1)?.index || 0,
		preferences: {},
		workspaceFiles: ['src/example.ts', 'src/other.ts'],
		hasIntermediateRevisions: entries.some((entry) => !entry.touchesFile),
		entries,
		snapshotEntries: [],
		snapshotState: undefined,
		...overrides,
	};
}

/** Five-entry fixture: one intermediate revision + working-tree tip. */
export function defaultTimelineData(): TimelineData {
	return makeTimelineData([
		makeEntry({ index: 0, shortRevision: 'aaaa0000', revision: 'aaaa0000'.padEnd(40, '0') }),
		makeEntry({
			index: 1,
			shortRevision: 'bbbb0001',
			revision: 'bbbb0001'.padEnd(40, '0'),
			touchesFile: false,
		}),
		makeEntry({ index: 2, shortRevision: 'cccc0002', revision: 'cccc0002'.padEnd(40, '0') }),
		makeEntry({ index: 3, shortRevision: 'dddd0003', revision: 'dddd0003'.padEnd(40, '0') }),
		makeEntry({
			index: 4,
			shortRevision: 'Current',
			revision: 'eeee0004'.padEnd(40, '0'),
			isWorkingTree: true,
			relativeDate: 'now',
			shortDate: 'Today',
		}),
	]);
}

/** JJ fixture with change ids so snapshot hydration can request work. */
export function jjTimelineData(): TimelineData {
	return makeTimelineData(
		[
			makeEntry({
				index: 0,
				shortRevision: 'aaaa0000',
				revision: 'aaaa0000'.padEnd(40, '0'),
				changeId: 'change-a',
			}),
			makeEntry({
				index: 1,
				shortRevision: 'bbbb0001',
				revision: 'bbbb0001'.padEnd(40, '0'),
				changeId: 'change-b',
				touchesFile: false,
			}),
			makeEntry({
				index: 2,
				shortRevision: 'cccc0002',
				revision: 'cccc0002'.padEnd(40, '0'),
				changeId: 'change-c',
			}),
			makeEntry({
				index: 3,
				shortRevision: 'dddd0003',
				revision: 'dddd0003'.padEnd(40, '0'),
				changeId: 'change-d',
			}),
			makeEntry({
				index: 4,
				shortRevision: 'Current',
				revision: 'eeee0004'.padEnd(40, '0'),
				isWorkingTree: true,
				relativeDate: 'now',
				shortDate: 'Today',
			}),
		],
		{
			backend: 'jj',
			snapshotEntries: [],
			snapshotState: { loadedChangeIds: [] },
		},
	);
}

export function makeDiffPreview(fromIndex: number, toIndex: number, overrides: Partial<DiffPreview> = {}): DiffPreview {
	return {
		index: toIndex,
		title: `r${fromIndex} → r${toIndex}`,
		subtitle: 'test preview',
		diffCount: 1,
		additions: 1,
		deletions: 0,
		hunkCount: 1,
		hasChanges: true,
		fromIndex,
		toIndex,
		comparisonSource: 'revision',
		beforePath: 'example.ts',
		afterPath: 'example.ts',
		beforeText: 'line one\n',
		afterText: 'line one\nline two\n',
		nonTextualDetails: [],
		...overrides,
	};
}

/** Resolvers for the usual host/persist traffic produced by afterMutate. */
export function hostCommandResolvers(count = 8) {
	return [
		...Array.makeBy(count, () => [SendHostCommand, CompletedSendHost()] as const),
		...Array.makeBy(2, () => [PersistState, CompletedPersistState()] as const),
		...Array.makeBy(2, () => [ScrollToEntry, CompletedScrollToEntry()] as const),
	];
}

/**
 * Boot + timeline-data hydrate with sync Commands drained.
 * Session is Ready; default selection is tip-1 → tip.
 */
export function hydratedModel(data: TimelineData = defaultTimelineData()): Model {
	const [booted] = init();
	let ready: Model = booted;

	Story.story(
		update,
		Story.with(booted),
		Story.message(BootedApp()),
		Story.Command.expectNone(),
		Story.message(
			GotHostMessage({
				payload: { type: 'timeline-data', payload: data },
			}),
		),
		Story.Command.expectHas(SendHostCommand),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'diff-preview',
					payload: makeDiffPreview(Math.max(0, data.defaultIndex - 1), data.defaultIndex),
				},
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			ready = model;
		}),
	);

	return ready;
}

export { PersistState, SendHostCommand };
