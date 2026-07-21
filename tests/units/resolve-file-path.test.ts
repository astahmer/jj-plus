import assert from 'node:assert/strict';
import test from 'node:test';
import { coerceFsPath } from '../../src/shared/resolve-file-path.ts';

test('coerceFsPath accepts strings and fsPath-shaped objects', () => {
	assert.equal(coerceFsPath('/tmp/a.ts'), '/tmp/a.ts');
	assert.equal(coerceFsPath({ fsPath: '/tmp/b.ts' }), '/tmp/b.ts');
	assert.equal(coerceFsPath(null), undefined);
	assert.equal(coerceFsPath(12), undefined);
	assert.equal(coerceFsPath({}), undefined);
});
