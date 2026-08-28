import { OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';
import type { BlameLine } from '../shared/blame.ts';
import {
	formatBlameGutterLabel,
	shortBlameRevision,
	truncateBlameSummaryForDecoration,
} from '../shared/blame.ts';

export function formatTimelineAtLineCodeLensTitle(line: number): string {
	return `JJ Plus: Open revision timeline · line ${line}`;
}

export function formatTimelineAtLineHoverTitle(args: {
	line: number;
	author?: string;
	when?: string;
	summary?: string;
}): string {
	const bits = [
		args.author?.trim().split(/\s+/u)[0],
		args.when?.trim(),
		args.summary ? truncateBlameSummary(args.summary, 40) : undefined,
	].filter(Boolean);
	const detail = bits.length ? ` — ${bits.join(' · ')}` : '';
	return `JJ Plus: Open revision timeline · line ${args.line}${detail}`;
}

export function buildTimelineAtLineCodeLens(args: { absolutePath: string; line: number }): {
	title: string;
	command: string;
	arguments: Array<{ absolutePath: string; line: number }>;
} {
	return {
		title: formatTimelineAtLineCodeLensTitle(args.line),
		command: OPEN_TIMELINE_AT_LINE_COMMAND,
		arguments: [{ absolutePath: args.absolutePath, line: args.line }],
	};
}

/** End-of-line decoration text — GitLens-style, no layout shift. */
export function formatCurrentLineBlameDecoration(entry: BlameLine): string {
	return `  ${formatBlameGutterLabel(entry)}`;
}

export function truncateBlameSummary(value: string, maxLength: number): string {
	return truncateBlameSummaryForDecoration(value, maxLength);
}

export function buildCurrentLineBlameHoverMarkdown(args: {
	entry: BlameLine;
	absolutePath: string;
	line: number;
	fullDescription?: string;
}): string {
	const openArgs = encodeURIComponent(JSON.stringify({ absolutePath: args.absolutePath, line: args.line }));
	const openLink = `command:${OPEN_TIMELINE_AT_LINE_COMMAND}?${openArgs}`;
	const actionArgs = encodeURIComponent(JSON.stringify({ absolutePath: args.absolutePath, line: args.line, revision: args.entry.revision }));
	const copyRevisionLink = `command:jj-plus.copyBlameRevision?${encodeURIComponent(JSON.stringify({ revision: args.entry.revision }))}`;
	const snapshotLink = `command:jj-plus.openBlameSnapshot?${actionArgs}`;
	const remoteLink = `command:jj-plus.openBlameRemote?${actionArgs}`;
	const author = args.entry.author?.trim() || 'Unknown author';
	const when = args.entry.authorDate || '';
	const shortDesc = args.entry.summary?.trim() || '';
	const longDesc = args.fullDescription?.trim() || '';
	const body = longDesc && longDesc !== shortDesc ? `${shortDesc}\n\n${longDesc}` : shortDesc;
	const rev = shortBlameRevision(args.entry.revision, 12);
	return [
		`**${escapeMarkdown(author)}**${when ? ` · ${escapeMarkdown(when)}` : ''}`,
		`Line ${args.line} · Revision \`${escapeMarkdownCode(rev)}\``,
		'',
		body ? escapeMarkdownBlock(body) : '_No commit description_',
		'',
		`[Open revision timeline at line ${args.line}](${openLink})`,
		`[Open file snapshot](${snapshotLink}) · [Copy revision](${copyRevisionLink}) · [Open remote](${remoteLink})`,
	].join('\n');
}

function escapeMarkdown(value: string): string {
	return value
		.replaceAll('\\', '\\\\')
		.replaceAll('`', '\\`')
		.replaceAll('*', '\\*')
		.replaceAll('_', '\\_')
		.replaceAll('[', '\\[')
		.replaceAll(']', '\\]')
		.replaceAll('>', '\\>');
}

function escapeMarkdownCode(value: string): string {
	return value.replace(/[\\`]/gu, '\\$&');
}

function escapeMarkdownBlock(value: string): string {
	return value
		.split(/\r?\n/u)
		.map((line) => escapeMarkdown(line))
		.join('\n');
}
