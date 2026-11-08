export function currencyCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : '';
}

// /system/auth exposes only the ledger currency, never private billing config.
export function readBillingCurrency(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const envelope = response as { data?: unknown; billing?: unknown };
  const data = envelope.data ?? envelope;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return '';
  const billing = (row as { billing?: unknown }).billing;
  return billing && typeof billing === 'object'
    ? currencyCode((billing as { currency?: unknown }).currency)
    : '';
}

export async function loadBillingCurrency(explicit: unknown, load: () => Promise<unknown>): Promise<string> {
  const configured = currencyCode(explicit);
  try {
    // The ledger is authoritative; explicit configuration supports older APIs.
    return readBillingCurrency(await load()) || configured;
  } catch {
    // Unknown amounts remain unlabelled instead of being mistaken for CNY.
    return configured;
  }
}
