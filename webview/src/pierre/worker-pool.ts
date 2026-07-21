import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from '@pierre/diffs/worker';

declare global {
	interface Window {
		WORKER_URI?: string;
	}
}

let workerPool: WorkerPoolManager | undefined;
let workerPoolFailed = false;
let initPromise: Promise<WorkerPoolManager | undefined> | null = null;

async function resolveWorkerFactory(): Promise<() => Worker> {
	const extensionUri = typeof window !== 'undefined' ? window.WORKER_URI?.trim() : '';
	if (extensionUri) {
		const response = await fetch(extensionUri);
		if (!response.ok) {
			throw new Error(`Failed to fetch Pierre worker: ${response.status}`);
		}
		const workerCode = await response.text();
		const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
		return () => new Worker(blobUrl, { type: 'module' });
	}

	// Vite / standalone: `?worker&url` import injected as __PIERRE_WORKER_URL__.
	const bundled = (globalThis as { __PIERRE_WORKER_URL__?: string }).__PIERRE_WORKER_URL__;
	if (bundled) {
		return () => new Worker(bundled, { type: 'module' });
	}

	try {
		const mod = await import('@pierre/diffs/worker/worker.js?worker&url');
		const url = typeof mod.default === 'string' ? mod.default : String(mod.default);
		(globalThis as { __PIERRE_WORKER_URL__?: string }).__PIERRE_WORKER_URL__ = url;
		return () => new Worker(url, { type: 'module' });
	} catch {
		throw new Error('No Pierre worker URL available');
	}
}

async function createWorkerPool(): Promise<WorkerPoolManager | undefined> {
	if (typeof window === 'undefined' || typeof Worker === 'undefined') {
		return undefined;
	}
	const workerFactory = await resolveWorkerFactory();
	return getOrCreateWorkerPoolSingleton({
		poolOptions: {
			poolSize: 2,
			workerFactory,
		},
		highlighterOptions: {
			theme: { dark: 'pierre-dark', light: 'pierre-light' },
		},
	});
}

/** Sync accessor — undefined until `ensurePierreWorkerPool` resolves. */
export function getPierreWorkerPool(): WorkerPoolManager | undefined {
	return workerPoolFailed ? undefined : workerPool;
}

/**
 * Lazily initialize the Pierre worker pool (blob URL for VS Code, Vite worker for standalone).
 * Safe to call repeatedly; failures fall back to main-thread FileDiff.
 */
export function ensurePierreWorkerPool(): Promise<WorkerPoolManager | undefined> {
	if (workerPoolFailed) {
		return Promise.resolve(undefined);
	}
	if (workerPool) {
		return Promise.resolve(workerPool);
	}
	if (!initPromise) {
		initPromise = createWorkerPool()
			.then((pool) => {
				workerPool = pool;
				if (!pool) {
					workerPoolFailed = true;
				}
				return pool;
			})
			.catch(() => {
				workerPoolFailed = true;
				workerPool = undefined;
				return undefined;
			});
	}
	return initPromise;
}

export function resetPierreWorkerPoolForTests(): void {
	workerPool = undefined;
	workerPoolFailed = false;
	initPromise = null;
}
