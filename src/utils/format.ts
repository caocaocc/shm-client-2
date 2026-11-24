import { currencyCode } from './billing.ts';

const precision = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const defaultZone = 'Asia/Shanghai';

function decimal(input: unknown) {
  if (typeof input === 'number') return input;
  if (typeof input === 'string' && /^[+-]?\d+(\.\d+)?$/.test(input.trim())) return Number(input);
  return NaN;
}

export function formatMoney(input: unknown, locale = 'zh-CN', denomination = 'CNY') {
  const value = decimal(input);
  const currency = currencyCode(denomination);
  if (!Number.isFinite(value) || !currency) return '—';
  if (currency === 'CNY') {
    const parts = new Intl.NumberFormat(locale, precision).formatToParts(value);
    const first = parts.findIndex(p => p.type === 'integer');
    const amount = parts.map((p, i) => (i === first ? '¥' : '') + (p.type === 'literal' ? '' : p.value)).join('');
    return /^ar(?:-|$)/i.test(locale) ? '\u2066' + amount + '\u2069' : amount;
  }
  return Intl.NumberFormat(locale, { ...precision, style: 'currency', currency }).format(value);
}

export function currencySymbol(locale: string, denomination = 'CNY') {
  const currency = currencyCode(denomination);
  if (!currency) return '—';
  if (currency === 'CNY') return '¥';
  return Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0)
    .find(part => part.type === 'currency')?.value ?? currency;
}

export function currencyInputProps(locale: string, currency: string) {
  if (currencyCode(currency) === 'CNY') return { prefix: '¥', dir: 'ltr' as const };
  return { suffix: ' ' + currencySymbol(locale, currency) };
}

export function requiredTopUp(cost: unknown, balance: unknown) {
  // Ledger values have cent precision. Subtract them in cents.
  return Math.max(0, Math.round(decimal(cost) * 100) - Math.round(decimal(balance) * 100)) / 100;
}

export function paymentAmount(value: unknown, minimum = 0.01) {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents >= Math.max(1, Math.round(minimum * 100)) ? (cents / 100).toFixed(2) : null;
}

export function parsePeriod(value: unknown) {
  const parts = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));
  if (!parts) return null;
  const fraction = (parts[2] || '').padEnd(4, '0');
  return { months: Number(parts[1]), days: Number(fraction.slice(0, 2)), hours: Number(fraction.slice(2)) };
}

function wallClock(instant: number, formatter: Intl.DateTimeFormat) {
  const clock = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  return Date.UTC(+clock.year, +clock.month - 1, +clock.day, +clock.hour, +clock.minute, +clock.second);
}

export function parseBackendDate(input: unknown, timeZone = defaultZone): Date | null {
  if (typeof input === 'number' || (typeof input === 'string' && /^\d{10,13}$/.test(input))) {
    const epoch = Number(input);
    const result = new Date(Math.abs(epoch) < 1e11 ? epoch * 1000 : epoch);
    return Number.isFinite(result.getTime()) ? result : null;
  }
  if (typeof input !== 'string') return null;
  const match = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?)?(Z|[+-]\d\d:\d\d)?$/.exec(input);
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', offset] = match;
  const iso = year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second;
  const nominal = Date.parse(iso + 'Z');
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 19) !== iso) return null;
  const ms = Number(fraction.padEnd(3, '0').slice(0, 3));
  if (offset) {
    const explicit = Date.parse(iso + offset);
    return Number.isFinite(explicit) ? new Date(explicit + ms) : null;
  }
  try {
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Around a DST change, try the offsets on both sides. Reject a missing or repeated wall time.
    const candidates = new Set<number>();
    for (const shift of [-86400000, 0, 86400000]) {
      const probe = nominal + shift;
      const candidate = nominal + (probe - wallClock(probe, clock));
      if (wallClock(candidate, clock) === nominal) candidates.add(candidate);
    }
    return candidates.size === 1 ? new Date([...candidates][0] + ms) : null;
  } catch { return null; }
}

export function formatDate(input: unknown, locale = 'zh-CN', timeZone = defaultZone) {
  const date = parseBackendDate(input, timeZone);
  try { return date?.toLocaleDateString(locale, { timeZone }) ?? '—'; } catch { return '—'; }
}

export function formatDateTime(input: unknown, locale = 'zh-CN', timeZone = defaultZone) {
  const date = parseBackendDate(input, timeZone);
  try {
    return date?.toLocaleString(locale, { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—';
  } catch { return '—'; }
}
