import { OPEN_TIMELINE_AT_LINE_COMMAND } from './constants.ts';

export function formatTimelineAtLineCodeLensTitle(line: number): string {
	return `Open JJ timeline · line ${line}`;
}

export function buildTimelineAtLineCodeLens(args: {
	absolutePath: string;
	line: number;
}): { title: string; command: string; arguments: Array<{ absolutePath: string; line: number }> } {
	return {
		title: formatTimelineAtLineCodeLensTitle(args.line),
		command: OPEN_TIMELINE_AT_LINE_COMMAND,
		arguments: [{ absolutePath: args.absolutePath, line: args.line }],
	};
}
