#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { readFile } from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipVsCode = args.has('--skip-vscode');
const skipNpm = args.has('--skip-npm');
const withNpmProvenance = args.has('--provenance');

if ([...args].some((arg) => !['--dry-run', '--skip-vscode', '--skip-npm', '--provenance'].includes(arg))) {
	console.error('Usage: pnpm release [--dry-run] [--skip-vscode] [--skip-npm] [--provenance]');
	process.exit(2);
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;
const tag = `v${version}`;
const marketplaceToken = process.env.VSCE_PAT ?? process.env.JJPLUS_VSCODE_PAT;
if (marketplaceToken && !process.env.VSCE_PAT) process.env.VSCE_PAT = marketplaceToken;
const npmPublishArgs = [
	'publish',
	'--access',
	'public',
	'--no-git-checks',
	...(withNpmProvenance ? ['--provenance'] : []),
];

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

async function commandSucceeds(command, commandArgs) {
	try {
		await run(command, commandArgs, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

console.log(`Preparing JJ Plus ${version} (${tag})`);
if (!dryRun && !skipVsCode && !marketplaceToken) {
	throw new Error('VSCE_PAT is required for Marketplace publishing. Use --skip-vscode to publish npm only.');
}
if (
	!dryRun &&
	!skipNpm &&
	!(process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) &&
	!(await commandSucceeds('npm', ['whoami', '--registry=https://registry.npmjs.org']))
) {
	throw new Error(
		'npm authentication is missing. Set NPM_TOKEN/NODE_AUTH_TOKEN or run npm login. Use --skip-npm to publish Marketplace only.',
	);
}

await run('pnpm', ['release:check']);

if (skipVsCode) console.log('Skipping Visual Studio Marketplace (--skip-vscode).');
else
	await run(
		'pnpm',
		dryRun
			? ['exec', 'vsce', 'package', '--skip-license', '--no-dependencies']
			: ['exec', 'vsce', 'publish', '--no-dependencies', '--skip-duplicate', '--githubBranch', 'main'],
	);

if (skipNpm) console.log('Skipping npm (--skip-npm).');
else if (dryRun) await run('pnpm', [...npmPublishArgs, '--dry-run']);
else if (
	await commandSucceeds('npm', ['view', `jj-plus@${version}`, 'version', '--registry=https://registry.npmjs.org'])
)
	console.log(`jj-plus@${version} already exists on npm; skipping.`);
else await run('pnpm', npmPublishArgs);

console.log(dryRun ? `Dry run complete for ${tag}.` : `Published JJ Plus ${version} to the selected registries.`);
