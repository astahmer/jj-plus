import * as BrowserHttpClient from '@effect/platform-browser/BrowserHttpClient';
import { Array, Effect, String as EffectString, Match as M, Option, Schema as S, pipe } from 'effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { Command, Route, Runtime } from 'foldkit';
import { Document, Html, html } from 'foldkit/html';
import { m } from 'foldkit/message';
import { UrlRequest, load, pushUrl, replaceUrl } from 'foldkit/navigation';
import { r } from 'foldkit/route';
import { ts } from 'foldkit/schema';
import { evo } from 'foldkit/struct';
import { Url, toString as urlToString } from 'foldkit/url';

import * as FiltersDialog from './filters-dialog';
import * as SearchInput from './search-input';

const SearchMode = S.Union([S.Literal('exact'), S.Literal('prefix')]);
type SearchMode = typeof SearchMode.Type;

const parseMode = (value: string): SearchMode => (value === 'prefix' ? 'prefix' : 'exact');

const AspectRatio = S.Struct({
	width: S.Number,
	height: S.Number,
});

const ImageEmbed = S.Struct({
	$type: S.Literal('app.bsky.embed.images#view'),
	images: S.Array(
		S.Struct({
			thumb: S.String,
			fullsize: S.String,
			alt: S.String,
			aspectRatio: S.optional(AspectRatio),
		}),
	),
});

const VideoEmbed = S.Struct({
	$type: S.Literal('app.bsky.embed.video#view'),
	cid: S.String,
	playlist: S.String,
	thumbnail: S.String,
	alt: S.optional(S.String),
	aspectRatio: S.optional(AspectRatio),
});

const ExternalEmbed = S.Struct({
	$type: S.Literal('app.bsky.embed.external#view'),
	external: S.Struct({
		uri: S.String,
		title: S.String,
		description: S.String,
		thumb: S.optional(S.String),
	}),
});

const Embed = S.Union([ImageEmbed, VideoEmbed, ExternalEmbed, S.Unknown]);

const FacetFeature = S.Union([
	S.Struct({
		$type: S.Literal('app.bsky.richtext.facet#mention'),
		did: S.String,
	}),
	S.Struct({
		$type: S.Literal('app.bsky.richtext.facet#link'),
		uri: S.String,
	}),
	S.Struct({
		$type: S.Literal('app.bsky.richtext.facet#tag'),
		tag: S.String,
	}),
	S.Unknown,
]);

const Facet = S.Struct({
	index: S.Struct({
		byteStart: S.Number,
		byteEnd: S.Number,
	}),
	features: S.Array(FacetFeature),
});

const Actor = S.Struct({
	did: S.String,
	handle: S.optional(S.NullOr(S.String)),
});

const SearchScope = S.Union([S.Literal('likes'), S.Literal('posts'), S.Literal('reposts')]);
type SearchScope = typeof SearchScope.Type;

const SearchResponse = S.Struct({
	actors: S.Array(Actor),
	query: S.String,
	mode: SearchMode,
	scope: S.Array(SearchScope),
	totalFetched: S.Number,
	totalMatches: S.Number,
	results: S.Array(
		S.Struct({
			sourceActor: Actor,
			sourceScope: SearchScope,
			likeUri: S.optional(S.NullOr(S.String)),
			likeCreatedAt: S.optional(S.NullOr(S.String)),
			repostUri: S.optional(S.NullOr(S.String)),
			repostCreatedAt: S.optional(S.NullOr(S.String)),
			postUri: S.String,
			postCreatedAt: S.String,
			text: S.String,
			authorDid: S.String,
			authorHandle: S.optional(S.NullOr(S.String)),
			authorDisplayName: S.optional(S.NullOr(S.String)),
			bskyUrl: S.String,
			embed: S.optional(Embed),
			facets: S.optional(S.Array(Facet)),
			likeCount: S.optional(S.Number),
			repostCount: S.optional(S.Number),
		}),
	),
});

type SearchResponse = typeof SearchResponse.Type;

// ROUTE

export const SearchRoute = r('Search', {
	actor: S.Option(S.String),
	q: S.Option(S.String),
	mode: S.Option(SearchMode),
	scope: S.Option(S.String),
});

export const NotFoundRoute = r('NotFound', { path: S.String });

const AppRoute = S.Union([SearchRoute, NotFoundRoute]);
type AppRoute = typeof AppRoute.Type;

