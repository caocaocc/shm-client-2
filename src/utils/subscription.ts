export interface Subscription {
  url: string | null;
  usedBytes?: number;
  limitBytes?: number;
  deviceLimit?: number | null;
  status?: string;
  resetStrategy?: string;
  expiresAt?: string;
}

// Only fields in the storage document itself belong to this service.
function field(object: unknown, name: string): unknown {
  return object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, name)
    ? (object as Record<string, unknown>)[name] : undefined;
}

function count(value: unknown) {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function webLink(raw: unknown) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* A partial URL cannot be opened or encoded as a subscription. */ }
  return null;
}

export function parseProxySubscription(payload: unknown): Subscription | null {
  const data = field(payload, 'data') ?? payload;
  const document = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (field(document, 'isFound') === false) return null;
  const user = field(document, 'user');
  const devices = field(user, 'hwidDeviceLimit');
  const snapshot: Subscription = {
    url: webLink(field(document, 'subscription_url')) || webLink(field(document, 'subscriptionUrl')),
    usedBytes: count(field(user, 'trafficUsedBytes')),
    limitBytes: count(field(user, 'trafficLimitBytes')),
    deviceLimit: devices === null ? null : count(devices),
    status: text(field(user, 'userStatus')),
    resetStrategy: text(field(user, 'trafficLimitStrategy')),
    expiresAt: text(field(user, 'expiresAt')),
  };
  return snapshot.url || Object.values(snapshot).some(v => v !== null && v !== undefined) ? snapshot : null;
}

export function proxyStorageKey(id: number, prefix?: string) {
  return (prefix?.trim() || 'vpn_remna_') + id;
}

export async function loadProxySubscription(id: number, prefix: string | undefined,
  read: (key: string, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  try {
    const result = await read(proxyStorageKey(id, prefix), signal);
    signal.throwIfAborted();
    return parseProxySubscription(result);
  } catch (error) {
    signal.throwIfAborted();
    if (field(field(error, 'response'), 'status') === 404) return null;
    throw error;
  }
}

export function remainingTraffic({ usedBytes, limitBytes }: Subscription) {
  if (usedBytes === undefined || !limitBytes) return undefined;
  return Math.max(0, limitBytes - usedBytes);
}

export function formatBytes(input: unknown, locale = 'zh-CN') {
  const bytes = count(input);
  if (bytes === undefined) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let index = 0;
  let quantity = bytes;
  while (quantity >= 1024 && index < units.length - 1) { quantity /= 1024; index++; }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(quantity) + ' ' + units[index];
}
