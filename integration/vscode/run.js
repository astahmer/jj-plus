const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
	const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
	const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
	const repoRoot = path.join(extensionDevelopmentPath, '.e2e-runtime', 'repos');
	const userDataRoot = path.join(os.tmpdir(), 'jjrd-u-');
	const extensionsRoot = path.join(os.tmpdir(), 'jjrd-x-');

	for (const fixtureName of ['git-basic', 'jj-basic']) {
		const workspacePath = path.join(repoRoot, fixtureName);
		const userDataDir = await fs.mkdtemp(userDataRoot);
		const extensionsDir = await fs.mkdtemp(extensionsRoot);

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
				fs.rm(userDataDir, { recursive: true, force: true }),
				fs.rm(extensionsDir, { recursive: true, force: true }),
			]);
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
