export type BlameLine = {
	/** 1-based line number in the blamed file. */
	line: number;
	revision: string;
	author?: string;
	/** Unix epoch seconds when available (git porcelain author-time). */
	authorTimestamp?: number;
	/** Display-ready author date string when available. */
	authorDate?: string;
	summary?: string;
};

export function parseGitBlamePorcelain(stdout: string): BlameLine[] {
	const lines: BlameLine[] = [];
	let pending: Partial<BlameLine> & { revision?: string } = {};
	for (const raw of stdout.split(/\r?\n/u)) {
		if (!raw) {
			continue;
		}
		if (/^[0-9a-f]{7,40}\s+\d+\s+\d+/i.test(raw)) {
			const [revision, , finalLine] = raw.split(/\s+/u);
			if (pending.revision && pending.line) {
				lines.push(finalizeBlamePending(pending));
			}
			pending = { revision, line: Number(finalLine) };
			continue;
		}
		if (raw.startsWith('author ')) {
			pending.author = raw.slice('author '.length);
			continue;
		}
		if (raw.startsWith('author-time ')) {
			const timestamp = Number(raw.slice('author-time '.length));
			if (Number.isFinite(timestamp)) {
				pending.authorTimestamp = timestamp;
				pending.authorDate = formatBlameAuthorDate(timestamp);
			}
			continue;
		}
		if (raw.startsWith('summary ')) {
			pending.summary = raw.slice('summary '.length);
		}
	}
	if (pending.revision && pending.line) {
		lines.push(finalizeBlamePending(pending));
	}
	return lines;
}

function finalizeBlamePending(pending: Partial<BlameLine> & { revision?: string }): BlameLine {
	return {
		line: pending.line!,
		revision: pending.revision!,
		author: pending.author,
		authorTimestamp: pending.authorTimestamp,
		authorDate: pending.authorDate,
		summary: pending.summary,
	};
}

/**
 * Default / templated jj annotate lines.
 * Preferred template (see buildJjAnnotateArgs):
 * `REV\tAUTHOR\tEPOCH_SECONDS\tSUMMARY`
 * Also accepts legacy `REV PATH:LINE: content` / `REV content`, and ISO timestamps.
 */
export function parseJjFileAnnotate(stdout: string): BlameLine[] {
	const lines: BlameLine[] = [];
	let line = 1;
	for (const raw of stdout.split(/\r?\n/u)) {
		if (!raw) {
			continue;
		}
		const tabulated = /^([0-9a-f]{7,40}|[a-z0-9]+)\t([^\t]*)\t([^\t]*)\t?(.*)$/iu.exec(raw);
		if (tabulated) {
			const parsedTime = parseBlameTimestamp(tabulated[3] ?? '');
			lines.push({
				line,
				revision: tabulated[1]!,
				author: tabulated[2]?.trim() || undefined,
				authorTimestamp: parsedTime?.timestamp,
				authorDate: parsedTime?.authorDate || tabulated[3]?.trim() || undefined,
				summary: tabulated[4]?.trim() || undefined,
			});
			line += 1;
			continue;
		}
		const match = /^([0-9a-f]{7,40}|[a-z0-9]+)\s+(?:\S+\s+)?(.*)$/i.exec(raw);
		if (!match) {
			line += 1;
			continue;
		}
		lines.push({
			line,
			revision: match[1]!,
			summary: match[2]?.trim() || undefined,
		});
		line += 1;
	}
	return lines;
}

/** Parse unix seconds or jj timestamp strings like `2026-04-08 15:39:22.000 +02:00`. */
export function parseBlameTimestamp(
	raw: string,
	nowMs = Date.now(),
): { timestamp: number; authorDate: string } | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}
	if (/^\d{9,12}$/u.test(trimmed)) {
		const timestamp = Number(trimmed);
		if (!Number.isFinite(timestamp)) {
			return undefined;
		}
		return { timestamp, authorDate: formatBlameAuthorDate(timestamp, nowMs) };
	}
	const isoish = trimmed.replace(/^(\d{4}-\d{2}-\d{2}) /u, '$1T').replace(/ ([+-]\d{2}:\d{2})$/u, '$1');
	const ms = Date.parse(isoish);
	if (!Number.isFinite(ms)) {
		return undefined;
	}
	const timestamp = Math.floor(ms / 1000);
	return { timestamp, authorDate: formatBlameAuthorDate(timestamp, nowMs) };
}

