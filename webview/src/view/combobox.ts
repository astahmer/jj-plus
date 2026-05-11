import { Option } from 'effect';
import { html, type Html } from 'foldkit/html';
import { getTimelineMarkerPrefix, type TimelineMarker } from '../domain/timeline-markers.ts';
import type { Message } from '../messages.ts';

export type ComboboxOption = {
	value: string;
	label?: string;
	description?: string;
	keywords?: Array<string>;
	markers?: Array<TimelineMarker>;
};

export type ComboboxViewProps = {
	id: string;
	inputClass: string;
	value: string;
	placeholder?: string;
	menuClass?: string;
	options: ReadonlyArray<ComboboxOption>;
	onSubmit: (value: string) => Message;
};

/**
 * Minimal combobox: renders the same DOM ids/classes as the Solid combobox
 * so tests can target them. The dropdown menu is collapsed by default; test
 * flows submit values by focusing the input, typing, and pressing Enter.
 */
export function combobox({
	id,
	inputClass,
	value,
	placeholder,
	menuClass,
	options,
	onSubmit,
}: ComboboxViewProps): Html {
	const h = html<Message>();
	const listId = `${id}Options`;

	return h.div(
		[h.Class('combobox')],
		[
			h.input([
				h.Class(inputClass),
				h.Id(id),
				h.Type('text'),
				h.Value(value),
				h.Placeholder(placeholder || ''),
				h.Autocomplete('off'),
				h.Role('combobox'),
				h.Attribute('aria-autocomplete', 'list'),
				h.Attribute('aria-controls', listId),
				h.OnKeyDownPreventDefault((key) => {
					if (key === 'Enter') {
						const element = document.getElementById(id) as HTMLInputElement | null;
						const nextValue = element?.value ?? '';
						return Option.some(onSubmit(nextValue));
					}
					return Option.none();
				}),
			]),
			h.div(
				[
					h.Class(`combobox-menu combobox-menu--hidden${menuClass ? ` ${menuClass}` : ''}`),
					h.Id(listId),
					h.Role('listbox'),
				],
				options.length === 0
					? [h.div([h.Class('combobox-empty')], ['No matches'])]
					: options.map((option) =>
							h.div(
								[h.Class('combobox-option'), h.Role('option'), h.DataAttribute('value', option.value)],
								[
									h.div(
										[h.Class('combobox-option-title-row')],
										[
											h.span([h.Class('combobox-option-title')], [option.label || option.value]),
											option.label && option.label !== option.value
												? h.span([h.Class('combobox-option-value')], [option.value])
												: h.empty,
										],
									),
									option.description ? h.div([h.Class('combobox-option-description')], [option.description]) : h.empty,
									option.markers && option.markers.length
										? h.div(
												[h.Class('combobox-option-markers')],
												option.markers.map((marker) =>
													h.span(
														[h.Class(`timeline-marker timeline-marker--${marker.kind}`), h.Title(marker.title)],
														[
															h.span([h.Class('timeline-marker-prefix')], [getTimelineMarkerPrefix(marker.kind)]),
															h.span([h.Class('timeline-marker-label')], [marker.label]),
														],
													),
												),
											)
										: h.empty,
								],
							),
						),
			),
		],
	);
}
