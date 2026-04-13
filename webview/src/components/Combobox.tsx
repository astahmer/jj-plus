import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

export type ComboboxOption = {
	value: string;
	label?: string;
	description?: string;
	keywords?: string[];
};

type ComboboxProps = {
	id: string;
	inputClass: string;
	value: string;
	options: ComboboxOption[];
	placeholder?: string;
	onInput?: (value: string) => void;
	onCommit: (value: string) => void;
};

export function Combobox(props: ComboboxProps) {
	const [draftValue, setDraftValue] = createSignal(props.value);
	const [open, setOpen] = createSignal(false);
	const [activeIndex, setActiveIndex] = createSignal(0);
	const [editing, setEditing] = createSignal(false);
	const listId = `${props.id}Options`;
	let closeTimer: number | undefined;
	let optionRefs: Array<HTMLButtonElement | undefined> = [];

	const filteredOptions = createMemo(() => {
		const query = open() && draftValue() === props.value ? '' : draftValue().trim().toLowerCase();
		if (!query) {
			return props.options;
		}

		return props.options.filter((option) => {
			return [option.value, option.label, option.description, ...(option.keywords || [])]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query));
		});
	});

	createEffect(() => {
		if (editing() && draftValue() !== props.value) {
			return;
		}

		setDraftValue(props.value);
	});

	createEffect(() => {
		const options = filteredOptions();
		if (!options.length) {
			setActiveIndex(0);
			return;
		}

		setActiveIndex((index) => Math.min(Math.max(index, 0), options.length - 1));
	});

	createEffect(() => {
		if (!open()) {
			return;
		}

		optionRefs[activeIndex()]?.scrollIntoView({ block: 'nearest' });
	});

	onCleanup(() => {
		if (closeTimer) {
			window.clearTimeout(closeTimer);
		}
	});

	function clearCloseTimer() {
		if (closeTimer) {
			window.clearTimeout(closeTimer);
			closeTimer = undefined;
		}
	}

	function scheduleClose() {
		clearCloseTimer();
		closeTimer = window.setTimeout(() => {
			setOpen(false);
			setEditing(false);
		}, 120);
	}

	function commit(value: string) {
		setEditing(false);
		setDraftValue(value);
		props.onInput?.(value);
		props.onCommit(value);
		setOpen(false);
	}

	return (
		<div
			class="combobox"
			onFocusIn={() => {
				clearCloseTimer();
				setOpen(true);
			}}
			onFocusOut={scheduleClose}
		>
			<input
				class={props.inputClass}
				id={props.id}
				value={draftValue()}
				placeholder={props.placeholder}
				autocomplete="off"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={open()}
				aria-controls={listId}
				onClick={() => setOpen(true)}
				onInput={(event) => {
					clearCloseTimer();
					setEditing(true);
					setDraftValue(event.currentTarget.value);
					props.onInput?.(event.currentTarget.value);
					setOpen(true);
					setActiveIndex(0);
				}}
				onKeyDown={(event) => {
					const options = filteredOptions();
					if (event.key === 'ArrowDown') {
						event.preventDefault();
						if (!open()) {
							setOpen(true);
							return;
						}

						setActiveIndex((index) => Math.min(index + 1, Math.max(0, options.length - 1)));
						return;
					}

					if (event.key === 'ArrowUp') {
						event.preventDefault();
						if (!open()) {
							setOpen(true);
							return;
						}

						setActiveIndex((index) => Math.max(0, index - 1));
						return;
					}

					if (event.key === 'Enter') {
						event.preventDefault();
						const query = event.currentTarget.value.trim().toLowerCase();
						const exactOption = props.options.find((option) => option.value.toLowerCase() === query);
						const option = exactOption || options[activeIndex()];
						commit(option?.value || event.currentTarget.value);
						return;
					}

					if (event.key === 'Escape') {
						event.preventDefault();
						setEditing(false);
						setOpen(false);
					}
				}}
			/>
			<Show when={open()}>
				<div class="combobox-menu" id={listId} role="listbox" onMouseDown={(event) => event.preventDefault()}>
					<Show when={filteredOptions().length} fallback={<div class="combobox-empty">No matches</div>}>
						<For each={filteredOptions()}>
							{(option, index) => {
								const isActive = () => index() === activeIndex();
								const isSelected = () => option.value === props.value;
								return (
									<button
										ref={(element) => {
											optionRefs[index()] = element;
										}}
										class={`combobox-option${isActive() ? ' is-active' : ''}${isSelected() ? ' is-selected' : ''}`}
										type="button"
										role="option"
										aria-selected={isSelected()}
										onMouseEnter={() => {
											clearCloseTimer();
											setActiveIndex(index());
										}}
										onMouseDown={(event) => {
											event.preventDefault();
											commit(option.value);
										}}
									>
										<div class="combobox-option-title-row">
											<span class="combobox-option-title">{option.label || option.value}</span>
											<Show when={option.label && option.label !== option.value}>
												<span class="combobox-option-value">{option.value}</span>
											</Show>
										</div>
										<Show when={option.description}>
											<div class="combobox-option-description">{option.description}</div>
										</Show>
									</button>
								);
							}}
						</For>
					</Show>
				</div>
			</Show>
		</div>
	);
}