export function formatBlameAuthorDate(timestampSeconds: number, nowMs = Date.now()): string {
	const date = new Date(timestampSeconds * 1000);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	const deltaSec = Math.max(0, Math.round((nowMs - date.getTime()) / 1000));
	if (deltaSec < 60) {
		return 'just now';
	}
	if (deltaSec < 3600) {
		const mins = Math.floor(deltaSec / 60);
		return `${mins}m ago`;
	}
	if (deltaSec < 86400) {
		const hours = Math.floor(deltaSec / 3600);
		return `${hours}h ago`;
	}
	if (deltaSec < 86400 * 30) {
		const days = Math.floor(deltaSec / 86400);
		return `${days}d ago`;
	}
	return date.toISOString().slice(0, 10);
}

export function formatBlameGutterLabel(entry: BlameLine): string {
	const author = entry.author?.trim().split(/\s+/u)[0] || '';
	const date = entry.authorDate || '';
	const rev = shortBlameRevision(entry.revision);
	if (author && date) {
		return `${author}, ${date}`;
	}
	if (author) {
		return `${author} · ${rev}`;
	}
	if (date) {
		return `${rev} · ${date}`;
	}
	return rev;
}

export function formatBlameHoverTooltip(entry: BlameLine): string {
	return [
		entry.author ? `Author: ${entry.author}` : '',
		entry.authorDate ? `Date: ${entry.authorDate}` : '',
		entry.revision ? `Revision: ${entry.revision}` : '',
		entry.summary ? `Summary: ${entry.summary}` : '',
	]
		.filter(Boolean)
		.join('\n');
}

export function findBlameForLine(blame: BlameLine[], line: number): BlameLine | undefined {
	return blame.find((entry) => entry.line === line);
}

export function buildGitBlameArgs(args: { relativePath: string; line: number }): string[] {
	return ['blame', '-L', `${args.line},${args.line}`, '--porcelain', '--', args.relativePath];
}

export function buildGitBlameFileArgs(args: { relativePath: string; revision?: string }): string[] {
	if (args.revision) {
		return ['blame', '--porcelain', args.revision, '--', args.relativePath];
	}
	return ['blame', '--porcelain', '--', args.relativePath];
}

/** Tab-separated: commit id, author name, author unix seconds, first-line description. */
export const JJ_FILE_ANNOTATE_TEMPLATE =
	'commit.commit_id().short() ++ "\\t" ++ commit.author().name() ++ "\\t" ++ commit.author().timestamp().format("%s") ++ "\\t" ++ commit.description().first_line()';

export function buildJjAnnotateArgs(args: { relativePath: string; revision?: string }): string[] {
	const templateArgs = ['-T', JJ_FILE_ANNOTATE_TEMPLATE];
	if (args.revision) {
		return ['file', 'annotate', '-r', args.revision, ...templateArgs, args.relativePath];
	}
	return ['file', 'annotate', ...templateArgs, args.relativePath];
}

export function revisionMatchesBlame(entryRevision: string, blameRevision: string): boolean {
	const left = entryRevision.toLowerCase();
	const right = blameRevision.toLowerCase();
	return left === right || left.startsWith(right) || right.startsWith(left);
}

/** Keep first line of each contiguous same-revision run — sparse Pierre annotations. */
export function collapseBlameToHunkStarts(blame: BlameLine[]): BlameLine[] {
	const starts: BlameLine[] = [];
	let previousRevision = '';
	for (const entry of blame) {
		if (entry.revision === previousRevision) {
			continue;
		}
		starts.push(entry);
		previousRevision = entry.revision;
	}
	return starts;
}

export function shortBlameRevision(revision: string, maxLength = 7): string {
	return revision.length <= maxLength ? revision : revision.slice(0, maxLength);
}

export function findEntryIndexForBlameRevision(
	entries: Array<{ revision: string; isWorkingTree?: boolean }>,
	blameRevision: string,
): number {
	return entries.findIndex((entry) => !entry.isWorkingTree && revisionMatchesBlame(entry.revision, blameRevision));
}
