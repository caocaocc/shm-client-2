import { intlLocale } from './format.ts';

export interface ProxySubscription {
  url: string | null;
  status?: string;
  usedBytes?: number;
  limitBytes?: number;
  resetStrategy?: string;
  expiresAt?: string | number;
  // Missing means the subscription endpoint did not expose this setting.
  // null inherits the panel default; zero explicitly disables the limit.
  deviceLimit?: number | null;
}

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : undefined;
}

function own(value: RecordValue, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

// Storage returns the current template payload directly or in SHM's JSON envelope.
function snapshot(payload: unknown): RecordValue | undefined {
  const envelope = object(payload);
  if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, 'data')) return envelope;
  const data = envelope.data;
  return object(Array.isArray(data) && data.length === 1 ? data[0] : data);
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function subscriptionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : undefined;
  } catch { return undefined; }
}

export function parseProxySubscription(payload: unknown): ProxySubscription | null {
  const source = snapshot(payload);
  if (!source || own(source, 'isFound') === false) return null;
  const user = object(own(source, 'user')) || {};
  const rawStatus = own(user, 'userStatus');
  const rawStrategy = own(user, 'trafficLimitStrategy');
  const rawExpiresAt = own(user, 'expiresAt');
  const rawDeviceLimit = own(user, 'hwidDeviceLimit');
  const result: ProxySubscription = {
    url: subscriptionUrl(own(source, 'subscription_url')) || null,
    status: typeof rawStatus === 'string' && rawStatus ? rawStatus.toUpperCase() : undefined,
    usedBytes: nonNegativeInteger(own(user, 'trafficUsedBytes')),
    limitBytes: nonNegativeInteger(own(user, 'trafficLimitBytes')),
    resetStrategy: typeof rawStrategy === 'string' && rawStrategy ? rawStrategy.toUpperCase() : undefined,
    expiresAt: typeof rawExpiresAt === 'string' || typeof rawExpiresAt === 'number' ? rawExpiresAt : undefined,
    deviceLimit: rawDeviceLimit === null ? null : nonNegativeInteger(rawDeviceLimit),
  };
  return result.url || Object.entries(result).some(([key, value]) => key !== 'url' && value !== undefined) ? result : null;
}

export function proxyStorageKey(userServiceId: number, prefix?: string): string {
  return `${prefix?.trim() || 'vpn_remna_'}${userServiceId}`;
}

export async function loadProxySubscription(
  userServiceId: number,
  prefix: string | undefined,
  fetchStorage: (key: string, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<ProxySubscription | null> {
  signal.throwIfAborted();
  try {
    const payload = await fetchStorage(proxyStorageKey(userServiceId, prefix), signal);
    signal.throwIfAborted();
    return parseProxySubscription(payload);
  } catch (error) {
    signal.throwIfAborted();
    if (object(object(error)?.response)?.status === 404) return null;
    throw error;
  }
}

export function remainingTraffic(subscription: ProxySubscription): number | undefined {
  const { usedBytes, limitBytes } = subscription;
  return limitBytes !== undefined && limitBytes > 0 && usedBytes !== undefined
    ? Math.max(0, limitBytes - usedBytes) : undefined;
}

export function formatBytes(value: number | undefined, language = 'zh-CN'): string {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const index = value === 0 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const locale = intlLocale(language);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1024 ** index)} ${units[index]}`;
}
