import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTimelineDocumentHtml } from '../../src/webview/timeline-template.ts';

test('timeline HTML CSP allows Pierre workers and injects WORKER_URI', () => {
	const html = renderTimelineDocumentHtml({
		title: 'Revision Timeline',
		cspSource: 'https://example.vscode-cdn.net',
		styleHref: './timeline-app.css',
		appSrc: './timeline-app.js',
		workerSrc: './pierre-worker-portable.js',
	});

	assert.match(html, /worker-src https:\/\/example\.vscode-cdn\.net blob:/);
	assert.match(html, /connect-src https:\/\/example\.vscode-cdn\.net/);
	assert.match(html, /window\.WORKER_URI="\.\/pierre-worker-portable\.js"/);
});
