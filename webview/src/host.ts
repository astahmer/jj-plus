import { getEntriesForSource } from './timeline-model.ts';
import type {
	ComparisonSource,
	DiffPreview,
	TimelineCommand,
	TimelineFixture,
	TimelineFixtureFile,
	TimelineHost,
	TimelineInboundMessage,
	TimelinePreferences,
} from './types.ts';

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

function resolveNonEmptyRange(fileFixture: TimelineFixtureFile, candidateIndexes: number[]) {
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

export function createTimelineHost(): TimelineHost {
	if (typeof window.acquireVsCodeApi === 'function') {
		const vscode = window.acquireVsCodeApi();
		return {
			send(command) {
				// oxlint-disable-next-line unicorn/require-post-message-target-origin
				vscode.postMessage(command);
			},
			subscribe(listener) {
				const handler = (event: MessageEvent<TimelineInboundMessage>) => {
					if (event.data && typeof event.data === 'object' && 'type' in event.data) {
						listener(event.data);
					}
				};
				window.addEventListener('message', handler);
				return () => window.removeEventListener('message', handler);
			},
		};
	}

	if (new URLSearchParams(window.location.search).get('standalone') === '1') {
		const listeners = new Set<(message: TimelineInboundMessage) => void>();

		return {
			send(command) {
				void prepareAndDispatch(command).catch((error) => {
					console.error(error);
				});
			},
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};

		function emitStandalone(message: TimelineInboundMessage) {
			listeners.forEach((listener) => listener(message));
		}

		async function prepareAndDispatch(command: TimelineCommand) {
			const nextCommand = await maybeAttachStandaloneEditorCommand(command);
			if (!nextCommand) {
				return;
			}

			await dispatch(nextCommand);
		}

		async function dispatch(command: TimelineCommand) {
			const response = await fetch('/api/command', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify(command),
			});

			if (!response.ok) {
				throw new Error(`Standalone timeline request failed: ${response.status}`);
			}

			const payload = (await response.json()) as { messages?: TimelineInboundMessage[] };
			payload.messages?.forEach((message) => emitStandalone(message));
		}
	}

	const listeners = new Set<(message: TimelineInboundMessage) => void>();
	let fixturePromise: Promise<TimelineFixture> | null = null;
	let activeRelativePath = '';
	const testState = window.__TIMELINE_TEST_STATE__ || {
		fixtureName: '',
		activeRelativePath: '',
		actions: [],
		lastAction: null,
	};
	window.__TIMELINE_TEST_STATE__ = testState;

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

	function emit(message: TimelineInboundMessage) {
		listeners.forEach((listener) => listener(message));
	}

	async function emitTimeline() {
		const fixture = await getFixture();
		const fileFixture = getActiveFileFixture(fixture);
		const timelineData = withPersistedPreferences(fileFixture.timelineData);
		emit({ type: 'timeline-data', payload: timelineData });
		emit({
			type: 'diff-preview',
			payload: getFixturePreview(
				fileFixture,
				timelineData.defaultIndex - 1,
				timelineData.defaultIndex,
				timelineData.preferences.comparisonSource || 'revision',
			),
		});
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
	) {
		const key = `${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`;
		const previewMap = fileFixture.previews[comparisonSource] || fileFixture.previews.revision || {};
		const preview = previewMap[key];
		if (preview) {
			return clone(preview);
		}

		const fallback: DiffPreview = {
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
			rows: [],
			nonTextualDetails: [],
		};
		return fallback;
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
		};
		window.localStorage.setItem(key, JSON.stringify(nextPreferences));
	}

	function getPersistedPreferences(relativePath: string) {
		const raw = window.localStorage.getItem(getPreferencesKey(relativePath));
		if (!raw) {
			return {} satisfies TimelinePreferences;
		}

		try {
			return JSON.parse(raw) as TimelinePreferences;
		} catch {
			return {} satisfies TimelinePreferences;
		}
	}

	function getPreferencesKey(relativePath: string) {
		return `timeline-fixture:${testState.fixtureName}:${relativePath}`;
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
}
