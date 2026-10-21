import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CachedHttp, HttpError } from '../src/cache.js';
import { roots } from '../src/config.js';

test('concurrent reads coalesce and persistent cache survives a new instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tfgm-cache-'));
  try {
    let requests = 0;
    const request = (async () => { requests++; return new Response('{"ok":true}'); }) as typeof fetch;
    const url = `${roots.recipes}build.json`;
    const cache = new CachedHttp(directory, 10000, request);
    assert.deepEqual(await Promise.all([cache.json(url), cache.json(url)]), [{ ok: true }, { ok: true }]);
    await new CachedHttp(directory, 10000, request).json(url);
    assert.equal(requests, 1);
    await new CachedHttp(directory, 0, request).json(url);
    assert.equal(requests, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('malformed responses and HTTP failures do not poison cache; corrupted disk recovers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tfgm-cache-'));
  try {
    const url = `${roots.recipes}build.json`;
    const file = join(directory, `${createHash('sha256').update(url).digest('hex')}.json`);
    await writeFile(file, 'broken');
    const responses = [new Response('not found', { status: 404 }), new Response('<html>'), new Response('{"ok":true}')];
    const cache = new CachedHttp(directory, 10000, (async () => responses.shift()!) as typeof fetch);
    await assert.rejects(() => cache.json(url), HttpError);
    await assert.rejects(() => cache.json(url), SyntaxError);
    assert.deepEqual(await cache.json(url), { ok: true });
    await assert.rejects(() => cache.json('https://example.org/data.json'), /Only configured/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
