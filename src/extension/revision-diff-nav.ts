import * as path from 'node:path';
import * as vscode from 'vscode';
import { getRevisionDiffNavAvailability } from '../shared/revision-diff-availability.ts';
import { resolveNonEmptyRevisionPair } from '../shared/revision-diff-pair.ts';
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

export { getRevisionDiffNavAvailability } from '../shared/revision-diff-availability.ts';

type ShowFile = (args: { workspacePath: string; revset: string; filePath: string }) => Promise<string>;

type CreateUri = (args: { workspacePath: string; revset: string; relativePath: string; content: string }) => vscode.Uri;

type ListRevisions = (args: {
	workspacePath: string;
	relativePath: string;
	backend: 'git' | 'jj';
}) => Promise<string[]>;

type ResolveBackend = (args: { workspacePath: string }) => Promise<{ backend: 'git' | 'jj' }>;

const CONTEXT_ACTIVE = 'jjplus.revisionDiffActive';
const CONTEXT_HAS_PREVIOUS = 'jjplus.revisionDiffHasPrevious';
const CONTEXT_HAS_NEXT = 'jjplus.revisionDiffHasNext';

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

	const syncContext = async () => {
		const availability = getRevisionDiffNavAvailability(session);
		await Promise.all([
			vscode.commands.executeCommand('setContext', CONTEXT_ACTIVE, availability.active),
			vscode.commands.executeCommand('setContext', CONTEXT_HAS_PREVIOUS, availability.hasPrevious),
			vscode.commands.executeCommand('setContext', CONTEXT_HAS_NEXT, availability.hasNext),
		]);
	};

	const openPair = async (next: RevisionDiffSession) => {
		const pair = await resolveNonEmptyRevisionPair({
			revisions: next.revisions,
			tipIndex: next.tipIndex,
			showFile: (revset) =>
				args.showFile({
					workspacePath: next.workspacePath,
					revset,
					filePath: next.relativePath,
				}),
		});
		if (!pair) {
			throw new Error('No non-empty revision pair available for this file');
		}
		const originalUri = args.createUri({
			workspacePath: next.workspacePath,
			revset: pair.base,
			relativePath: next.relativePath,
			content: pair.originalContent,
		});
		const modifiedUri = args.createUri({
			workspacePath: next.workspacePath,
			revset: pair.tip,
			relativePath: next.relativePath,
			content: pair.modifiedContent,
		});
		session = { ...next, tipIndex: pair.tipIndex };
		await syncContext();
		await vscode.commands.executeCommand(
			'vscode.diff',
			originalUri,
			modifiedUri,
			`${next.fileName}: ${short(pair.base)} → ${short(pair.tip)}`,
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
		const availability = getRevisionDiffNavAvailability(session);
		if (!session || !availability.hasPrevious) {
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
		const availability = getRevisionDiffNavAvailability(session);
		if (!session || !availability.hasNext) {
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
		void syncContext();
	});

	void syncContext();

	return {
		openWithPrevious,
		openPrevious,
		openNext,
		openTimelineHere,
		getSession: () => session,
		dispose: () => {
			disposable.dispose();
			session = undefined;
			void syncContext();
		},
	};
}

function short(revision: string): string {
	return revision.length > 12 ? revision.slice(0, 12) : revision;
}

export { listFileRevisionIds } from '../shared/list-file-revisions.ts';
