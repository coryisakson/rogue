/**
 * The game name a captured page's title most likely names, to prefill "Add as new game" (/admin/capture-inbox and the
 * capture forms). A guess the admin checks, never stored without them. No imports: the inbox page bundles this file for
 * its browser script as well.
 *   "How to Play Wingspan - Official Rules - UltraBoardGames"      -> "Wingspan"
 *   "Terraforming Mars Rules: How to Play | Official Game Rules"   -> "Terraforming Mars"
 *   "Slay the Spire: The Board Game | Board Game | BoardGameGeek"  -> "Slay the Spire: The Board Game"
 */

// Title parts that name the kind of page, not the game ("Official Rules", "FAQ", "Board Game").
const GENERIC = /^(?:the\s+)?(?:official\s+)?(?:(?:board\s*)?game\s+)?(?:rules?(?:\s+of\s+play)?|rule\s*book|rulebook|how\s+to\s+play|instructions|faq|errata|board\s*games?|board\s*game\s+expansion|game|home|files|forums?|reference|player\s+aids?|quick\s+start|learn\s+to\s+play|official\s+site|wiki)(?:\s+(?:and|&)\s+(?:faq|errata|rules|strategy|setup))*(?:\s*\(pdf\))?$/i;
// Separators sites put between the page name and the site name. A plain colon is not one: "Pandemic: Iberia" is a name.
const SEPARATORS = /\s+[|–—·•:]{1,2}\s+|\s+-\s+|\s*\|\s*/;
const PREFIX = /^(?:how\s+to\s+play|learn\s+(?:how\s+)?to\s+play|(?:official\s+)?rules?\s+(?:of|for)|rulebook\s+(?:of|for)|instructions\s+for|faq\s+for)\s+/i;
// "Catan Rules", "Catan Rules: How to Play", "Catan Board Game Rules and FAQ", "Catan rulebook (PDF)".
const RULES_TAIL = /\s+(?:(?:the\s+)?(?:official\s+)?(?:board\s*game\s+)?(?:game\s+)?(?:rules?|rulebook|rule\s*book|instructions|faq|how\s+to\s+play)\b.*)$/i;

/** Lower-case letters and digits only, to compare a title part with the host name ("Ultra BoardGames" ~ ultraboardgames.com). */
const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** True when a title part is the site's name: it looks like a domain, or matches a label of the host. */
function isSiteName(part: string, host: string): boolean {
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(part.trim())) return true;
  const p = compact(part);
  if (p.length < 3) return false;
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').slice(0, -1).map(compact).filter((l) => l.length >= 3);
  return labels.some((l) => l === p || l === `${p}com` || p === `${l}com`) || p === 'boardgamegeek';
}

export function gameNameFromPageTitle(title: string, host = ''): string {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const parts = t.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !GENERIC.test(p) && !isSiteName(p, host));
  // Every part was generic or the site's name ("Rules | Example"): no guess; the admin types the name.
  let name = kept[0] ?? '';
  name = name.replace(PREFIX, '').replace(RULES_TAIL, '').replace(/\s*\((?:pdf|\d{4})\)\s*$/i, '').trim();
  // "Catan - Board Game" ends here as "Catan Board Game" only when the site wrote it without a separator; keep "X: The Board Game".
  if (!/:\s*the\s+board\s*game$/i.test(name)) name = name.replace(/\s+board\s*game$/i, '').trim();
  name = name.replace(/[\s,;:–—-]+$/, '').trim();
  return name.length >= 2 ? name.slice(0, 80) : '';
}