const searchRouter = pipe(
	Route.root,
	Route.query(
		S.Struct({
			actor: S.OptionFromOptional(S.String),
			q: S.OptionFromOptional(S.String),
			mode: S.OptionFromOptional(SearchMode),
			scope: S.OptionFromOptional(S.String),
		}),
	),
	Route.mapTo(SearchRoute),
);

const routeParser = Route.oneOf(searchRouter);
const urlToAppRoute = Route.parseUrlWithFallback(routeParser, NotFoundRoute);

// MODEL

const SearchIdle = ts('SearchIdle');
const SearchLoading = ts('SearchLoading');
const SearchError = ts('SearchError', { error: S.String });
const SearchOk = ts('SearchOk', { response: SearchResponse });

const SearchState = S.Union([SearchIdle, SearchLoading, SearchError, SearchOk]);
type SearchState = typeof SearchState.Type;

export const Model = S.Struct({
	route: AppRoute,
	actorInput: S.String,
	queryInput: S.String,
	modeInput: SearchMode,
	scopeInput: S.String,
	searchState: SearchState,
	showEmptyWarning: S.Boolean,
	searchInput: SearchInput.Model,
	filtersDialog: FiltersDialog.Model,
});
export type Model = typeof Model.Type;

// MESSAGE

export const CompletedNavigateInternal = m('CompletedNavigateInternal');
export const CompletedLoadExternal = m('CompletedLoadExternal');
export const CompletedReplaceUrl = m('CompletedReplaceUrl');
export const GotSearchInputMessage = m('GotSearchInputMessage', {
	message: SearchInput.Message,
});
export const GotFiltersDialogMessage = m('GotFiltersDialogMessage', {
	message: FiltersDialog.Message,
});
export const ClickedLink = m('ClickedLink', { request: UrlRequest });
export const ChangedUrl = m('ChangedUrl', { url: Url });
export const ChangedActorInput = m('ChangedActorInput', { value: S.String });
export const ChangedModeInput = m('ChangedModeInput', { mode: SearchMode });
export const ChangedScopeInput = m('ChangedScopeInput', { value: S.String });
export const SubmittedSearch = m('SubmittedSearch');
export const SucceededSearch = m('SucceededSearch', {
	response: SearchResponse,
});
export const FailedSearch = m('FailedSearch', { error: S.String });

export const Message = S.Union([
	CompletedNavigateInternal,
	CompletedLoadExternal,
	CompletedReplaceUrl,
	GotSearchInputMessage,
	GotFiltersDialogMessage,
	ClickedLink,
	ChangedUrl,
	ChangedActorInput,
	ChangedModeInput,
	ChangedScopeInput,
	SubmittedSearch,
	SucceededSearch,
	FailedSearch,
]);
export type Message = typeof Message.Type;

// INIT

type SearchFields = Omit<typeof SearchRoute.Type, '_tag'>;

const emptySearchFields: SearchFields = {
	actor: Option.none(),
	q: Option.none(),
	mode: Option.none(),
	scope: Option.none(),
};

const routeToSearchFields = (route: AppRoute): SearchFields =>
	M.value(route).pipe(
		M.tag('Search', (route) => route),
		M.orElse(() => emptySearchFields),
	);

const defaultScopeInput = 'likes';

const shouldSearch = (model: Model): boolean =>
	EffectString.isNonEmpty(model.actorInput) && EffectString.isNonEmpty(model.queryInput);

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url: Url) => {
	const route = urlToAppRoute(url);
	const fields = routeToSearchFields(route);

	const actorInput = Option.getOrElse(fields.actor, () => '');
	const queryInput = Option.getOrElse(fields.q, () => '');
	const modeInput = parseMode(Option.getOrElse(fields.mode, () => 'exact'));
	const scopeInput = Option.getOrElse(fields.scope, () => defaultScopeInput);

	const hasSearchParams = EffectString.isNonEmpty(actorInput) && EffectString.isNonEmpty(queryInput);

	const model: Model = {
		route,
		actorInput,
		queryInput,
		modeInput,
		scopeInput,
		searchState: SearchIdle(),
		showEmptyWarning: false,
		searchInput: SearchInput.init(),
		filtersDialog: FiltersDialog.init(queryInput),
	};

	const commands = hasSearchParams
		? [SearchLikes({ actor: actorInput, q: queryInput, mode: modeInput, scope: scopeInput })]
		: [];

	return [model, commands];
};

// COMMANDS

