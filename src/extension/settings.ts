import * as vscode from 'vscode';

export const SETTINGS_SECTION = 'jjplus';

export type BlameHoverMode = 'blame' | 'any' | 'never';

export type JjplusSettings = {
	currentLineBlame: boolean;
	inlineBlameGutter: boolean;
	inlineBlameSparse: boolean;
	blameHoverMode: BlameHoverMode;
	statusBarChangeChip: boolean;
	scmChangedLines: boolean;
	opLogWatch: boolean;
	conflictHelper: boolean;
	codeActions: boolean;
};

export function readJjplusSettings(): JjplusSettings {
	const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
	const inspectedMode = config.inspect<BlameHoverMode>('blameHoverMode');
	const hasExplicitMode = [
		inspectedMode?.workspaceFolderLanguageValue,
		inspectedMode?.workspaceFolderValue,
		inspectedMode?.workspaceLanguageValue,
		inspectedMode?.workspaceValue,
		inspectedMode?.globalLanguageValue,
		inspectedMode?.globalValue,
	].some((value) => value !== undefined);
	const configuredMode = config.get<BlameHoverMode>('blameHoverMode', 'blame');
	const legacyHoverEnabled = config.get<boolean>('hoverTimelineLink', true);
	return {
		currentLineBlame: config.get<boolean>('currentLineBlame', true),
		inlineBlameGutter: config.get<boolean>('inlineBlameGutter', false),
		inlineBlameSparse: config.get<boolean>('inlineBlameSparse', true),
		blameHoverMode: hasExplicitMode ? configuredMode : legacyHoverEnabled ? 'blame' : 'never',
		statusBarChangeChip: config.get<boolean>('statusBarChangeChip', true),
		scmChangedLines: config.get<boolean>('scmChangedLines', false),
		opLogWatch: config.get<boolean>('opLogWatch', false),
		conflictHelper: config.get<boolean>('conflictHelper', true),
		codeActions: config.get<boolean>('codeActions', false),
	};
}

export function onJjplusSettingsChange(listener: () => void): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration(SETTINGS_SECTION)) {
			listener();
		}
	});
}
