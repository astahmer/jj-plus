import { Effect, Queue, Stream } from 'effect';
import { Subscription } from 'foldkit';
import { subscribeRepoHost } from './commands.ts';
import { GotHostMessage } from './messages.ts';
import type { Message } from './messages.ts';
import type { Model } from './model.ts';

const hostStream: Stream.Stream<Message> = Stream.callback<Message>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const unsubscribe = subscribeRepoHost((payload) => Queue.offerUnsafe(queue, GotHostMessage({ payload })));
			return { unsubscribe };
		}),
		({ unsubscribe }) => Effect.sync(() => unsubscribe()),
	).pipe(Effect.flatMap(() => Effect.never)),
);

export const subscriptions = Subscription.make<Model, Message>()(() => ({
	host: Subscription.persistent(hostStream),
}));
