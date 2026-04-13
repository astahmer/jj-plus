import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
	const __dirname = new URL('.', import.meta.url).pathname;
	const extensionDevelopmentPath = resolve(__dirname, '..', '..');
	const extensionTestsPath = resolve(__dirname, 'suite', 'index.js');
	const repoRoot = join(extensionDevelopmentPath, '.e2e-runtime', 'repos');
	const userDataRoot = join(tmpdir(), 'jjrd-u-');
	const extensionsRoot = join(tmpdir(), 'jjrd-x-');

	for (const fixtureName of ['git-basic', 'jj-basic']) {
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

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
