import { getEntriesForSource } from '../domain/timeline-model.ts';
import { measureDiffLayoutMetrics } from '../pierre/file-diff-host.ts';
import type {
	ComparisonSource,
	DiffPreview,
	TimelineCommand,
	TimelineFixture,
	TimelineFixtureFile,
	TimelineHost,
	TimelineInboundMessage,
	TimelinePreferences,
} from '../types.ts';

type VsCodeApi = {
	postMessage: (message: TimelineCommand) => void;
};

declare global {
	interface Window {
		acquireVsCodeApi?: () => VsCodeApi;
		__TIMELINE_TEST_STATE__?: {
			fixtureName: string;
			activeRelativePath: string;
			actions: Array<{ command: string; payload: Record<string, unknown> }>;
			lastAction: { command: string; payload: Record<string, unknown> } | null;
		};
	}
}

function resolveFileFixture(fixture: TimelineFixture, relativePath: string) {
	return fixture.files?.[relativePath] || (fixture.timelineData.relativePath === relativePath ? fixture : null);
}

function resolveNonEmptyRange(fileFixture: TimelineFixtureFile, candidateIndexes: Array<number>) {
	const previewMap = fileFixture.previews.revision || {};
	for (let index = candidateIndexes.length - 1; index > 0; index -= 1) {
		const fromIndex = candidateIndexes[index - 1];
		const toIndex = candidateIndexes[index];
		const key = `${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`;
		if (previewMap[key]?.hasChanges) {
			return { fromIndex, toIndex };
		}
	}

	return null;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function parseLineHistoryQuery(search: string): { startLine: number; endLine: number } | null {
	const raw = new URLSearchParams(search).get('lineHistory');
	if (!raw) {
		return null;
	}
	const match = /^(\d+)(?:-(\d+))?$/.exec(raw.trim());
	if (!match) {
		return null;
	}
	const startLine = Number(match[1]);
	const endLine = Number(match[2] || match[1]);
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < 1) {
		return null;
	}
	return { startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) };
}

function applyBrowserLineHistoryFilter(
	timelineData: TimelineFixtureFile['timelineData'],
	lineHistory: { startLine: number; endLine: number } | null,
): TimelineFixtureFile['timelineData'] {
	if (!lineHistory) {
		return timelineData;
	}

	const entries = timelineData.entries.filter((_, index, all) => index === 0 || index >= all.length - 2);
	const remapped = entries.map((entry, index) => ({ ...entry, index }));
	return {
		...timelineData,
		entries: remapped,
		defaultIndex: Math.max(0, remapped.length - 1),
		latestIndex: Math.max(0, remapped.length - 1),
		lineHistory,
	};
}

function getFixtureRangeOverview(fileFixture: TimelineFixtureFile) {
	const workspaceFiles = fileFixture.timelineData.workspaceFiles || [];
	return workspaceFiles
		.slice(0, 150)
		.map((relativePath) => ({
			relativePath,
			changeCount: relativePath === fileFixture.timelineData.relativePath ? 1 : 0,
			isCurrentFile: relativePath === fileFixture.timelineData.relativePath,
		}))
		.toSorted((left, right) => {
			if (left.isCurrentFile !== right.isCurrentFile) {
				return Number(right.isCurrentFile) - Number(left.isCurrentFile);
			}

			return left.relativePath.localeCompare(right.relativePath);
		});
}

function buildFallbackStackPreview(
	fileFixture: TimelineFixtureFile,
	fromIndex: number,
	toIndex: number,
	comparisonSource: ComparisonSource,
	relativePath: string,
): DiffPreview {
	const sample = Object.values(fileFixture.previews.revision || {})[0];
	return {
		index: toIndex,
		title: `${relativePath} stack`,
		subtitle: relativePath,
		diffCount: 1,
		additions: sample?.additions ?? 1,
		deletions: sample?.deletions ?? 0,
		hunkCount: sample?.hunkCount ?? 1,
		hasChanges: true,
		fromIndex,
		toIndex,
		comparisonSource,
		beforePath: relativePath,
		afterPath: relativePath,
		beforeText: sample?.beforeText ?? `// before ${relativePath}\n`,
		afterText: sample?.afterText ?? `// after ${relativePath}\nchanged\n`,
		nonTextualDetails: [],
	};
}

