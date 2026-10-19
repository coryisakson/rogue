/**
 * Which language is a question written in? Only used to pick the rulebook edition whose excerpts fit the answer
 * (e.g. an English question must not be answered from German role names). Deliberately crude: stop-word counting
 * for the languages we index; anything unclear returns null, meaning "do not filter".
 */
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'what', 'which', 'how', 'many', 'can', 'does', 'do', 'is', 'are', 'a', 'of', 'when', 'you', 'in', 'to', 'if'],
  de: ['der', 'die', 'das', 'welche', 'wie', 'viele', 'kann', 'darf', 'ist', 'sind', 'ein', 'eine', 'und', 'wenn', 'ich', 'muss', 'was', 'wer', 'kartenhand'],
};

export function questionLang(question: string): string | null {
  const words = question.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  const score = (list: string[] = []) => words.filter((w) => list.includes(w)).length;
  const en = score(STOPWORDS.en), de = score(STOPWORDS.de);
  if (en === de) return null;
  return en > de ? 'en' : 'de';
}

/** Keep only hits in the wanted language, but never filter down to nothing. */
export function preferLang<T extends { lang: string }>(hits: T[], wanted: string | null | undefined): T[] {
  if (!wanted) return hits;
  const kept = hits.filter((h) => h.lang.toLowerCase().split('-')[0] === wanted);
  return kept.length ? kept : hits;
}
