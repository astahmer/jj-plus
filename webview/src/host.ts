import type { ComparisonSource, DiffPreview, TimelineCommand, TimelineFixture, TimelineHost, TimelineInboundMessage } from './types';

type VsCodeApi = {
  postMessage: (message: TimelineCommand) => void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export function createTimelineHost(): TimelineHost {
  if (typeof window.acquireVsCodeApi === 'function') {
    const vscode = window.acquireVsCodeApi();
    return {
      send(command) {
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

  const listeners = new Set<(message: TimelineInboundMessage) => void>();
  let fixturePromise: Promise<TimelineFixture> | null = null;

  return {
    send(command) {
      if (command.command === 'ready' || command.command === 'refresh') {
        void getFixture().then((fixture) => {
          emit({ type: 'timeline-data', payload: fixture.timelineData });
          emit({
            type: 'diff-preview',
            payload: getFixturePreview(fixture, fixture.timelineData.defaultIndex - 1, fixture.timelineData.defaultIndex),
          });
        });
        return;
      }

      if (command.command === 'select-entry') {
        void getFixture().then((fixture) => {
          emit({ type: 'diff-preview', payload: getFixturePreview(fixture, command.fromIndex, command.toIndex) });
        });
        return;
      }

      if (command.command === 'hydrate-snapshot-entries') {
        void getFixture().then((fixture) => {
          emit({
            type: 'snapshot-entries',
            payload: {
              snapshotEntries: fixture.timelineData.snapshotEntries,
              snapshotState: fixture.timelineData.snapshotState || { loadedChangeIds: [] },
            },
          });
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

  function getFixture() {
    if (!fixturePromise) {
      const fixtureName = new URLSearchParams(window.location.search).get('fixture') || 'jj-basic';
      fixturePromise = fetch(`/e2e/${fixtureName}.json`).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load fixture ${fixtureName}: ${response.status}`);
        }
        return /** @type {Promise<TimelineFixture>} */ (response.json());
      });
    }
    return fixturePromise;
  }

  function getFixturePreview(fixture: TimelineFixture, fromIndex: number, toIndex: number) {
    const key = `${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`;
    const preview = fixture.previews[key];
    if (preview) {
      return preview;
    }
    const comparisonSource: ComparisonSource = fixture.timelineData.backend === 'jj' ? 'snapshot' : 'revision';
    const fallback: DiffPreview = {
      index: Math.max(fromIndex, toIndex),
      title: 'No diff available',
      subtitle: '',
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
}