function getFixtureEntryDiffCount(
	fileFixture: TimelineFixtureFile,
	entryIndex: number,
	comparisonSource: ComparisonSource,
) {
	const sourceEntries = getEntriesForSource(fileFixture.timelineData, comparisonSource);
	const entry = sourceEntries[entryIndex];
	const previousEntry = sourceEntries[Math.max(0, entryIndex - 1)];
	if (!entry || !previousEntry || entryIndex <= 0) {
		return 0;
	}

	const previewMap = fileFixture.previews[comparisonSource] || fileFixture.previews.revision || {};
	const key = `${Math.min(previousEntry.index, entry.index)}:${Math.max(previousEntry.index, entry.index)}`;
	return previewMap[key]?.hasChanges ? 1 : 0;
}

async function maybeAttachStandaloneEditorCommand(command: TimelineCommand): Promise<TimelineCommand | null> {
	if (command.command !== 'open-range-files-diff' && command.command !== 'open-revision-files-diff') {
		return command;
	}

	if (command.editorCommand) {
		return command;
	}

	const editorCommand = window.prompt('Open diffs with which editor command?', 'code');
	if (editorCommand === null) {
		return null;
	}

	const trimmedEditorCommand = editorCommand.trim();
	if (!trimmedEditorCommand) {
		return null;
	}

	return {
		...command,
		editorCommand: trimmedEditorCommand,
	};
}

function isDebugMeasureLayoutMessage(data: unknown): boolean {
	return Boolean(data && typeof data === 'object' && Reflect.get(data, 'type') === 'debug-measure-layout');
}

function postLayoutMetrics(send: (command: TimelineCommand) => void): void {
	send({
		command: 'layout-metrics',
		metrics: measureDiffLayoutMetrics(),
	});
}

