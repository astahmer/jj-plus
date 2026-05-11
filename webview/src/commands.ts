import { Effect, Schema as S } from 'effect';
import { Command } from 'foldkit';
import { getHost } from './host-singleton.ts';
import {
	BootedApp,
	CompletedFocusElement,
	CompletedPersistState,
	CompletedScrollToEntry,
	CompletedSendHost,
} from './messages.ts';
import type { TimelineCommand } from './types.ts';

const HostCommandSchema = S.Unknown as unknown as S.Schema<TimelineCommand>;

export const SendHostCommand = Command.define(
	'SendHostCommand',
	{ command: HostCommandSchema },
	CompletedSendHost,
)(({ command }) =>
	Effect.sync(() => {
		getHost().send(command);
		return CompletedSendHost();
	}),
);

export const BootSession = Command.define(
	'BootSession',
	BootedApp,
)(
	Effect.sync(() => {
		getHost().send({ command: 'ready' });
		return BootedApp();
	}),
);

export const PersistState = Command.define(
	'PersistState',
	{ command: HostCommandSchema },
	CompletedPersistState,
)(({ command }) =>
	Effect.sync(() => {
		getHost().send(command);
		return CompletedPersistState();
	}),
);

export const FocusElement = Command.define(
	'FocusElement',
	{ elementId: S.String },
	CompletedFocusElement,
)(({ elementId }) =>
	Effect.sync(() => {
		window.requestAnimationFrame(() => {
			const element = document.getElementById(elementId);
			if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
				element.focus();
				element.select();
				return;
			}
			(element as HTMLElement | null)?.focus?.();
		});
		return CompletedFocusElement();
	}),
);

export const ScrollToEntry = Command.define(
	'ScrollToEntry',
	{ entryIndex: S.Number },
	CompletedScrollToEntry,
)(({ entryIndex }) =>
	Effect.sync(() => {
		window.requestAnimationFrame(() => {
			const entry = document.querySelector(`.history-item[data-entry-index="${entryIndex}"]`);
			if (!(entry instanceof HTMLElement)) {
				return;
			}
			entry.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			entry.focus({ preventScroll: true });
		});
		return CompletedScrollToEntry();
	}),
);
