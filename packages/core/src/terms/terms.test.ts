import { describe, expect, it } from 'vitest';
import { MAX_TERMS_FLAGS, decideTermsWithAgent, isAssetHost, judgeTerms, registrableDomain, screenSentenceAnswers, sentencesToJudge, termsSiteCandidates } from './index.js';

const filler = 'These terms describe how you may use our website, order products, and contact customer support. '.repeat(20);

describe('terms agent (pure parts)', () => {
  it('knows a CDN is not the publisher', () => {
    expect(isAssetHost('cdn.svc.asmodee.net')).toBe(true);
    expect(isAssetHost('www.zmangames.com')).toBe(false);
    expect(registrableDomain('cdn.svc.asmodee.net')).toBe('asmodee.net');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
  });
  it('looks at the linking page first and skips the CDN host', () => {
    const c = termsSiteCandidates('https://cdn.svc.asmodee.net/production-zman/uploads/rules.pdf', 'https://www.zmangames.com/game/pandemic/');
    expect(c[0]!.origin).toBe('https://www.zmangames.com');
    expect(c.some((x) => x.origin === 'https://cdn.svc.asmodee.net')).toBe(false);
    expect(c.some((x) => x.origin === 'https://www.asmodee.net')).toBe(true);
  });
  it('uses the file host when it is a real site and nothing else is known', () => {
    const c = termsSiteCandidates('https://contentiongames.com/_images/rules.pdf', null);
    expect(c[0]!.origin).toBe('https://contentiongames.com');
  });
  it('clears long terms with no bot/AI/copy language', () => {
    expect(judgeTerms(filler).verdict).toBe('clear');
  });
  it('flags a prohibition on bots as restricted', () => {
    const j = judgeTerms(`${filler} You may not use any robot, spider or scraper to access the site.`);
    expect(j.verdict).toBe('restricted');
  });
  it('lets generic copyright wording through (R28) but not bot rules', () => {
    const j = judgeTerms(`${filler} You may not copy, reproduce or republish any content from this website without prior written permission.`);
    expect(j.verdict).toBe('clear');
    expect(j.flags.length).toBeGreaterThan(0);
  });
  it('treats AI mentions without a clear rule as unclear, and short pages as unclear', () => {
    expect(judgeTerms(`${filler} We use artificial intelligence to recommend products to our customers.`).verdict).toBe('unclear');
    expect(judgeTerms('Terms. Use at your own risk.').verdict).toBe('unclear');
  });
});

describe('terms agent judgement (code gates around the Nanobot agent)', () => {
  const text = `${filler} The following are not allowed on this site: Using automated tools to place orders. Our site uses artificial intelligence to recommend products.`;
  const code = judgeTerms(text);
  const sentences = sentencesToJudge(text, code);

  it('hands only unclear bot/AI sentences to the agent, with the text around them', () => {
    expect(code.verdict).toBe('unclear');
    expect(sentences.map((s) => s.kind)).toEqual(['bot', 'ai']);
    expect(sentences.map((s) => s.n)).toEqual([1, 2]);
    expect(sentences[0]!.context).toContain('The following are not allowed');
    expect(sentencesToJudge(filler, judgeTerms(filler))).toEqual([]); // clear: nothing to judge
    expect(sentencesToJudge('Short. Our bots are friendly.', judgeTerms('Short. Our bots are friendly.'))).toEqual([]); // too little text
  });
  it('screens answers: unknown numbers, bad meanings and missing reasons', () => {
    const r = screenSentenceAnswers(sentences, [
      { n: 1, meaning: 'unrelated', why: '' },
      { n: 7, meaning: 'allows', why: 'no such sentence here' },
      { n: 2, meaning: 'maybe', why: 'not a valid meaning' },
    ]);
    expect(r.answers).toEqual([{ n: 1, meaning: 'unsure', why: '' }]);
    expect(r.problems.join(' ')).toMatch(/reason.*no sentence 7.*meaning must be.*No answer for sentence\(s\) 2/);
    expect(screenSentenceAnswers(sentences, 'nonsense').answers).toEqual([]);
  });
  it('clears only when every sentence is allows/unrelated with a reason', () => {
    const ok = screenSentenceAnswers(sentences, [
      { n: 1, meaning: 'unrelated', why: 'About placing shop orders, not reading pages.' },
      { n: 2, meaning: 'unrelated', why: 'Describes the shop’s own features.' },
    ]).answers;
    expect(decideTermsWithAgent(code, sentences, ok).verdict).toBe('clear');
    expect(decideTermsWithAgent(code, sentences, ok, true).verdict).toBe('unclear'); // agent asked for a human
    expect(decideTermsWithAgent(code, sentences, ok.slice(0, 1)).verdict).toBe('unclear'); // one sentence unanswered
    const unsure = [ok[0]!, { n: 2, meaning: 'unsure' as const, why: '' }];
    expect(decideTermsWithAgent(code, sentences, unsure).verdict).toBe('unclear');
  });
  it('any forbidding sentence makes it restricted, and code verdicts other than unclear never change', () => {
    const answers = [{ n: 1, meaning: 'forbids' as const, why: 'Bans automated tools on the whole site.' }, { n: 2, meaning: 'allows' as const, why: 'Unrelated feature text.' }];
    const d = decideTermsWithAgent(code, sentences, answers);
    expect(d.verdict).toBe('restricted');
    expect(d.reasons[1]).toContain('Sentence 1 (bot): forbids');
    const restricted = judgeTerms(`${filler} You may not use any robot, spider or scraper to access the site.`);
    expect(decideTermsWithAgent(restricted, sentences, [{ n: 1, meaning: 'allows', why: 'model tries to override' }])).toBe(restricted);
  });
  it('never clears when the flag cap was hit (later sentences may be unseen)', () => {
    const many = `${filler} ${Array.from({ length: MAX_TERMS_FLAGS + 2 }, (_, i) => `Item ${i} mentions our crawler program number ${i}.`).join(' ')}`;
    const j = judgeTerms(many);
    const s = sentencesToJudge(many, j);
    expect(j.flags.length).toBe(MAX_TERMS_FLAGS);
    const all = s.map((x) => ({ n: x.n, meaning: 'unrelated' as const, why: 'Talks about a loyalty program.' }));
    expect(decideTermsWithAgent(j, s, all).verdict).toBe('unclear');
  });
});
