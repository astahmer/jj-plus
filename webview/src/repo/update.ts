import { Match as M } from 'effect';
import type { Command } from 'foldkit';
import { evo } from 'foldkit/struct';
import { SendHostCommand } from './commands.ts';
import type { Message } from './messages.ts';
import { initialModel, type Model } from './model.ts';
import type { RepoTimelineData, RepoTimelineInboundMessage } from './types.ts';

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];

function refreshCommand(model: Model): Command.Command<Message> {
	return SendHostCommand({
		command: {
			command: 'refresh',
			revset: model.revset.trim() || 'ancestors(@)',
		},
	});
}

function handleHostMessage(model: Model, payload: unknown): UpdateReturn {
	const message = payload as RepoTimelineInboundMessage;
	if (message.type === 'repo-timeline-data') {
		const data = message.payload as RepoTimelineData;
		const selectedIndex = Math.max(0, data.entries.length - 1);
		return [evo(model, { data: () => data, selectedIndex: () => selectedIndex, loading: () => false, error: () => '' }), []];
	}
	if (message.type === 'repo-timeline-diff') {
		return [evo(model, { diff: () => message.payload }), []];
	}
	if (message.type === 'repo-timeline-error') {
		return [evo(model, { loading: () => false, error: () => message.payload.message }), []];
	}
	return [model, []];
}

export function init(): UpdateReturn {
	return [initialModel, [SendHostCommand({ command: { command: 'ready' } })]];
}

export function update(model: Model, message: Message): UpdateReturn {
	return M.value(message).pipe(
		M.withReturnType<UpdateReturn>(),
		M.tagsExhaustive({
			BootedApp: () => [model, []],
			CompletedSendHost: () => [model, []],
			GotHostMessage: ({ payload }) => handleHostMessage(model, payload),
			UpdatedQuery: ({ value }) => [evo(model, { query: () => value }), []],
			UpdatedRevset: ({ value }) => [evo(model, { revset: () => value }), []],
			ClickedRefresh: () => [evo(model, { loading: () => true, error: () => '' }), [refreshCommand(model)]],
			ClickedRevision: ({ index }) => [evo(model, { selectedIndex: () => index, diff: () => null }), [SendHostCommand({ command: { command: 'select-revision', index } })]],
			ClickedRemote: ({ index }) => [model, [SendHostCommand({ command: { command: 'open-revision-remote', index } })]],
			ToggledSort: () => [evo(model, { oldestFirst: (value) => !value }), []],
		}),
	);
}