const SearchLikes = Command.define(
	'SearchLikes',
	{ actor: S.String, q: S.String, mode: SearchMode, scope: S.String },
	SucceededSearch,
	FailedSearch,
)(({ actor, q, mode, scope }) =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;
		const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';
		const url = `${apiBaseUrl}/api/search?actor=${encodeURIComponent(actor)}&q=${encodeURIComponent(q)}&mode=${mode}&scope=${encodeURIComponent(scope)}`;
		const response = yield* client.get(url);

		if (response.status >= 400) {
			const text = yield* response.text;
			return FailedSearch({
				error: `Search failed (${response.status}): ${text}`,
			});
		}

		const json = yield* response.json;
		const responseBody = S.decodeUnknownSync(SearchResponse)(json);
		return SucceededSearch({ response: responseBody });
	}).pipe(
		Effect.catch((error) => Effect.succeed(FailedSearch({ error: globalThis.String(error) }))),
		Effect.provide(BrowserHttpClient.layerXMLHttpRequest),
	),
);

const NavigateInternal = Command.define(
	'NavigateInternal',
	{ url: S.String },
	CompletedNavigateInternal,
)(({ url }) => pushUrl(url).pipe(Effect.as(CompletedNavigateInternal())));

const LoadExternal = Command.define(
	'LoadExternal',
	{ href: S.String },
	CompletedLoadExternal,
)(({ href }) => load(href).pipe(Effect.as(CompletedLoadExternal())));

const ReplaceSearch = Command.define(
	'ReplaceSearch',
	{
		actor: S.String,
		q: S.String,
		mode: SearchMode,
		scope: S.String,
	},
	CompletedReplaceUrl,
)(({ actor, q, mode, scope }) =>
	replaceUrl(
		searchRouter({
			actor: Option.liftPredicate(actor, EffectString.isNonEmpty),
			q: Option.liftPredicate(q, EffectString.isNonEmpty),
			mode: Option.some(mode),
			scope: Option.some(scope),
		}),
	).pipe(Effect.as(CompletedReplaceUrl())),
);

// UPDATE

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];
const withUpdateReturn = M.withReturnType<UpdateReturn>();

const searchInputWithQuery = (searchInput: SearchInput.Model, query: string): SearchInput.Model => {
	const [nextSearchInput] = SearchInput.update(searchInput, query, SearchInput.ChangedQueryInput({ query }));

	return nextSearchInput;
};

const updateSearchInput = (model: Model, message: SearchInput.Message): UpdateReturn => {
	const [nextSearchInput, commands, maybeOutMessage] = SearchInput.update(model.searchInput, model.queryInput, message);

	const mappedCommands = Command.mapMessages(
		commands,
		(childMessage): Message => GotSearchInputMessage({ message: childMessage }),
	);

	return Option.match(maybeOutMessage, {
		onNone: () => [evo(model, { searchInput: () => nextSearchInput }), mappedCommands],
		onSome: (outMessage) =>
			M.value(outMessage).pipe(
				withUpdateReturn,
				M.tagsExhaustive({
					ChangedQuery: ({ value }) => [
						evo(model, {
							queryInput: () => value,
							showEmptyWarning: () => false,
							searchInput: () => nextSearchInput,
						}),
						mappedCommands,
					],
				}),
			),
	});
};

const updateFiltersDialog = (model: Model, message: FiltersDialog.Message): UpdateReturn => {
	const [nextFiltersDialog, commands, maybeOutMessage] = FiltersDialog.update(model.filtersDialog, message);

	const mappedCommands = Command.mapMessages(
		commands,
		(childMessage): Message => GotFiltersDialogMessage({ message: childMessage }),
	);

	return Option.match(maybeOutMessage, {
		onNone: () => [evo(model, { filtersDialog: () => nextFiltersDialog }), mappedCommands],
		onSome: (outMessage) =>
			M.value(outMessage).pipe(
				withUpdateReturn,
				M.tagsExhaustive({
					AppliedFilters: ({ query }) => {
						const [nextSearchInput] = SearchInput.update(
							model.searchInput,
							query,
							SearchInput.ChangedQueryInput({ query }),
						);

						return [
							evo(model, {
								queryInput: () => query,
								showEmptyWarning: () => false,
								searchInput: () => nextSearchInput,
								filtersDialog: () => nextFiltersDialog,
							}),
							mappedCommands,
						];
					},
				}),
			),
	});
};

