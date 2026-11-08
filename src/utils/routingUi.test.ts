import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routingDraftChanged, queuedPollDelay, routingDisplayState, routingButtonAction, routingStatusLabel, routingSyncErrorCode } from './routingUi.ts';
import { normalizeRules } from './routing.ts';
import { readFileSync } from 'node:fs';

test('enabled routing cannot be resubmitted for whitespace, duplicate or reordered whitelist-only changes', () => {
  const saved = normalizeRules('example.com\ngeoip:cn');
  assert.equal(routingDraftChanged('', saved, saved), false);
  assert.equal(routingDraftChanged(' \n', normalizeRules(' GEOIP:CN\nExample.COM\nexample.com '), saved), false);
  assert.equal(routingDraftChanged('', normalizeRules('other.example.com\ngeoip:cn'), saved), true);
  assert.equal(routingDraftChanged('socks5://proxy.example.com:1080', saved, saved), true);
});

test('retained outbound text is unchanged after saving, while edits and rule changes remain detectable', () => {
  const rules = normalizeRules('example.com');
  for (const outbound of ['socks5://user:pass@proxy.example.com:1080', 'ss://example', '[Interface]\nPrivateKey = example\n[Peer]\nEndpoint = example.com:51820']) {
    assert.equal(routingDraftChanged(outbound, rules, rules, outbound), false);
    assert.equal(routingDraftChanged(` \n${outbound}\n`, rules, rules, outbound), true);
    assert.equal(routingDraftChanged(outbound + 'changed', rules, rules, outbound), true);
    assert.equal(routingDraftChanged(outbound, ['other.example.com'], rules, outbound), true);
    assert.equal(routingDraftChanged('', rules, rules, outbound), false);
    assert.equal(routingDraftChanged('', [], rules, outbound), true);
  }
});

test('operation and synchronization feedback stays available as text independently of the action color', () => {
  const base = { state: 'idle', busy: null, dirty: false, saveFailed: false, pollPaused: false } as const;
  assert.equal(routingStatusLabel(base), 'states.idle');
  for (const state of ['disabled', 'cleaned', 'queued', 'waiting_service', 'submitted', 'error']) {
    assert.equal(routingStatusLabel({ ...base, state }), `states.${state}`);
  }
  assert.equal(routingStatusLabel({ ...base, state: 'untrusted-secret' }), 'states.unknown');
  assert.equal(routingStatusLabel({ ...base, dirty: true }), 'unsaved');
  assert.equal(routingStatusLabel({ ...base, state: 'submitted', dirty: true }), 'unsaved');
  assert.equal(routingStatusLabel({ ...base, pollPaused: true }), 'pollPaused');
  assert.equal(routingStatusLabel({ ...base, busy: 'save', saveFailed: true }), 'saving');
  assert.equal(routingStatusLabel({ ...base, busy: 'enable' }), 'enabling');
  assert.equal(routingStatusLabel({ ...base, busy: 'disable' }), 'disabling');
  assert.equal(routingStatusLabel({ ...base, saveFailed: true, dirty: true }), 'saveError');
  assert.equal(routingStatusLabel({ ...base, saveUnconfirmed: true, dirty: true }), 'saveUnconfirmed');
  assert.equal(routingStatusLabel({ ...base, state: 'error', dirty: true }), 'unsaved');
});

test('Chinese outbound placeholder preserves the requested input examples', () => {
  const zh = JSON.parse(readFileSync(new URL('../../public/locales/zh-CN.json', import.meta.url), 'utf8')).routing;
  assert.equal(zh.outboundPlaceholder, 'socks5://用户名:密码@服务器:端口\nSS 分享链接\n完整 WireGuard 配置');
});

test('queued reads back off and stop after thirty attempts until the panel is reopened', () => {
  const delays = Array.from({ length: 30 }, (_, attempt) => queuedPollDelay(attempt));
  assert.equal(delays.filter(delay => delay === 3000).length, 10);
  assert.equal(delays.filter(delay => delay === 6000).length, 10);
  assert.equal(delays.filter(delay => delay === 12000).length, 10);
  assert.equal(queuedPollDelay(30), null);
  assert.equal(queuedPollDelay(100), null);
});

