// Mechanical checks on one source/target pair. Each returns findings: { check, sev, detail }.
// sev is FAIL (almost certainly broken), WARN (probably wrong; Claude or a person should look) or
// NOTE (worth knowing, often fine).

// Placeholders in the common formats. ICU messages ({n, plural, ...}) are handled separately.
const PLACEHOLDER_RES = [
  /\{\{\s*[\w.-]+\s*\}\}/g, // {{name}}  (i18next, Handlebars, Angular)
  /\$\{\s*[\w.-]+\s*\}/g, // ${name}
  // printf: %s %d %1$s %@ %.2f. The space flag is left out so "100% sure" isn't read as "% s".
  /%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?(?:hh|h|ll|l|L|z|j|t)?[diouxXeEfFgGaAcspn@]/g,
  /%\([\w.-]+\)[-+0#]*\d*(?:\.\d+)?[diouxXeEfFgGcrs]/g, // Python: %(name)s
  /\{\d+\}/g, // {0} (.NET, Java MessageFormat)
  /\{[A-Za-z_][\w.-]*\}/g, // {name}
  /:[A-Za-z_]\w*\b(?=[\s.,!?;)]|$)/g, // :name (Laravel, Rails) - only when it looks like a token
];

// Finds ICU arguments with branches: {name, plural|select|selectordinal, branches}. Returns
// [{ name, kind, branches: [keyword...], start, end }] at the top level.
export function icuArgs(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    const head = s.slice(i).match(/^\{\s*([\w.-]+)\s*,\s*(plural|select|selectordinal)\s*,/);
    if (!head) continue;
    let depth = 0, j = i;
    for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') { depth--; if (depth === 0) break; } }
    if (depth !== 0) { out.push({ name: head[1], kind: head[2], branches: [], start: i, end: s.length, unbalanced: true }); break; }
    const body = s.slice(i + head[0].length, j);
    const branches = [];
    let d = 0, word = '';
    for (const c of body) {
      if (c === '{') { if (d === 0 && word.trim()) branches.push(word.trim().split(/\s+/).pop()); d++; word = ''; }
      else if (c === '}') { d--; word = ''; }
      else if (d === 0) word += c;
    }
    out.push({ name: head[1], kind: head[2], branches, start: i, end: j + 1 });
    i = j;
  }
  return out;
}

// Plural categories differ by language (Polish has few and many, Japanese only other), so a
// different set of plural branches is normal; select branches should match.
const PLURAL_CATS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function stripIcu(s, args) {
  // Keep only the text outside ICU blocks for the simple placeholder scan, and the branch texts.
  let out = '', last = 0;
  for (const a of args) { out += s.slice(last, a.start) + ' '; last = a.end; }
  return out + s.slice(last);
}

const multiset = arr => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
function diffMultiset(a, b) {
  const ma = multiset(a), mb = multiset(b), missing = [], extra = [];
  for (const [k, n] of ma) for (let i = (mb.get(k) || 0); i < n; i++) missing.push(k);
  for (const [k, n] of mb) for (let i = (ma.get(k) || 0); i < n; i++) extra.push(k);
  return { missing, extra };
}

export function placeholders(s) {
  const found = [];
  let rest = s;
  for (const re of PLACEHOLDER_RES) {
    rest = rest.replace(re, m => { found.push(m.replace(/\s+/g, '')); return ' '.repeat(m.length); });
  }
  return found;
}

// Normalises "%1$s" vs "%s" ordering? No: positional and plain forms are different on purpose,
// so they're compared as written.
function checkPlaceholders(src, tgt, f) {
  const sa = icuArgs(src), ta = icuArgs(tgt);
  for (const a of ta) if (a.unbalanced) f.push({ check: 'icu', sev: 'FAIL', detail: `unbalanced braces in the ICU message for {${a.name}}` });
  const sNames = sa.map(a => `${a.name}:${a.kind}`), tNames = ta.map(a => `${a.name}:${a.kind}`);
  const d = diffMultiset(sNames, tNames);
  if (d.missing.length) f.push({ check: 'icu', sev: 'FAIL', detail: `ICU argument missing in the translation: ${d.missing.map(x => `{${x.replace(':', ', ')}}`).join(', ')}` });
  if (d.extra.length) f.push({ check: 'icu', sev: 'FAIL', detail: `ICU argument not in the source: ${d.extra.map(x => `{${x.replace(':', ', ')}}`).join(', ')}` });
  for (const s of sa) {
    const t = ta.find(x => x.name === s.name && x.kind === s.kind);
    if (!t) continue;
    if (s.kind === 'select') {
      const bd = diffMultiset(s.branches, t.branches);
      if (bd.missing.length || bd.extra.length) f.push({ check: 'icu', sev: 'FAIL', detail: `select branches for {${s.name}} differ: ${bd.missing.length ? `missing ${bd.missing.join(', ')}` : ''}${bd.missing.length && bd.extra.length ? '; ' : ''}${bd.extra.length ? `extra ${bd.extra.join(', ')}` : ''}` });
    } else {
      if (!t.branches.includes('other')) f.push({ check: 'icu', sev: 'FAIL', detail: `the plural for {${s.name}} has no "other" branch, which ICU requires` });
      const odd = t.branches.filter(b => !PLURAL_CATS.has(b) && !/^=\d+$/.test(b));
      if (odd.length) f.push({ check: 'icu', sev: 'FAIL', detail: `unknown plural branch for {${s.name}}: ${odd.join(', ')}` });
      const exact = s.branches.filter(b => /^=\d+$/.test(b) && !t.branches.includes(b));
      if (exact.length) f.push({ check: 'icu', sev: 'WARN', detail: `exact-number branch ${exact.join(', ')} for {${s.name}} is in the source but not the translation` });
      if (s.branches.join() !== t.branches.join()) f.push({ check: 'icu', sev: 'NOTE', detail: `plural branches for {${s.name}}: source ${s.branches.join(' ')}, translation ${t.branches.join(' ')} (languages differ; check the target language's categories)` });
    }
  }
  const pd = diffMultiset(placeholders(stripIcu(src, sa)), placeholders(stripIcu(tgt, ta)));
  if (pd.missing.length) f.push({ check: 'placeholder', sev: 'FAIL', detail: `placeholder missing in the translation: ${pd.missing.join(' ')}` });
  if (pd.extra.length) f.push({ check: 'placeholder', sev: 'FAIL', detail: `placeholder not in the source: ${pd.extra.join(' ')}` });
}

