import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Mocha from 'mocha';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFilePath);
const currentFileExtension = extname(currentFilePath);
const suiteFileExtension = currentFileExtension === '.ts' ? '.ts' : currentFileExtension === '.cjs' ? '.cjs' : '.js';

export async function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 60000,
	});

	mocha.addFile(resolve(currentDirectory, `timeline.integration${suiteFileExtension}`));

	return new Promise<void>((resolveRun, reject) => {
		try {
			mocha.run((failures) => {
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
