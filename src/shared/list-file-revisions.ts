export async function listFileRevisionIds(args: {
	runner: {
		runGit: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
		runJj: (args: { workspacePath: string; args: string[] }) => Promise<{ stdout: string }>;
	};
	workspacePath: string;
	relativePath: string;
	backend: 'git' | 'jj';
}): Promise<string[]> {
	if (args.backend === 'git') {
		const { stdout } = await args.runner.runGit({
			workspacePath: args.workspacePath,
			args: ['log', '--follow', '--format=%H', '--', args.relativePath],
		});
		return stdout
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean)
			.toReversed();
	}
	const { stdout } = await args.runner.runJj({
		workspacePath: args.workspacePath,
		args: ['log', '-r', '::@', '--no-graph', '-T', 'commit_id ++ "\\n"', '--', args.relativePath],
	});
	const ids = stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.toReversed();
	if (ids.at(-1) !== '@') {
		ids.push('@');
	}
	return ids;
}
