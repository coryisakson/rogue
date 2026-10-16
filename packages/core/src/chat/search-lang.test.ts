import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { keywordMatchSql, keywordRankSql, tsConfigForLang, tsConfigSql } from './search-lang.js';
import { answerLanguageRule } from './chat.js';

describe('keyword search config by language', () => {
  it('maps chunk languages to Postgres text-search configs', () => {
    expect(tsConfigForLang('de')).toBe('german');
    expect(tsConfigForLang('de-AT')).toBe('german');
    expect(tsConfigForLang('EN')).toBe('english');
    expect(tsConfigForLang('es')).toBe('spanish');
    expect(tsConfigForLang('it')).toBe('italian');
    expect(tsConfigForLang('zh')).toBe('simple'); // no word spaces: vectors do the work
    expect(tsConfigForLang('fr')).toBe('simple');
    expect(tsConfigForLang(null)).toBe('simple');
  });

  it('matches each chunk with its own language config, one index-friendly branch per config', () => {
    const sql = keywordMatchSql('$1');
    for (const cfg of ['english', 'german', 'spanish', 'italian', 'simple']) expect(sql).toContain(`ch.tsv @@ to_tsquery('${cfg}', $1)`);
    expect(sql).toContain(`lower(split_part(ch.lang, '-', 1)) = 'de' AND ch.tsv @@ to_tsquery('german', $1)`);
    expect(sql).toContain(`NOT IN ('en', 'de', 'es', 'it') AND ch.tsv @@ to_tsquery('simple', $1)`);
    expect(keywordRankSql('$1')).toBe(`ts_rank_cd(ch.tsv, to_tsquery(${tsConfigSql('ch.lang')}, $1))`);
  });

  it('migration 0031 builds chunks.tsv with the same CASE the queries use', () => {
    const sql = readFileSync(new URL('../../migrations/0031_user_language.sql', import.meta.url), 'utf8');
    expect(sql).toContain(`to_tsvector(${tsConfigSql('lang')}, text)`);
    expect(sql).toMatch(/users ADD COLUMN IF NOT EXISTS language TEXT NULL CHECK \(language IN \('en', 'de', 'zh', 'es', 'it'\)\)/);
  });
});

describe('answer language', () => {
  it('follows the user language when known, else the question', () => {
    expect(answerLanguageRule('de')).toContain('Answer in German. Cite pages as (p.N) exactly as in the excerpts. Keep rule terms of the game in the language of the excerpts in parentheses at first use.');
    expect(answerLanguageRule('zh')).toContain('Answer in Chinese (Simplified).');
    expect(answerLanguageRule(undefined)).toContain('same language as the question');
  });
});
