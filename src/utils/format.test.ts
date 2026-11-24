import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_LANGS } from '../i18n/language.ts';
import { currencyCode, readBillingCurrency } from './billing.ts';
import { currencyInputProps, currencySymbol, formatDate, formatDateTime, formatMoney, parseBackendDate, parsePeriod, paymentAmount, requiredTopUp } from './format.ts';

test('ledger currency comes from public system settings before any explicit site fallback', () => {
  assert.equal(currencyCode(' rub '), 'RUB');
  assert.equal(readBillingCurrency({ status: 200, data: [{ billing: { currency: 'RUB' } }] }, 'CNY'), 'RUB');
  assert.equal(readBillingCurrency({ data: { billing: { currency: 'CNY' } } }, 'RUB'), 'CNY');
  assert.equal(readBillingCurrency({ billing: { currency: 'EUR' } }), 'EUR');
  assert.equal(readBillingCurrency({ data: [{}] }, 'EUR'), 'EUR');
  assert.equal(readBillingCurrency(null, 'CNY'), 'CNY');
  assert.equal(readBillingCurrency({ data: [{ billing: { currency: 'RUB' } }] }, 'invalid'), 'RUB');
  assert.match(formatMoney('-21.56', 'zh-CN', readBillingCurrency({ data: [{ billing: { currency: 'RUB' } }] })), /RUB|₽/);
});

test('failed and missing metadata never add a guessed currency symbol', () => {
  for (const payload of [undefined, null, {}, { data: [] }, { data: [{ billing: {} }] }, { data: [{ billing: { currency: '<RUB>' } }] }]) {
    const currency = readBillingCurrency(payload);
    assert.equal(currency, '');
    assert.equal(formatMoney('1234.50', 'zh-CN', currency), '—');
    assert.equal(currencySymbol('zh-CN', currency), '—');
  }
});

test('CNY amounts have two decimals in each language without converting numbers', () => {
  assert.equal(formatMoney('30'), '¥30.00');
  assert.equal(formatMoney('0.01'), '¥0.01');
  assert.equal(formatMoney('99999999.99'), '¥99,999,999.99');
  assert.equal(formatMoney('-12.30'), '-¥12.30');
  assert.equal(formatMoney(12.345), '¥12.35');
  assert.equal(formatMoney('30', 'en'), '¥30.00');
  assert.equal(formatMoney('30', 'ru'), '¥30,00');
  assert.match(formatMoney('30', 'en', 'RUB'), /RUB|₽/);
  assert.equal(currencySymbol('zh-CN'), '¥');
  for (const invalid of [' ', '0x30', '30 CNY', undefined, null, Infinity]) assert.equal(formatMoney(invalid), '—');
  assert.equal(formatMoney('30', 'en', 'bad'), '—');
});

test('CNY prefixes remain before localized numbers and after the sign', () => {
  for (const language of BUILT_IN_LANGS) {
    for (const value of [1234.5, -1234.5, 0, -0]) {
      const numericParts = new Intl.NumberFormat(language, {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).formatToParts(value).filter(part => part.type !== 'literal');
      const firstDigit = numericParts.findIndex(part => part.type === 'integer');
      const expected = numericParts.slice(0, firstDigit).map(part => part.value).join('')
        + '¥' + numericParts.slice(firstDigit).map(part => part.value).join('');
      const displayed = formatMoney(value, language, 'CNY');
      assert.equal(displayed.replace(/[\u2066\u2069]/g, ''), expected, language);
      if (language === 'ar') assert.equal(displayed, `\u2066${expected}\u2069`);
    }
    assert.equal(currencySymbol(language, 'CNY'), '¥');
    assert.deepEqual(currencyInputProps(language, 'CNY'), { prefix: '¥', dir: 'ltr' });
    for (const currency of ['RUB', 'USD']) {
      assert.equal(formatMoney(-1234.5, language, currency), new Intl.NumberFormat(language, {
        style: 'currency', currency, currencyDisplay: 'symbol',
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(-1234.5));
      assert.deepEqual(currencyInputProps(language, currency), { suffix: ` ${currencySymbol(language, currency)}` });
    }
  }
  assert.equal(paymentAmount('1234.50'), '1234.50');
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
