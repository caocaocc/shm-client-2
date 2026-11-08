export const BUILT_IN_LANGS = ['zh-CN', 'en', 'ru', 'de', 'es', 'fr', 'uz', 'ar'];

export function resolveDefaultLanguage(runtimeDefault: string | undefined, buildDefault: string | undefined, single = false): string {
  // The current official image emits "ru" when its language setting is omitted.
  // This multilingual application defaults to Chinese; an explicit build or
  // single-language setting can select Russian without replacing the entry script.
  if (runtimeDefault && (single || runtimeDefault.toLowerCase() !== 'ru')) return runtimeDefault;
  return buildDefault || 'zh-CN';
}

function supportedLanguage(value: string | null | undefined, supported: string[]): string | undefined {
  if (!value) return undefined;
  const exact = supported.find(code => code.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  if (/^zh(?:-|$)|^cn$/i.test(value) && supported.includes('zh-CN')) return 'zh-CN';
  return supported.find(code => code.toLowerCase() === value.split('-')[0].toLowerCase());
}

export function selectLanguage(defaultLanguage: string, savedLanguage: string | null, supported = BUILT_IN_LANGS, single = false): string {
  const siteDefault = supportedLanguage(defaultLanguage, supported) || 'zh-CN';
  return (!single && supportedLanguage(savedLanguage, supported)) || siteDefault;
}
