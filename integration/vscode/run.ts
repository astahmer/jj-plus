import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import ts from 'typescript';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(currentDirectory, '..', '..');
const suiteDirectory = resolve(currentDirectory, 'suite');
const repoRoot = join(extensionDevelopmentPath, '.e2e-runtime', 'repos');
const userDataRoot = join(tmpdir(), 'jjrd-u-');
const extensionsRoot = join(tmpdir(), 'jjrd-x-');
const fixtureNames = ['git-basic', 'jj-basic'] as const;

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});

async function main(): Promise<void> {
	const extensionTestsPath = await compileSuite();

	try {
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
	} finally {
		await Promise.all([
			rm(join(suiteDirectory, 'index.cjs'), { force: true }),
			rm(join(suiteDirectory, 'timeline.integration.cjs'), { force: true }),
		]);
	}
}

async function compileSuite(): Promise<string> {
	const timelineSourcePath = join(suiteDirectory, 'timeline.integration.ts');
	const timelineOutputPath = join(suiteDirectory, 'timeline.integration.cjs');
	const timelineSource = await readFile(timelineSourcePath, 'utf8');
	const compiledTimeline = ts.transpileModule(timelineSource, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2023,
		},
		fileName: timelineSourcePath,
	});
	await writeFile(timelineOutputPath, compiledTimeline.outputText, 'utf8');

	const indexOutputPath = join(suiteDirectory, 'index.cjs');
	await writeFile(
		indexOutputPath,
		[
			"const path = require('node:path');",
			"const Mocha = require('mocha');",
			'',
			'exports.run = async function run() {',
			'  process.stderr.write(`[integration] suite runner start: ${__filename}\\n`);',
			"  const testFile = path.resolve(__dirname, 'timeline.integration.cjs');",
			'  process.stderr.write(`[integration] adding file: ${testFile}\\n`);',
			"  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });",
			'  mocha.addFile(testFile);',
			'  return new Promise((resolve, reject) => {',
			'    try {',
			"      process.stderr.write('[integration] starting mocha.run()\\n');",
			'      mocha.run((failures) => {',
			'        process.stderr.write(`[integration] mocha finished with ${failures} failure(s)\\n`);',
			'        if (failures > 0) {',
			'          reject(new Error(`${failures} integration test(s) failed.`));',
			'          return;',
			'        }',
			'        resolve();',
			'      });',
			'    } catch (error) {',
			'      reject(error);',
			'    }',
			'  });',
			'};',
			'',
		].join('\n'),
		'utf8',
	);

	return indexOutputPath;
}
