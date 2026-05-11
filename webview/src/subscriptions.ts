import { Effect, Option, Queue, Schema as S, Stream } from 'effect';
import { Subscription } from 'foldkit';
import { subscribeHost } from './host-singleton.ts';
import type { Message } from './messages.ts';
import { GotHostMessage, PressedShortcut } from './messages.ts';
import type { Model } from './model.ts';

const EDITABLE_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	if (target instanceof HTMLTextAreaElement) {
		return true;
	}
	if (target instanceof HTMLInputElement) {
		const type = (target.getAttribute('type') || 'text').toLowerCase();
		return EDITABLE_INPUT_TYPES.has(type);
	}
	return false;
}

const hostStream: Stream.Stream<Message> = Stream.callback<Message>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const unsubscribe = subscribeHost((payload) => {
				Queue.offerUnsafe(queue, GotHostMessage({ payload }));
			});
			return { unsubscribe };
		}),
		({ unsubscribe }) => Effect.sync(() => unsubscribe()),
	).pipe(Effect.flatMap(() => Effect.never)),
);

const keyboardStream: Stream.Stream<Message> = Subscription.fromEventFilterMap<KeyboardEvent, Message>({
	target: () => window,
	type: 'keydown',
	toMessage: (event) => {
		const targetId = event.target instanceof HTMLElement ? event.target.id : '';
		return Option.some(
			PressedShortcut({
				key: event.key,
				shiftKey: event.shiftKey,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				altKey: event.altKey,
				targetId,
				isEditableTarget: isEditableTarget(event.target),
			}),
		);
	},
});

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	host: Subscription.persistent(hostStream),
	keyboard: entry(
		{ hotkeysOpen: S.Boolean },
		{
			modelToDependencies: (model) => ({ hotkeysOpen: model.hotkeysOpen }),
			dependenciesToStream: () => keyboardStream,
		},
	),
}));
