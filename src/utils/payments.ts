export interface PaySystem {
  name: string;
  shm_url: string;
  paysystem: string;
  allow_deletion?: number;
  recurring?: number;
  internal?: number;
  payment_mode?: string;
}
export type PaymentChannel = PaySystem & { id: string; profile: string };

export function paymentChannels(items: PaySystem[]): PaymentChannel[] {
  const result = new Map<string, PaymentChannel>();
  for (const channel of items) {
    if (!channel || !channel.name || typeof channel.shm_url !== 'string' || !channel.shm_url.trim()) continue;
    let endpoint: URL;
    try { endpoint = new URL(channel.shm_url, 'https://portal.invalid'); } catch { continue; }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) continue;
    const profile = endpoint.searchParams.get('ps') || channel.paysystem;
    // Each opening receives a new timestamp. Keep selection tied to the actual payment profile.
    endpoint.searchParams.delete('ts');
    endpoint.searchParams.delete('amount');
    const id = JSON.stringify([endpoint.href, profile, !!channel.allow_deletion, !!channel.recurring, !!channel.internal]);
    if (!result.has(id)) result.set(id, { ...channel, id, profile });
  }
  return [...result.values()];
}

export function chargeUrl(channel: PaymentChannel, amount: string, origin: string) {
  const target = new URL(channel.shm_url, origin);
  if (target.searchParams.has('amount')) {
    target.searchParams.set('amount', amount);
    return target.href;
  }
  return target.href + amount;
}
