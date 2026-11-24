import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProxySubscription, proxyStorageKey, loadProxySubscription, remainingTraffic, formatBytes } from './subscription.ts';

const latest = {
  isFound: true,
  subscription_url: 'https://sub.example.test/abc',
  subscriptionUrl: 'https://sub.example.test/abc',
  user: {
    shortUuid: 'abc', username: 'us_42', userStatus: 'ACTIVE', isActive: true,
    trafficUsed: '1 GiB', trafficLimit: '300 GiB', trafficUsedBytes: '1073741824',
    trafficLimitBytes: '322122547200', trafficLimitStrategy: 'MONTH_ROLLING',
    expiresAt: '2026-11-01T00:00:00Z',
  },
  links: [], ssConfLinks: {},
};

test('Remnawave 3.4.7 subscription info reads byte strings and expiresAt without inventing HWID limits', () => {
  const result = parseProxySubscription(latest)!;
  assert.equal(result.url, 'https://sub.example.test/abc');
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.usedBytes, 1024 ** 3);
  assert.equal(result.limitBytes, 300 * 1024 ** 3);
  assert.equal(result.resetStrategy, 'MONTH_ROLLING');
  assert.equal(result.expiresAt, '2026-11-01T00:00:00Z');
  assert.equal(result.deviceLimit, undefined);
  assert.equal(remainingTraffic(result), 299 * 1024 ** 3);
});

test('current template payload and SHM JSON envelope use the canonical stored URL', () => {
  assert.equal(parseProxySubscription({ ...latest, subscription_url: 'https://custom.example.test/key' })?.url, 'https://custom.example.test/key');
  for (const payload of [latest, { status: 200, data: latest }, { status: 200, data: [latest] }]) {
    assert.equal(parseProxySubscription(payload)?.usedBytes, 1024 ** 3);
  }
  for (const payload of [JSON.stringify(latest), { response: latest }, { data: [latest, latest] },
    { response: { user: { subscriptionUrl: 'https://sub.example.test/unused' } } }]) {
    assert.equal(parseProxySubscription(payload), null, 'unsupported historical wrappers are not interpreted');
  }
});

test('an explicit isFound false rejects leftover URLs and user metadata', () => {
  const missing = { ...latest, isFound: false };
  assert.equal(parseProxySubscription(missing), null);
  assert.equal(parseProxySubscription({ data: missing }), null);
});

test('current user fields preserve null, zero and missing device limits without aliases', () => {
  for (const deviceLimit of [null, 0, 3, undefined]) {
    const result = parseProxySubscription({ user: {
      userStatus: 'DISABLED', expiresAt: '2026-11-01T00:00:00Z', trafficLimitBytes: 0,
      hwidDeviceLimit: deviceLimit, trafficUsedBytes: 123,
    } })!;
    assert.equal(result.status, 'DISABLED');
    assert.equal(result.usedBytes, 123);
    assert.equal(result.limitBytes, 0);
    assert.equal(result.deviceLimit, deviceLimit);
    assert.equal(remainingTraffic(result), undefined);
  }
  assert.equal(parseProxySubscription({ response: { status: 'ACTIVE', userTraffic: { usedTrafficBytes: 123 } } }), null);
  assert.equal(parseProxySubscription({ user: { traffic_limit_strategy: 'MONTH', data_limit: 100, used_traffic: 10 } }), null);
  assert.equal(remainingTraffic({ url: null, usedBytes: 200, limitBytes: 100 }), 0);
});

test('bad data never becomes a usable URL, unlimited quota, or a guessed byte count', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '/relative', 'https://user:secret@example.test/sub', '', null]) {
    assert.equal(parseProxySubscription({ subscription_url: url }), null);
  }
  for (const value of [null, '', 'bad', true, -1, '1.2', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseProxySubscription({ user: { trafficLimitBytes: value, trafficUsedBytes: value, hwidDeviceLimit: value === null ? undefined : value } }), null);
  }
  assert.equal(parseProxySubscription({ isFound: false }), null);
  assert.equal(parseProxySubscription('not json'), null);
  assert.equal(parseProxySubscription({ status: 200, data: {} }), null);
});