export const update = (model: Model, message: Message): UpdateReturn =>
	M.value(message).pipe(
		withUpdateReturn,
		M.tagsExhaustive({
			CompletedNavigateInternal: () => [model, []],
			CompletedLoadExternal: () => [model, []],
			CompletedReplaceUrl: () => [model, []],

			GotSearchInputMessage: ({ message }) => updateSearchInput(model, message),

			GotFiltersDialogMessage: ({ message }) => updateFiltersDialog(model, message),

			ClickedLink: ({ request }) =>
				M.value(request).pipe(
					withUpdateReturn,
					M.tagsExhaustive({
						Internal: ({ url }) => [model, [NavigateInternal({ url: urlToString(url) })]],
						External: ({ href }) => [model, [LoadExternal({ href })]],
					}),
				),

			ChangedUrl: ({ url }) => {
				const nextRoute = urlToAppRoute(url);
				const fields = routeToSearchFields(nextRoute);
				const nextQueryInput = Option.getOrElse(fields.q, () => '');
				const nextSearchInput = searchInputWithQuery(model.searchInput, nextQueryInput);

				return [
					evo(model, {
						route: () => nextRoute,
						actorInput: () => Option.getOrElse(fields.actor, () => ''),
						queryInput: () => nextQueryInput,
						modeInput: () => parseMode(Option.getOrElse(fields.mode, () => 'exact')),
						scopeInput: () => Option.getOrElse(fields.scope, () => defaultScopeInput),
						showEmptyWarning: () => false,
						searchInput: () => nextSearchInput,
						filtersDialog: () => FiltersDialog.init(nextQueryInput),
					}),
					[],
				];
			},

			ChangedActorInput: ({ value }) => {
				const [nextSearchInput] = SearchInput.update(
					model.searchInput,
					model.queryInput,
					SearchInput.ClosedSuggestions(),
				);

				return [
					evo(model, {
						actorInput: () => value,
						showEmptyWarning: () => false,
						searchInput: () => nextSearchInput,
					}),
					[],
				];
			},

			ChangedModeInput: ({ mode }) => {
				const [nextSearchInput] = SearchInput.update(
					model.searchInput,
					model.queryInput,
					SearchInput.ClosedSuggestions(),
				);

				return [
					evo(model, {
						modeInput: () => mode,
						showEmptyWarning: () => false,
						searchInput: () => nextSearchInput,
					}),
					[],
				];
			},

			ChangedScopeInput: ({ value }) => {
				const [nextSearchInput] = SearchInput.update(
					model.searchInput,
					model.queryInput,
					SearchInput.ClosedSuggestions(),
				);

				return [
					evo(model, {
						scopeInput: () => value,
						showEmptyWarning: () => false,
						searchInput: () => nextSearchInput,
					}),
					[],
				];
			},

			SubmittedSearch: () => {
				const { actorInput, queryInput, modeInput, scopeInput } = model;
				const [nextSearchInput] = SearchInput.update(
					model.searchInput,
					model.queryInput,
					SearchInput.ClosedSuggestions(),
				);

				if (!shouldSearch(model)) {
					return [
						evo(model, {
							showEmptyWarning: () => true,
							searchInput: () => nextSearchInput,
						}),
						[],
					];
				}

				return [
					evo(model, {
						searchState: () => SearchLoading(),
						showEmptyWarning: () => false,
						searchInput: () => nextSearchInput,
					}),
					[
						ReplaceSearch({
							actor: actorInput,
							q: queryInput,
							mode: modeInput,
							scope: scopeInput,
						}),
						SearchLikes({
							actor: actorInput,
							q: queryInput,
							mode: modeInput,
							scope: scopeInput,
						}),
					],
				];
			},

			SucceededSearch: ({ response }) => [evo(model, { searchState: () => SearchOk({ response }) }), []],

			FailedSearch: ({ error }) => [evo(model, { searchState: () => SearchError({ error }) }), []],
		}),
	);

// VIEW

const iconH = html<Message>();

const iconSvg = (classes: string, children: ReadonlyArray<Html>): Html =>
	iconH.svg(
		[
			iconH.Xmlns('http://www.w3.org/2000/svg'),
			iconH.ViewBox('0 0 24 24'),
			iconH.Fill('none'),
			iconH.Stroke('currentColor'),
			iconH.StrokeWidth('2'),
			iconH.StrokeLinecap('round'),
			iconH.StrokeLinejoin('round'),
			iconH.Class(classes),
		],
		children,
	);

