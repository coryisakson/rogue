/**
 * Keyword search per chunk language. chunks.tsv is built with the Postgres text-search config of the chunk's own `lang`
 * (migration 0031), so the query must use the same config per row: German stems German words, and so on.
 * Chinese has no word spaces: 'simple' finds little there, so zh relies on the vector path.
 */
const TS_CONFIGS: Record<string, string> = { en: 'english', de: 'german', es: 'spanish', it: 'italian' };

/** 'de' / 'de-AT' -> 'german'; zh and anything unknown -> 'simple'. */
export function tsConfigForLang(lang: string | null | undefined): string {
  return TS_CONFIGS[(lang ?? '').toLowerCase().split(/[-_]/)[0] ?? ''] ?? 'simple';
}

/** SQL expression turning a lang column into its regconfig. The same text builds chunks.tsv in migration 0031. */
export function tsConfigSql(col: string): string {
  const whens = Object.entries(TS_CONFIGS).map(([lang, cfg]) => `WHEN '${lang}' THEN '${cfg}'::regconfig`).join(' ');
  return `CASE lower(split_part(${col}, '-', 1)) ${whens} ELSE 'simple'::regconfig END`;
}

/**
 * WHERE clause matching a tsquery string (param `$n`, built by orQuery) against chunks of every language, each with its
 * own config. One branch per config keeps each `tsv @@ to_tsquery(<constant config>, $n)` usable by the GIN index.
 */
export function keywordMatchSql(param: string, alias = 'ch'): string {
  const base = `lower(split_part(${alias}.lang, '-', 1))`;
  const langs = Object.keys(TS_CONFIGS);
  const branches = Object.entries(TS_CONFIGS).map(([lang, cfg]) => `(${base} = '${lang}' AND ${alias}.tsv @@ to_tsquery('${cfg}', ${param}))`);
  branches.push(`(${base} NOT IN (${langs.map((l) => `'${l}'`).join(', ')}) AND ${alias}.tsv @@ to_tsquery('simple', ${param}))`);
  return `(${branches.join(' OR ')})`;
}

/** ORDER BY expression ranking a keyword hit with its own language's query. */
export function keywordRankSql(param: string, alias = 'ch'): string {
  return `ts_rank_cd(${alias}.tsv, to_tsquery(${tsConfigSql(`${alias}.lang`)}, ${param}))`;
}
