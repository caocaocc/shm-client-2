import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { config } from '../config';

import { BUILT_IN_LANGS, selectLanguage } from './language';
export { BUILT_IN_LANGS };

export const CUSTOM_LANGS: string[] = config.CUSTOM_LANGS
  ? config.CUSTOM_LANGS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const allLangs = [...BUILT_IN_LANGS, ...CUSTOM_LANGS];

const isSingleLanguage = config.SINGLE_LANGUAGE === 'true';
let savedLanguage = null;
try { savedLanguage = localStorage.getItem('shm_language'); } catch { /* Storage may be unavailable. */ }

const activeLangs = isSingleLanguage
  ? [config.DEFAULT_LANGUAGE]
  : allLangs;

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}.json`,
    },
    lng: selectLanguage(config.DEFAULT_LANGUAGE, savedLanguage, activeLangs, isSingleLanguage),
    load: 'currentOnly',
    fallbackLng: isSingleLanguage ? config.DEFAULT_LANGUAGE : 'en',
    supportedLngs: activeLangs,
    preload: activeLangs,

    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: [],
      lookupLocalStorage: 'shm_language',
    },

    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
