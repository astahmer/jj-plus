import { html, type Html } from 'foldkit/html';
import type { Message } from '../messages.ts';
import type { Model } from '../model.ts';

export function sessionLoadingOverlay(model: Model): Html {
	const h = html<Message>();
	if (model.session._tag !== 'Loading' && model.session._tag !== 'Idle') {
		return h.empty;
	}

	const label =
		model.session._tag === 'Idle'
			? 'Starting timeline…'
			: model.fileInputValue
				? `Loading history for ${model.fileInputValue}…`
				: 'Loading revision history…';

	return h.div(
		[h.Class('session-loading-overlay'), h.Role('status'), h.AriaLive('polite')],
		[
			h.div(
				[h.Class('session-loading-card')],
				[
					h.div([h.Class('session-loading-title')], [label]),
					h.div(
						[h.Class('session-loading-subtitle')],
						['Fetching revisions and preparing the first diff. This can take a moment on large histories.'],
					),
					h.div(
						[h.Class('diff-progress-track session-loading-progress'), h.AriaHidden(true)],
						[h.div([h.Class('diff-progress-bar')], [])],
					),
				],
			),
		],
	);
}
