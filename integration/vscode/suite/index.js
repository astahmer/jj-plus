import { resolve as _resolve } from 'node:path';
import Mocha from 'mocha';

function run() {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 60000,
	});

	mocha.addFile(_resolve(__dirname, 'timeline.integration.js'));

	return new Promise((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} integration test(s) failed.`));
				return;
			}

			resolve(void 0);
		});
	});
}

export default { run };
