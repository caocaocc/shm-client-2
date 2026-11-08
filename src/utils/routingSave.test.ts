import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveRoutingOptions } from './routingSave.ts';

const payload = { user_service_id: 42, enabled: true, data: { rules: ['example.com'] }, secret: { outbound_text: 'synthetic credentials' } };
const response = (state = 'queued') => ({ data: { data: [{ supported: true, feature: 'routing', enabled: true, has_secret: true, data: { rules: ['example.com'] }, status: state }] } });

test('a confirmed save returns parsed state without an extra read', async () => {
  const calls: unknown[] = [];
  const result = await saveRoutingOptions(payload, {
    save: async value => { calls.push(value); return response(); },
    get: async () => { throw new Error('unexpected read'); },
  }, new AbortController().signal, () => { throw new Error('unexpected uncertainty'); });
  assert.equal(result.confirmed, true);
  assert.equal(result.options?.status, 'queued');
  assert.deepEqual(calls, [payload]);
});

test('a lost save response notifies before one redacted read and never repeats the POST', async () => {
  for (const error of [new Error('Network Error'), { code: 'ECONNABORTED' }, { response: null }]) {
    const calls: string[] = [];
    const controller = new AbortController();
    const result = await saveRoutingOptions(payload, {
      save: async value => { assert.equal(value, payload); calls.push('POST'); throw error; },
      get: async (id, signal) => { assert.equal(id, 42); assert.equal(signal, controller.signal); calls.push('GET'); return response('submitted'); },
    }, controller.signal, () => calls.push('unconfirmed'));
    assert.deepEqual(calls, ['POST', 'unconfirmed', 'GET']);
    assert.equal(result.confirmed, false, 'a matching GET cannot confirm this draft was saved');
    assert.equal(result.options?.status, 'submitted');
  }
});

test('an unsuccessful confirmation read preserves uncertainty without inventing saved state', async () => {
  for (const read of [async () => { throw new Error('offline'); }, async () => ({ data: { data: [] } }), async () => ({ data: { data: [{ supported: false }] } })]) {
    let posts = 0;
    const result = await saveRoutingOptions(payload, {
      save: async () => { posts++; throw { code: 'ECONNABORTED' }; }, get: read,
    }, new AbortController().signal, () => {});
    assert.deepEqual(result, { confirmed: false, options: null });
    assert.equal(posts, 1);
  }
});

test('an obsolete or malformed save response remains unconfirmed and triggers only one redacted read', async () => {
  for (const status of [{ state: 'queued' }, null]) {
    const calls: string[] = [];
    const result = await saveRoutingOptions(payload, {
      save: async () => {
        calls.push('POST');
        const value = response();
        return { data: { data: [{ ...value.data.data[0], status }] } };
      },
      get: async () => { calls.push('GET'); return response('submitted'); },
    }, new AbortController().signal, () => calls.push('unconfirmed'));
    assert.deepEqual(calls, ['POST', 'unconfirmed', 'GET']);
    assert.equal(result.confirmed, false);
    assert.equal(result.options?.status, 'submitted');
  }
});

test('HTTP rejection stays a failed save rather than a speculative retry', async () => {
  const rejected = { response: { status: 403 } };
  await assert.rejects(saveRoutingOptions(payload, {
    save: async () => { throw rejected; }, get: async () => { throw new Error('unexpected read'); },
  }, new AbortController().signal, () => { throw new Error('unexpected uncertainty'); }), error => error === rejected);
});

test('closing a form cancels reconciliation and late reads cannot publish into another form', async () => {
  const controller = new AbortController();
  let finish!: (value: ReturnType<typeof response>) => void;
  const pending = saveRoutingOptions(payload, {
    save: async () => { throw new Error('Network Error'); },
    get: async () => new Promise(resolve => { finish = resolve; }),
  }, controller.signal, () => {});
  await Promise.resolve();
  controller.abort(); finish(response());
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
});

test('a response lost after closing cannot start a status read', async () => {
  const controller = new AbortController();
  let fail!: (error: unknown) => void;
  const pending = saveRoutingOptions(payload, {
    save: async () => new Promise((_resolve, reject) => { fail = reject; }),
    get: async () => { throw new Error('unexpected read'); },
  }, controller.signal, () => { throw new Error('unexpected uncertainty'); });
  controller.abort(); fail(new Error('offline'));
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
});