export function createTimelineHost(): TimelineHost {
	if (typeof window.acquireVsCodeApi === 'function') {
		const vscode = window.acquireVsCodeApi();
		return {
			send(command) {
				vscode.postMessage(command);
			},
			subscribe(listener) {
				const handler = (event: MessageEvent<TimelineInboundMessage | { type: string }>) => {
					if (isDebugMeasureLayoutMessage(event.data)) {
						postLayoutMetrics((command) => vscode.postMessage(command));
						return;
					}
					if (event.data && typeof event.data === 'object' && 'type' in event.data) {
						listener(event.data as TimelineInboundMessage);
					}
				};
				window.addEventListener('message', handler);
				return () => window.removeEventListener('message', handler);
			},
		};
	}

	if (new URLSearchParams(window.location.search).get('standalone') === '1') {
		const standaloneListeners = new Set<(message: TimelineInboundMessage) => void>();

		const emitStandalone = (message: TimelineInboundMessage) => {
			standaloneListeners.forEach((listener) => listener(message));
		};

		const dispatchStandalone = async (command: TimelineCommand) => {
			const response = await fetch('/api/command', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(command),
			});

			if (!response.ok) {
				throw new Error(`Standalone timeline request failed: ${response.status}`);
			}

			const payload = (await response.json()) as { messages?: Array<TimelineInboundMessage> };
			payload.messages?.forEach((message) => emitStandalone(message));
		};

		const prepareAndDispatchStandalone = async (command: TimelineCommand) => {
			const nextCommand = await maybeAttachStandaloneEditorCommand(command);
			if (!nextCommand) {
				return;
			}
			await dispatchStandalone(nextCommand);
		};

		return {
			send(command) {
				void prepareAndDispatchStandalone(command).catch((error) => {
					console.error(error);
				});
			},
			subscribe(listener) {
				standaloneListeners.add(listener);
				return () => standaloneListeners.delete(listener);
			},
		};
	}

	const listeners = new Set<(message: TimelineInboundMessage) => void>();
	let fixturePromise: Promise<TimelineFixture> | null = null;
	let activeRelativePath = '';
	let lineHistoryFilter = parseLineHistoryQuery(window.location.search);
	const testState = window.__TIMELINE_TEST_STATE__ || {
		fixtureName: '',
		activeRelativePath: '',
		actions: [],
		lastAction: null,
	};
	window.__TIMELINE_TEST_STATE__ = testState;

	function emit(message: TimelineInboundMessage) {
		listeners.forEach((listener) => listener(message));
	}

	function getFixture() {
		if (!fixturePromise) {
			const fixtureName = new URLSearchParams(window.location.search).get('fixture') || 'jj-basic';
			fixturePromise = fetch(`/e2e/${fixtureName}.json`).then(async (response) => {
				if (!response.ok) {
					throw new Error(`Failed to load fixture ${fixtureName}: ${response.status}`);
				}
				const fixture = (await response.json()) as TimelineFixture;
				activeRelativePath = fixture.timelineData.relativePath;
				testState.fixtureName = fixtureName;
				testState.activeRelativePath = activeRelativePath;
				window.__TIMELINE_TEST_STATE__ = testState;
				return fixture;
			});
		}
		return fixturePromise;
	}

	function getActiveFileFixture(fixture: TimelineFixture): TimelineFixtureFile {
		if (fixture.files && activeRelativePath && fixture.files[activeRelativePath]) {
			return fixture.files[activeRelativePath];
		}

		return {
			timelineData: fixture.timelineData,
			previews: fixture.previews,
		};
	}

	function getPreferencesKey(relativePath: string) {
		return `timeline-fixture:${testState.fixtureName}:${relativePath}`;
	}

	function getPersistedPreferences(relativePath: string): TimelinePreferences {
		const raw = window.localStorage.getItem(getPreferencesKey(relativePath));
		if (!raw) {
			return {};
		}

		try {
			return JSON.parse(raw) as TimelinePreferences;
		} catch {
			return {};
		}
	}

	function withPersistedPreferences(timelineData: TimelineFixtureFile['timelineData']) {
		const persisted = getPersistedPreferences(timelineData.relativePath);
		return {
			...clone(timelineData),
			preferences: {
				...clone(timelineData.preferences),
				...persisted,
			},
		};
	}

	function getFixturePreview(
		fileFixture: TimelineFixtureFile,
		fromIndex: number,
		toIndex: number,
		comparisonSource: ComparisonSource,
	): DiffPreview {
		const key = `${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`;
		const previewMap = fileFixture.previews[comparisonSource] || fileFixture.previews.revision || {};
		const preview = previewMap[key];
		if (preview) {
			return clone(preview);
		}

		return {
			index: Math.max(fromIndex, toIndex),
			title: 'No diff available',
			subtitle: '',
			diffCount: 0,
			additions: 0,
			deletions: 0,
			hunkCount: 0,
			hasChanges: false,
			fromIndex: Math.min(fromIndex, toIndex),
			toIndex: Math.max(fromIndex, toIndex),
			comparisonSource,
			beforePath: '',
			afterPath: '',
			beforeText: '',
			afterText: '',
			nonTextualDetails: [],
		};
	}

	function persistPreferences(command: Extract<TimelineCommand, { command: 'persist-state' }>) {
		const key = getPreferencesKey(activeRelativePath);
		const nextPreferences: TimelinePreferences = {
			sidebarWidth: command.sidebarWidth,
			sidebarCollapsed: command.sidebarCollapsed,
			timelinePaneHeight: command.timelinePaneHeight,
			timelinePaneCollapsed: command.timelinePaneCollapsed,
			layoutMode: command.layoutMode,
			contentMode: command.contentMode,
			comparisonMode: command.comparisonMode,
			comparisonSource: command.comparisonSource,
			showIntermediateRevisions: command.showIntermediateRevisions,
			preset: command.preset,
			customRevset: command.customRevset,
			themePreference: command.themePreference,
			heatmapOpen: command.heatmapOpen === true,
		};
		window.localStorage.setItem(key, JSON.stringify(nextPreferences));
	}

	function recordAction(command: TimelineCommand, fileFixture: TimelineFixtureFile) {
		const payload: Record<string, unknown> = {
			relativePath: fileFixture.timelineData.relativePath,
			fileName: fileFixture.timelineData.fileName,
		};

		if (
			command.command === 'select-entry' ||
			command.command === 'open-editor-diff' ||
			command.command === 'open-range-files-diff'
		) {
			payload.fromIndex = command.fromIndex;
			payload.toIndex = command.toIndex;
			payload.comparisonSource = command.comparisonSource;
			payload.selectedEntryIndexes =
				command.command === 'open-range-files-diff' ? command.selectedEntryIndexes || [] : [];
		}

		if (command.command === 'open-revision-files-diff' || command.command === 'open-revision-remote') {
			const sourceEntries = getEntriesForSource(fileFixture.timelineData, command.comparisonSource);
			const entry = sourceEntries.find((candidate) => candidate.index === command.entryIndex);
			payload.entryIndex = command.entryIndex;
			payload.comparisonSource = command.comparisonSource;
			payload.revision = entry?.shortRevision || '';
			payload.remoteUrl = entry?.remoteUrl || null;
		}

		if (command.command === 'open-range-files-diff' || command.command === 'open-revision-files-diff') {
			payload.editorCommand = command.editorCommand || null;
		}

		const action = {
			command: command.command,
			payload,
		};

		testState.actions.push(action);
		if (command.command !== 'select-entry') {
			testState.lastAction = action;
		}
		window.__TIMELINE_TEST_STATE__ = testState;
	}

	async function emitTimeline() {
		const fixture = await getFixture();
		const fileFixture = getActiveFileFixture(fixture);
		const timelineData = applyBrowserLineHistoryFilter(
			withPersistedPreferences(fileFixture.timelineData),
			lineHistoryFilter,
		);
		emit({ type: 'timeline-data', payload: timelineData });
		emit({
			type: 'diff-preview',
			payload: getFixturePreview(
				fileFixture,
				Math.max(0, timelineData.defaultIndex - 1),
				timelineData.defaultIndex,
				timelineData.preferences.comparisonSource || 'revision',
			),
		});

		if (timelineData.backend === 'jj') {
			emit({
				type: 'snapshot-entries',
				payload: {
					snapshotEntries: clone(fileFixture.timelineData.snapshotEntries || []),
					snapshotState: clone(fileFixture.timelineData.snapshotState || { loadedChangeIds: [] }),
				},
			});
		}
	}

	return {
		send(command) {
			if (command.command === 'ready' || command.command === 'refresh') {
				void emitTimeline();
				return;
			}

			if (command.command === 'select-entry') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					recordAction(command, fileFixture);
					emit({
						type: 'diff-preview',
						payload: getFixturePreview(fileFixture, command.fromIndex, command.toIndex, command.comparisonSource),
					});
				});
				return;
			}

			if (command.command === 'hydrate-snapshot-entries') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					emit({
						type: 'snapshot-entries',
						payload: {
							snapshotEntries: clone(fileFixture.timelineData.snapshotEntries),
							snapshotState: clone(fileFixture.timelineData.snapshotState || { loadedChangeIds: [] }),
						},
					});
				});
				return;
			}

			if (command.command === 'resolve-nonempty-range') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					const resolved = resolveNonEmptyRange(fileFixture, command.candidateIndexes);
					emit({ type: 'resolved-range', payload: resolved });
				});
				return;
			}

			if (command.command === 'load-range-overview') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					emit({
						type: 'range-overview',
						payload: {
							fromIndex: Math.min(command.fromIndex, command.toIndex),
							toIndex: Math.max(command.fromIndex, command.toIndex),
							comparisonSource: command.comparisonSource,
							selectedEntryIndexes: command.selectedEntryIndexes,
							items: getFixtureRangeOverview(fileFixture),
						},
					});
				});
				return;
			}

			if (command.command === 'load-range-stack') {
				void getFixture().then((fixture) => {
					const fromIndex = Math.min(command.fromIndex, command.toIndex);
					const toIndex = Math.max(command.fromIndex, command.toIndex);
					const key = `${fromIndex}:${toIndex}`;
					const items = command.relativePaths.flatMap((relativePath) => {
						const fileFixture = resolveFileFixture(fixture, relativePath) || getActiveFileFixture(fixture);
						const preview =
							fileFixture.previews[command.comparisonSource]?.[key] ||
							fileFixture.previews.revision?.[key] ||
							buildFallbackStackPreview(fileFixture, fromIndex, toIndex, command.comparisonSource, relativePath);
						return [{ relativePath, preview }];
					});
					emit({
						type: 'range-stack-previews',
						payload: {
							fromIndex,
							toIndex,
							comparisonSource: command.comparisonSource,
							items,
						},
					});
				});
				return;
			}

			if (command.command === 'load-diff-blame') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					const fromIndex = Math.min(command.fromIndex, command.toIndex);
					const toIndex = Math.max(command.fromIndex, command.toIndex);
					const entries = getEntriesForSource(fileFixture.timelineData, command.comparisonSource);
					const tip = entries[toIndex] || entries[entries.length - 1];
					emit({
						type: 'diff-blame',
						payload: {
							fromIndex,
							toIndex,
							comparisonSource: command.comparisonSource,
							relativePath: fileFixture.timelineData.relativePath,
							lines: [
								{ line: 1, revision: tip?.revision || 'aaaaaaa', author: tip?.authorName, summary: tip?.description },
								{ line: 2, revision: tip?.revision || 'aaaaaaa', author: tip?.authorName },
								{
									line: 3,
									revision: entries[Math.max(0, toIndex - 1)]?.revision || 'bbbbbbb',
									author: 'Earlier',
									summary: 'prior change',
								},
							],
						},
					});
				});
				return;
			}

			if (command.command === 'load-file-oplog') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					const snapshots = fileFixture.timelineData.snapshotEntries || [];
					const withOps = snapshots.filter((entry) => entry.operationId);
					const source = withOps.length > 0 ? withOps : fileFixture.timelineData.entries.filter((entry) => entry.operationId);
					emit({
						type: 'file-oplog',
						payload: {
							relativePath: fileFixture.timelineData.relativePath,
							entries: source.slice(-8).reverse().map((entry) => ({
								operationId: entry.operationId || entry.id,
								description: entry.description || 'Operation',
								entryIndex: entry.index,
								changeId: entry.changeId,
								operationIndex: entry.operationIndex,
							})),
						},
					});
				});
				return;
			}

			if (command.command === 'search-history') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					const entries = fileFixture.timelineData.entries.filter((entry) => !entry.isWorkingTree);
					const tip = entries[Math.max(0, entries.length - 1)];
					const previous = entries[Math.max(0, entries.length - 2)] || tip;
					const introducedAt = previous?.index ?? 0;
					const tipIndex = tip?.index ?? introducedAt;
					const hits: Array<{ entryIndex: number; kind: 'introduced' | 'present' }> = [
						{ entryIndex: introducedAt, kind: 'introduced' },
					];
					if (tipIndex !== introducedAt) {
						hits.push({ entryIndex: tipIndex, kind: 'present' });
					}
					emit({
						type: 'history-search',
						payload: {
							query: command.query,
							introducedAt,
							removedAt: null,
							hits,
							purpose: command.purpose === 'sidebar' ? 'sidebar' : 'history',
						},
					});
				});
				return;
			}

			if (command.command === 'load-entry-diff-counts') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					emit({
						type: 'entry-diff-counts',
						payload: {
							comparisonSource: command.comparisonSource,
							counts: command.entryIndexes.map((entryIndex) => ({
								entryIndex,
								diffCount: getFixtureEntryDiffCount(fileFixture, entryIndex, command.comparisonSource),
							})),
						},
					});
				});
				return;
			}

			if (command.command === 'persist-state') {
				persistPreferences(command);
				return;
			}

			if (command.command === 'switch-file') {
				void getFixture().then((fixture) => {
					if (!resolveFileFixture(fixture, command.relativePath)) {
						return;
					}

					activeRelativePath = command.relativePath;
					testState.activeRelativePath = activeRelativePath;
					window.__TIMELINE_TEST_STATE__ = testState;
					void emitTimeline();
				});
				return;
			}

			if (command.command === 'clear-line-history') {
				lineHistoryFilter = null;
				void emitTimeline();
				return;
			}

			if (command.command === 'set-custom-revset') {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					const timelineData = applyBrowserLineHistoryFilter(
						{
							...withPersistedPreferences(fileFixture.timelineData),
							customRevset: command.customRevset,
							entries: fileFixture.timelineData.entries.filter(
								(_, index) => index % 2 === 0 || index === fileFixture.timelineData.entries.length - 1,
							),
						},
						lineHistoryFilter,
					);
					const remapped = timelineData.entries.map((entry, index) => ({ ...entry, index }));
					emit({
						type: 'timeline-data',
						payload: {
							...timelineData,
							entries: remapped,
							defaultIndex: Math.max(0, remapped.length - 1),
							latestIndex: Math.max(0, remapped.length - 1),
							customRevset: command.customRevset,
							preferences: {
								...timelineData.preferences,
								customRevset: command.customRevset,
							},
						},
					});
				});
				return;
			}

			if (
				command.command === 'open-editor-diff' ||
				command.command === 'open-range-files-diff' ||
				command.command === 'open-revision-files-diff' ||
				command.command === 'open-revision-remote' ||
				command.command === 'open-current-file' ||
				command.command === 'cancel-active-request'
			) {
				void getFixture().then((fixture) => {
					const fileFixture = getActiveFileFixture(fixture);
					recordAction(command, fileFixture);
				});
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
