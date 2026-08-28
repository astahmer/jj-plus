import { Schema as S } from 'effect';

export const Model = S.Struct({
	data: S.NullOr(S.Unknown),
	diff: S.NullOr(S.Unknown),
	query: S.String,
	revset: S.String,
	selectedIndex: S.Number,
	oldestFirst: S.Boolean,
	loading: S.Boolean,
	error: S.String,
});
export type Model = typeof Model.Type;

export const initialModel: Model = {
	data: null,
	diff: null,
	query: '',
	revset: 'ancestors(@)',
	selectedIndex: 0,
	oldestFirst: false,
	loading: true,
	error: '',
};
