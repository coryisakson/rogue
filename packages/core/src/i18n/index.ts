/**
 * i18n. Rule: user-facing words go through t(); English is the source. Every language has every key (typed as a full
 * Record and checked by i18n.test.ts), so there are no silent fallback gaps. Add a language: copy de.ts, translate,
 * add it to LOCALES, LANGUAGE_NAMES and migration-checked users.language values.
 * The non-English dictionaries are machine-translated and need native review (docs/REVIEW_LOG.md R31).
 */
import { en } from './en.js';
import { de } from './de.js';
import { zh } from './zh.js';
import { es } from './es.js';
import { it } from './it.js';

export const LOCALES = ['en', 'de', 'zh', 'es', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export type MessageKey = keyof typeof en;

export const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, de, zh, es, it };

/** Each language in its own words, for the language switcher. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', de: 'Deutsch', zh: '中文', es: 'Español', it: 'Italiano' };
/** English names, for model prompts ("Answer in German"). */
export const LANGUAGE_NAMES_EN: Record<Locale, string> = { en: 'English', de: 'German', zh: 'Chinese (Simplified)', es: 'Spanish', it: 'Italian' };
/** BCP 47 tags for Intl number and date formatting. */
const INTL_TAGS: Record<Locale, string> = { en: 'en', de: 'de-DE', zh: 'zh-CN', es: 'es', it: 'it-IT' };

export const isLocale = (x: string | null | undefined): x is Locale => !!x && (LOCALES as readonly string[]).includes(x);

/** "de-AT" -> "de", "zh-Hant-TW" -> "zh"; unknown languages -> null. */
export function localeOf(tag: string | null | undefined): Locale | null {
  const base = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

/** Placeholder values; null/undefined print as nothing (like JSX), a placeholder not passed at all stays visible. */
export type Vars = Record<string, string | number | null | undefined>;

/** Look up a message and fill its {placeholders}. English is a last-resort fallback only (the test keeps it unused). */
export function t(locale: Locale, key: MessageKey, vars?: Vars): string {
  const msg = DICTIONARIES[locale]?.[key] ?? en[key];
  return vars ? msg.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name] ?? '') : m)) : msg;
}

/** The given keys as a plain object, for client scripts (rendered into a data-i18n JSON attribute). */
export function clientStrings<K extends MessageKey>(locale: Locale, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, t(locale, k)])) as Record<K, string>;
}

/** Pick the best supported language from an Accept-Language header ("de-AT,de;q=0.9,en;q=0.5"). */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  const wanted = (acceptLanguage ?? '').split(',').map((part) => {
    const [tag = '', q] = part.trim().split(';q=');
    return { lang: localeOf(tag), q: q ? Number(q) : 1 };
  }).filter((w) => w.lang && w.q > 0).sort((a, b) => b.q - a.q);
  return wanted[0]?.lang ?? DEFAULT_LOCALE;
}

/** The language for one request. Priority: the signed-in user's profile > the language cookie > Accept-Language > English. */
export function resolveLocale(input: { profile?: string | null; cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.profile)) return input.profile;
  if (isLocale(input.cookie)) return input.cookie;
  return pickLocale(input.acceptLanguage);
}

export const LANG_COOKIE = 'rogue_lang';

export function formatNumber(locale: Locale, n: number): string {
  return new Intl.NumberFormat(INTL_TAGS[locale]).format(n);
}

export function formatDate(locale: Locale, d: Date | string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(INTL_TAGS[locale], opts).format(typeof d === 'string' ? new Date(d) : d);
}
