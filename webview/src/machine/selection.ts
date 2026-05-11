import { Schema as S } from 'effect';
import { Machine } from 'foldkit/experimental';
import { to } from 'foldkit/experimental/machine';
import { m } from 'foldkit/message';
import { ts } from 'foldkit/schema';

// STATE

export const IdlePick = ts('IdlePick');
export const PendingAnchor = ts('PendingAnchor', { entryIndex: S.Number });
export const RangeSelected = ts('RangeSelected');

export const SelectionState = S.Union([IdlePick, PendingAnchor, RangeSelected]);
export type SelectionState = typeof SelectionState.Type;

// MESSAGE

export const ClickedEntry = m('ClickedEntry', { entryIndex: S.Number });
export const CommittedSelection = m('CommittedSelection');
export const CancelledSelection = m('CancelledSelection');

export const SelectionMessage = S.Union([ClickedEntry, CommittedSelection, CancelledSelection]);
export type SelectionMessage = typeof SelectionMessage.Type;

// MACHINE

export const selectionMachine = Machine.define({
	state: SelectionState,
	message: SelectionMessage,
})({
	initial: IdlePick(),
	states: {
		IdlePick: {
			on: {
				ClickedEntry: to('PendingAnchor', ({ message }) => PendingAnchor({ entryIndex: message.entryIndex })),
			},
		},
		PendingAnchor: {
			on: {
				ClickedEntry: to('RangeSelected', () => RangeSelected()),
				CommittedSelection: to('IdlePick', () => IdlePick()),
				CancelledSelection: to('IdlePick', () => IdlePick()),
			},
		},
		RangeSelected: {
			on: {
				ClickedEntry: to('PendingAnchor', ({ message }) => PendingAnchor({ entryIndex: message.entryIndex })),
				CancelledSelection: to('IdlePick', () => IdlePick()),
			},
		},
	},
});
