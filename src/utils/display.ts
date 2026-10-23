import i18n from '../i18n';
import { config } from '../config';
import * as format from './format';
import type { MoneyValue, DateValue } from './format';
export { paymentAmount, requiredTopUp } from './format';

export const formatMoney = (value: MoneyValue, currency = config.CURRENCY) => format.formatMoney(value, i18n.language, currency);
export const currencySymbol = () => format.currencySymbol(i18n.language, config.CURRENCY);
export const formatDate = (value: DateValue) => format.formatDate(value, i18n.language, config.TIMEZONE);
export const formatDateTime = (value: DateValue) => format.formatDateTime(value, i18n.language, config.TIMEZONE);
export const formatPeriod = (value: string | number) => {
  const parts = format.parsePeriod(value);
  if (!parts) return '—';
  return (['months', 'days', 'hours'] as const).filter(unit => parts[unit] > 0)
    .map(unit => `${parts[unit]} ${i18n.t(`common.${unit}`, { count: parts[unit] })}`).join(' ') || '—';
};
