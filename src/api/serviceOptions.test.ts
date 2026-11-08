import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

test('service options use the current user endpoint and preserve request bodies and cancellation', () => {
  const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export const serviceOptionsApi = {');
  assert.ok(start >= 0);
  const end = source.indexOf('\n};', start) + 3;
  const declaration = stripTypeScriptTypes(source.slice(start, end)).replace(/^export /, '');
  const calls: Array<{ method: string; url: string; value: unknown; config: unknown }> = [];
  const api = Object.fromEntries(['get', 'post'].map(method => [method, (url: string, value: unknown, config: unknown) => {
    calls.push({ method, url, value, config });
    return Promise.resolve({ data: [] });
  }]));
  const options = runInNewContext(`${declaration}\nserviceOptionsApi`, { api }) as {
    get: (id: number, signal: AbortSignal) => unknown;
    readSecret: (id: number, signal: AbortSignal) => unknown;
    save: (body: unknown) => unknown;
  };
  const signal = new AbortController().signal;
  options.get(47, signal);
  const read = calls[0].value as { params: { user_service_id: number }; signal: AbortSignal; timeout: number };
  assert.equal(calls[0].url, '/user/service/options');
  assert.equal(calls[0].method, 'get');
  assert.equal(read.params.user_service_id, 47);
  assert.equal(read.signal, signal);
  assert.equal(read.timeout, 10_000);
  options.readSecret(47, signal);
  const reveal = calls[calls.length - 1];
  assert.equal(reveal.method, 'post');
  assert.equal(reveal.url, '/user/service/options/secret');
  assert.equal((reveal.value as { user_service_id: number }).user_service_id, 47);
  assert.equal((reveal.config as { signal: AbortSignal }).signal, signal);
  assert.equal((reveal.config as { timeout: number }).timeout, 10_000);
  for (const body of [{ user_service_id: 47, enabled: false }, { user_service_id: 47, enabled: true, data: { rules: ['example.com'] } }]) {
    options.save(body);
    const write = calls[calls.length - 1];
    assert.equal(write.method, 'post');
    assert.equal(write.url, '/user/service/options');
    assert.equal(write.value, body);
    assert.equal((write.config as { timeout: number }).timeout, 10_000);
  }
});
