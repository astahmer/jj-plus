import { defineConfig } from 'tsdown';

export default defineConfig({
	clean: true,
	dts: false,
	entry: {
		'suite/index': 'tests/vscode/suite/index.ts',
		'suite/timeline.integration': 'tests/vscode/suite/timeline.integration.ts',
	},
	external: ['mocha', 'vscode'],
	format: ['cjs'],
	outDir: '.integration-dist/vscode-tests',
	platform: 'node',
	sourcemap: true,
	target: 'node20',
	tsconfig: 'tsconfig.node.json',
	unbundle: true,
});
