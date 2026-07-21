import * as vscode from 'vscode';
import { OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';
import { formatTimelineAtLineCodeLensTitle } from './timeline-at-line.ts';

/**
 * Lightweight CodeLens on the active line —
 * one lens near the cursor rather than per-line spam.
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
			const lineNumber = line + 1;
			return [
				new vscode.CodeLens(range, {
					title: formatTimelineAtLineCodeLensTitle(lineNumber),
					command: OPEN_TIMELINE_AT_LINE_COMMAND,
					arguments: [
						{
							absolutePath: document.uri.fsPath,
							line: lineNumber,
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
				`[${formatTimelineAtLineCodeLensTitle(line)}](command:${OPEN_TIMELINE_AT_LINE_COMMAND}?${args})`,
			);
			markdown.isTrusted = true;
			return new vscode.Hover(markdown);
		},
	};
}

/** Light gutter glyph on the active selection — findable without CodeLens enabled. */
export function createTimelineAtLineGutterDecoration(): vscode.Disposable {
	const decorationType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: undefined,
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.rangeHighlightForeground'),
		isWholeLine: false,
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		before: {
			contentText: '◦',
			color: new vscode.ThemeColor('editorLineNumber.activeForeground'),
			margin: '0 4px 0 0',
			width: '0.8em',
			fontWeight: '700',
		},
	});

	const refresh = (editor: vscode.TextEditor | undefined) => {
		if (!editor || editor.document.uri.scheme !== 'file') {
			return;
		}
		const line = editor.selection.active.line;
		const range = new vscode.Range(line, 0, line, 0);
		editor.setDecorations(decorationType, [
			{
				range,
				hoverMessage: new vscode.MarkdownString(
					`${formatTimelineAtLineCodeLensTitle(line + 1)}  \n_(Click CodeLens / context menu / command)_`,
				),
			},
		]);
		for (const other of vscode.window.visibleTextEditors) {
			if (other !== editor) {
				other.setDecorations(decorationType, []);
			}
		}
	};

	refresh(vscode.window.activeTextEditor);
	return vscode.Disposable.from(
		decorationType,
		vscode.window.onDidChangeActiveTextEditor((editor) => refresh(editor)),
		vscode.window.onDidChangeTextEditorSelection((event) => {
			if (event.textEditor === vscode.window.activeTextEditor) {
				refresh(event.textEditor);
			}
		}),
	);
}

