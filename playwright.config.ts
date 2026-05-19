import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const notesDir = path.resolve('.tmp/e2e-notes');

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 30_000,
	expect: {
		timeout: 10_000
	},
	fullyParallel: false,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry'
	},
	webServer: {
		command: 'npm run e2e:server',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			NOTES_DIR: notesDir
		}
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
