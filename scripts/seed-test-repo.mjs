#!/usr/bin/env node
/**
 * Creates (or recreates) test-repo/ — a small colocated jj+git workspace for F5 Extension Host.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.join(rootDir, 'test-repo');

const planPath = 'apps/backend/instructions/lazy-di-rollout-plan.md';
const servicePath = 'apps/backend/src/service.ts';

async function run(command, args, cwd = repoDir) {
	await execFileAsync(command, args, { cwd });
}

async function writeFiles(files) {
	for (const [relativePath, content] of Object.entries(files)) {
		const absolutePath = path.join(repoDir, relativePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content);
	}
}

function plan(title, highlight, note) {
	return [`# ${title}`, '', highlight, '', note, ''].join('\n');
}

function service(tag, note) {
	return [
		`export const tag = '${tag}'`,
		'',
		`// ${note}`,
		'export function greet(name: string) {',
		'  return `hello ${name}`',
		'}',
		'',
	].join('\n');
}

async function commit(message, files) {
	await writeFiles(files);
	await run('jj', ['commit', '-m', message]);
}

await fs.rm(repoDir, { recursive: true, force: true });
await fs.mkdir(repoDir, { recursive: true });
await run('jj', ['git', 'init', '--colocate', repoDir], rootDir);
await run('git', ['config', 'user.name', 'Fixture User']);
await run('git', ['config', 'user.email', 'fixture@example.com']);
await run('jj', ['config', 'set', '--repo', 'user.name', 'Fixture User']);
await run('jj', ['config', 'set', '--repo', 'user.email', 'fixture@example.com']);

await commit('initial workspace', {
	[planPath]: plan('Rollout plan', 'alpha line', 'Capture the initial rollout notes.'),
	[servicePath]: service('alpha', 'Bootstrap service wiring.'),
});

await commit('unrelated note', {
	'notes/todo.txt': 'unrelated note\n',
});

await commit('plan refinement', {
	[planPath]: plan('Rollout plan', 'beta line', 'Refine the plan for the next review.'),
});

await commit('service extraction', {
	[servicePath]: service('beta', 'Extract the service helper into its own file.'),
});

await writeFiles({
	[planPath]: plan('Rollout plan', 'gamma line', 'Working-tree draft for timeline testing.'),
	[servicePath]: service('gamma', 'Uncommitted JJ working tree service changes.'),
});
await run('jj', ['describe', '-m', 'working tree draft']);

console.log(`Seeded ${repoDir}`);
console.log('Open apps/backend/instructions/lazy-di-rollout-plan.md and run JJ: Open File Revision Timeline');
