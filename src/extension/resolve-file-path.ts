import * as vscode from 'vscode';
import { coerceFsPath } from '../shared/resolve-file-path.ts';

export { coerceFsPath };

export function resolveCommandFilePath(arg?: unknown): string | undefined {
	const fromArg = coerceFsPath(arg);
	if (fromArg) {
		return fromArg;
	}
	const active = vscode.window.activeTextEditor?.document.uri;
	if (active?.scheme === 'file') {
		return active.fsPath;
	}
	return undefined;
}