test('inherited fields are never treated as stored subscription metadata', () => {
  assert.equal(parseProxySubscription(Object.create(latest)), null);
  assert.equal(parseProxySubscription({ user: Object.create(latest.user) }), null);
});

test('one configured or current template key is selected without a fallback list', () => {
  assert.equal(proxyStorageKey(42), 'vpn_remna_42');
  assert.equal(proxyStorageKey(42, ' custom_ '), 'custom_42');
  assert.equal(proxyStorageKey(42, 'vpn_remna_'), 'vpn_remna_42');
});

test('one read returns the current template snapshot', async () => {
  const calls: string[] = [];
  const result = await loadProxySubscription(42, undefined, async key => { calls.push(key); return latest; }, new AbortController().signal);
  assert.equal(result?.url, 'https://sub.example.test/abc');
  assert.deepEqual(calls, ['vpn_remna_42']);
});

test('a missing or malformed record does not cause an additional storage request', async () => {
  for (const missing of [true, false]) {
    const calls: string[] = [];
    const result = await loadProxySubscription(43, 'current_', async key => {
      calls.push(key);
      if (missing) throw { response: { status: 404 } };
      return {};
    }, new AbortController().signal);
    assert.equal(result, null);
    assert.deepEqual(calls, ['current_43']);
  }
});

test('a cancelled request cannot publish its result', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  let complete!: (value: unknown) => void;
  const pending = loadProxySubscription(42, undefined, key => {
    calls.push(key);
    return new Promise(resolve => { complete = resolve; });
  }, controller.signal);
  controller.abort();
  complete(latest);
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  assert.deepEqual(calls, ['vpn_remna_42']);
});

test('authorization and network errors surface without retries; absent records remain readable later', async () => {
  const calls: string[] = [];
  await assert.rejects(loadProxySubscription(42, undefined, async key => { calls.push(key); throw { response: { status: 403 } }; }, new AbortController().signal));
  assert.deepEqual(calls, ['vpn_remna_42']);
  await assert.rejects(loadProxySubscription(42, undefined, async () => { throw new Error('offline'); }, new AbortController().signal), /offline/);
  assert.equal(await loadProxySubscription(42, undefined, async () => { throw { response: { status: 404 } }; }, new AbortController().signal), null);
  assert.equal((await loadProxySubscription(42, undefined, async () => ({ user: { trafficUsedBytes: '0' } }), new AbortController().signal))?.usedBytes, 0);
});

test('traffic formatting uses binary units, preserves zero, and localizes numbers', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KiB');
  assert.equal(formatBytes(300 * 1024 ** 3), '300 GiB');
  assert.equal(formatBytes(1.5 * 1024 ** 3, 'ru'), '1,5 GiB');
  assert.equal(formatBytes(undefined), '—');
});

test('all eight built-in languages include subscription labels and preserve interpolation', async () => {
  const { readFile } = await import('node:fs/promises');
  const { BUILT_IN_LANGS } = await import('../i18n/language.ts');
  const leaves = (value: Record<string, unknown>, prefix = ''): Record<string, string> => Object.fromEntries(
    Object.entries(value).flatMap(([key, text]) => typeof text === 'string'
      ? [[prefix + key, text]] : Object.entries(leaves(text as Record<string, unknown>, prefix + key + '.'))),
  );
  const messages = await Promise.all(BUILT_IN_LANGS.map(async language => {
    const data = JSON.parse(await readFile(new URL(`../../public/locales/${language}.json`, import.meta.url), 'utf8'));
    return { language, messages: leaves(data.subscription) };
  }));
  const english = messages.find(item => item.language === 'en')!.messages;
  for (const { language, messages: translated } of messages) {
    assert.deepEqual(Object.keys(translated).sort(), Object.keys(english).sort(), language);
    for (const [key, text] of Object.entries(translated)) {
      assert.ok(text.trim(), `${language}: ${key}`);
      assert.deepEqual([...text.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]),
        [...english[key].matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]), `${language}: ${key}`);
    }
  }
});
