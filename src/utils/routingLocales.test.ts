import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILT_IN_LANGS } from '../i18n/language.ts';
import { routingStatusLabel, routingSyncErrorCode } from './routingUi.ts';

type Messages = { [key: string]: string | Messages };
const readSource = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const locales = Object.fromEntries(BUILT_IN_LANGS.map(language => [
  language,
  JSON.parse(readSource(`../../public/locales/${language}.json`)).routing as Messages,
]));
function leaves(value: Messages, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, message]) => {
    const path = prefix + key;
    return typeof message === 'string' ? [[path, message]] : Object.entries(leaves(message, path + '.'));
  }));
}
const messages = Object.fromEntries(Object.entries(locales).map(([language, value]) => [language, leaves(value)]));
const interpolationNames = (value: string) => [...value.matchAll(/{{\s*([\w]+)\s*}}/g)].map(match => match[1]).sort();
const en = messages.en;

test('all built-in languages translate every routing key with the same interpolation contract', () => {
  for (const language of BUILT_IN_LANGS) {
    const translated = messages[language];
    assert.ok(translated, language);
    assert.deepEqual(Object.keys(translated).sort(), Object.keys(en).sort(), `${language}: routing keys`);
    for (const [key, value] of Object.entries(translated)) {
      assert.ok(value.trim(), `${language}: ${key} is empty`);
      assert.deepEqual(interpolationNames(value), interpolationNames(en[key]), `${language}: ${key} interpolation`);
      assert.doesNotMatch(value, /^routing\./, `${language}: ${key} must be translated`);
    }
    assert.equal(translated.outboundPlaceholder.split('\n').length, 3, `${language}: three outbound examples`);
    assert.match(translated.outboundPlaceholder, /^socks5:\/\//, `${language}: SOCKS5 example`);
    assert.match(translated.outboundPlaceholder, /SS/);
    assert.match(translated.outboundPlaceholder, /WireGuard/);
    assert.equal(translated.rulesPlaceholder, en.rulesPlaceholder, `${language}: rule syntax remains literal`);
  }
});

test('every parser error and fixed synchronization error has a translation without falling back to English', () => {
  const parser = readSource('./routing.ts');
  const inputCodes = new Set(['invalidOutbound', ...[...parser.matchAll(/(?:fail|new RoutingInputError)\('([\w]+)'/g)].map(match => match[1])]);
  const ui = readSource('./routingUi.ts');
  const codeBlock = ui.match(/const SYNC_ERROR_CODES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(codeBlock, 'fixed synchronization error codes are discoverable');
  const syncCodes = [...codeBlock[1].matchAll(/'([A-Z_]+)'/g)].map(match => match[1]);
  assert.ok(syncCodes.length > 0);
  for (const language of BUILT_IN_LANGS) {
    for (const code of inputCodes) assert.ok(messages[language][`errors.${code}`], `${language}: input ${code}`);
    for (const code of syncCodes) {
      assert.equal(routingSyncErrorCode(code), code);
      assert.ok(messages[language][`syncErrors.${code}`], `${language}: synchronization ${code}`);
    }
  }
});

test('literal panel labels and all dynamic button states have localized values', () => {
  const panel = readSource('../components/ServiceRoutingPanel.tsx');
  const literalKeys = [...panel.matchAll(/['"]routing\.([\w.]+)['"]/g)].map(match => match[1]);
  const base = { state: 'idle', busy: null, dirty: false, saveFailed: false, pollPaused: false } as const;
  const feedbackKeys = [
    ...['idle', 'disabled', 'cleaned', 'queued', 'waiting_service', 'submitted', 'error', 'unknown-state'].map(state => routingStatusLabel({ ...base, state })),
    routingStatusLabel({ ...base, dirty: true }),
    routingStatusLabel({ ...base, saveFailed: true }),
    routingStatusLabel({ ...base, saveUnconfirmed: true }),
    routingStatusLabel({ ...base, pollPaused: true }),
    routingStatusLabel({ ...base, busy: 'save' }),
    routingStatusLabel({ ...base, busy: 'disable' }),
    routingStatusLabel({ ...base, busy: 'enable' }),
    'save', 'enable', 'disable',
  ];
  for (const language of BUILT_IN_LANGS) {
    for (const key of new Set([...literalKeys, ...feedbackKeys])) {
      assert.ok(messages[language][key], `${language}: panel ${key}`);
    }
  }
});