test('only an empty disabled configuration is shown as unconfigured; processing, errors and cleanup stay visible', () => {
  assert.equal(routingDisplayState(false, false, 0, 'disabled'), 'idle');
  assert.equal(routingDisplayState(false, true, 0, 'disabled'), 'disabled');
  assert.equal(routingDisplayState(false, false, 1, 'disabled'), 'disabled');
  assert.equal(routingDisplayState(true, false, 0, 'disabled'), 'disabled');
  for (const state of ['queued', 'submitted', 'waiting_service', 'error', 'cleaned', 'unknown']) {
    assert.equal(routingDisplayState(false, false, 0, state), state);
  }
});

test('sync failures expose fixed diagnostic codes and localized actions without displaying raw server errors', () => {
  const zh = JSON.parse(readFileSync(new URL('../../public/locales/zh-CN.json', import.meta.url), 'utf8')).routing;
  const en = JSON.parse(readFileSync(new URL('../../public/locales/en.json', import.meta.url), 'utf8')).routing;
  const ru = JSON.parse(readFileSync(new URL('../../public/locales/ru.json', import.meta.url), 'utf8')).routing;
  assert.match(zh.direction, /按现有平台路由/);
  assert.match(en.direction, /existing platform routing/);
  assert.match(ru.direction, /существующими правилами маршрутизации платформы/);
  for (const code of ['REMOTE_HTTP', 'ENDPOINT_DENIED', 'SERVICE_OPTIONS_KEY_MISSING', 'SERVICE_OPTIONS_CONFIG_INVALID', 'SERVICE_OPTIONS_TASK_INVALID', 'SERVICE_OPTIONS_TARGET_INVALID', 'SERVICE_OPTIONS_TARGET_CHANGED']) {
    assert.equal(routingSyncErrorCode(code), code);
    assert.equal(typeof zh.syncErrors[code], 'string');
    assert.equal(typeof en.syncErrors[code], 'string');
  }
  for (const code of ['PROFILE_SCOPE', 'PROFILE_ORDER', 'SERVICE_OPTIONS_POLICY_CHANGED', 'SERVICE_OPTIONS_POLICY_INVALID']) {
    assert.equal(routingSyncErrorCode(code), 'SERVICE_OPTIONS_SYNC_FAILED');
    assert.equal(zh.syncErrors[code], undefined);
    assert.equal(en.syncErrors[code], undefined);
  }
  for (const value of [undefined, null, {}, '<script>secret</script>', 'password=do-not-render', 'PRIVATE_TOKEN_EXAMPLE', 'REMOTE_HTTP\nsecret']) {
    assert.equal(routingSyncErrorCode(value), 'SERVICE_OPTIONS_SYNC_FAILED');
  }
});

test('one action determines matching text and color for saves, enables and safe disables', () => {
  const save = { action: 'save', color: 'blue', labelKey: 'save' };
  const enable = { action: 'enable', color: 'green', labelKey: 'enable' };
  const disable = { action: 'disable', color: 'orange', labelKey: 'disable' };
  assert.deepEqual(routingButtonAction(true, true, true, true), save);
  assert.deepEqual(routingButtonAction(true, false, true, true), disable);
  assert.deepEqual(routingButtonAction(true, true, false, true), disable);
  assert.deepEqual(routingButtonAction(true, false, false, true), disable);
  assert.deepEqual(routingButtonAction(false, true, true, true), save);
  assert.deepEqual(routingButtonAction(false, false, true, true), enable);
  assert.deepEqual(routingButtonAction(false, true, false, true), save);
  assert.deepEqual(routingButtonAction(false, false, false, false), save);
  assert.deepEqual(routingButtonAction(false, false, true, false), save);
});

test('an in-flight action keeps its text and color even as the save response changes the enabled flag', () => {
  for (const busy of ['save', 'enable', 'disable'] as const) {
    const expected = { action: busy, labelKey: busy, color: { save: 'blue', enable: 'green', disable: 'orange' }[busy] };
    for (const enabled of [false, true]) {
      for (const dirty of [false, true]) assert.deepEqual(routingButtonAction(enabled, dirty, true, true, busy), expected);
    }
  }
});
