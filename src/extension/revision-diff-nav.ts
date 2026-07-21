import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveCommandFilePath } from './resolve-file-path.ts';

export type RevisionDiffSession = {
	workspacePath: string;
	relativePath: string;
	fileName: string;
	backend: 'git' | 'jj';
	/** Oldest → newest revision ids for this file (tip last). */
	revisions: string[];
	/** Index of the "after" / tip side currently shown. */
	tipIndex: number;
};

type ShowFile = (args: { workspacePath: string; revset: string; filePath: string }) => Promise<string>;

type CreateUri = (args: { workspacePath: string; revset: string; relativePath: string; content: string }) => vscode.Uri;

type ListRevisions = (args: {
	workspacePath: string;
	relativePath: string;
	backend: 'git' | 'jj';
}) => Promise<string[]>;

type ResolveBackend = (args: { workspacePath: string }) => Promise<{ backend: 'git' | 'jj' }>;

export function createRevisionDiffNavigator(args: {
	showFile: ShowFile;
	createUri: CreateUri;
	listRevisions: ListRevisions;
	resolveBackend: ResolveBackend;
	resolveHistoryWorkspacePath: (args: { workspacePath: string }) => Promise<string>;
	toRelativePath: (args: { historyWorkspacePath: string; absolutePath: string }) => string | undefined;
}): {
	openWithPrevious: (arg?: unknown) => Promise<void>;
	openPrevious: () => Promise<void>;
	openNext: () => Promise<void>;
	openTimelineHere: () => Promise<void>;
	getSession: () => RevisionDiffSession | undefined;
	dispose: () => void;
} {
	let session: RevisionDiffSession | undefined;
	const contextKey = 'jjplus.revisionDiffActive';

	const setActive = async (active: boolean) => {
		await vscode.commands.executeCommand('setContext', contextKey, active);
	};

	const openPair = async (next: RevisionDiffSession) => {
		const tip = next.revisions[next.tipIndex];
		const base = next.revisions[next.tipIndex - 1];
		if (!tip || !base) {
			throw new Error('No adjacent revision pair available');
		}
		const [originalContent, modifiedContent] = await Promise.all([
			args.showFile({ workspacePath: next.workspacePath, revset: base, filePath: next.relativePath }),
			args.showFile({ workspacePath: next.workspacePath, revset: tip, filePath: next.relativePath }),
		]);
		const originalUri = args.createUri({
			workspacePath: next.workspacePath,
			revset: base,
			relativePath: next.relativePath,
			content: originalContent,
		});
		const modifiedUri = args.createUri({
			workspacePath: next.workspacePath,
			revset: tip,
			relativePath: next.relativePath,
			content: modifiedContent,
		});
		session = next;
		await setActive(true);
		await vscode.commands.executeCommand(
			'vscode.diff',
			originalUri,
			modifiedUri,
			`${next.fileName}: ${short(base)} → ${short(tip)}`,
			{ preview: true },
		);
	};

	const openWithPrevious = async (arg?: unknown) => {
		const absolutePath = resolveCommandFilePath(arg);
		if (!absolutePath) {
			void vscode.window.showErrorMessage('Open a workspace file to diff against the previous revision');
			return;
		}
		try {
			const preferredWorkspacePath = path.dirname(absolutePath);
			const historyWorkspacePath = await args.resolveHistoryWorkspacePath({
				workspacePath: preferredWorkspacePath,
			});
			const relativePath = args.toRelativePath({ historyWorkspacePath, absolutePath });
			if (!relativePath) {
				throw new Error('The selected file is outside the resolved repository root');
			}
			const { backend } = await args.resolveBackend({ workspacePath: historyWorkspacePath });
			const revisions = await args.listRevisions({
				workspacePath: historyWorkspacePath,
				relativePath,
				backend,
			});
			if (revisions.length < 2) {
				throw new Error('Need at least two revisions touching this file');
			}
			await openPair({
				workspacePath: historyWorkspacePath,
				relativePath,
				fileName: path.basename(absolutePath),
				backend,
				revisions,
				tipIndex: revisions.length - 1,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to open changes with previous revision: ${message}`);
		}
	};

	const openPrevious = async () => {
		if (!session || session.tipIndex < 1) {
			void vscode.window.showInformationMessage('Already at the oldest revision for this file');
			return;
		}
		try {
			await openPair({ ...session, tipIndex: session.tipIndex - 1 });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to open previous revision: ${message}`);
		}
	};

	const openNext = async () => {
		if (!session || session.tipIndex >= session.revisions.length - 1) {
			void vscode.window.showInformationMessage('Already at the newest revision for this file');
			return;
		}
		try {
			await openPair({ ...session, tipIndex: session.tipIndex + 1 });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to open next revision: ${message}`);
		}
	};

	const openTimelineHere = async () => {
		if (!session) {
			void vscode.window.showErrorMessage('Open a revision diff first');
			return;
		}
		const absolutePath = path.join(session.workspacePath, session.relativePath);
		await vscode.commands.executeCommand('jj-range-diff.openFileRevisionTimeline', absolutePath);
	};

	const disposable = vscode.window.onDidChangeActiveTextEditor(() => {
		void setActive(Boolean(session));
	});

	return {
		openWithPrevious,
		openPrevious,
		openNext,
		openTimelineHere,
		getSession: () => session,
		dispose: () => {
			disposable.dispose();
			void setActive(false);
		},
	};
}

function short(revision: string): string {
	return revision.length > 12 ? revision.slice(0, 12) : revision;
}

export { listFileRevisionIds } from '../shared/list-file-revisions.ts';
