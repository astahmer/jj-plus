import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	buildGitBlameFileArgs,
	buildJjAnnotateArgs,
	collapseBlameToHunkStarts,
	findBlameForLine,
	parseGitBlamePorcelain,
	parseJjFileAnnotate,
	type BlameLine,
} from '../shared/blame.ts';
import { OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';
import { onJjplusSettingsChange, readJjplusSettings } from './settings.ts';
import {
	buildCurrentLineBlameHoverMarkdown,
	formatCurrentLineBlameDecoration,
	formatTimelineAtLineHoverTitle,
	shouldShowBlameHoverAtPosition,
} from './timeline-at-line.ts';

type BlameRunner = {
	runGit: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
	runJj: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
};

type ResolveBackend = (args: { workspacePath: string }) => Promise<{ backend: 'git' | 'jj' }>;

type CacheEntry = {
	key: string;
	lines: BlameLine[];
};

type SelectionLines = ReadonlyArray<{ active: number; anchor: number }>;

const MAX_EDITOR_COLUMN = 0x3fffffff;

function getSelectionLines(editor: vscode.TextEditor): SelectionLines {
	return editor.selections.map((selection) => ({
		active: selection.active.line,
		anchor: selection.anchor.line,
	}));
}

function selectionLinesMatch(left: SelectionLines | undefined, right: SelectionLines): boolean {
	return (
		left?.length === right.length &&
		left.every((selection, index) => {
			const other = right[index];
			return other?.active === selection.active && other.anchor === selection.anchor;
		})
	);
}

/**
 * Shared file-blame cache + GitLens-style decorations (current line + optional full gutter).
 * Hover always carries author / relative time / short desc when blame is available.
 */
export function createEditorBlameDecorations(args: {
	runner: BlameRunner;
	resolveBackend: ResolveBackend;
}): vscode.Disposable {
	const currentLineType = vscode.window.createTextEditorDecorationType({
		after: {
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'italic',
			margin: '0 0 0 3em',
			textDecoration: 'none',
		},
	});
	const inlineGutterType = vscode.window.createTextEditorDecorationType({
		after: {
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'italic',
			margin: '0 0 0 1.2em',
			fontWeight: 'normal',
			textDecoration: 'none',
		},
	});
	const endOfLineRange = (document: vscode.TextDocument, line: number): vscode.Range => {
		// Match GitLens' far-right zero-width anchor. validateRange clamps it to
		// the actual line end without attaching the decoration to editable text.
		const end = document.validatePosition(new vscode.Position(line, MAX_EDITOR_COLUMN));
		return new vscode.Range(end, end);
	};
	const clearDecorations = (editor: vscode.TextEditor) => {
		editor.setDecorations(currentLineType, []);
		editor.setDecorations(inlineGutterType, []);
	};
	const clearVisibleDecorations = () => {
		for (const editor of vscode.window.visibleTextEditors) {
			clearDecorations(editor);
		}
	};

	const cache = new Map<string, CacheEntry>();
	let generation = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let editingDocument: vscode.TextDocument | undefined;
	let editingSelectionLines: SelectionLines | undefined;

	const isEditing = (editor: vscode.TextEditor): boolean =>
		editor === vscode.window.activeTextEditor &&
		editingDocument === editor.document &&
		editingSelectionLines !== undefined;

	const clearEditingState = () => {
		editingDocument = undefined;
		editingSelectionLines = undefined;
		generation += 1;
	};

	const markEditing = (editor: vscode.TextEditor) => {
		editingDocument = editor.document;
		editingSelectionLines = getSelectionLines(editor);
		generation += 1;
		clearDecorations(editor);
	};

	const scheduleRefresh = (delayMs = 60) => {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}
		refreshTimer = setTimeout(() => {
			void refresh(vscode.window.activeTextEditor);
		}, delayMs);
	};

	const loadBlame = async (
		workspacePath: string,
		relativePath: string,
		backend: 'git' | 'jj',
	): Promise<BlameLine[]> => {
		if (backend === 'git') {
			const { stdout } = await args.runner.runGit({
				workspacePath,
				args: buildGitBlameFileArgs({ relativePath }),
			});
			return parseGitBlamePorcelain(stdout);
		}
		const { stdout } = await args.runner.runJj({
			workspacePath,
			args: buildJjAnnotateArgs({ relativePath }),
		});
		return parseJjFileAnnotate(stdout);
	};

	const getCachedLines = async (document: vscode.TextDocument): Promise<BlameLine[] | undefined> => {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (!workspaceFolder || document.uri.scheme !== 'file') {
			return undefined;
		}
		const workspacePath = workspaceFolder.uri.fsPath;
		const relativePath = path.relative(workspacePath, document.uri.fsPath).replace(/\\/g, '/');
		if (!relativePath || relativePath.startsWith('..')) {
			return undefined;
		}
		const cacheKey = `${document.uri.toString()}::${document.version}`;
		let entry = cache.get(document.uri.toString());
		if (!entry || entry.key !== cacheKey) {
			const { backend } = await args.resolveBackend({ workspacePath });
			const lines = await loadBlame(workspacePath, relativePath, backend);
			entry = { key: cacheKey, lines };
			cache.set(document.uri.toString(), entry);
		}
		return entry.lines;
	};

	const refresh = async (editor: vscode.TextEditor | undefined) => {
		const token = ++generation;
		const settings = readJjplusSettings();
		if (!editor || editor.document.uri.scheme !== 'file') {
			clearVisibleDecorations();
			return;
		}
		if (isEditing(editor)) {
			clearDecorations(editor);
			return;
		}

		if (!settings.currentLineBlame && !settings.inlineBlameGutter) {
			clearVisibleDecorations();
			return;
		}

		let lines: BlameLine[] | undefined;
		try {
			lines = await getCachedLines(editor.document);
		} catch {
			clearVisibleDecorations();
			return;
		}
		if (token !== generation || vscode.window.activeTextEditor !== editor || !lines) {
			return;
		}

		const document = editor.document;
		const activeLine = editor.selection.active.line;

		if (settings.currentLineBlame) {
			const blame = findBlameForLine(lines, activeLine + 1);
			if (blame) {
				editor.setDecorations(currentLineType, [
					{
						// Keep the annotation outside the editable text range, as GitLens does.
						range: endOfLineRange(document, activeLine),
						renderOptions: { after: { contentText: formatCurrentLineBlameDecoration(blame) } },
						// Keep hover ownership exclusively in the provider. VS Code can retain
						// decoration hovers across refreshes, which otherwise duplicates cards.
						hoverMessage: undefined,
					},
				]);
			} else {
				editor.setDecorations(currentLineType, []);
			}
		} else {
			editor.setDecorations(currentLineType, []);
		}

		if (settings.inlineBlameGutter) {
			const annotated = settings.inlineBlameSparse ? collapseBlameToHunkStarts(lines) : lines;
			editor.setDecorations(
				inlineGutterType,
				annotated
					.filter((entry) => entry.line >= 1 && entry.line <= document.lineCount)
					.map((entry) => {
						const line = entry.line - 1;
						return {
							range: endOfLineRange(document, line),
							renderOptions: {
								after: {
									contentText: formatCurrentLineBlameDecoration(entry),
								},
							},
							hoverMessage: undefined,
						};
					}),
			);
		} else {
			editor.setDecorations(inlineGutterType, []);
		}

		for (const other of vscode.window.visibleTextEditors) {
			if (other !== editor) {
				clearDecorations(other);
			}
		}
	};

	const hoverProvider: vscode.HoverProvider = {
		async provideHover(document, position) {
			const settings = readJjplusSettings();
			if (settings.blameHoverMode === 'never' || document.uri.scheme !== 'file') {
				return null;
			}
			const line = position.line + 1;
			let blame: BlameLine | undefined;
			const annotatedLines = new Set<number>();
			try {
				const lines = await getCachedLines(document);
				blame = lines ? findBlameForLine(lines, line) : undefined;
				if (lines && settings.inlineBlameGutter) {
					for (const entry of settings.inlineBlameSparse ? collapseBlameToHunkStarts(lines) : lines) {
						annotatedLines.add(entry.line);
					}
				}
				const activeEditor = vscode.window.activeTextEditor;
				if (settings.currentLineBlame && activeEditor?.document.uri.toString() === document.uri.toString()) {
					annotatedLines.add(activeEditor.selection.active.line + 1);
				}
			} catch {
				blame = undefined;
			}
			if (
				!shouldShowBlameHoverAtPosition({
					mode: settings.blameHoverMode,
					positionCharacter: position.character,
					lineLength: document.lineAt(position.line).text.length,
					line,
					annotatedLines,
				})
			) {
				return null;
			}
			const markdown = new vscode.MarkdownString(
				blame
					? buildCurrentLineBlameHoverMarkdown({
							entry: blame,
							absolutePath: document.uri.fsPath,
							line,
						})
					: `[${formatTimelineAtLineHoverTitle({ line })}](command:${OPEN_TIMELINE_AT_LINE_COMMAND}?${encodeURIComponent(
							JSON.stringify({ absolutePath: document.uri.fsPath, line }),
						)})`,
			);
			markdown.isTrusted = true;
			return new vscode.Hover(markdown);
		},
	};

	scheduleRefresh(0);

	return vscode.Disposable.from(
		currentLineType,
		inlineGutterType,
		vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
		vscode.window.onDidChangeActiveTextEditor(() => {
			clearEditingState();
			scheduleRefresh(0);
		}),
		vscode.window.onDidChangeTextEditorSelection((event) => {
			if (event.textEditor !== vscode.window.activeTextEditor) {
				return;
			}
			if (isEditing(event.textEditor)) {
				// GitLens keeps annotations hidden while editing the current line.
				// Moving to another line ends that editing session and restores them.
				if (!selectionLinesMatch(editingSelectionLines, getSelectionLines(event.textEditor))) {
					clearEditingState();
					scheduleRefresh(0);
				}
				return;
			}
			scheduleRefresh(40);
		}),
		vscode.workspace.onDidChangeTextDocument((event) => {
			const editor = vscode.window.activeTextEditor;
			if (event.document !== editor?.document) {
				return;
			}
			cache.delete(event.document.uri.toString());
			if (event.contentChanges.length > 0) {
				// GitLens clears its current-line annotation during an edit so
				// inline completions can use the editor's end-of-line slot.
				markEditing(editor);
				return;
			}
			scheduleRefresh(180);
		}),
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
				clearEditingState();
				scheduleRefresh(0);
			}
		}),
		onJjplusSettingsChange(() => {
			clearEditingState();
			scheduleRefresh(0);
		}),
		{
			dispose() {
				if (refreshTimer) {
					clearTimeout(refreshTimer);
				}
				clearEditingState();
				cache.clear();
			},
		},
	);
}
