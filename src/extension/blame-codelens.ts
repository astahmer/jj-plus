import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	buildGitBlameFileArgs,
	buildJjAnnotateArgs,
	findBlameForLine,
	parseGitBlamePorcelain,
	parseJjFileAnnotate,
	type BlameLine,
} from '../shared/blame.ts';
import { OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';
import {
	buildCurrentLineBlameHoverMarkdown,
	formatCurrentLineBlameDecoration,
	formatTimelineAtLineCodeLensTitle,
} from './timeline-at-line.ts';

type BlameRunner = {
	runGit: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
	runJj: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
};

type HistoryBackend = 'git' | 'jj';

type ResolveBackend = (args: { workspacePath: string }) => Promise<{ backend: HistoryBackend }>;

type FileBlameCacheEntry = {
	key: string;
	lines: BlameLine[];
	fetchedAt: number;
};

/**
 * GitLens-style current-line blame on the right — end-of-line decorations.
 * Avoids CodeLens layout shift on the selected line.
 */
export function createCurrentLineBlameLens(args: {
	runner: BlameRunner;
	resolveBackend: ResolveBackend;
}): vscode.Disposable {
	const decorationType = vscode.window.createTextEditorDecorationType({
		after: {
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'italic',
			margin: '0 0 0 1.5em',
		},
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});

	const cache = new Map<string, FileBlameCacheEntry>();
	let generation = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	const scheduleRefresh = (delayMs = 80) => {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}
		refreshTimer = setTimeout(() => {
			void refresh(vscode.window.activeTextEditor);
		}, delayMs);
	};

	const refresh = async (editor: vscode.TextEditor | undefined) => {
		const token = ++generation;
		if (!editor || editor.document.uri.scheme !== 'file') {
			return;
		}

		const document = editor.document;
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (!workspaceFolder) {
			editor.setDecorations(decorationType, []);
			return;
		}

		const workspacePath = workspaceFolder.uri.fsPath;
		const relativePath = path.relative(workspacePath, document.uri.fsPath).replace(/\\/g, '/');
		if (!relativePath || relativePath.startsWith('..')) {
			editor.setDecorations(decorationType, []);
			return;
		}

		const cacheKey = `${document.uri.toString()}::${document.version}`;
		let entry = cache.get(document.uri.toString());
		if (!entry || entry.key !== cacheKey) {
			try {
				const { backend } = await args.resolveBackend({ workspacePath });
				if (token !== generation) {
					return;
				}
				const lines =
					backend === 'git'
						? await loadGitBlame(args.runner, workspacePath, relativePath)
						: await loadJjBlame(args.runner, workspacePath, relativePath);
				entry = { key: cacheKey, lines, fetchedAt: Date.now() };
				cache.set(document.uri.toString(), entry);
			} catch {
				if (token !== generation) {
					return;
				}
				editor.setDecorations(decorationType, []);
				return;
			}
		}

		if (token !== generation || vscode.window.activeTextEditor !== editor) {
			return;
		}

		const line = editor.selection.active.line;
		const blame = findBlameForLine(entry.lines, line + 1);
		if (!blame) {
			editor.setDecorations(decorationType, []);
			return;
		}

		const range = document.lineAt(line).range;
		const hover = new vscode.MarkdownString(
			buildCurrentLineBlameHoverMarkdown({
				entry: blame,
				absolutePath: document.uri.fsPath,
				line: line + 1,
			}),
		);
		hover.isTrusted = true;
		hover.supportHtml = false;

		editor.setDecorations(decorationType, [
			{
				range,
				renderOptions: {
					after: {
						contentText: formatCurrentLineBlameDecoration(blame),
					},
				},
				hoverMessage: hover,
			},
		]);

		for (const other of vscode.window.visibleTextEditors) {
			if (other !== editor) {
				other.setDecorations(decorationType, []);
			}
		}
	};

	scheduleRefresh(0);

	return vscode.Disposable.from(
		decorationType,
		vscode.window.onDidChangeActiveTextEditor(() => scheduleRefresh(0)),
		vscode.window.onDidChangeTextEditorSelection((event) => {
			if (event.textEditor === vscode.window.activeTextEditor) {
				scheduleRefresh(40);
			}
		}),
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
				cache.delete(event.document.uri.toString());
				scheduleRefresh(200);
			}
		}),
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

async function loadJjBlame(runner: BlameRunner, workspacePath: string, relativePath: string): Promise<BlameLine[]> {
	const { stdout } = await runner.runJj({
		workspacePath,
		args: buildJjAnnotateArgs({ relativePath }),
	});
	return parseJjFileAnnotate(stdout);
}

async function loadGitBlame(runner: BlameRunner, workspacePath: string, relativePath: string): Promise<BlameLine[]> {
	const { stdout } = await runner.runGit({
		workspacePath,
		args: buildGitBlameFileArgs({ relativePath }),
	});
	return parseGitBlamePorcelain(stdout);
}

/** @deprecated Prefer createCurrentLineBlameLens — kept for tests that assert title helpers. */
export function createTimelineBlameCodeLensProvider(): vscode.CodeLensProvider & vscode.Disposable {
	const onDidChange = new vscode.EventEmitter<void>();
	return {
		onDidChangeCodeLenses: onDidChange.event,
		provideCodeLenses() {
			return [];
		},
		dispose() {
			onDidChange.dispose();
		},
	};
}

export function createTimelineBlameHoverProvider(args?: {
	getBlameLine?: (document: vscode.TextDocument, line: number) => BlameLine | undefined;
}): vscode.HoverProvider {
	return {
		provideHover(document, position) {
			if (document.uri.scheme !== 'file') {
				return null;
			}
			const line = position.line + 1;
			const blame = args?.getBlameLine?.(document, line);
			if (blame) {
				const markdown = new vscode.MarkdownString(
					buildCurrentLineBlameHoverMarkdown({
						entry: blame,
						absolutePath: document.uri.fsPath,
						line,
					}),
				);
				markdown.isTrusted = true;
				return new vscode.Hover(markdown);
			}
			const commandArgs = encodeURIComponent(JSON.stringify({ absolutePath: document.uri.fsPath, line }));
			const markdown = new vscode.MarkdownString(
				`[${formatTimelineAtLineCodeLensTitle(line)}](command:${OPEN_TIMELINE_AT_LINE_COMMAND}?${commandArgs})`,
			);
			markdown.isTrusted = true;
			return new vscode.Hover(markdown);
		},
	};
}
