import { OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';
import type { BlameLine } from '../shared/blame.ts';
import {
	formatBlameGutterLabel,
	formatBlameHoverTooltip,
	shortBlameRevision,
	truncateBlameSummaryForDecoration,
} from '../shared/blame.ts';

export function formatTimelineAtLineCodeLensTitle(line: number): string {
	return `jjplus: Open revision timeline · line ${line}`;
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
	return `jjplus: Open revision timeline · line ${args.line}${detail}`;
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
	const author = args.entry.author?.trim() || 'Unknown author';
	const when = args.entry.authorDate || '';
	const header = when ? `${author} · ${when}` : author;
	const shortDesc = args.entry.summary?.trim() || '';
	const longDesc = args.fullDescription?.trim() || '';
	const body = longDesc && longDesc !== shortDesc ? `${shortDesc}\n\n${longDesc}` : shortDesc || '_No description_';
	const rev = shortBlameRevision(args.entry.revision, 12);
	const title = formatTimelineAtLineHoverTitle({
		line: args.line,
		author,
		when,
		summary: shortDesc,
	});
	return [
		`**${title}**`,
		'',
		`**${header}**`,
		'',
		body,
		'',
		`\`${rev}\` | [Open revision timeline](${openLink})`,
		'',
		'---',
		formatBlameHoverTooltip(args.entry),
	]
		.filter((line, index, all) => !(line === '' && all[index - 1] === ''))
		.join('\n');
}
