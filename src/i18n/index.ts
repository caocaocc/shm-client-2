import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { config } from '../config';
import { BUILT_IN_LANGS, selectLanguage } from './language';

export { BUILT_IN_LANGS } from './language';

export const CUSTOM_LANGS: string[] = config.CUSTOM_LANGS
  ? config.CUSTOM_LANGS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const allLangs = [...BUILT_IN_LANGS, ...CUSTOM_LANGS];

const isSingleLanguage = config.SINGLE_LANGUAGE === 'true';
let savedLanguage: string | null = null;
try { savedLanguage = localStorage.getItem('shm_language'); } catch { /* Storage may be disabled. */ }

const activeLangs = isSingleLanguage
  ? [selectLanguage(config.DEFAULT_LANGUAGE, null, allLangs, true)]
  : allLangs;

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}.json`,
    },
    lng: selectLanguage(config.DEFAULT_LANGUAGE, savedLanguage, allLangs, isSingleLanguage),
    fallbackLng: 'en',
    supportedLngs: activeLangs,
    preload: activeLangs,

    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'shm_language',
    },

    interpolation: {
      escapeValue: false,
    },
  });

const updateDocumentLanguage = () => {
  document.documentElement.lang = i18n.resolvedLanguage || i18n.language || 'zh-CN';
};
i18n.on('initialized', updateDocumentLanguage);
i18n.on('languageChanged', updateDocumentLanguage);
updateDocumentLanguage();

export default i18n;
