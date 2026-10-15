import { describe, expect, it } from 'vitest';
import { pickLocale, t } from './index.js';

describe('i18n', () => {
  it('translates and falls back to English', () => {
    expect(t('de', 'nav.games')).toBe('Spiele');
    expect(t('de', 'nav.admin')).toBe('Admin'); // not translated yet -> English
    expect(t('en', 'nav.games')).toBe('Games');
  });
  it('picks the best supported language', () => {
    expect(pickLocale('de-AT,de;q=0.9,en;q=0.5')).toBe('de');
    expect(pickLocale('fr-FR,fr;q=0.9,en;q=0.5')).toBe('en');
    expect(pickLocale('fr,de;q=0.4')).toBe('de');
    expect(pickLocale(null)).toBe('en');
  });
});
