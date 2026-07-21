import * as vscode from 'vscode';
import { OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';

/**
 * Lightweight CodeLens on the active line's first non-empty block start —
 * one lens near the cursor region rather than per-line spam.
 */
export function createTimelineBlameCodeLensProvider(): vscode.CodeLensProvider & vscode.Disposable {
	const onDidChange = new vscode.EventEmitter<void>();
	const subs = [
		vscode.window.onDidChangeTextEditorSelection(() => onDidChange.fire()),
		vscode.window.onDidChangeActiveTextEditor(() => onDidChange.fire()),
	];

	return {
		onDidChangeCodeLenses: onDidChange.event,
		provideCodeLenses(document) {
			if (document.uri.scheme !== 'file') {
				return [];
			}
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
				return [];
			}
			const line = editor.selection.active.line;
			const range = new vscode.Range(line, 0, line, 0);
			return [
				new vscode.CodeLens(range, {
					title: 'JJ: Timeline for line',
					command: OPEN_TIMELINE_AT_LINE_COMMAND,
					arguments: [
						{
							absolutePath: document.uri.fsPath,
							line: line + 1,
						},
					],
				}),
			];
		},
		dispose() {
			onDidChange.dispose();
			for (const sub of subs) {
				sub.dispose();
			}
		},
	};
}

export function createTimelineBlameHoverProvider(): vscode.HoverProvider {
	return {
		provideHover(document, position) {
			if (document.uri.scheme !== 'file') {
				return null;
			}
			const line = position.line + 1;
			const args = encodeURIComponent(JSON.stringify({ absolutePath: document.uri.fsPath, line }));
			const markdown = new vscode.MarkdownString(
				`[Open revision timeline for line ${line}](command:${OPEN_TIMELINE_AT_LINE_COMMAND}?${args})`,
			);
			markdown.isTrusted = true;
			return new vscode.Hover(markdown);
		},
	};
}
