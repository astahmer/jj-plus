import { OPEN_FILE_TIMELINE_COMMAND, OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';
import { resolveCommandFilePath } from './resolve-file-path.ts';
import { onJjplusSettingsChange, readJjplusSettings, SETTINGS_SECTION } from './settings.ts';
import { mergeCompareQuickPickValues } from '../shared/jj-revset-suggestions.ts';
import { buildJjAnnotateArgs, findBlameForLine, parseJjFileAnnotate } from '../shared/blame.ts';
import * as path from 'node:path';
import * as vscode from 'vscode';

type Runner = {
	runJj: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
	runGit: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
};

type ResolveBackend = (args: { workspacePath: string }) => Promise<{ backend: 'git' | 'jj' }>;

/**
 * Remaining editor/workspace features, each gated by jjplus.* settings where they touch the editor.
 */
export function registerEditorExtraFeatures(args: {
	context: vscode.ExtensionContext;
	runner: Runner;
	resolveBackend: ResolveBackend;
	createInlineContentUri: (args: {
		workspacePath: string;
		revset: string;
		relativePath: string;
		content: string;
	}) => vscode.Uri;
	showFileAtRevision: (args: { workspacePath: string; revset: string; filePath: string }) => Promise<string>;
}): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('jj-plus.toggleLineBlame', async () => {
			const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
			const current = config.get<boolean>('inlineBlameGutter', false);
			await config.update('inlineBlameGutter', !current, vscode.ConfigurationTarget.Global);
			void vscode.window.setStatusBarMessage(`jjplus: line blame ${current ? 'off' : 'on'}`, 2500);
		}),
		vscode.commands.registerCommand('jj-plus.compareWithBookmark', async () => {
			const absolutePath = resolveCommandFilePath();
			if (!absolutePath) {
				void vscode.window.showErrorMessage('Open a workspace file first');
				return;
			}
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolutePath));
			if (!folder) {
				void vscode.window.showErrorMessage('File must belong to a workspace folder');
				return;
			}
			const { backend } = await args.resolveBackend({ workspacePath: folder.uri.fsPath });
			const picks =
				backend === 'jj'
					? await listJjBookmarks(args.runner, folder.uri.fsPath)
					: await listGitBranches(args.runner, folder.uri.fsPath);
			const chosen = await vscode.window.showQuickPick(picks, {
				placeHolder: backend === 'jj' ? 'Compare with bookmark / revset' : 'Compare with branch / ref',
			});
			if (!chosen) {
				return;
			}
			const relativePath = path.relative(folder.uri.fsPath, absolutePath).replace(/\\/g, '/');
			const [originalContent, modifiedContent] = await Promise.all([
				args.showFileAtRevision({
					workspacePath: folder.uri.fsPath,
					revset: chosen,
					filePath: relativePath,
				}),
				args.showFileAtRevision({
					workspacePath: folder.uri.fsPath,
					revset: backend === 'jj' ? '@' : 'HEAD',
					filePath: relativePath,
				}),
			]);
			await vscode.commands.executeCommand(
				'vscode.diff',
				args.createInlineContentUri({
					workspacePath: folder.uri.fsPath,
					revset: chosen,
					relativePath,
					content: originalContent,
				}),
				args.createInlineContentUri({
					workspacePath: folder.uri.fsPath,
					revset: backend === 'jj' ? '@' : 'HEAD',
					relativePath,
					content: modifiedContent,
				}),
				`${path.basename(absolutePath)}: ${chosen} → ${backend === 'jj' ? '@' : 'HEAD'}`,
				{ preview: true },
			);
		}),
		vscode.commands.registerCommand('jj-plus.peekRevisionAtCursor', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.scheme !== 'file') {
				return;
			}
			const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
			if (!folder) {
				return;
			}
			const relativePath = path.relative(folder.uri.fsPath, editor.document.uri.fsPath).replace(/\\/g, '/');
			const line = editor.selection.active.line + 1;
			const { backend } = await args.resolveBackend({ workspacePath: folder.uri.fsPath });
			if (backend !== 'jj') {
				void vscode.window.showInformationMessage('Peek revision currently supports jj workspaces');
				return;
			}
			const { stdout } = await args.runner.runJj({
				workspacePath: folder.uri.fsPath,
				args: buildJjAnnotateArgs({ relativePath }),
			});
			const blame = findBlameForLine(parseJjFileAnnotate(stdout), line);
			if (!blame?.revision) {
				void vscode.window.showInformationMessage('No revision found for this line');
				return;
			}
			const content = await args.showFileAtRevision({
				workspacePath: folder.uri.fsPath,
				revset: blame.revision,
				filePath: relativePath,
			});
			const uri = args.createInlineContentUri({
				workspacePath: folder.uri.fsPath,
				revset: blame.revision,
				relativePath,
				content,
			});
			await vscode.commands.executeCommand(
				'editor.action.peekLocations',
				editor.document.uri,
				editor.selection.active,
				[new vscode.Location(uri, new vscode.Position(Math.max(0, line - 1), 0))],
			);
		}),
		vscode.commands.registerCommand('jj-plus.openFileAtRevision', async () => {
			const absolutePath = resolveCommandFilePath();
			if (!absolutePath) {
				void vscode.window.showErrorMessage('Open a workspace file first');
				return;
			}
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolutePath));
			if (!folder) {
				return;
			}
			const revset = await vscode.window.showInputBox({
				prompt: 'Revision / revset / bookmark',
				placeHolder: '@-',
			});
			if (!revset) {
				return;
			}
			const relativePath = path.relative(folder.uri.fsPath, absolutePath).replace(/\\/g, '/');
			const content = await args.showFileAtRevision({
				workspacePath: folder.uri.fsPath,
				revset,
				filePath: relativePath,
			});
			const uri = args.createInlineContentUri({
				workspacePath: folder.uri.fsPath,
				revset,
				relativePath,
				content,
			});
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: true });
		}),
		vscode.commands.registerCommand('jj-plus.openWorkingCopyChangesMulti', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder');
				return;
			}
			const { backend } = await args.resolveBackend({ workspacePath: folder.uri.fsPath });
			if (backend !== 'jj') {
				void vscode.window.showInformationMessage('Multi-file previous diff currently supports jj');
				return;
			}
			const { stdout } = await args.runner.runJj({
				workspacePath: folder.uri.fsPath,
				args: ['diff', '-r', '@-', '--name-only'],
			});
			const files = stdout
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter(Boolean);
			if (!files.length) {
				void vscode.window.showInformationMessage('No working-copy file changes vs @-');
				return;
			}
			const resources = await Promise.all(
				files.slice(0, 40).map(async (relativePath) => {
					const [original, modified] = await Promise.all([
						args.showFileAtRevision({
							workspacePath: folder.uri.fsPath,
							revset: '@-',
							filePath: relativePath,
						}),
						args.showFileAtRevision({
							workspacePath: folder.uri.fsPath,
							revset: '@',
							filePath: relativePath,
						}),
					]);
					return {
						originalUri: args.createInlineContentUri({
							workspacePath: folder.uri.fsPath,
							revset: '@-',
							relativePath,
							content: original,
						}),
						modifiedUri: args.createInlineContentUri({
							workspacePath: folder.uri.fsPath,
							revset: '@',
							relativePath,
							content: modified,
						}),
						goToFileUri: vscode.Uri.file(path.join(folder.uri.fsPath, relativePath)),
					};
				}),
			);
			await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
				title: 'Working copy vs @-',
				resources,
			});
		}),
	);

	disposables.push(createStatusBarChangeChip(args));
	disposables.push(createOpLogWatcher(args));
	disposables.push(createConflictHelper());
	disposables.push(createWhyCodeActions());
	disposables.push(createScmChangedLineDecorations(args));

	return vscode.Disposable.from(...disposables);
}

