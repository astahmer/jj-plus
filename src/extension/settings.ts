import * as vscode from 'vscode';

export const SETTINGS_SECTION = 'jjplus';

export type JjplusSettings = {
	currentLineBlame: boolean;
	inlineBlameGutter: boolean;
	inlineBlameSparse: boolean;
	hoverTimelineLink: boolean;
	statusBarChangeChip: boolean;
	scmChangedLines: boolean;
	opLogWatch: boolean;
	conflictHelper: boolean;
	codeActions: boolean;
};

export function readJjplusSettings(): JjplusSettings {
	const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
	return {
		currentLineBlame: config.get<boolean>('currentLineBlame', true),
		inlineBlameGutter: config.get<boolean>('inlineBlameGutter', false),
		inlineBlameSparse: config.get<boolean>('inlineBlameSparse', true),
		hoverTimelineLink: config.get<boolean>('hoverTimelineLink', true),
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
