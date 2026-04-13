import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Mocha from 'mocha';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFilePath);
const suiteFileExtension = extname(currentFilePath) === '.ts' ? '.ts' : '.js';

export async function run(): Promise<void> {
	process.stderr.write(`[integration] suite runner start: ${currentFilePath}\n`);
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 60000,
	});

	process.stderr.write(
		`[integration] adding file: ${resolve(currentDirectory, `timeline.integration${suiteFileExtension}`)}\n`,
	);
	mocha.addFile(resolve(currentDirectory, `timeline.integration${suiteFileExtension}`));

	return new Promise<void>((resolveRun, reject) => {
		try {
			process.stderr.write('[integration] starting mocha.run()\n');
			mocha.run((failures) => {
				process.stderr.write(`[integration] mocha finished with ${failures} failure(s)\n`);
				if (failures > 0) {
					reject(new Error(`${failures} integration test(s) failed.`));
					return;
				}

				resolveRun();
			});
		} catch (error) {
			reject(error);
		}
	});
}
