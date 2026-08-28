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
			margin: '0 0 0 1.5em',
		},
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});
	const inlineGutterType = vscode.window.createTextEditorDecorationType({
		after: {
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'italic',
			margin: '0 0 0 1.2em',
			fontWeight: 'normal',
		},
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});

	const cache = new Map<string, CacheEntry>();
	let generation = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

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
			return;
		}

		if (!settings.currentLineBlame && !settings.inlineBlameGutter) {
			editor.setDecorations(currentLineType, []);
			editor.setDecorations(inlineGutterType, []);
			return;
		}

		let lines: BlameLine[] | undefined;
		try {
			lines = await getCachedLines(editor.document);
		} catch {
			editor.setDecorations(currentLineType, []);
			editor.setDecorations(inlineGutterType, []);
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
				const hover = new vscode.MarkdownString(
					buildCurrentLineBlameHoverMarkdown({
						entry: blame,
						absolutePath: document.uri.fsPath,
						line: activeLine + 1,
					}),
				);
				hover.isTrusted = true;
				editor.setDecorations(currentLineType, [
					{
						range: document.lineAt(activeLine).range,
						renderOptions: { after: { contentText: formatCurrentLineBlameDecoration(blame) } },
						// The hover provider owns the card when the timeline-link setting is on.
						// Keeping both sources here makes VS Code render the same card twice.
						hoverMessage: settings.hoverTimelineLink ? undefined : hover,
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
						const hover = new vscode.MarkdownString(
							buildCurrentLineBlameHoverMarkdown({
								entry,
								absolutePath: document.uri.fsPath,
								line: entry.line,
							}),
						);
						hover.isTrusted = true;
						return {
							range: document.lineAt(line).range,
							renderOptions: {
								after: {
									contentText: formatCurrentLineBlameDecoration(entry),
								},
							},
								hoverMessage: settings.hoverTimelineLink ? undefined : hover,
						};
					}),
			);
		} else {
			editor.setDecorations(inlineGutterType, []);
		}

		for (const other of vscode.window.visibleTextEditors) {
			if (other !== editor) {
				other.setDecorations(currentLineType, []);
				other.setDecorations(inlineGutterType, []);
			}
		}
	};

	const hoverProvider: vscode.HoverProvider = {
		async provideHover(document, position) {
			const settings = readJjplusSettings();
			if (!settings.hoverTimelineLink || document.uri.scheme !== 'file') {
				return null;
			}
			const line = position.line + 1;
			let blame: BlameLine | undefined;
			try {
				const lines = await getCachedLines(document);
				blame = lines ? findBlameForLine(lines, line) : undefined;
			} catch {
				blame = undefined;
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
		vscode.window.onDidChangeActiveTextEditor(() => scheduleRefresh(0)),
		vscode.window.onDidChangeTextEditorSelection((event) => {
			if (event.textEditor === vscode.window.activeTextEditor) {
				scheduleRefresh(40);
			}
		}),
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
				cache.delete(event.document.uri.toString());
				scheduleRefresh(180);
			}
		}),
		onJjplusSettingsChange(() => scheduleRefresh(0)),
		{
			dispose() {
				if (refreshTimer) {
					clearTimeout(refreshTimer);
				}
				cache.clear();
			},
		},
	);
}
