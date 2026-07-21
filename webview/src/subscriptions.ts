import { Effect, Option, Queue, Schema as S, Stream } from 'effect';
import { Subscription } from 'foldkit';
import { readAnchorEntryIndex } from './domain/timeline-tooltips.ts';
import { subscribeHost } from './host-singleton.ts';
import type { Message } from './messages.ts';
import {
	GotHostMessage,
	LeftTrack,
	MovedOverTrack,
	PointerMovedDuringDrag,
	PressedShortcut,
	ReleasedPointerDuringDrag,
	ClickedPierreBlameLine,
	TimeLapseTick,
} from './messages.ts';
import type { Model } from './model.ts';
import { PIERRE_BLAME_LINE_EVENT } from './pierre/file-diff-host.ts';

const EDITABLE_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	if (target instanceof HTMLTextAreaElement) {
		return true;
	}
	if (target instanceof HTMLInputElement) {
		const type = (target.getAttribute('type') || 'text').toLowerCase();
		return EDITABLE_INPUT_TYPES.has(type);
	}
	return false;
}

const hostStream: Stream.Stream<Message> = Stream.callback<Message>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const unsubscribe = subscribeHost((payload) => {
				Queue.offerUnsafe(queue, GotHostMessage({ payload }));
			});
			return { unsubscribe };
		}),
		({ unsubscribe }) => Effect.sync(() => unsubscribe()),
	).pipe(Effect.flatMap(() => Effect.never)),
);

const keyboardStream: Stream.Stream<Message> = Subscription.fromEventFilterMap<KeyboardEvent, Message>({
	target: () => window,
	type: 'keydown',
	toMessage: (event) => {
		const targetId = event.target instanceof HTMLElement ? event.target.id : '';
		return Option.some(
			PressedShortcut({
				key: event.key,
				shiftKey: event.shiftKey,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				altKey: event.altKey,
				targetId,
				isEditableTarget: isEditableTarget(event.target),
			}),
		);
	},
});

const pointerMoveStream: Stream.Stream<Message> = Subscription.fromEventFilterMap<PointerEvent, Message>({
	target: () => window,
	type: 'pointermove',
	toMessage: (event) => Option.some(PointerMovedDuringDrag({ clientX: event.clientX, clientY: event.clientY })),
});

const pointerUpStream: Stream.Stream<Message> = Subscription.fromEventFilterMap<PointerEvent, Message>({
	target: () => window,
	type: 'pointerup',
	toMessage: () => Option.some(ReleasedPointerDuringDrag()),
});

function targetInsideTrack(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && target.closest('#track') !== null;
}

const trackMouseMoveStream: Stream.Stream<Message> = Subscription.fromEventFilterMap<MouseEvent, Message>({
	target: () => window,
	type: 'mousemove',
	toMessage: (event) => {
		if (!targetInsideTrack(event.target)) {
			return Option.none();
		}

		return Option.some(
			MovedOverTrack({
				clientX: event.clientX,
				clientY: event.clientY,
				anchorEntryIndex: readAnchorEntryIndex(event.target as HTMLElement | null),
			}),
		);
	},
});

const trackMouseOutStream: Stream.Stream<Message> = Subscription.fromEventFilterMap<MouseEvent, Message>({
	target: () => window,
	type: 'mouseout',
	toMessage: (event) => {
		if (!targetInsideTrack(event.target)) {
			return Option.none();
		}
		if (targetInsideTrack(event.relatedTarget)) {
			return Option.none();
		}
		return Option.some(LeftTrack());
	},
});

const pierreBlameClickStream: Stream.Stream<Message> = Subscription.fromEventFilterMap<
	CustomEvent<{ line: number; revision: string }>,
	Message
>({
	target: () => window,
	type: PIERRE_BLAME_LINE_EVENT,
	toMessage: (event) => {
		const revision = String(event.detail?.revision || '').trim();
		const line = Number(event.detail?.line);
		if (!revision || !Number.isInteger(line) || line < 1) {
			return Option.none();
		}
		return Option.some(ClickedPierreBlameLine({ line, revision }));
	},
});

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	host: Subscription.persistent(hostStream),
	keyboard: entry(
		{ hotkeysOpen: S.Boolean },
		{
			modelToDependencies: (model) => ({ hotkeysOpen: model.hotkeysOpen }),
			dependenciesToStream: () => keyboardStream,
		},
	),
	pointerMove: entry(
		{ isDragging: S.Boolean },
		{
			modelToDependencies: (model) => ({ isDragging: model.dragState._tag !== 'DragIdle' }),
			dependenciesToStream: ({ isDragging }) => (isDragging ? pointerMoveStream : Stream.empty),
		},
	),
	pointerUp: entry(
		{ isDragging: S.Boolean },
		{
			modelToDependencies: (model) => ({ isDragging: model.dragState._tag !== 'DragIdle' }),
			dependenciesToStream: ({ isDragging }) => (isDragging ? pointerUpStream : Stream.empty),
		},
	),
	trackMouseMove: Subscription.persistent(trackMouseMoveStream),
	trackMouseOut: Subscription.persistent(trackMouseOutStream),
	pierreBlameClick: Subscription.persistent(pierreBlameClickStream),
	timeLapse: entry(
		{ timeLapsePlaying: S.Boolean },
		{
			modelToDependencies: (model) => ({ timeLapsePlaying: model.timeLapsePlaying }),
			dependenciesToStream: ({ timeLapsePlaying }) =>
				timeLapsePlaying ? Stream.tick('700 millis').pipe(Stream.map(() => TimeLapseTick())) : Stream.empty,
		},
	),
}));
