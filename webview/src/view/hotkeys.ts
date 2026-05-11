import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import { ClickedToggleHotkeys } from '../messages.ts';
import type { Model } from '../model.ts';
import { getVersion } from '../selectors.ts';

function row(label: string, keys: Array<string>): Html {
	const h = html<Message>();
	return h.div(
		[h.Class('hotkey-row')],
		[
			h.span([h.Class('hotkey-label')], [label]),
			h.span(
				[h.Class('hotkey-value')],
				keys.map((key) => h.kbd([], [key])),
			),
		],
	);
}

function note(label: string, description: string): Html {
	const h = html<Message>();
	return h.div(
		[h.Class('hotkey-row')],
		[h.span([h.Class('hotkey-label')], [label]), h.span([h.Class('hotkey-note')], [description])],
	);
}

export function hotkeysPopover(model: Model): Html {
	const h = html<Message>();

	return h.div(
		[h.Class('hotkeys-popover'), h.Id('hotkeysPopover')],
		[
			h.div(
				[h.Class('hotkeys-card')],
				[
					h.div(
						[h.Class('hotkeys-head')],
						[
							h.div(
								[],
								[
									h.div(
										[h.Style({ display: 'flex', 'align-items': 'baseline', gap: '6px' })],
										[
											h.div([h.Class('eyebrow')], ['Shortcuts']),
											h.div([h.Class('hotkeys-version')], [getVersion(model)]),
										],
									),
									h.div([h.Class('hotkeys-subtitle')], ['Range selection, sidebar navigation, and diff actions']),
								],
							),
							h.button(
								[
									h.Class('collapse-button'),
									h.Id('closeHotkeysButton'),
									h.Type('button'),
									h.OnClick(ClickedToggleHotkeys()),
								],
								['Close'],
							),
						],
					),
					h.div(
						[h.Class('hotkeys-grid')],
						[
							h.div(
								[h.Class('hotkey-section')],
								[
									h.div([h.Class('hotkey-section-title')], ['Selection']),
									row('Move range', ['←', '→']),
									row('Fast move range', ['Shift', '←', '→']),
									row('Move range vertically', ['↑', '↓']),
									row('Adjust to marker', ['Option', '←', '→']),
									row('Adjust from marker', ['Ctrl', '←', '→']),
									row('Dock range to start/end', ['Cmd', '←', '→']),
								],
							),
							h.div(
								[h.Class('hotkey-section')],
								[
									h.div([h.Class('hotkey-section-title')], ['Actions']),
									row('Open cumulative diff', ['Space']),
									row('Focus diff', ['D']),
									row('Toggle help', ['?']),
									row('Toggle sidebar', ['B']),
									row('Focus file switcher', ['/']),
									row('Focus from / to pickers', ['F', 'T']),
									row('Focus sidebar search', ['S']),
									row('Exit focus / overlays', ['Esc']),
									note('Pick range by click', 'Click one revision, then another'),
									note('Drag markers', 'Adjust range directly on the timeline'),
								],
							),
						],
					),
				],
			),
		],
	);
}
