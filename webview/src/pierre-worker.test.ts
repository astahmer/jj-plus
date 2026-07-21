import { describe, expect, test } from 'vitest';
import { ensurePierreWorkerPool, getPierreWorkerPool, resetPierreWorkerPoolForTests } from './pierre/worker-pool.ts';

describe('pierre worker pool', () => {
	test('ensurePierreWorkerPool is idempotent and safe when Worker is unavailable', async () => {
		resetPierreWorkerPoolForTests();
		const first = await ensurePierreWorkerPool();
		const second = await ensurePierreWorkerPool();
		expect(second).toBe(first);
		expect(getPierreWorkerPool()).toBe(first);
		resetPierreWorkerPoolForTests();
	});
});
