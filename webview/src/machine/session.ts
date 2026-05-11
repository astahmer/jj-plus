import { Schema as S } from 'effect';
import { Machine } from 'foldkit/experimental';
import { to } from 'foldkit/experimental/machine';
import { m } from 'foldkit/message';
import { ts } from 'foldkit/schema';

// STATE

export const Idle = ts('Idle');
export const Loading = ts('Loading');
export const Ready = ts('Ready');
export const Failed = ts('Failed', { reason: S.String });

export const SessionState = S.Union([Idle, Loading, Ready, Failed]);
export type SessionState = typeof SessionState.Type;

// MESSAGE

export const BootedSession = m('BootedSession');
export const RefreshedSession = m('RefreshedSession');
export const SwitchedFile = m('SwitchedFile');
export const ReceivedTimelineData = m('ReceivedTimelineData');
export const FailedTimelineData = m('FailedTimelineData', { reason: S.String });

export const SessionMessage = S.Union([
	BootedSession,
	RefreshedSession,
	SwitchedFile,
	ReceivedTimelineData,
	FailedTimelineData,
]);
export type SessionMessage = typeof SessionMessage.Type;

// MACHINE

export const sessionMachine = Machine.define({
	state: SessionState,
	message: SessionMessage,
})({
	initial: Idle(),
	states: {
		Idle: {
			on: {
				BootedSession: to('Loading', () => Loading()),
			},
		},
		Loading: {
			on: {
				ReceivedTimelineData: to('Ready', () => Ready()),
				FailedTimelineData: to('Failed', ({ message }) => Failed({ reason: message.reason })),
			},
		},
		Ready: {
			on: {
				RefreshedSession: to('Loading', () => Loading()),
				SwitchedFile: to('Loading', () => Loading()),
				ReceivedTimelineData: to('Ready', () => Ready()),
			},
		},
		Failed: {
			on: {
				RefreshedSession: to('Loading', () => Loading()),
				SwitchedFile: to('Loading', () => Loading()),
			},
		},
	},
});
