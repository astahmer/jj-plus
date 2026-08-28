import { html, type Html } from 'foldkit/html';
import type { Message } from './messages.ts';
import {
	ClearedSearch,
	ClickedRefresh,
	ClickedRemote,
	ClickedRevision,
	SelectedMatchMode,
	SelectedSearchMode,
	SubmittedSearch,
	ToggledSort,
	UpdatedAfter,
	UpdatedPath,
	UpdatedQuery,
	UpdatedRevset,
	UpdatedUntil,
} from './messages.ts';
import type { Model } from './model.ts';
import type { RepoRevisionEntry, RepoTimelineData, RepoTimelineDiff, RepoTimelineSearchPayload, RepoTimelineSearchResult } from './types.ts';
import { queueRepoPierreDiffSync } from './pierre.ts';

function dataOf(model: Model): RepoTimelineData | null {
	return model.data as RepoTimelineData | null;
}

function diffOf(model: Model): RepoTimelineDiff | null {
	return model.diff as RepoTimelineDiff | null;
}

function searchOf(model: Model): RepoTimelineSearchPayload | null {
	return model.searchResults as RepoTimelineSearchPayload | null;
}

function matches(entry: RepoRevisionEntry, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [entry.revision, entry.changeId, entry.authorName, entry.description, ...(entry.bookmarkNames || []), ...(entry.branchNames || [])]
		.filter(Boolean)
		.some((value) => String(value).toLowerCase().includes(needle));
}

function visibleEntries(model: Model): Array<RepoRevisionEntry> {
	const data = dataOf(model);
	if (!data) return [];
	const search = searchOf(model);
	const resultIndexes = search ? new Set(search.results.map((result) => result.entryIndex)) : undefined;
	const entries = data.entries.filter((entry) => (resultIndexes ? resultIndexes.has(entry.index) : matches(entry, model.query)));
	return model.oldestFirst ? entries : entries.toReversed();
}

function resultForEntry(model: Model, entry: RepoRevisionEntry): RepoTimelineSearchResult | undefined {
	return searchOf(model)?.results.find((result) => result.entryIndex === entry.index);
}

function patchStats(patch: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of patch.split(/\r?\n/u)) {
		if (line.startsWith('+++') || line.startsWith('---')) continue;
		if (line.startsWith('+')) additions += 1;
		if (line.startsWith('-')) deletions += 1;
	}
	return { additions, deletions };
}

function renderEntry(entry: RepoRevisionEntry, selected: boolean, hit?: RepoTimelineSearchResult): Html {
	const h = html<Message>();
	const refs = [...(entry.bookmarkNames || []), ...(entry.branchNames || [])];
	return h.button(
		[
			h.Class(`repo-entry${selected ? ' is-selected' : ''}`),
			h.Type('button'),
			h.OnClick(ClickedRevision({ index: entry.index })),
			h.AriaPressed(String(selected)),
			h.Title(entry.description),
		],
		[
			h.div(
				[h.Class('repo-entry-top')],
				[
					h.span([h.Class('repo-entry-id')], [entry.changeId || entry.shortRevision]),
					h.span([h.Class('repo-entry-date')], [entry.relativeDate || entry.shortDate || '']),
				],
			),
			h.div([h.Class('repo-entry-title')], [entry.description || 'No description']),
			hit ? h.div([h.Class('repo-entry-hit')], [`${hit.filePath || 'metadata'}${hit.line ? `:${hit.line}` : ''}${hit.detail ? ` · ${hit.detail}` : ''}`]) : h.empty,
			h.div(
				[h.Class('repo-entry-meta')],
				[
					h.span([], [entry.authorName || 'Unknown author']),
					refs.length ? h.span([h.Class('repo-entry-refs')], [refs.join(' · ')]) : h.empty,
				],
			),
		],
	);
}

function renderDiff(model: Model): Html {
	const h = html<Message>();
	const diff = diffOf(model);
	const data = dataOf(model);
	const entry = data?.entries[model.selectedIndex];
	if (model.loading && !diff) {
		return h.div([h.Class('repo-empty repo-loading'), h.Role('status')], ['Loading repository history…']);
	}
	if (model.error) {
		return h.div([h.Class('repo-empty repo-error'), h.Role('alert')], [model.error]);
	}
	if (!entry || !diff) {
		return h.div([h.Class('repo-empty')], ['Select a revision to inspect its changes.']);
	}
	const stats = patchStats(diff.patch);
	return h.div(
		[h.Class('repo-detail')],
		[
			h.div(
				[h.Class('repo-detail-head')],
				[
					h.div(
						[h.Class('repo-detail-heading')],
						[
							h.div([h.Class('eyebrow')], ['Selected revision']),
							h.h2([], [entry.description || 'No description']),
							h.div([h.Class('repo-detail-subtitle')], [`${entry.shortRevision} · ${entry.authorName} · ${entry.authorDate}`]),
						],
					),
					h.div(
						[h.Class('repo-detail-actions')],
						[
							entry.remoteUrl
								? h.button([h.Class('repo-action'), h.Type('button'), h.OnClick(ClickedRemote({ index: entry.index }))], ['Open remote'])
								: h.empty,
						],
					),
				],
			),
			h.div(
				[h.Class('repo-detail-stats')],
				[
					h.span([h.Class('repo-stat repo-stat-files')], [`${diff.files.length} file${diff.files.length === 1 ? '' : 's'}`]),
					h.span([h.Class('repo-stat repo-stat-add')], [`+${stats.additions}`]),
					h.span([h.Class('repo-stat repo-stat-delete')], [`-${stats.deletions}`]),
				],
			),
			diff.files.length
				? h.div([h.Class('repo-file-list')], diff.files.map((file) => h.span([h.Class('repo-file')], [file.path])))
				: h.div([h.Class('repo-empty-diff')], ['No changed files in this revision.']),
			h.div([h.Class('repo-pierre-slot'), h.Id('repo-pierre-slot'), h.AriaLabel('Revision diff')], []),
			!diff.files.length && diff.patch ? h.pre([h.Class('repo-patch-fallback'), h.AriaLabel('Raw revision patch')], [diff.patch]) : h.empty,
		],
	);
}

