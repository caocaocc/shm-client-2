import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemAuthConfig } from '../api/client';
import { config } from '../config';
import { readBillingCurrency } from '../utils/billing';
import { currencyInputProps, formatDate, formatDateTime, formatMoney } from '../utils/format';

export const SystemSettings = createContext<SystemAuthConfig | null>(null);

export function useDisplay() {
  const { i18n } = useTranslation();
  const currency = readBillingCurrency(useContext(SystemSettings), config.CURRENCY);
  const locale = i18n.resolvedLanguage || i18n.language;
  return {
    amountProps: currencyInputProps(locale, currency),
    date: (value: unknown) => formatDate(value, locale, config.TIMEZONE),
    timestamp: (value: unknown) => formatDateTime(value, locale, config.TIMEZONE),
    money: (value: unknown) => formatMoney(value, locale, currency),
  };
}
