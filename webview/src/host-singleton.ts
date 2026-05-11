import { createTimelineHost } from './host/host.ts';
import type { TimelineHost, TimelineInboundMessage } from './types.ts';

let currentHost: TimelineHost | null = null;
const externalListeners = new Set<(message: TimelineInboundMessage) => void>();

export function getHost(): TimelineHost {
	if (!currentHost) {
		const host = createTimelineHost();
		currentHost = host;
		host.subscribe((message) => {
			externalListeners.forEach((listener) => listener(message));
		});
	}
	return currentHost;
}

export function subscribeHost(listener: (message: TimelineInboundMessage) => void): () => void {
	externalListeners.add(listener);
	return () => externalListeners.delete(listener);
}
