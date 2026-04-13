import * as vscode from 'vscode';
import type { HistoryBackend } from '../shared/timeline-types.ts';
import { OPEN_RANGE_DIFF_URI_PATH, SNAPSHOT_SCHEME } from './constants.ts';
import type { RangeDiffArgs, SnapshotQuery } from './types.ts';

export function createSnapshotUri(args: {
	workspacePath: string;
	revset: string;
	relativePath: string;
	backend?: HistoryBackend;
}): vscode.Uri {
	return vscode.Uri.from({
		scheme: SNAPSHOT_SCHEME,
		path: `/${args.relativePath}`,
		query: JSON.stringify({
			workspacePath: args.workspacePath,
			filePath: args.relativePath,
			revset: args.revset,
			backend: args.backend,
		}),
	});
}

export function parseRangeDiffUri(uri: vscode.Uri): RangeDiffArgs {
	const params = new URLSearchParams(uri.query);

	return {
		from: getQueryParam(params, 'from') || getQueryParam(params, 'base'),
		to: getQueryParam(params, 'to') || getQueryParam(params, 'target'),
		base: getQueryParam(params, 'base'),
		target: getQueryParam(params, 'target'),
		title: getQueryParam(params, 'title'),
		workspacePath: getQueryParam(params, 'workspacePath'),
		confirm: getBooleanQueryParam(params, 'confirm'),
		verbose: getBooleanQueryParam(params, 'verbose'),
		source: getQueryParam(params, 'source'),
	};
}

export function parseSnapshotUri(uri: vscode.Uri): SnapshotQuery {
	return JSON.parse(uri.query) as SnapshotQuery;
}

export function sanitizeRangeDiffArgs(args: RangeDiffArgs | undefined): RangeDiffArgs | undefined {
	if (!args) {
		return undefined;
	}

	return {
		from: args.from,
		to: args.to,
		base: args.base,
		target: args.target,
		title: args.title,
		workspacePath: args.workspacePath,
		confirm: args.confirm,
		verbose: args.verbose,
		source: args.source,
	};
}

export function areSamePath(args: { left: string; right: string }): boolean {
	return normalizePath(args.left) === normalizePath(args.right);
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

export function isRangeDiffUriTarget(args: { uri: vscode.Uri; extensionId: string }): boolean {
	return args.uri.authority === args.extensionId && args.uri.path === OPEN_RANGE_DIFF_URI_PATH;
}

function getQueryParam(params: URLSearchParams, name: string): string | undefined {
	const value = params.get(name)?.trim();
	return value || undefined;
}

function getBooleanQueryParam(params: URLSearchParams, name: string): boolean | undefined {
	const value = params.get(name)?.trim().toLowerCase();
	if (!value) {
		return undefined;
	}

	if (value === '1' || value === 'true' || value === 'yes') {
		return true;
	}

	if (value === '0' || value === 'false' || value === 'no') {
		return false;
	}

	return undefined;
}
