import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routingAction, routingSettings, type RoutingSettings } from './routing.ts';

const record: RoutingSettings = {
  outbound_text: '[Interface]\nAddress = 10.0.0.1/32\n[Peer]\nEndpoint = test.invalid:1234\n',
  rules: ['example.com', 'geoip:cn'], enabled: true, status: 'submitted',
};

test('the owner response retains the original outbound and the API sync status', () => {
  assert.deepEqual(routingSettings({ data: [record] }), record);
  assert.equal(routingSettings({ data: [{ ...record, status: 'error', error: 'INVALID_RULES' }] }).error, 'INVALID_RULES');
  for (const response of [{}, { data: [] }, { data: [{ ...record, enabled: 'false' }] }, { data: [{ ...record, rules: 'x' }] }]) {
    assert.throws(() => routingSettings(response as { data?: RoutingSettings[] }));
  }
});

test('the form uses one action for a new, edited, enabled or disabled configuration', () => {
  assert.equal(routingAction({ ...record, outbound_text: '', rules: [], enabled: false }, '', ''), 'save');
  assert.equal(routingAction(record, record.outbound_text, record.rules.join('\n')), 'disable');
  assert.equal(routingAction({ ...record, enabled: false }, record.outbound_text, record.rules.join('\n')), 'enable');
  assert.equal(routingAction(record, record.outbound_text.trim(), record.rules.join('\n')), 'save');
  assert.equal(routingAction(record, record.outbound_text, 'geosite:google'), 'save');
});

test('reassigning a service requires an explicit save of the outbound and rules for the new server', () => {
  const changed = { ...record, status: 'error' as const, error: 'TARGET_CHANGED' };
  assert.equal(routingAction(changed, record.outbound_text, record.rules.join('\n')), 'save');
  assert.equal(routingAction({ ...changed, enabled: false }, record.outbound_text, record.rules.join('\n')), 'save');
});

test('all supported locales cover the routing form, status, actions and error messages', async () => {
  const { readFile } = await import('node:fs/promises');
  const keys = ['outbound', 'rules', 'example', 'help', 'unconfigured', 'queued', 'pending_disable', 'disabled',
    'submitted', 'error', 'waiting', 'estimated', 'enable', 'disable', 'unconfirmed', 'retry', 'panel',
    'badOutbound', 'badRules', 'unavailable', 'denied', 'targetChanged'];
  for (const lang of ['zh-CN', 'ru', 'en', 'de', 'es', 'fr', 'uz', 'ar']) {
    const locale = JSON.parse(await readFile(new URL('../../public/locales/' + lang + '.json', import.meta.url), 'utf8'));
    for (const key of keys) assert.ok(locale.routing[key]?.trim(), lang + '/' + key);
  }
});