const externalLinkIcon = iconSvg('w-4 h-4', [
	iconH.path([iconH.D('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')], []),
	iconH.polyline([iconH.Points('15 3 21 3 21 9')], []),
	iconH.line([iconH.X1('10'), iconH.Y1('14'), iconH.X2('21'), iconH.Y2('3')], []),
]);

const searchIcon = iconSvg('w-12 h-12', [
	iconH.circle([iconH.Cx('11'), iconH.Cy('11'), iconH.R('8')], []),
	iconH.line([iconH.X1('21'), iconH.Y1('21'), iconH.X2('16.65'), iconH.Y2('16.65')], []),
]);

const spinnerIcon = iconSvg('w-8 h-8 animate-spin', [iconH.path([iconH.D('M21 12a9 9 0 1 1-6.219-8.56')], [])]);

const emptyIcon = iconSvg('w-12 h-12', [
	iconH.path([iconH.D('M22 12h-6l-2 3h-4l-2-3H2')], []),
	iconH.path(
		[
			iconH.D(
				'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
			),
		],
		[],
	),
]);

const errorIcon = iconSvg('w-12 h-12', [
	iconH.circle([iconH.Cx('12'), iconH.Cy('12'), iconH.R('10')], []),
	iconH.line([iconH.X1('12'), iconH.Y1('8'), iconH.X2('12'), iconH.Y2('12')], []),
	iconH.line([iconH.X1('12'), iconH.Y1('16'), iconH.X2('12.01'), iconH.Y2('16')], []),
]);

const emptyWarningMessage = (model: Model): Option.Option<string> => {
	if (!model.showEmptyWarning) return Option.none();

	const actorEmpty = EffectString.isEmpty(model.actorInput);
	const queryEmpty = EffectString.isEmpty(model.queryInput);

	if (actorEmpty && queryEmpty) {
		return Option.some('Please enter a handle or DID and a search query.');
	}
	if (actorEmpty) {
		return Option.some('Please enter a handle or DID.');
	}
	if (queryEmpty) {
		return Option.some('Please enter a search query.');
	}
	return Option.none();
};

const scopeOptionSet: ReadonlySet<string> = new Set(['likes', 'posts', 'reposts']);

const isSearchScope = (value: string): value is SearchScope => scopeOptionSet.has(value);

const scopeOptions: ReadonlyArray<SearchScope> = ['likes', 'posts', 'reposts'];

const parseScopeInput = (value: string): ReadonlyArray<SearchScope> =>
	value
		.split(',')
		.map((scope) => scope.trim())
		.filter(isSearchScope);

const formatScopeInput = (scopes: ReadonlyArray<SearchScope>): string => scopes.join(',');

const scopeCheckboxView = (model: Model, scope: SearchScope): Html => {
	const h = html<Message>();
	const selectedScopes = parseScopeInput(model.scopeInput);
	const isSelected = selectedScopes.includes(scope);

	return h.label(
		[h.Class('inline-flex items-center gap-2 cursor-pointer')],
		[
			h.input([
				h.Type('checkbox'),
				h.Checked(isSelected),
				h.OnInput(() => {
					const nextScopes = isSelected ? selectedScopes.filter((s) => s !== scope) : [...selectedScopes, scope];
					return ChangedScopeInput({ value: formatScopeInput(nextScopes) });
				}),
				h.Class('w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500'),
			]),
			h.span([h.Class('text-sm text-gray-700 capitalize')], [scope]),
		],
	);
};

