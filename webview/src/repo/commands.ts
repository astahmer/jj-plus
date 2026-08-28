import { Effect, Schema as S } from 'effect';
import { Command } from 'foldkit';
import { CompletedSendHost } from './messages.ts';
import type { RepoTimelineCommand } from './types.ts';
import { createRepoHost } from './host.ts';

const host = createRepoHost();
const HostCommandSchema = S.Unknown as unknown as S.Schema<RepoTimelineCommand>;

export const SendHostCommand = Command.define(
	'SendRepoHostCommand',
	{ command: HostCommandSchema },
	CompletedSendHost,
)(({ command }) =>
	Effect.sync(() => {
		host.send(command);
		return CompletedSendHost();
	}),
);

export function subscribeRepoHost(listener: Parameters<ReturnType<typeof createRepoHost>['subscribe']>[0]): () => void {
	return host.subscribe(listener);
}
