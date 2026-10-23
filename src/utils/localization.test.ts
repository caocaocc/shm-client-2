import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { formatMoney, currencySymbol, paymentAmount, requiredTopUp, parseBackendDate, formatDate, formatDateTime, parsePeriod } from './format.ts';
import { selectLanguage, resolveDefaultLanguage, BUILT_IN_LANGS } from '../i18n/language.ts';
import { currencyCode, readBillingCurrency, loadBillingCurrency } from './billing.ts';

test('ledger currency comes from the public system metadata without relabelling RUB as CNY', async () => {
  assert.equal(currencyCode(' rub '), 'RUB');
  assert.equal(readBillingCurrency({ status: 200, data: [{ billing: { currency: 'RUB' } }] }), 'RUB');
  assert.equal(readBillingCurrency({ data: { billing: { currency: 'CNY' } } }), 'CNY');
  assert.equal(readBillingCurrency({ billing: { currency: 'EUR' } }), 'EUR');
  assert.match(formatMoney('-21.56', 'zh-CN', await loadBillingCurrency('', async () => ({ data: [{ billing: { currency: 'RUB' } }] }))), /RUB|₽/);
  assert.equal(await loadBillingCurrency('CNY', async () => ({ data: [{ billing: { currency: 'RUB' } }] })), 'RUB');
  assert.equal(await loadBillingCurrency('RUB', async () => ({ data: [{ billing: { currency: 'CNY' } }] })), 'CNY');
  assert.equal(await loadBillingCurrency('EUR', async () => ({ data: [{}] })), 'EUR');
  assert.equal(await loadBillingCurrency('CNY', async () => { throw new Error('legacy metadata unavailable'); }), 'CNY');
  assert.equal(await loadBillingCurrency('invalid', async () => ({ data: [{ billing: { currency: 'RUB' } }] })), 'RUB');
});

test('pending, failed and legacy metadata never add a guessed currency symbol', async () => {
  for (const payload of [undefined, null, {}, { data: [] }, { data: [{ billing: {} }] }, { data: [{ billing: { currency: '<RUB>' } }] }]) {
    const currency = await loadBillingCurrency('', async () => payload);
    assert.equal(currency, '');
    assert.equal(formatMoney('1234.50', 'zh-CN', currency), '—');
    assert.equal(currencySymbol('zh-CN', currency), '—');
  }
  assert.equal(await loadBillingCurrency('', async () => { throw new Error('network unavailable'); }), '');
  let resolve!: (value: unknown) => void;
  let currency = '';
  const pending = loadBillingCurrency('', () => new Promise(done => { resolve = done; })).then(value => { currency = value; });
  assert.equal(formatMoney('1234.50', 'zh-CN', currency), '—');
  resolve({ data: [{ billing: { currency: 'CNY' } }] });
  await pending;
  assert.equal(formatMoney('1234.50', 'zh-CN', currency), '¥1,234.50');
});

test('first visit uses Chinese and subsequent visits respect saved language', () => {
  assert.equal(selectLanguage('zh-CN', null), 'zh-CN');
  assert.equal(selectLanguage('zh-CN', 'en'), 'en');
  assert.equal(selectLanguage('zh-CN', 'ru'), 'ru');
  assert.equal(selectLanguage('zh-CN', 'en-US'), 'en');
  assert.equal(selectLanguage('zh-CN', 'zh-Hans'), 'zh-CN');
  assert.equal(selectLanguage('zh-CN', 'removed-language'), 'zh-CN');
  assert.equal(selectLanguage('ru', 'en', BUILT_IN_LANGS, true), 'ru');
  assert.equal(selectLanguage('kk', 'kk', [...BUILT_IN_LANGS, 'kk']), 'kk');
});

test('CNY amounts have two decimals in each language without converting numbers', () => {
  assert.equal(formatMoney('30'), '¥30.00');
  assert.equal(formatMoney('0.01'), '¥0.01');
  assert.equal(formatMoney('99999999.99'), '¥99,999,999.99');
  assert.equal(formatMoney('-12.30'), '-¥12.30');
  assert.equal(formatMoney(12.345), '¥12.35');
  assert.equal(formatMoney('30', 'en'), 'CN¥30.00');
  assert.match(formatMoney('30', 'ru'), /30,00.*CN¥/);
  assert.match(formatMoney('30', 'en', 'RUB'), /RUB|₽/);
  assert.equal(currencySymbol('zh-CN'), '¥');
  for (const invalid of [' ', '0x30', '30 CNY', undefined, null, Infinity]) assert.equal(formatMoney(invalid), '—');
  assert.equal(formatMoney('30', 'en', 'bad'), '—');
});

