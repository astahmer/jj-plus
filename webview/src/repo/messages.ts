import { Schema as S } from 'effect';
import { m } from 'foldkit/message';

export const BootedApp = m('BootedApp');
export const CompletedSendHost = m('CompletedSendHost');
export const GotHostMessage = m('GotHostMessage', { payload: S.Unknown });
export const UpdatedQuery = m('UpdatedQuery', { value: S.String });
export const UpdatedRevset = m('UpdatedRevset', { value: S.String });
export const UpdatedPath = m('UpdatedPath', { value: S.String });
export const UpdatedAfter = m('UpdatedAfter', { value: S.String });
export const UpdatedUntil = m('UpdatedUntil', { value: S.String });
export const SelectedSearchMode = m('SelectedSearchMode', { value: S.Literals(['metadata', 'changes', 'snapshot']) });
export const SelectedMatchMode = m('SelectedMatchMode', { value: S.Literals(['literal', 'regex', 'fuzzy']) });
export const SubmittedSearch = m('SubmittedSearch');
export const ClearedSearch = m('ClearedSearch');
export const ClickedRefresh = m('ClickedRefresh');
export const ClickedRevision = m('ClickedRevision', { index: S.Number });
export const ClickedRemote = m('ClickedRemote', { index: S.Number });
export const ToggledSort = m('ToggledSort');

export const Message = S.Union([
	BootedApp,
	CompletedSendHost,
	GotHostMessage,
	UpdatedQuery,
	UpdatedRevset,
	UpdatedPath,
	UpdatedAfter,
	UpdatedUntil,
	SelectedSearchMode,
	SelectedMatchMode,
	SubmittedSearch,
	ClearedSearch,
	ClickedRefresh,
	ClickedRevision,
	ClickedRemote,
	ToggledSort,
]);
export type Message = typeof Message.Type;