const searchFormView = (model: Model): Html => {
	const h = html<Message>();

	const emptyWarning = Option.match(emptyWarningMessage(model), {
		onNone: () => h.empty,
		onSome: (message) => h.p([h.Class('w-full text-sm text-amber-700')], [message]),
	});

	return h.form(
		[h.Class('flex flex-col gap-3 mb-2'), h.OnSubmit(SubmittedSearch())],
		[
			h.div(
				[h.Class('flex flex-wrap items-start gap-3')],
				[
					h.input([
						h.Type('text'),
						h.Value(model.actorInput),
						h.Placeholder('Handle or DID'),
						h.AriaLabel('Actor handle or DID'),
						h.OnInput((value) => ChangedActorInput({ value })),
						h.Class(
							'flex-1 min-w-48 px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500',
						),
					]),
					h.div(
						[h.Class('flex items-center gap-3 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50')],
						[
							h.span([h.Class('text-sm text-gray-500')], ['Scopes:']),
							...scopeOptions.map((scope) => scopeCheckboxView(model, scope)),
						],
					),
					h.div(
						[h.Class('flex items-center gap-2')],
						[
							h.label([h.Class('text-sm text-gray-700')], ['Mode:']),
							h.select(
								[
									h.Value(model.modeInput),
									h.OnInput((value) => ChangedModeInput({ mode: parseMode(value) })),
									h.Class(
										'px-4 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500',
									),
								],
								[h.option([h.Value('exact')], ['Exact']), h.option([h.Value('prefix')], ['Prefix'])],
							),
						],
					),
					FiltersDialog.buttonView<Message>(model.queryInput, (message) => GotFiltersDialogMessage({ message })),
					h.button(
						[
							h.Type('submit'),
							h.Class(
								'px-6 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500',
							),
						],
						['Search'],
					),
				],
			),
			SearchInput.searchInputView<Message>(model.queryInput, model.searchInput, (message) =>
				GotSearchInputMessage({ message }),
			),
			emptyWarning,
			FiltersDialog.dialogView<Message>(model.filtersDialog, (message) => GotFiltersDialogMessage({ message })),
		],
	);
};

const bskyProfileUrl = (handleOrDid: string): string => `https://bsky.app/profile/${handleOrDid}`;

const atprotoLikesUri = (did: string): string => `https://atproto.at/uri/at://${did}/app.bsky.feed.like`;

const playIcon = iconSvg('w-12 h-12', [
	iconH.circle([iconH.Cx('12'), iconH.Cy('12'), iconH.R('10')], []),
	iconH.polygon([iconH.Points('10 8 16 12 10 16 10 8')], []),
]);

const linkIcon = iconSvg('w-4 h-4', [
	iconH.path([iconH.D('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71')], []),
	iconH.path([iconH.D('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')], []),
]);

const imageEmbedView = (embed: typeof ImageEmbed.Type): Html => {
	const h = html<Message>();

	return h.div(
		[h.Class('grid grid-cols-2 gap-2 mt-3')],
		embed.images.map((image) =>
			h.a(
				[h.Href(image.fullsize), h.Target('_blank'), h.Rel('noopener noreferrer')],
				[
					h.img([
						h.Src(image.thumb),
						h.Alt(image.alt),
						h.Class('w-full h-48 object-cover rounded-lg border border-gray-200'),
					]),
				],
			),
		),
	);
};

const videoEmbedView = (embed: typeof VideoEmbed.Type): Html => {
	const h = html<Message>();

	return h.a(
		[h.Href(embed.playlist), h.Target('_blank'), h.Rel('noopener noreferrer')],
		[
			h.div(
				[h.Class('relative mt-3 rounded-lg overflow-hidden border border-gray-200')],
				[
					h.img([h.Src(embed.thumbnail), h.Alt(embed.alt ?? 'Video thumbnail'), h.Class('w-full h-64 object-cover')]),
					h.div(
						[h.Class('absolute inset-0 flex items-center justify-center bg-black/30')],
						[h.div([h.Class('text-white')], [playIcon])],
					),
				],
			),
		],
	);
};

const externalEmbedView = (embed: typeof ExternalEmbed.Type): Html => {
	const h = html<Message>();

	const thumb = embed.external.thumb
		? h.img([h.Src(embed.external.thumb), h.Alt(''), h.Class('w-full h-40 object-cover border-b border-gray-200')])
		: h.div(
				[h.Class('flex items-center justify-center h-24 bg-gray-100 border-b border-gray-200')],
				[h.div([h.Class('text-gray-400')], [linkIcon])],
			);

	return h.a(
		[
			h.Href(embed.external.uri),
			h.Target('_blank'),
			h.Rel('noopener noreferrer'),
			h.Class(
				'block mt-3 rounded-lg border border-gray-200 overflow-hidden hover:border-emerald-500 transition-colors',
			),
		],
		[
			thumb,
			h.div(
				[h.Class('p-3')],
				[
					h.p([h.Class('text-sm font-semibold text-gray-900 line-clamp-1')], [embed.external.title]),
					h.p([h.Class('text-xs text-gray-500 mt-1 line-clamp-2')], [embed.external.description]),
					h.p([h.Class('text-xs text-gray-400 mt-1 truncate')], [embed.external.uri]),
				],
			),
		],
	);
};