test('Shanghai wall times are invariant across browser-equivalent time zones', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(parseBackendDate('2026-10-12 00:00:00')?.toISOString(), '2026-10-11T16:00:00.000Z');
      assert.equal(formatDate('2026-10-12 00:00:00'), '2026/10/12');
      assert.equal(formatDateTime('2026-10-12 00:00:00'), '2026/10/12 00:00:00');
      assert.equal(formatDateTime(1791734400), '2026/10/12 00:00:00');
      assert.equal(formatDateTime('2026-10-11T16:00:00Z'), '2026/10/12 00:00:00');
      assert.equal(parseBackendDate('2026-10-12')?.toISOString(), '2026-10-11T16:00:00.000Z');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('payment amounts stay exact two-decimal ASCII and permit one fen', () => {
  assert.equal(paymentAmount('0.01'), '0.01');
  assert.equal(paymentAmount('30'), '30.00');
  assert.equal(paymentAmount(0.3), '0.30');
  assert.equal(paymentAmount('0.50', 0.51), null);
  for (const value of ['', '-1', '0', '1.001', '¥30.00', '30,00', NaN, Infinity]) assert.equal(paymentAmount(value), null);
  assert.equal(requiredTopUp(30, 29.9), 0.1);
  assert.equal(requiredTopUp(0.3, 0.2), 0.1);
  assert.equal(requiredTopUp(10, 20), 0);
});

test('strict parsing preserves explicit offsets and rejects invalid or ambiguous wall dates', () => {
  assert.equal(parseBackendDate('2026-10-12T00:00:00+08:00')?.toISOString(), '2026-10-11T16:00:00.000Z');
  assert.equal(parseBackendDate('2024-02-29 00:00:00')?.toISOString(), '2024-02-28T16:00:00.000Z');
  assert.equal(parseBackendDate('2026-10-12 00:00:00.123456')?.getUTCMilliseconds(), 123);
  for (const invalid of ['2026-02-29 12:00:00', '2026-13-01 12:00:00', '2026-10-12 24:00:00', '10/12/2026', '0000-00-00 00:00:00']) assert.equal(parseBackendDate(invalid), null);
  assert.equal(parseBackendDate('2026-03-08 02:30:00', 'America/New_York'), null);
  assert.equal(parseBackendDate('2026-11-01 01:30:00', 'America/New_York'), null);
  assert.equal(parseBackendDate('2026-10-12 00:00:00', 'invalid-zone'), null);
  assert.equal(formatDate('invalid'), '—');
  assert.equal(formatDateTime('2026-10-12T00:00:00Z', 'en', 'America/New_York'), '10/11/2026, 20:00:00');
});

test('SHM fractional period encoding is days and hours rather than decimal months', () => {
  assert.deepEqual(parsePeriod(0.1), { months: 0, days: 10, hours: 0 });
  assert.deepEqual(parsePeriod('0.10'), { months: 0, days: 10, hours: 0 });
  assert.deepEqual(parsePeriod('0.0101'), { months: 0, days: 1, hours: 1 });
  assert.deepEqual(parsePeriod(1.0001), { months: 1, days: 0, hours: 1 });
  assert.deepEqual(parsePeriod(12), { months: 12, days: 0, hours: 0 });
  assert.equal(parsePeriod(-1), null);
});

function leaves(data: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : Object.entries(leaves(value as Record<string, unknown>, path));
  }));
}

test('Chinese contains every English key and preserves interpolation and markup contracts', () => {
  const directory = new URL('../../public/locales/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.json'))) JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
  const english = leaves(JSON.parse(readFileSync(new URL('en.json', directory), 'utf8')));
  const chinese = leaves(JSON.parse(readFileSync(new URL('zh-CN.json', directory), 'utf8')));
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    assert.deepEqual(chinese[key].match(/{{\s*\w+\s*}}|<\w+\s*\/>/g)?.sort() || [], english[key].match(/{{\s*\w+\s*}}|<\w+\s*\/>/g)?.sort() || [], key);
  }
  assert.equal(chinese['config.code'], 'zh-CN');
  assert.equal(chinese['config.label'], '简体中文');
  assert.ok(!Object.values(chinese).some(value => value.includes('₽')));
});


test('legacy entry Russian defaults do not override Chinese first visits', () => {
  assert.equal(resolveDefaultLanguage(undefined, undefined), 'zh-CN');
  assert.equal(resolveDefaultLanguage('ru', undefined), 'zh-CN');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined), null), 'zh-CN');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined), 'en'), 'en');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined), 'ru'), 'ru');
  assert.equal(resolveDefaultLanguage('en', 'ru'), 'en');
  assert.equal(resolveDefaultLanguage('zh-CN', 'ru'), 'zh-CN');
  assert.equal(resolveDefaultLanguage('ru', 'ru'), 'ru');
  assert.equal(resolveDefaultLanguage('ru', 'en'), 'en');
  assert.equal(resolveDefaultLanguage('ru', undefined, true), 'ru');
  assert.equal(resolveDefaultLanguage('ru', 'en', true), 'ru');
  assert.equal(resolveDefaultLanguage(undefined, 'ru', true), 'ru');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined, true), 'en', BUILT_IN_LANGS, true), 'ru');
});
