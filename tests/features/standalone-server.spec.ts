import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { startStandaloneTimelineServer } from '../../src/standalone/server.ts';

const fixtureWorkspacePath = path.join(process.cwd(), '.e2e-runtime', 'repos', 'git-basic');
const primaryRelativePath = 'apps/backend/instructions/lazy-di-rollout-plan.md';

type EditorLaunchRecord = {
	args: string[];
	originalPath: string | null;
	modifiedPath: string | null;
	originalContent: string;
	modifiedContent: string;
};

test.describe('standalone server browser harness', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('selection diffs prompt for an editor command and launch through the real standalone server', async ({
		page,
	}) => {
		test.slow();

		const tempDir = await mkdtemp(path.join(tmpdir(), 'jjrd-standalone-'));
		const captureScriptPath = path.join(tempDir, 'capture-editor-command.mjs');
		const launchLogPath = path.join(tempDir, 'editor-launches.jsonl');
		await writeFile(captureScriptPath, buildCaptureScript(), 'utf8');

		const server = await startStandaloneTimelineServer({
			workspacePath: fixtureWorkspacePath,
			filePath: path.join(fixtureWorkspacePath, primaryRelativePath),
			openBrowser: false,
		});

		try {
			await page.goto(server.url);
			await expect(page.getByText('Revision Timeline')).toBeVisible();
			await expect(page.locator('#diffTitle')).not.toHaveText('No diff available');

			let promptType = '';
			let promptMessage = '';
			let promptDefaultValue = '';
			const promptHandled = new Promise<void>((resolvePrompt, rejectPrompt) => {
				page.once('dialog', (prompt) => {
					promptType = prompt.type();
					promptMessage = prompt.message();
					promptDefaultValue = prompt.defaultValue();
					void prompt.accept(`node ${captureScriptPath} ${launchLogPath}`).then(resolvePrompt, rejectPrompt);
				});
			});

			await page.locator('#openSidebarRangeDiffButton').click();
			await promptHandled;
			expect(promptType).toBe('prompt');
			expect(promptMessage).toBe('Open diffs with which editor command?');
			expect(promptDefaultValue).toBe('code');

			await expect.poll(async () => (await readLaunchRecords(launchLogPath)).length > 0).toBe(true);

			const launchRecords = await readLaunchRecords(launchLogPath);
			for (const launchRecord of launchRecords) {
				expect(launchRecord.args).toContain('--reuse-window');
				expect(launchRecord.args).toContain('--diff');
				expect(launchRecord.originalPath).toBeTruthy();
				expect(launchRecord.modifiedPath).toBeTruthy();
			}

			expect(launchRecords.some((launchRecord) => launchRecord.originalContent !== launchRecord.modifiedContent)).toBe(
				true,
			);
			expect(launchRecords.some((launchRecord) => launchRecord.modifiedContent.length > 0)).toBe(true);
		} finally {
			await server.close();
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

function buildCaptureScript(): string {
	return [
		"import fs from 'node:fs';",
		"import path from 'node:path';",
		'const [, , outputPath, ...args] = process.argv;',
		"const diffFlagIndex = args.lastIndexOf('--diff');",
		'const originalPath = diffFlagIndex >= 0 ? args[diffFlagIndex + 1] : null;',
		'const modifiedPath = diffFlagIndex >= 0 ? args[diffFlagIndex + 2] : null;',
		'const readText = (filePath) => {',
		"  if (!filePath) return '';",
		'  try {',
		"    return fs.readFileSync(filePath, 'utf8');",
		'  } catch {',
		"    return '';",
		'  }',
		'};',
		'fs.mkdirSync(path.dirname(outputPath), { recursive: true });',
		'fs.appendFileSync(',
		'  outputPath,',
		'  JSON.stringify({',
		'    args,',
		'    originalPath,',
		'    modifiedPath,',
		'    originalContent: readText(originalPath),',
		'    modifiedContent: readText(modifiedPath),',
		"  }) + '\\n',",
		');',
	].join('\n');
}

async function readLaunchRecords(logPath: string): Promise<EditorLaunchRecord[]> {
	try {
		const raw = await readFile(logPath, 'utf8');
		return raw
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as EditorLaunchRecord);
	} catch {
		return [];
	}
}
