/**
 * i18n skeleton. Rule: user-facing words go through t(); English is the source and the fallback, so a missing
 * translation never breaks a page. Add a language by adding a dictionary here (contributors: copy `de`).
 */
export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  'nav.games': 'Games', 'nav.about': 'About', 'nav.admin': 'Admin', 'nav.signin': 'Sign in', 'nav.signout': 'Sign out',
  'footer.preview': 'MVP preview · AI-drafted from publisher rulebooks, always check the source',
  'footer.how': 'how this works',
} as const;
export type MessageKey = keyof typeof en;

const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en,
  de: { 'nav.games': 'Spiele', 'nav.about': 'Über', 'nav.signin': 'Anmelden', 'nav.signout': 'Abmelden', 'footer.how': 'so funktioniert es' },
};

export const isLocale = (x: string | null | undefined): x is Locale => !!x && (LOCALES as readonly string[]).includes(x);

export function t(locale: Locale, key: MessageKey): string {
  return dictionaries[locale][key] ?? en[key];
}

/** Pick the best supported language from an Accept-Language header ("de-AT,de;q=0.9,en;q=0.5"); a cookie choice should win over this. */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  const wanted = (acceptLanguage ?? '').split(',').map((part) => {
    const [tag = '', q] = part.trim().split(';q=');
    return { lang: tag.toLowerCase().split('-')[0]!, q: q ? Number(q) : 1 };
  }).filter((w) => w.lang).sort((a, b) => b.q - a.q);
  for (const w of wanted) if (isLocale(w.lang)) return w.lang;
  return DEFAULT_LOCALE;
}
