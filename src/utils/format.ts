// Display units never convert the backend's ledger values.
export const DEFAULT_CURRENCY = 'CNY';
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
export const DEFAULT_LOCALE = 'zh-CN';

export type MoneyValue = string | number | null | undefined;
export type DateValue = string | number | Date | null | undefined;

// SHM periods encode months.days-hours (M.DDHH), not decimal months.
export function parsePeriod(value: string | number): { months: number; days: number; hours: number } | null {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));
  if (!match) return null;
  const fraction = (match[2] || '').padEnd(4, '0');
  return { months: Number(match[1]), days: Number(fraction.slice(0, 2)), hours: Number(fraction.slice(2, 4)) };
}

export function intlLocale(language = DEFAULT_LOCALE): string {
  const locale = language === 'cn' ? DEFAULT_LOCALE : language;
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale])[0] || 'en';
  } catch {
    return 'en';
  }
}

export function formatMoney(value: MoneyValue, language = DEFAULT_LOCALE, currency = DEFAULT_CURRENCY): string {
  if (value === null || value === undefined || value === '' || !/^[A-Z]{3}$/.test(currency)) return '—';
  if (typeof value === 'string' && !/^[+-]?\d+(?:\.\d+)?$/.test(value)) return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(intlLocale(language), {
    style: 'currency', currency, currencyDisplay: 'symbol',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

export function currencySymbol(language = DEFAULT_LOCALE, currency = DEFAULT_CURRENCY): string {
  if (!/^[A-Z]{3}$/.test(currency)) return '—';
  return new Intl.NumberFormat(intlLocale(language), { style: 'currency', currency })
    .formatToParts(0).find(part => part.type === 'currency')?.value || currency;
}

// Payment submission remains ASCII ledger units, never a localized string.
export function paymentAmount(value: MoneyValue, minimum = 0.01): string | null {
  if (value === null || value === undefined || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= minimum && amount <= 99999999.99 ? amount.toFixed(2) : null;
}

export function requiredTopUp(cost: number, balance: number): number {
  return Math.max(0, Math.round(cost * 100) - Math.round(balance * 100)) / 100;
}

type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallParts(value: number, timeZone: string): WallTime {
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    wallFormatters.set(timeZone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(value)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])) as WallTime;
}

function utcValue(parts: WallTime): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

// SHM DATETIME is a wall clock in the site's business zone, not the browser's
// local time. Only an explicit offset/Z string may use native ISO parsing.
// Ambiguous/nonexistent DST wall clocks are rejected instead of guessed.
export function parseBackendDate(value: DateValue, timeZone = DEFAULT_TIME_ZONE): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!match || (match[8] && !match[4])) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => Number(part || 0));
  const parts: WallTime = { year, month, day, hour, minute, second };
  const nominal = utcValue(parts);
  const calendar = new Date(nominal);
  if (year < 1000 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month
      || calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour
      || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return null;
  const millis = Number((match[7] || '').padEnd(3, '0').slice(0, 3));
  if (match[8]) {
    const iso = `${value.slice(0, 10)}T${match[4]}:${match[5]}:${match[6]}${match[7] ? `.${match[7].slice(0, 3)}` : ''}${match[8]}`;
    const result = new Date(iso);
    return Number.isFinite(result.getTime()) ? result : null;
  }
  try {
    // Sampling both sides also detects DST folds/gaps in configurable zones.
    const offsets = new Set([-86400000, 0, 86400000].map(delta => utcValue(wallParts(nominal + delta, timeZone)) - (nominal + delta)));
    const matches = [...offsets].map(offset => nominal - offset)
      .filter(candidate => utcValue(wallParts(candidate, timeZone)) === nominal);
    return matches.length === 1 ? new Date(matches[0] + millis) : null;
  } catch {
    return null;
  }
}

export function formatDate(value: DateValue, language = DEFAULT_LOCALE, timeZone = DEFAULT_TIME_ZONE): string {
  const date = parseBackendDate(value, timeZone);
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat(intlLocale(language), { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch { return '—'; }
}

export function formatDateTime(value: DateValue, language = DEFAULT_LOCALE, timeZone = DEFAULT_TIME_ZONE): string {
  const date = parseBackendDate(value, timeZone);
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat(intlLocale(language), {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(date);
  } catch { return '—'; }
}
