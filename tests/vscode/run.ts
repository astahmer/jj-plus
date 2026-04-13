import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(currentDirectory, '..', '..');
const extensionTestsPath = resolve(extensionDevelopmentPath, '.integration-dist', 'vscode-tests', 'suite', 'index.cjs');
const repoRoot = join(extensionDevelopmentPath, '.e2e-runtime', 'repos');
const userDataRoot = join(tmpdir(), 'jjrd-u-');
const extensionsRoot = join(tmpdir(), 'jjrd-x-');
const fixtureNames = ['git-basic', 'jj-basic'] as const;

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});

async function main(): Promise<void> {
	await ensureBuiltSuite();

	for (const fixtureName of fixtureNames) {
		const workspacePath = join(repoRoot, fixtureName);
		const userDataDir = await mkdtemp(userDataRoot);
		const extensionsDir = await mkdtemp(extensionsRoot);

		try {
			await runTests({
				extensionDevelopmentPath,
				extensionTestsPath,
				launchArgs: [
					workspacePath,
					'--disable-workspace-trust',
					'--skip-welcome',
					'--skip-release-notes',
					'--user-data-dir',
					userDataDir,
					'--extensions-dir',
					extensionsDir,
				],
			});
		} finally {
			await Promise.all([
				rm(userDataDir, { recursive: true, force: true }),
				rm(extensionsDir, { recursive: true, force: true }),
			]);
		}
	}
}

async function ensureBuiltSuite(): Promise<void> {
	try {
		await access(extensionTestsPath);
	} catch {
		throw new Error(
			'Missing built VS Code integration suite. Run "pnpm build:integration" before executing the test runner.',
		);
	}
}
