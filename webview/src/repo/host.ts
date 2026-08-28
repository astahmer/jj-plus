import type { RepoTimelineCommand, RepoTimelineInboundMessage } from './types.ts';

export type RepoHost = {
	send(command: RepoTimelineCommand): void;
	subscribe(listener: (message: RepoTimelineInboundMessage) => void): () => void;
};

export function createRepoHost(): RepoHost {
	const vscode = window.acquireVsCodeApi?.() as { postMessage(command: RepoTimelineCommand): void } | undefined;
	const listeners = new Set<(message: RepoTimelineInboundMessage) => void>();
	const handler = (event: MessageEvent<RepoTimelineInboundMessage>) => {
		if (event.data && typeof event.data === 'object' && 'type' in event.data) {
			listeners.forEach((listener) => listener(event.data));
		}
	};
	window.addEventListener('message', handler);

	return {
		send(command) {
			if (vscode) vscode.postMessage(command);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
