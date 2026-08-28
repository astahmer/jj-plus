import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { foldkit } from '@foldkit/vite-plugin';

const pierreWorkerSrc = resolve(process.cwd(), 'node_modules/@pierre/diffs/dist/worker/worker-portable.js');
const pierreWorkerDest = resolve(process.cwd(), 'webview-dist/pierre-worker-portable.js');

function copyPierreWorkerPlugin() {
	return {
		name: 'copy-pierre-worker',
		transformIndexHtml(html) {
			if (html.includes('window.WORKER_URI')) {
				return html.replace(
					/window\.WORKER_URI\s*=\s*['"][^'"]*['"]/,
					'window.WORKER_URI = "./pierre-worker-portable.js"',
				);
			}
			return html.replace('</body>', '<script>window.WORKER_URI="./pierre-worker-portable.js";</script></body>');
		},
		closeBundle() {
			if (!existsSync(pierreWorkerSrc)) {
				return;
			}
			mkdirSync(dirname(pierreWorkerDest), { recursive: true });
			copyFileSync(pierreWorkerSrc, pierreWorkerDest);
		},
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url?.startsWith('/pierre-worker-portable.js') && existsSync(pierreWorkerSrc)) {
					res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
					res.end(readFileSync(pierreWorkerSrc));
					return;
				}
				next();
			});
		},
	};
}

export default defineConfig({
	root: resolve(process.cwd(), 'webview'),
	base: './',
	plugins: [foldkit(), copyPierreWorkerPlugin()],
	server: {
		port: 4173,
	},
	build: {
		outDir: resolve(process.cwd(), 'webview-dist'),
		emptyOutDir: true,
		copyPublicDir: false,
		cssCodeSplit: false,
		target: 'es2020',
		chunkSizeWarningLimit: 2000,
		rollupOptions: {
			input: {
				timeline: resolve(process.cwd(), 'webview', 'index.html'),
				repoTimeline: resolve(process.cwd(), 'webview', 'repo-timeline.html'),
			},
			output: {
				entryFileNames: ({ name }) => (name === 'repoTimeline' ? 'repo-timeline-app.js' : 'timeline-app.js'),
				chunkFileNames: 'chunks/[name]-[hash].js',
				assetFileNames(assetInfo) {
					if (assetInfo.name && assetInfo.name.endsWith('.css')) {
						return assetInfo.name.includes('repo') ? 'repo-timeline-app.css' : 'timeline-app.css';
					}
					return 'assets/[name]-[hash][extname]';
				},
			},
		},
	},
});
