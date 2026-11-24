type BillingInfo = { billing?: { currency?: unknown } };

const currencies = (Intl as typeof Intl & {
  supportedValuesOf?: (key: 'currency') => string[];
}).supportedValuesOf?.('currency');

export function currencyCode(input: unknown) {
  if (typeof input !== 'string') return '';
  const code = input.trim().toUpperCase();
  return (currencies || ['CNY', 'USD', 'EUR', 'RUB']).includes(code) ? code : '';
}

export function readBillingCurrency(response: unknown, site?: unknown) {
  const envelope = response as { data?: unknown } | null;
  const data = envelope?.data ?? response;
  const system = (Array.isArray(data) ? data[0] : data) as BillingInfo | null;
  return currencyCode(system?.billing?.currency) || currencyCode(site);
}
