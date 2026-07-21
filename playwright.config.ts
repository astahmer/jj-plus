import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const bddTestDir = defineBddConfig({
	features: 'tests/features/**/*.feature',
	steps: ['tests/features/steps/**/*.ts', 'tests/features/support/**/*.ts'],
	outputDir: '.features-gen',
});

export default defineConfig({
	testDir: bddTestDir,
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	expect: {
		toHaveScreenshot: {
			animations: 'disabled',
			caret: 'hide',
		},
	},
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'browser',
			testDir: '.',
			testMatch: 'tests/features/**/*.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'visual',
			testDir: '.',
			testMatch: 'tests/visual/**/*.spec.ts',
			testIgnore: '**/tmp/**',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: 'pnpm vite --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173',
		timeout: 120000,
		reuseExistingServer: !process.env.CI,
	},
});
