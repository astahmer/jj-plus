import { Option } from 'effect';
import { html, type Html } from 'foldkit/html';
import { getTimelineMarkerPrefix, type TimelineMarker } from '../domain/timeline-markers.ts';
import type { Message } from '../messages.ts';
import { ClosedCombobox, OpenedCombobox, UpdatedComboboxDraft } from '../messages.ts';

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
	open: boolean;
	placeholder?: string;
	options: ReadonlyArray<ComboboxOption>;
	onSubmit: (value: string) => Message;
};

export function filterComboboxOptions(
	options: ReadonlyArray<ComboboxOption>,
	value: string,
	open: boolean,
): Array<ComboboxOption> {
	const query = open ? value.trim().toLowerCase() : '';
	if (!query) {
		return [...options];
	}
	return options.filter((option) =>
		[option.value, option.label, option.description, ...(option.keywords || [])]
			.filter(Boolean)
			.some((candidate) => String(candidate).toLowerCase().includes(query)),
	);
}

export function comboboxMenuContent(
	filteredOptions: ReadonlyArray<ComboboxOption>,
	onSubmit: (value: string) => Message,
): Array<Html | string> {
	const h = html<Message>();
	if (filteredOptions.length === 0) {
		return [h.div([h.Class('combobox-empty')], ['No matches'])];
	}
	return filteredOptions.map((option) =>
		h.button(
			[
				h.Class('combobox-option'),
				h.Type('button'),
				h.Role('option'),
				h.DataAttribute('value', option.value),
				h.OnClick(onSubmit(option.value)),
			],
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
	);
}

/**
 * Input-only combobox. Open menus render through the body overlay portal so they
 * are never clipped by overflow:hidden ancestors.
 */
export function combobox({ id, inputClass, value, open, placeholder, options, onSubmit }: ComboboxViewProps): Html {
	const h = html<Message>();
	const listId = `${id}Options`;

	return h.div(
		[h.Class('combobox')],
		[
			h.input([
				h.Class(inputClass),
				h.Id(id),
				h.Type('text'),
				...(open ? [] : [h.Value(value)]),
				h.Placeholder(placeholder || ''),
				h.Autocomplete('off'),
				h.Role('combobox'),
				h.Attribute('aria-autocomplete', 'list'),
				h.Attribute('aria-expanded', open ? 'true' : 'false'),
				h.Attribute('aria-controls', listId),
				h.OnFocus(OpenedCombobox({ id })),
				h.OnBlur(ClosedCombobox({ id })),
				h.OnInput((nextValue) => UpdatedComboboxDraft({ id, value: nextValue })),
				h.OnKeyDownPreventDefault((key) => {
					if (key === 'Enter') {
						const element = document.getElementById(id) as HTMLInputElement | null;
						const typedValue = (element?.value ?? value).trim();
						if (!typedValue) {
							return Option.none();
						}
						const exactOption = options.find((option) => option.value.toLowerCase() === typedValue.toLowerCase());
						const commitValue = exactOption?.value || typedValue;
						return Option.some(onSubmit(commitValue));
					}
					if (key === 'Escape') {
						return Option.some(ClosedCombobox({ id }));
					}
					return Option.none();
				}),
			]),
		],
	);
}
