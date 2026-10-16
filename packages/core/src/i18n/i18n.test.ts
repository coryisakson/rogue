import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DICTIONARIES, LOCALES, LANGUAGE_NAMES, LANGUAGE_NAMES_EN, clientStrings, formatNumber, pickLocale, resolveLocale, t } from './index.js';

describe('i18n', () => {
  it('translates and fills placeholders', () => {
    expect(t('de', 'nav.games')).toBe('Spiele');
    expect(t('en', 'nav.games')).toBe('Games');
    expect(t('en', 'chat.meter', { n: 3, max: 12 })).toBe('Turn 3 of 12');
    expect(t('zh', 'chat.meter', { n: 3, max: 12 })).toBe('第 3 轮，共 12 轮');
    expect(t('en', 'common.players', { min: 2 })).toBe('2–{max} players'); // unknown placeholder stays visible
  });

  it('every language has every English key, non-empty, with the same placeholders', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const keys = Object.keys(DICTIONARIES.en) as (keyof typeof DICTIONARIES.en)[];
    for (const locale of LOCALES) {
      const dict = DICTIONARIES[locale];
      const missing = keys.filter((k) => typeof dict[k] !== 'string' || !dict[k].trim());
      expect(missing, `${locale} is missing keys`).toEqual([]);
      expect(Object.keys(dict).filter((k) => !(k in DICTIONARIES.en)), `${locale} has unknown keys`).toEqual([]);
      for (const k of keys) expect(placeholders(dict[k]), `${locale} ${k}`).toEqual(placeholders(DICTIONARIES.en[k]));
      expect(LANGUAGE_NAMES[locale]).toBeTruthy();
      expect(LANGUAGE_NAMES_EN[locale]).toBeTruthy();
    }
  });

  it('non-English dictionaries are marked as machine-translated', () => {
    for (const locale of LOCALES.filter((l) => l !== 'en')) {
      expect(readFileSync(new URL(`./${locale}.ts`, import.meta.url), 'utf8')).toMatch(/Machine-translated .*needs native review/);
    }
  });

  it('picks the best supported language from Accept-Language', () => {
    expect(pickLocale('de-AT,de;q=0.9,en;q=0.5')).toBe('de');
    expect(pickLocale('fr-FR,fr;q=0.9,en;q=0.5')).toBe('en');
    expect(pickLocale('fr,de;q=0.4')).toBe('de');
    expect(pickLocale('zh-CN,zh;q=0.9')).toBe('zh');
    expect(pickLocale('zh-TW')).toBe('zh');
    expect(pickLocale('zh-Hant-TW,en;q=0.2')).toBe('zh');
    expect(pickLocale('es-MX,es;q=0.9')).toBe('es');
    expect(pickLocale('it-IT')).toBe('it');
    expect(pickLocale('en;q=0.3,es;q=0.8')).toBe('es');
    expect(pickLocale(null)).toBe('en');
    expect(pickLocale('')).toBe('en');
  });

  it('resolves the request locale: profile > cookie > Accept-Language > en', () => {
    expect(resolveLocale({ profile: 'it', cookie: 'de', acceptLanguage: 'es' })).toBe('it');
    expect(resolveLocale({ profile: null, cookie: 'de', acceptLanguage: 'es' })).toBe('de');
    expect(resolveLocale({ profile: null, cookie: null, acceptLanguage: 'es-MX' })).toBe('es');
    expect(resolveLocale({ profile: 'xx', cookie: 'yy', acceptLanguage: 'fr' })).toBe('en');
    expect(resolveLocale({})).toBe('en');
  });

  it('client strings and number formatting follow the locale', () => {
    expect(clientStrings('es', ['chat.ask', 'chat.quote'])).toEqual({ 'chat.ask': 'Preguntar', 'chat.quote': 'Cita' });
    expect(formatNumber('de', 1234)).toBe('1.234');
    expect(formatNumber('en', 1234)).toBe('1,234');
  });
});