function createStatusBarChangeChip(args: { runner: Runner; resolveBackend: ResolveBackend }): vscode.Disposable {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	item.command = OPEN_FILE_TIMELINE_COMMAND;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const refresh = async () => {
		const settings = readJjplusSettings();
		if (!settings.statusBarChangeChip) {
			item.hide();
			return;
		}
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== 'file') {
			item.hide();
			return;
		}
		const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (!folder) {
			item.hide();
			return;
		}
		try {
			const { backend } = await args.resolveBackend({ workspacePath: folder.uri.fsPath });
			if (backend !== 'jj') {
				item.hide();
				return;
			}
			const { stdout } = await args.runner.runJj({
				workspacePath: folder.uri.fsPath,
				args: [
					'log',
					'-r',
					'@',
					'--no-graph',
					'-T',
					'change_id.shortest(8) ++ " " ++ description.first_line() ++ "\\n"',
					'-n',
					'1',
				],
			});
			const line = stdout.trim().split(/\r?\n/u)[0] || '';
			if (!line) {
				item.hide();
				return;
			}
			item.text = `$(git-commit) ${line.slice(0, 48)}`;
			item.tooltip = 'jjplus: working-copy change — click to open revision timeline';
			item.show();
		} catch {
			item.hide();
		}
	};

	const schedule = () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			void refresh();
		}, 200);
	};

	schedule();
	return vscode.Disposable.from(
		item,
		vscode.window.onDidChangeActiveTextEditor(schedule),
		onJjplusSettingsChange(schedule),
		{ dispose: () => timer && clearTimeout(timer) },
	);
}

