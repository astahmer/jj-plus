import { Schema as S } from 'effect';
import { m } from 'foldkit/message';

export const BootedApp = m('BootedApp');
export const CompletedSendHost = m('CompletedSendHost');
export const GotHostMessage = m('GotHostMessage', { payload: S.Unknown });
export const UpdatedQuery = m('UpdatedQuery', { value: S.String });
export const UpdatedRevset = m('UpdatedRevset', { value: S.String });
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
	ClickedRefresh,
	ClickedRevision,
	ClickedRemote,
	ToggledSort,
]);
export type Message = typeof Message.Type;
