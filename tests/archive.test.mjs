import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prefetchedArchiveSource} from '../site/assets/archive.js';

test('reuses a prefetched range and falls back to a fresh header after invalidation', async () => {
  const data = Uint8Array.from([1, 2, 3, 4]).buffer;
  const source = prefetchedArchiveSource({
    getKey: () => 'archive',
    getBytes: async (offset, length, signal, etag) => ({offset, length, etag}),
  }, Promise.resolve({data, etag: '"original"'}));

  assert.equal(source.getKey(), 'archive');
  assert.deepEqual(await source.getBytes(0, 4), {data, etag: '"original"'});
  assert.deepEqual(await source.getBytes(1, 2, undefined, '"original"'), {
    data: data.slice(1, 3), etag: '"original"',
  });
  assert.deepEqual(await source.getBytes(2, 3, undefined, '"original"'), {
    offset: 2, length: 3, etag: '"original"',
  });
  assert.deepEqual(await source.getBytes(0, 4), {offset: 0, length: 4, etag: undefined});
  assert.deepEqual(await source.getBytes(1, 2, undefined, '"new"'), {
    offset: 1, length: 2, etag: '"new"',
  });
});