function createOpLogWatcher(args: { runner: Runner; resolveBackend: ResolveBackend }): vscode.Disposable {
	let lastOp = '';
	let timer: ReturnType<typeof setInterval> | undefined;

	const tick = async () => {
		if (!readJjplusSettings().opLogWatch) {
			return;
		}
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		try {
			const { backend } = await args.resolveBackend({ workspacePath: folder.uri.fsPath });
			if (backend !== 'jj') {
				return;
			}
			const { stdout } = await args.runner.runJj({
				workspacePath: folder.uri.fsPath,
				args: ['op', 'log', '-n', '1', '--no-graph', '-T', 'self.id().short() ++ " " ++ description.first_line()'],
			});
			const tip = stdout.trim();
			if (!tip) {
				return;
			}
			if (lastOp && tip !== lastOp) {
				void vscode.window.setStatusBarMessage(`jjplus: op log advanced — ${tip}`, 5000);
				void vscode.window.showInformationMessage(`jj repository changed: ${tip}`);
			}
			lastOp = tip;
		} catch {
			// ignore
		}
	};

	const restart = () => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
		if (readJjplusSettings().opLogWatch) {
			timer = setInterval(() => {
				void tick();
			}, 8000);
			void tick();
		}
	};

	restart();
	return vscode.Disposable.from(onJjplusSettingsChange(restart), {
		dispose() {
			if (timer) {
				clearInterval(timer);
			}
		},
	});
}

function createConflictHelper(): vscode.Disposable {
	const decoration = vscode.window.createTextEditorDecorationType({
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.errorForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('diffEditor.diagonalFill'),
	});

	const refresh = (editor: vscode.TextEditor | undefined) => {
		if (!readJjplusSettings().conflictHelper || !editor || editor.document.uri.scheme !== 'file') {
			return;
		}
		const ranges: vscode.DecorationOptions[] = [];
		for (let line = 0; line < editor.document.lineCount; line += 1) {
			const text = editor.document.lineAt(line).text;
			if (text.startsWith('<<<<<<<') || text.startsWith('>>>>>>>') || text.startsWith('%%%%%%%')) {
				ranges.push({
					range: editor.document.lineAt(line).range,
					hoverMessage: 'jjplus: conflict marker — use Jump to Next Conflict',
				});
			}
		}
		editor.setDecorations(decoration, ranges);
	};

	return vscode.Disposable.from(
		decoration,
		vscode.commands.registerCommand('jj-plus.jumpNextConflict', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			const start = editor.selection.active.line + 1;
			for (let line = start; line < editor.document.lineCount; line += 1) {
				const text = editor.document.lineAt(line).text;
				if (text.startsWith('<<<<<<<') || text.startsWith('%%%%%%%')) {
					const pos = new vscode.Position(line, 0);
					editor.selection = new vscode.Selection(pos, pos);
					editor.revealRange(editor.document.lineAt(line).range);
					return;
				}
			}
			void vscode.window.showInformationMessage('No further conflict markers');
		}),
		vscode.window.onDidChangeActiveTextEditor((editor) => refresh(editor)),
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document === vscode.window.activeTextEditor?.document) {
				refresh(vscode.window.activeTextEditor);
			}
		}),
		onJjplusSettingsChange(() => refresh(vscode.window.activeTextEditor)),
		{ dispose: () => refresh(undefined) },
	);
}

