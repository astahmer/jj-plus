import { Match as M } from 'effect';
import type { Command } from 'foldkit';
import { evo } from 'foldkit/struct';
import { SendHostCommand } from './commands.ts';
import type { Message } from './messages.ts';
import { initialModel, type Model } from './model.ts';
import type { RepoTimelineData, RepoTimelineInboundMessage, RepoTimelineSearchPayload } from './types.ts';

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];

function refreshCommand(model: Model): Command.Command<Message> {
	return SendHostCommand({
		command: {
			command: 'refresh',
			revset: model.revset.trim() || 'ancestors(@)',
		},
	});
}

function searchCommand(model: Model, requestId: number): Command.Command<Message> {
	return SendHostCommand({
		command: {
			command: 'search',
			request: {
				requestId,
				query: model.query,
				mode: model.searchMode,
				matchMode: model.matchMode,
				path: model.path || undefined,
				after: model.after || undefined,
				until: model.until || undefined,
				selectedIndex: model.selectedIndex,
			},
		},
	});
}

function handleHostMessage(model: Model, payload: unknown): UpdateReturn {
	const message = payload as RepoTimelineInboundMessage;
	if (message.type === 'repo-timeline-data') {
		const data = message.payload as RepoTimelineData;
		const selectedIndex = Math.max(0, data.entries.length - 1);
		return [evo(model, { data: () => data, selectedIndex: () => selectedIndex, loading: () => false, error: () => '', searchResults: () => null }), []];
	}
	if (message.type === 'repo-timeline-diff') {
		return [evo(model, { diff: () => message.payload }), []];
	}
	if (message.type === 'repo-timeline-error') {
		return [evo(model, { loading: () => false, error: () => message.payload.message, searchLoading: () => false, searchError: () => message.payload.message }), []];
	}
	if (message.type === 'repo-timeline-search') {
		const searchPayload = message.payload as RepoTimelineSearchPayload;
		if (searchPayload.requestId !== model.searchRequestId) return [model, []];
		const first = searchPayload.results[0];
		return [evo(model, { searchResults: () => searchPayload, searchLoading: () => false, searchError: () => '', selectedIndex: () => first?.entryIndex ?? model.selectedIndex }), []];
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
			UpdatedQuery: ({ value }) => [evo(model, { query: () => value, searchResults: () => null }), []],
			UpdatedRevset: ({ value }) => [evo(model, { revset: () => value }), []],
			UpdatedPath: ({ value }) => [evo(model, { path: () => value, searchResults: () => null }), []],
			UpdatedAfter: ({ value }) => [evo(model, { after: () => value, searchResults: () => null }), []],
			UpdatedUntil: ({ value }) => [evo(model, { until: () => value, searchResults: () => null }), []],
			SelectedSearchMode: ({ value }) => [evo(model, { searchMode: () => value, searchResults: () => null }), []],
			SelectedMatchMode: ({ value }) => [evo(model, { matchMode: () => value, searchResults: () => null }), []],
			SubmittedSearch: () => {
				const requestId = model.searchRequestId + 1;
				return [evo(model, { searchLoading: () => true, searchError: () => '', searchResults: () => null, searchRequestId: () => requestId }), [searchCommand(model, requestId)]];
			},
			ClearedSearch: () => [evo(model, { query: () => '', path: () => '', after: () => '', until: () => '', searchResults: () => null, searchError: () => '' }), []],
			ClickedRefresh: () => [evo(model, { loading: () => true, error: () => '' }), [refreshCommand(model)]],
			ClickedRevision: ({ index }) => [evo(model, { selectedIndex: () => index, diff: () => null }), [SendHostCommand({ command: { command: 'select-revision', index } })]],
			ClickedRemote: ({ index }) => [model, [SendHostCommand({ command: { command: 'open-revision-remote', index } })]],
			ToggledSort: () => [evo(model, { oldestFirst: (value) => !value }), []],
		}),
	);
}