// HTML and XML tags, including XLIFF inline tags. Attribute values are ignored except href/src.
export function tags(s) {
  return [...s.matchAll(/<\/?([A-Za-z][\w:-]*)([^<>]*?)(\/?)>/g)].map(m => `<${m[0].startsWith('</') ? '/' : ''}${m[1].toLowerCase()}${m[3] ? '/' : ''}>`);
}
const hrefs = s => [...s.matchAll(/\s(?:href|src)\s*=\s*("([^"]*)"|'([^']*)')/g)].map(m => m[2] ?? m[3]);

function checkTags(src, tgt, f) {
  const d = diffMultiset(tags(src), tags(tgt));
  if (d.missing.length) f.push({ check: 'tags', sev: 'FAIL', detail: `tag missing in the translation: ${d.missing.join(' ')}` });
  if (d.extra.length) f.push({ check: 'tags', sev: 'FAIL', detail: `tag not in the source: ${d.extra.join(' ')}` });
  const h = diffMultiset(hrefs(src), hrefs(tgt));
  if (h.missing.length) f.push({ check: 'links', sev: 'WARN', detail: `link target changed or missing: ${h.missing.join(' ')}` });
}

// Markdown: link targets, inline code, emphasis markers.
const mdLinks = s => [...s.matchAll(/\]\(\s*([^)\s]+)[^)]*\)/g)].map(m => m[1]);
const inlineCode = s => [...s.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)].map(m => m[2]);
const emphasis = s => (s.replace(/(`+)[\s\S]*?\1/g, '').match(/\*\*|__|~~/g) || []).length;

function checkMarkdown(src, tgt, f) {
  const l = diffMultiset(mdLinks(src), mdLinks(tgt));
  if (l.missing.length) f.push({ check: 'links', sev: 'WARN', detail: `link target missing or changed: ${l.missing.join(' ')}` });
  if (l.extra.length) f.push({ check: 'links', sev: 'WARN', detail: `link target not in the source: ${l.extra.join(' ')}` });
  const c = diffMultiset(inlineCode(src), inlineCode(tgt));
  if (c.missing.length) f.push({ check: 'code', sev: 'WARN', detail: `inline code changed or missing: ${c.missing.map(x => '`' + x + '`').join(' ')} (code is usually left untranslated)` });
  const se = emphasis(src), te = emphasis(tgt);
  if (se !== te) f.push({ check: 'formatting', sev: te % 2 ? 'FAIL' : 'WARN', detail: `bold/strikethrough markers: ${se} in the source, ${te} in the translation${te % 2 ? ' (an odd number, so one is unclosed)' : ''}` });
}

// Numbers, compared after removing digit-group separators. Ordinals and spelled-out numbers aren't caught.
// Group separators: space, no-break space (U+00A0), narrow no-break space (U+202F), apostrophe.
const SEP = ` ${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}'`;
// Either grouped thousands (1,000 / 1.000 / 1 000, with optional decimals) or a plain number, so
// "in 2024, 15 people" gives 2024 and 15.
const NUM_RE = new RegExp(`\\d{1,3}(?:[${SEP}.,]\\d{3})+(?:[.,]\\d+)?(?!\\d)|\\d+(?:[.,]\\d+)?`, 'g');
const SEP_RE = new RegExp(`[${SEP}]`, 'g');
export const numbers = s => (s.replace(/<[^>]*>/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ').replace(/\{[^{}]*\}|%\d+\$/g, ' ')
  .match(NUM_RE) || []).map(n => n.trim().replace(SEP_RE, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
const urls = s => (s.match(/https?:\/\/[^\s<>"')\]]+/g) || []).map(u => u.replace(/[.,;:!?]+$/, ''));
const emails = s => s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [];

const END_PUNCT = /([.!?:;…。！？：；])\s*$/;
const PUNCT_CLASS = { '.': '.', '。': '.', '!': '!', '！': '!', '?': '?', '？': '?', ':': ':', '：': ':', ';': ';', '；': ';', '…': '…' };

export function checkPair(src, tgt, opts = {}) {
  const f = [];
  const s = String(src ?? ''), t = tgt == null ? null : String(tgt);
  if (t == null) { f.push({ check: 'missing', sev: 'FAIL', detail: 'no translation for this source' }); return f; }
  if (!t.trim() && s.trim()) { f.push({ check: 'empty', sev: 'FAIL', detail: 'the translation is empty' }); return f; }
  if (!s.trim()) return f;
  const letters = s.replace(/<[^>]*>|\{[^{}]*\}|%\S+|https?:\/\/\S+/g, '').match(/\p{L}/gu) || [];
  if (t === s && letters.length >= 4 && !opts.sameLanguage) f.push({ check: 'untranslated', sev: 'WARN', detail: 'the translation is identical to the source (fine for names and brands)' });
  checkPlaceholders(s, t, f);
  checkTags(s, t, f);
  if (opts.markdown) checkMarkdown(s, t, f);
  const n = diffMultiset(numbers(s), numbers(t));
  if (n.missing.length) f.push({ check: 'numbers', sev: 'WARN', detail: `number in the source not found in the translation: ${n.missing.join(', ')}` });
  if (n.extra.length) f.push({ check: 'numbers', sev: 'WARN', detail: `number in the translation not in the source: ${n.extra.join(', ')}` });
  // URLs already reported as link targets aren't reported twice.
  const reported = new Set([...hrefs(s), ...mdLinks(s)]);
  const u = diffMultiset(urls(s), urls(t));
  const missingUrls = u.missing.filter(x => !reported.has(x));
  if (missingUrls.length) f.push({ check: 'links', sev: 'WARN', detail: `URL missing or changed: ${missingUrls.join(' ')}` });
  const e = diffMultiset(emails(s), emails(t));
  if (e.missing.length) f.push({ check: 'links', sev: 'WARN', detail: `email address missing or changed: ${e.missing.join(' ')}` });
  const sl = (s.match(/\n/g) || []).length, tl = (t.match(/\n/g) || []).length;
  if (sl !== tl && !opts.markdown) f.push({ check: 'line breaks', sev: 'WARN', detail: `${sl} line break(s) in the source, ${tl} in the translation` });
  const lead = x => (x.match(/^\s*/)[0]), trail = x => (x.match(/\s*$/)[0]);
  if (lead(s) !== lead(t) || trail(s) !== trail(t)) f.push({ check: 'whitespace', sev: 'NOTE', detail: 'leading or trailing spaces differ from the source' });
  const sp = s.match(END_PUNCT), tp = t.match(END_PUNCT);
  if (sp && !tp) f.push({ check: 'punctuation', sev: 'NOTE', detail: `the source ends with "${sp[1]}" and the translation doesn't` });
  else if (sp && tp && PUNCT_CLASS[sp[1]] !== PUNCT_CLASS[tp[1]] && !(PUNCT_CLASS[sp[1]] === '.' && tp[1] === '…')) f.push({ check: 'punctuation', sev: 'NOTE', detail: `ends with "${tp[1]}" where the source ends with "${sp[1]}"` });
  const sc = Array.from(s).length, tc = Array.from(t).length;
  if (sc >= 20 && (tc / sc > 3 || tc / sc < 0.33) && !opts.cjk) f.push({ check: 'length', sev: 'WARN', detail: `the translation is ${tc} characters for a ${sc}-character source; something may be missing or added` });
  return f;
}

// A glossary is lines of "source term = required translation" (# for comments). It checks each
// pair whose source has the term (whole word, any case) for the translation (any case).
export function parseGlossary(text) {
  const out = [];
  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const k = l.indexOf('=');
    if (k < 1) throw new Error(`glossary line needs "term = translation": ${l.slice(0, 60)}`);
    out.push({ term: l.slice(0, k).trim(), translation: l.slice(k + 1).trim() });
  }
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function checkGlossary(src, tgt, glossary) {
  const f = [];
  for (const g of glossary) {
    if (!new RegExp(`(^|[^\\p{L}\\p{N}])${esc(g.term)}($|[^\\p{L}\\p{N}])`, 'iu').test(src)) continue;
    if (g.translation === '' || !tgt.toLowerCase().includes(g.translation.toLowerCase())) f.push({ check: 'glossary', sev: 'WARN', detail: `"${g.term}" should be translated as "${g.translation}"` });
  }
  return f;
}