function createWhyCodeActions(): vscode.Disposable {
	return vscode.languages.registerCodeActionsProvider(
		{ scheme: 'file' },
		{
			async provideCodeActions(document, range) {
				if (!readJjplusSettings().codeActions) {
					return [];
				}
				const line = range.start.line + 1;
				const action = new vscode.CodeAction(`jjplus: Why is line ${line} here?`, vscode.CodeActionKind.QuickFix);
				action.command = {
					command: OPEN_TIMELINE_AT_LINE_COMMAND,
					title: 'Open timeline at line',
					arguments: [{ absolutePath: document.uri.fsPath, line }],
				};
				return [action];
			},
		},
		{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
	);
}

function createScmChangedLineDecorations(args: {
	runner: Runner;
	resolveBackend: ResolveBackend;
	showFileAtRevision: (args: { workspacePath: string; revset: string; filePath: string }) => Promise<string>;
}): vscode.Disposable {
	const decoration = vscode.window.createTextEditorDecorationType({
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Left,
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
	});
	let timer: ReturnType<typeof setTimeout> | undefined;

	const refresh = async (editor: vscode.TextEditor | undefined) => {
		if (!readJjplusSettings().scmChangedLines || !editor || editor.document.uri.scheme !== 'file') {
			editor?.setDecorations(decoration, []);
			return;
		}
		const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (!folder) {
			return;
		}
		try {
			const { backend } = await args.resolveBackend({ workspacePath: folder.uri.fsPath });
			if (backend !== 'jj') {
				editor.setDecorations(decoration, []);
				return;
			}
			const relativePath = path.relative(folder.uri.fsPath, editor.document.uri.fsPath).replace(/\\/g, '/');
			const before = await args.showFileAtRevision({
				workspacePath: folder.uri.fsPath,
				revset: '@-',
				filePath: relativePath,
			});
			const beforeLines = before.split(/\r?\n/u);
			const afterLines = editor.document.getText().split(/\r?\n/u);
			const ranges: vscode.Range[] = [];
			const max = Math.max(beforeLines.length, afterLines.length);
			for (let index = 0; index < max && index < editor.document.lineCount; index += 1) {
				if ((beforeLines[index] ?? '') !== (afterLines[index] ?? '')) {
					ranges.push(editor.document.lineAt(index).range);
				}
			}
			editor.setDecorations(
				decoration,
				ranges.map((range) => ({ range, hoverMessage: 'Changed vs @-' })),
			);
		} catch {
			editor.setDecorations(decoration, []);
		}
	};

	const schedule = () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			void refresh(vscode.window.activeTextEditor);
		}, 250);
	};

	schedule();
	return vscode.Disposable.from(
		decoration,
		vscode.window.onDidChangeActiveTextEditor(schedule),
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document === vscode.window.activeTextEditor?.document) {
				schedule();
			}
		}),
		onJjplusSettingsChange(schedule),
		{ dispose: () => timer && clearTimeout(timer) },
	);
}

async function listJjBookmarks(runner: Runner, workspacePath: string): Promise<string[]> {
	const { stdout } = await runner.runJj({
		workspacePath,
		args: ['bookmark', 'list', '-T', 'name ++ "\\n"'],
	});
	const names = stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	return mergeCompareQuickPickValues(names);
}

async function listGitBranches(runner: Runner, workspacePath: string): Promise<string[]> {
	const { stdout } = await runner.runGit({
		workspacePath,
		args: ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
	});
	return stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}