const isImageEmbed = S.is(ImageEmbed);
const isVideoEmbed = S.is(VideoEmbed);
const isExternalEmbed = S.is(ExternalEmbed);

const embedView = (embed: typeof Embed.Type): Html => {
	if (isImageEmbed(embed)) return imageEmbedView(embed);
	if (isVideoEmbed(embed)) return videoEmbedView(embed);
	if (isExternalEmbed(embed)) return externalEmbedView(embed);
	return html<Message>().empty;
};

const kindTagClasses = (kind: SearchScope): string => {
	if (kind === 'likes') return 'bg-pink-100 text-pink-800';
	if (kind === 'reposts') return 'bg-emerald-100 text-emerald-800';
	return 'bg-blue-100 text-blue-800';
};

const resultView = (result: SearchResponse['results'][number]): Html => {
	const h = html<Message>();

	const authorName = result.authorDisplayName ?? result.authorHandle ?? result.authorDid;
	const authorHandle = result.authorHandle ?? result.authorDid;
	const authorProfileUrl = bskyProfileUrl(authorHandle);
	const formattedDate = new Date(result.postCreatedAt).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZoneName: 'short',
	});
	const embed = Option.fromNullishOr(result.embed).pipe(
		Option.map(embedView),
		Option.getOrElse(() => h.empty),
	);

	const sourceLabel = result.sourceActor.handle ?? result.sourceActor.did;
	const engagementItems = [
		result.likeCount !== undefined ? `${result.likeCount} like${result.likeCount === 1 ? '' : 's'}` : '',
		result.repostCount !== undefined ? `${result.repostCount} repost${result.repostCount === 1 ? '' : 's'}` : '',
	].filter(Boolean);
	const engagementLabel = engagementItems.length > 0 ? engagementItems.join(' · ') : '';

	return h.article(
		[h.Class('p-4 mb-4 bg-white rounded-lg border border-gray-200 shadow-sm')],
		[
			h.div(
				[h.Class('flex items-center justify-between mb-2 gap-3')],
				[
					h.div(
						[h.Class('flex items-center gap-2 min-w-0')],
						[
							h.a(
								[
									h.Href(authorProfileUrl),
									h.Target('_blank'),
									h.Rel('noopener noreferrer'),
									h.Class('text-sm font-semibold text-emerald-700 hover:underline truncate'),
								],
								[authorName],
							),
							h.span([h.Class('text-xs text-gray-500 truncate')], [`@${authorHandle}`]),
							h.span(
								[
									h.Class(
										`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${kindTagClasses(result.sourceScope)}`,
									),
								],
								[result.sourceScope],
							),
						],
					),
					h.div(
						[h.Class('flex items-center gap-3 shrink-0')],
						[
							h.a(
								[
									h.Href(result.bskyUrl),
									h.Target('_blank'),
									h.Rel('noopener noreferrer'),
									h.Class('text-xs text-gray-400 hover:text-emerald-600 transition-colors'),
								],
								[formattedDate],
							),
							h.a(
								[
									h.Href(result.bskyUrl),
									h.Target('_blank'),
									h.Rel('noopener noreferrer'),
									h.AriaLabel('Open post in new tab'),
									h.Class('text-gray-400 hover:text-emerald-600 transition-colors'),
								],
								[externalLinkIcon],
							),
						],
					),
				],
			),
			h.div(
				[h.Class('flex items-center justify-between mb-2 gap-3')],
				[
					h.span([h.Class('text-xs text-gray-500 truncate')], [sourceLabel]),
					engagementLabel === '' ? h.empty : h.span([h.Class('text-xs text-gray-500 shrink-0')], [engagementLabel]),
				],
			),
			h.p([h.Class('text-sm text-gray-800 whitespace-pre-wrap')], [result.text]),
			embed,
		],
	);
};

