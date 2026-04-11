import { buildMockPreview, mockData } from './mock-data';
import type { TimelineCommand, TimelineHost, TimelineInboundMessage } from './types';

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

  return {
    send(command) {
      if (command.command === 'ready' || command.command === 'refresh') {
        queueMicrotask(() => {
          emit({ type: 'timeline-data', payload: mockData });
          emit({ type: 'diff-preview', payload: buildMockPreview(mockData.defaultIndex - 1, mockData.defaultIndex) });
        });
        return;
      }

      if (command.command === 'select-entry') {
        queueMicrotask(() => {
          emit({ type: 'diff-preview', payload: buildMockPreview(command.fromIndex, command.toIndex) });
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
}