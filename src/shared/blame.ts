export type BlameLine = {
	/** 1-based line number in the blamed file. */
	line: number;
	revision: string;
	author?: string;
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
				lines.push({
					line: pending.line,
					revision: pending.revision,
					author: pending.author,
					summary: pending.summary,
				});
			}
			pending = { revision, line: Number(finalLine) };
			continue;
		}
		if (raw.startsWith('author ')) {
			pending.author = raw.slice('author '.length);
			continue;
		}
		if (raw.startsWith('summary ')) {
			pending.summary = raw.slice('summary '.length);
		}
	}
	if (pending.revision && pending.line) {
		lines.push({
			line: pending.line,
			revision: pending.revision,
			author: pending.author,
			summary: pending.summary,
		});
	}
	return lines;
}

/** jj `file annotate` default: `REVISION PATH:LINE: content` or similar — also accept `rev: content`. */
export function parseJjFileAnnotate(stdout: string): BlameLine[] {
	const lines: BlameLine[] = [];
	let line = 1;
	for (const raw of stdout.split(/\r?\n/u)) {
		if (!raw) {
			continue;
		}
		const match = /^([0-9a-f]{7,40}|[a-z0-9]+)\s+(?:\S+\s+)?(.*)$/i.exec(raw);
		if (!match) {
			line += 1;
			continue;
		}
		lines.push({
			line,
			revision: match[1],
			summary: match[2]?.trim() || undefined,
		});
		line += 1;
	}
	return lines;
}

export function findBlameForLine(blame: BlameLine[], line: number): BlameLine | undefined {
	return blame.find((entry) => entry.line === line);
}

export function buildGitBlameArgs(args: { relativePath: string; line: number }): string[] {
	return ['blame', '-L', `${args.line},${args.line}`, '--porcelain', '--', args.relativePath];
}

export function buildJjAnnotateArgs(args: { relativePath: string }): string[] {
	return ['file', 'annotate', args.relativePath];
}

export function revisionMatchesBlame(entryRevision: string, blameRevision: string): boolean {
	const left = entryRevision.toLowerCase();
	const right = blameRevision.toLowerCase();
	return left === right || left.startsWith(right) || right.startsWith(left);
}
