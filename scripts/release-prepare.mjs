#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes('--dry-run');
const noPush = rawArgs.includes('--no-push');
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('--'));
const version = positionalArgs[0];

if (
	!version ||
	positionalArgs.length !== 1 ||
	!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ||
	rawArgs.some((arg) => !['--dry-run', '--no-push'].includes(arg) && arg.startsWith('--'))
) {
	console.error('Usage: pnpm release:prepare <version> [--dry-run] [--no-push]');
	process.exit(2);
}

const tag = `v${version}`;
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const currentVersion = packageJson.version;

function run(command, commandArgs, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, commandArgs, { stdio: 'inherit', shell: false, ...options });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolve();
			else
				reject(
					new Error(
						`${command} ${commandArgs.join(' ')} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}`,
					),
				);
		});
	});
}

function capture(command, commandArgs) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, commandArgs, { shell: false });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolve({ stdout, stderr });
			else
				reject(
					new Error(
						`${command} ${commandArgs.join(' ')} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}`,
					),
				);
		});
	});
}

const status = await capture('jj', ['status']);
if (!/working copy has no changes/iu.test(status.stdout)) {
	throw new Error('The JJ working copy is not clean. Commit or move the current changes before preparing a release.');
}

const tags = await capture('jj', ['tag', 'list']);
if (new RegExp(`^${escapeRegExp(tag)}(?:[:\\s])`, 'mu').test(tags.stdout)) {
	throw new Error(`${tag} already exists. Choose a new version instead of moving an existing release tag.`);
}

if (currentVersion === version) {
	console.log(`package.json is already at ${version}; continuing without another version bump.`);
} else if (dryRun) {
	console.log(`Would run: pnpm version ${version} --no-git-tag-version`);
} else {
	await run('pnpm', ['version', version, '--no-git-tag-version']);
}

console.log(`Release plan: ${currentVersion} -> ${version}`);
console.log(`  JJ description: release: ${tag}`);
console.log(`  JJ tag:         ${tag} -> @`);
console.log('  JJ bookmark:    main -> @');
console.log(
	`  Push:           ${noPush ? 'disabled (--no-push)' : dryRun ? 'disabled (--dry-run)' : 'main, then tag'}`,
);

if (dryRun) {
	console.log('Dry run complete; no files, JJ revisions, tags, bookmarks, or remotes were changed.');
	process.exit(0);
}

await run('jj', ['describe', '-m', `release: ${tag}`]);
await run('pnpm', ['release:check']);

// Tagging the working copy can make it immutable. JJ then creates a fresh
// empty working-copy commit, so capture the release commit before setting the
// tag instead of using `@` for the bookmark afterwards.
const releaseCommit = (await capture('jj', ['log', '-r', '@', '-T', 'commit_id', '--no-graph'])).stdout.trim();
if (!releaseCommit) {
	throw new Error('Could not resolve the release commit before tagging.');
}

await run('jj', ['tag', 'set', tag, '-r', '@']);
await run('jj', ['bookmark', 'set', 'main', '-r', releaseCommit]);

if (!noPush) {
	await run('jj', ['git', 'push', '--bookmark', 'main']);
	await run('jj', ['git', 'push', '--tag', tag]);
}

console.log(
	noPush
		? `Prepared ${tag}; nothing was pushed.`
		: `Prepared and pushed ${tag}. GitHub Actions should now publish Marketplace and npm.`,
);

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
