import { defineConfig } from 'tsdown';

export default defineConfig({
	clean: true,
	dts: false,
	entry: {
		bin: 'src/bin.ts',
		'extension/index': 'src/extension/index.ts',
		'standalone/server': 'src/standalone/server.ts',
	},
	external: ['vscode'],
	format: ['cjs'],
	outDir: 'dist',
	platform: 'node',
	sourcemap: true,
	target: 'node20',
	tsconfig: 'tsconfig.node.json',
	unbundle: true,
});
