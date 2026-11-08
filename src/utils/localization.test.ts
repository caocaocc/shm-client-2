import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { selectLanguage, resolveDefaultLanguage, BUILT_IN_LANGS } from '../i18n/language.ts';

test('first visit uses Chinese and subsequent visits respect saved language', () => {
  assert.equal(selectLanguage('zh-CN', null), 'zh-CN');
  assert.equal(selectLanguage('zh-CN', 'en'), 'en');
  assert.equal(selectLanguage('zh-CN', 'ru'), 'ru');
  assert.equal(selectLanguage('zh-CN', 'en-US'), 'en');
  assert.equal(selectLanguage('zh-CN', 'zh-Hans'), 'zh-CN');
  assert.equal(selectLanguage('zh-CN', 'removed-language'), 'zh-CN');
  assert.equal(selectLanguage('ru', 'en', BUILT_IN_LANGS, true), 'ru');
  assert.equal(selectLanguage('kk', 'kk', [...BUILT_IN_LANGS, 'kk']), 'kk');
});

function leaves(data: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : Object.entries(leaves(value as Record<string, unknown>, path));
  }));
}

test('Chinese contains every English key and preserves interpolation and markup contracts', () => {
  const directory = new URL('../../public/locales/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.json'))) JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
  const english = leaves(JSON.parse(readFileSync(new URL('en.json', directory), 'utf8')));
  const chinese = leaves(JSON.parse(readFileSync(new URL('zh-CN.json', directory), 'utf8')));
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    assert.deepEqual(chinese[key].match(/{{\s*\w+\s*}}|<\w+\s*\/>/g)?.sort() || [], english[key].match(/{{\s*\w+\s*}}|<\w+\s*\/>/g)?.sort() || [], key);
  }
  assert.equal(chinese['config.code'], 'zh-CN');
  assert.equal(chinese['config.label'], '简体中文');
});

test('the current official entry Russian default does not override Chinese first visits', () => {
  assert.equal(resolveDefaultLanguage(undefined, undefined), 'zh-CN');
  assert.equal(resolveDefaultLanguage('ru', undefined), 'zh-CN');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined), null), 'zh-CN');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined), 'en'), 'en');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined), 'ru'), 'ru');
  assert.equal(resolveDefaultLanguage('en', 'ru'), 'en');
  assert.equal(resolveDefaultLanguage('zh-CN', 'ru'), 'zh-CN');
  assert.equal(resolveDefaultLanguage('ru', 'ru'), 'ru');
  assert.equal(resolveDefaultLanguage('ru', 'en'), 'en');
  assert.equal(resolveDefaultLanguage('ru', undefined, true), 'ru');
  assert.equal(resolveDefaultLanguage('ru', 'en', true), 'ru');
  assert.equal(resolveDefaultLanguage(undefined, 'ru', true), 'ru');
  assert.equal(selectLanguage(resolveDefaultLanguage('ru', undefined, true), 'en', BUILT_IN_LANGS, true), 'ru');
});
