export const BUILT_IN_LANGS = ['zh-CN', 'en', 'ru', 'de', 'es', 'fr', 'uz', 'ar'];

// The stock container writes "ru" even when DEFAULT_LANGUAGE is unset.
export function resolveDefaultLanguage(runtime?: string, build?: string, single = false) {
  return (single || runtime !== 'ru' ? runtime : undefined) || build || 'zh-CN';
}

export function selectLanguage(site: string, saved: string | null, choices = BUILT_IN_LANGS, single = false) {
  const resolve = (input: string | null) => {
    const tag = input?.toLowerCase() || '';
    const exact = choices.find(code => code.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0];
    return choices.find(code => code === (base === 'zh' ? 'zh-CN' : base));
  };
  return (single ? undefined : resolve(saved)) || resolve(site) || choices[0];
}