export function view(model: Model): Html {
	const h = html<Message>();
	const data = dataOf(model);
	const entries = visibleEntries(model);
	if (typeof window !== 'undefined') queueRepoPierreDiffSync(model);
	const search = searchOf(model);
	const resultCount = search?.results.length ?? 0;
	return h.div(
		[h.Class('repo-app')],
		[
			h.header(
				[h.Class('repo-header')],
				[
					h.div([h.Class('repo-brand')], ['JJ Plus']),
					h.div([h.Class('repo-header-copy')], [
						h.div([h.Class('eyebrow')], ['Repository view']),
						h.h1([], [data?.repositoryName || 'Repo Timeline']),
					]),
					h.div([h.Class('repo-header-meta')], [data ? `${data.backend} · ${search ? `${resultCount} matches` : `${entries.length} revisions`}` : 'Preparing…']),
				],
			),
			h.section(
				[h.Class('repo-toolbar')],
				[
					h.label([h.Class('repo-field repo-query-field')], [
						h.span([h.Class('repo-field-label')], ['Search repository']),
						h.input([h.Type('search'), h.Value(model.query), h.Placeholder('text, author, or content'), h.OnInput((value) => UpdatedQuery({ value }))]),
				]),
					h.label([h.Class('repo-field repo-revset-field')], [
						h.span([h.Class('repo-field-label')], ['Revset']),
						h.input([h.Value(model.revset), h.Placeholder('ancestors(@)'), h.OnInput((value) => UpdatedRevset({ value }))]),
				]),
					h.div([h.Class('repo-search-mode')], ['Search in', ...(['metadata', 'changes', 'snapshot'] as const).map((value) => h.button([h.Class(`repo-mode-button${model.searchMode === value ? ' is-active' : ''}`), h.Type('button'), h.OnClick(SelectedSearchMode({ value })), h.AriaPressed(String(model.searchMode === value))], [value]))]),
					h.div([h.Class('repo-search-mode')], ['Match', ...(['literal', 'regex', 'fuzzy'] as const).map((value) => h.button([h.Class(`repo-mode-button${model.matchMode === value ? ' is-active' : ''}`), h.Type('button'), h.OnClick(SelectedMatchMode({ value })), h.AriaPressed(String(model.matchMode === value))], [value]))]),
					h.label([h.Class('repo-field repo-filter-field')], [h.span([h.Class('repo-field-label')], ['Path']), h.input([h.Value(model.path), h.Placeholder('src/'), h.OnInput((value) => UpdatedPath({ value }))])]),
					h.label([h.Class('repo-field repo-date-field')], [h.span([h.Class('repo-field-label')], ['After']), h.input([h.Type('date'), h.Value(model.after), h.OnInput((value) => UpdatedAfter({ value }))])]),
					h.label([h.Class('repo-field repo-date-field')], [h.span([h.Class('repo-field-label')], ['Until']), h.input([h.Type('date'), h.Value(model.until), h.OnInput((value) => UpdatedUntil({ value }))])]),
					h.button([h.Class('repo-toolbar-action repo-search-action'), h.Type('button'), h.OnClick(SubmittedSearch()), h.Disabled(model.searchLoading)], [model.searchLoading ? 'Searching…' : 'Search']),
					h.button([h.Class('repo-toolbar-action'), h.Type('button'), h.OnClick(ClearedSearch()), h.Disabled(!model.query && !model.path && !model.after && !model.until)], ['Clear']),
					h.button([h.Class('repo-toolbar-action'), h.Type('button'), h.OnClick(ClickedRefresh()), h.Disabled(model.loading)], ['Refresh']),
					h.button([h.Class('repo-toolbar-action repo-sort-action'), h.Type('button'), h.OnClick(ToggledSort())], [model.oldestFirst ? 'Newest first' : 'Oldest first']),
				],
			),
			model.loading && !data ? h.div([h.Class('repo-progress'), h.Role('progressbar')], []) : h.empty,
			model.searchError ? h.div([h.Class('repo-search-error'), h.Role('alert')], [model.searchError]) : h.empty,
			h.main(
				[h.Class('repo-main')],
				[
					h.aside(
						[h.Class('repo-results-panel')],
						[
							h.div([h.Class('repo-results-head')], [h.span([], ['Revisions']), h.span([h.Class('repo-results-count')], [data ? `${entries.length}${data.truncated && !model.query ? '+' : ''}` : '—'])]),
							entries.length ? h.div([h.Class('repo-results-list')], entries.map((entry) => renderEntry(entry, entry.index === model.selectedIndex, resultForEntry(model, entry)))) : h.div([h.Class('repo-empty')], [search ? 'No matches for this search.' : data?.entries.length ? 'No revisions in this revset.' : 'Loading revisions…']),
						],
					),
					h.section([h.Class('repo-detail-panel')], [renderDiff(model)]),
				],
			),
		],
	);
}