const searchStateView = (searchState: SearchState): Html => {
	const h = html<Message>();

	return M.value(searchState).pipe(
		M.tagsExhaustive({
			SearchIdle: () =>
				h.div(
					[h.Class('flex flex-col items-center py-12 text-gray-400')],
					[searchIcon, h.p([h.Class('mt-3')], ['Enter a handle or DID and a query, then hit Search.'])],
				),
			SearchLoading: () =>
				h.div(
					[h.Class('flex flex-col items-center justify-center py-16 text-gray-500')],
					[spinnerIcon, h.p([h.Class('mt-4 text-lg')], ['Searching likes…'])],
				),
			SearchError: ({ error }) =>
				h.div(
					[h.Class('rounded-lg border border-red-200 bg-red-50 p-6 text-center')],
					[
						errorIcon,
						h.p([h.Class('mt-3 text-lg font-medium text-red-700')], ['Search failed']),
						h.p([h.Class('mt-2 text-sm text-red-600')], [error]),
					],
				),
			SearchOk: ({ response }) => {
				const actorCount = response.actors.length;
				const scopeCount = response.scope.length;
				const firstActor = response.actors[0];
				const firstScope = response.scope[0];
				const actorLabel = actorCount === 1 ? '1 actor' : `${actorCount} actors`;
				const scopeLabel = scopeCount === 1 ? firstScope : `${scopeCount} scopes`;

				const summaryText =
					firstActor !== undefined && actorCount === 1 && firstScope === 'likes'
						? [
								`Showing ${response.totalMatches} match${response.totalMatches === 1 ? '' : 'es'} out of `,
								h.a(
									[
										h.Href(atprotoLikesUri(firstActor.did)),
										h.Target('_blank'),
										h.Rel('noopener noreferrer'),
										h.Class('text-emerald-600 hover:underline'),
									],
									[`${response.totalFetched} fetched likes`],
								),
								'.',
							]
						: [
								`Showing ${response.totalMatches} match${response.totalMatches === 1 ? '' : 'es'} out of ${response.totalFetched} fetched items across ${actorLabel} (${scopeLabel}).`,
							];

				return h.div(
					[],
					[
						h.p([h.Class('text-sm text-gray-500 mb-3')], summaryText),
						Array.match(response.results, {
							onEmpty: () =>
								h.div(
									[h.Class('flex flex-col items-center py-12 text-gray-400')],
									[emptyIcon, h.p([h.Class('mt-3')], ['No liked posts match your query.'])],
								),
							onNonEmpty: (results) => h.div([], results.map(resultView)),
						}),
					],
				);
			},
		}),
	);
};

const searchView = (model: Model): Html => {
	const h = html<Message>();

	return h.div(
		[h.Class('max-w-3xl mx-auto px-4')],
		[
			h.h1([h.Class('text-3xl font-bold text-gray-800 mb-2')], ['atproto likes search']),
			h.p(
				[h.Class('text-gray-500 mb-6')],
				[
					'Search through a user’s liked posts. Exact mode matches any substring; Prefix mode matches the start of words.',
				],
			),
			searchFormView(model),
			searchStateView(model.searchState),
			h.p(
				[h.Class('text-xs text-gray-400 mt-6 text-center')],
				['Search state is synced to the URL — share it or bookmark it.'],
			),
		],
	);
};

const notFoundView = (path: string): Html => {
	const h = html<Message>();

	return h.div(
		[h.Class('max-w-4xl mx-auto px-4 text-center')],
		[
			h.h1([h.Class('text-4xl font-bold text-red-600 mb-6')], ['404 — Page Not Found']),
			h.p([h.Class('text-lg text-gray-600 mb-4')], [`The path "${path}" was not found.`]),
			h.a([h.Href(searchRouter(emptySearchFields)), h.Class('text-emerald-600 hover:underline')], ['← Back to search']),
		],
	);
};

const routeTitle = (route: Model['route']): string =>
	M.value(route).pipe(
		M.tag('Search', () => 'atproto likes search'),
		M.orElse(() => 'Not Found | atproto likes search'),
	);

export const view = (model: Model): Document => {
	const h = html<Message>();

	const routeContent = M.value(model.route).pipe(
		M.tagsExhaustive({
			Search: () => searchView(model),
			NotFound: ({ path }) => notFoundView(path),
		}),
	);

	const body = h.div(
		[h.Class('min-h-screen bg-gray-50')],
		[
			h.header(
				[h.Class('bg-emerald-600 text-white px-6 py-4 mb-8 shadow-sm')],
				[
					h.div(
						[h.Class('max-w-3xl mx-auto flex items-center gap-3')],
						[
							h.span([h.Class('text-lg font-semibold')], ['foldkit']),
							h.span([h.Class('text-emerald-200 text-sm')], ['atproto likes search']),
						],
					),
				],
			),
			h.main([h.Class('pb-12')], [h.keyed('div')(model.route._tag, [], [routeContent])]),
		],
	);

	return { title: routeTitle(model.route), body };
};
