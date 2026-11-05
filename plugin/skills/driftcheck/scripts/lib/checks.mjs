// Mechanical checks on one source/target pair. Each returns findings:
//   { check, sev, detail, values?, tail? }
// sev is FAIL (almost certainly broken), WARN (probably wrong; Claude or a person should look) or
// NOTE (worth knowing, often fine). `detail` is fixed text written here; anything taken from the files
// goes in `values` (shown separately and safely in the report), never inside `detail`.

const cp = n => String.fromCodePoint(n);

// Placeholders in the common formats. ICU messages ({n, plural, ...}) are handled separately.
const PLACEHOLDER_RES = [
  /\{\{\s*[\w.-]+\s*\}\}/g, // {{name}}  (i18next, Handlebars, Angular)
  /\$\{\s*[\w.-]+\s*\}/g, // ${name}
  /%\{[\w.-]+\}/g, // %{name}  (Ruby, Rails)
  // Typed ICU / MessageFormat arguments: {0,number,integer}, {d, date, short}
  /\{\s*[\w.-]+\s*,\s*(?:number|date|time|choice|spellout|ordinal|duration)\s*(?:,[^{}]*)?\}/g,
  // printf: %s %d %1$s %@ %.2f. The space flag is left out so "100% sure" isn't read as "% s".
  /%(?:\d+\$)?[-+0#]*(?:[1-9]\d*)?(?:\.\d+)?(?:hh|h|ll|l|L|z|j|t)?[diouxXeEfFgGaAcspn@]/g,
  /%\([\w.-]+\)[-+0#]*(?:[1-9]\d*)?(?:\.\d+)?[diouxXeEfFgGcrs]/g, // Python: %(name)s
  /\{\d+\}/g, // {0} (.NET, Java MessageFormat)
  /\{[A-Za-z_][\w.-]*\}/g, // {name}
  /(?<![\w:/])\:[A-Za-z_]\w*\b(?=[\s.,!?;)]|$)/g, // :name (Laravel, Rails), not "Note:this" or URLs
];

// ICU arguments with branches: {name, plural|select|selectordinal, branches}. Returns, at this level,
// [{ name, kind, branches: [{ key, body }], start, end, unbalanced? }].
export function icuArgs(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    const head = s.slice(i, i + 200).match(/^\{\s*([\w.-]+)\s*,\s*(plural|select|selectordinal)\s*,/);
    if (!head) continue;
    let depth = 0, j = i;
    for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') { depth--; if (depth === 0) break; } }
    if (depth !== 0) { out.push({ name: head[1], kind: head[2], branches: [], start: i, end: s.length, unbalanced: true }); break; }
    const body = s.slice(i + head[0].length, j);
    const branches = [];
    let d = 0, word = '', key = null, start = 0;
    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (c === '{') { if (d === 0) { key = word.trim().split(/\s+/).pop() || ''; start = k + 1; } d++; word = ''; }
      else if (c === '}') { d--; if (d === 0) branches.push({ key, body: body.slice(start, k) }); word = ''; }
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

function outsideIcu(s, args) {
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
const diffSet = (a, b) => { const A = new Set(a), B = new Set(b); return { missing: [...A].filter(x => !B.has(x)), extra: [...B].filter(x => !A.has(x)) }; };

export function placeholders(s) {
  const found = [];
  let rest = s;
  for (const re of PLACEHOLDER_RES) rest = rest.replace(re, m => { found.push(m.replace(/\s+/g, '')); return ' '.repeat(m.length); });
  return found;
}

// Placeholders anywhere inside an ICU argument's branches, nested ICU included.
function icuPlaceholders(arg) {
  const all = [];
  for (const b of arg.branches) {
    const inner = icuArgs(b.body);
    all.push(...placeholders(outsideIcu(b.body, inner)));
    for (const a of inner) all.push(`{${a.name}, ${a.kind}}`, ...icuPlaceholders(a));
  }
  return all;
}

function checkIcu(sa, ta, f, path = '') {
  for (const a of ta) if (a.unbalanced) f.push({ check: 'icu', sev: 'FAIL', detail: `unbalanced braces in the ICU message for argument`, values: [path + a.name] });
  const d = diffMultiset(sa.map(a => `${a.name}, ${a.kind}`), ta.map(a => `${a.name}, ${a.kind}`));
  if (d.missing.length) f.push({ check: 'icu', sev: 'FAIL', detail: 'ICU argument missing in the translation', values: d.missing.map(x => `{${path}${x}}`) });
  if (d.extra.length) f.push({ check: 'icu', sev: 'FAIL', detail: 'ICU argument not in the source', values: d.extra.map(x => `{${path}${x}}`) });
  for (const s of sa) {
    const t = ta.find(x => x.name === s.name && x.kind === s.kind);
    if (!t || t.unbalanced) continue;
    const sk = s.branches.map(b => b.key), tk = t.branches.map(b => b.key);
    const name = path + s.name;
    if (s.kind === 'select') {
      const bd = diffMultiset(sk, tk);
      if (bd.missing.length) f.push({ check: 'icu', sev: 'FAIL', detail: `select branch missing in the translation for argument ${name}`, values: bd.missing });
      if (bd.extra.length) f.push({ check: 'icu', sev: 'FAIL', detail: `select branch not in the source for argument ${name}`, values: bd.extra });
    } else {
      if (!tk.includes('other')) f.push({ check: 'icu', sev: 'FAIL', detail: `the plural for argument ${name} has no "other" branch, which ICU requires` });
      const odd = tk.filter(b => !PLURAL_CATS.has(b) && !/^=\d+$/.test(b));
      if (odd.length) f.push({ check: 'icu', sev: 'FAIL', detail: `unknown plural branch for argument ${name}`, values: odd });
      const exact = sk.filter(b => /^=\d+$/.test(b) && !tk.includes(b));
      if (exact.length) f.push({ check: 'icu', sev: 'WARN', detail: `exact-number branch in the source but not the translation, for argument ${name}`, values: exact });
      if (sk.join() !== tk.join()) f.push({ check: 'icu', sev: 'NOTE', detail: `plural branches for argument ${name} differ (languages differ; check the target language's categories)`, values: [sk.join(' '), tk.join(' ')] });
    }
    // Placeholders used in any branch, compared as sets: a language with more or fewer plural forms
    // repeats them a different number of times.
    const pd = diffSet(icuPlaceholders(s), icuPlaceholders(t));
    if (pd.missing.length) f.push({ check: 'placeholder', sev: 'FAIL', detail: `placeholder used in the source's branches for argument ${name} but in none of the translation's`, values: pd.missing });
    if (pd.extra.length) f.push({ check: 'placeholder', sev: 'FAIL', detail: `placeholder in the translation's branches for argument ${name} but not the source's`, values: pd.extra });
    // Nested ICU arguments: names and required branches, by branch key where both have it.
    for (const sb of s.branches) {
      const tb = t.branches.find(b => b.key === sb.key) || (s.kind !== 'select' ? t.branches.find(b => b.key === 'other') : null);
      if (tb) checkIcu(icuArgs(sb.body), icuArgs(tb.body), f, `${name}.${sb.key}.`);
    }
  }
}

function checkPlaceholders(src, tgt, f) {
  const sa = icuArgs(src), ta = icuArgs(tgt);
  checkIcu(sa, ta, f);
  const pd = diffMultiset(placeholders(outsideIcu(src, sa)), placeholders(outsideIcu(tgt, ta)));
  if (pd.missing.length) f.push({ check: 'placeholder', sev: 'FAIL', detail: 'placeholder missing in the translation', values: pd.missing });
  if (pd.extra.length) f.push({ check: 'placeholder', sev: 'FAIL', detail: 'placeholder not in the source', values: pd.extra });
}

// HTML and XML tags, including XLIFF inline tags. Attribute values are ignored except href/src.
export function tags(s) {
  return [...s.matchAll(/<\/?([A-Za-z][\w:-]*)([^<>]*?)(\/?)>/g)].map(m => `<${m[0].startsWith('</') ? '/' : ''}${m[1].toLowerCase()}${m[3] ? '/' : ''}>`);
}
const hrefs = s => [...s.matchAll(/\s(?:href|src)\s*=\s*("([^"]*)"|'([^']*)')/g)].map(m => m[2] ?? m[3]);

function checkTags(src, tgt, f) {
  const d = diffMultiset(tags(src), tags(tgt));
  if (d.missing.length) f.push({ check: 'tags', sev: 'FAIL', detail: 'tag missing in the translation', values: d.missing });
  if (d.extra.length) f.push({ check: 'tags', sev: 'FAIL', detail: 'tag not in the source', values: d.extra });
  const h = diffMultiset(hrefs(src), hrefs(tgt));
  if (h.missing.length) f.push({ check: 'links', sev: 'WARN', detail: 'link target changed or missing', values: h.missing });
}

// Markdown: link targets, inline code, emphasis markers. Inline code and emphasis are found with a
// linear scan, not a backtracking regex.
const mdLinks = s => [...s.matchAll(/\]\(\s*([^)\s\]]+)[^)\]]*\)/g)].map(m => m[1]);
export function inlineCode(s) {
  const spans = [], text = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '`') { text.push(s[i]); i++; continue; }
    let n = 0; while (s[i + n] === '`') n++;
    const fence = '`'.repeat(n);
    let j = s.indexOf(fence, i + n);
    while (j >= 0 && s[j + n] === '`') { let k = j; while (s[k] === '`') k++; j = s.indexOf(fence, k); }
    if (j < 0) { text.push(fence); i += n; continue; }
    spans.push(s.slice(i + n, j).replace(/^ (.*) $/, '$1'));
    text.push(' ');
    i = j + n;
  }
  return { spans, text: text.join('') };
}
const emphasis = s => (inlineCode(s).text.match(/\*\*|__|~~/g) || []).length;

function checkMarkdown(src, tgt, f) {
  const l = diffMultiset(mdLinks(src), mdLinks(tgt));
  if (l.missing.length) f.push({ check: 'links', sev: 'WARN', detail: 'link target missing or changed', values: l.missing });
  if (l.extra.length) f.push({ check: 'links', sev: 'WARN', detail: 'link target not in the source', values: l.extra });
  const c = diffMultiset(inlineCode(src).spans, inlineCode(tgt).spans);
  if (c.missing.length) f.push({ check: 'code', sev: 'WARN', detail: 'inline code changed or missing', values: c.missing, tail: '(code is usually left untranslated)' });
  const se = emphasis(src), te = emphasis(tgt);
  if (se !== te) f.push({ check: 'formatting', sev: te % 2 ? 'FAIL' : 'WARN', detail: `bold/strikethrough markers: ${se} in the source, ${te} in the translation${te % 2 ? ' (an odd number, so one is unclosed)' : ''}` });
}

// Numbers, compared after removing digit-group separators. Ordinals and spelled-out numbers aren't caught.
// Group separators: space, no-break space (U+00A0), narrow no-break space (U+202F), apostrophe.
const SEP = ` ${cp(0xa0)}${cp(0x202f)}'`;
// Either grouped thousands (1,000 / 1.000 / 1 000, with optional decimals) or a plain number, so
// "in 2024, 15 people" gives 2024 and 15.
const NUM_RE = new RegExp(`\\d{1,3}(?:[${SEP}.,]\\d{3})+(?:[.,]\\d+)?(?!\\d)|\\d+(?:[.,]\\d+)?`, 'g');
const SEP_RE = new RegExp(`[${SEP}]`, 'g');
export const numbers = s => (s.replace(/<[^<>]*>/g, ' ').replace(/\]\([^)\]]*\)/g, ']').replace(/\]\[[^\]]*\]/g, ']').replace(/https?:\/\/\S+/g, ' ').replace(/\{[^{}]*\}|%\d+\$/g, ' ')
  .match(NUM_RE) || []).map(n => n.trim().replace(SEP_RE, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
const urls = s => (s.match(/https?:\/\/[^\s<>"')\]]+/g) || []).map(u => u.replace(/[.,;:!?]+$/, ''));
const emails = s => s.match(/(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [];

const END_PUNCT = /([.!?:;…。！？：；])\s*$/;
const PUNCT_CLASS = { '.': '.', '。': '.', '!': '!', '！': '!', '?': '?', '？': '?', ':': ':', '：': ':', ';': ';', '；': ';', '…': '…' };
// Strings longer than this get only the structural checks (missing, empty, placeholders, tags), so
// one huge string can't make the run take minutes.
export const MAX_CHECKED = 20000;

export function checkPair(src, tgt, opts = {}) {
  const f = [];
  const s = String(src ?? ''), t = tgt == null ? null : String(tgt);
  if (t == null) { f.push({ check: 'missing', sev: 'FAIL', detail: 'no translation for this source' }); return f; }
  if (!t.trim() && s.trim()) { f.push({ check: 'empty', sev: 'FAIL', detail: 'the translation is empty' }); return f; }
  if (!s.trim()) return f;
  const letters = s.replace(/<[^<>]*>|\{[^{}]*\}|%\S+|https?:\/\/\S+/g, '').match(/\p{L}/gu) || [];
  if (t === s && letters.length >= 4 && !opts.sameLanguage) f.push({ check: 'untranslated', sev: 'WARN', detail: 'the translation is identical to the source (fine for names and brands)' });
  checkPlaceholders(s, t, f);
  checkTags(s, t, f);
  if (s.length > MAX_CHECKED || t.length > MAX_CHECKED) { f.push({ check: 'size', sev: 'NOTE', detail: `longer than ${MAX_CHECKED} characters, so only the placeholder and tag checks ran` }); return f; }
  if (opts.markdown) checkMarkdown(s, t, f);
  const n = diffMultiset(numbers(s), numbers(t));
  if (n.missing.length) f.push({ check: 'numbers', sev: 'WARN', detail: 'number in the source not found in the translation', values: n.missing });
  if (n.extra.length) f.push({ check: 'numbers', sev: 'WARN', detail: 'number in the translation not in the source', values: n.extra });
  // URLs already reported as link targets aren't reported twice.
  const reported = new Set([...hrefs(s), ...mdLinks(s)]);
  const u = diffMultiset(urls(s), urls(t));
  const missingUrls = u.missing.filter(x => !reported.has(x));
  if (missingUrls.length) f.push({ check: 'links', sev: 'WARN', detail: 'URL missing or changed', values: missingUrls });
  const e = diffMultiset(emails(s), emails(t));
  if (e.missing.length) f.push({ check: 'links', sev: 'WARN', detail: 'email address missing or changed', values: e.missing });
  const sl = (s.match(/\n/g) || []).length, tl = (t.match(/\n/g) || []).length;
  if (sl !== tl && !opts.markdown) f.push({ check: 'line breaks', sev: 'WARN', detail: `${sl} line break(s) in the source, ${tl} in the translation` });
  const lead = x => x.length - x.trimStart().length, trail = x => x.length - x.trimEnd().length;
  if (lead(s) !== lead(t) || trail(s) !== trail(t)) f.push({ check: 'whitespace', sev: 'NOTE', detail: 'leading or trailing spaces differ from the source' });
  const sp = s.trimEnd().match(END_PUNCT), tp = t.trimEnd().match(END_PUNCT);
  if (sp && !tp) f.push({ check: 'punctuation', sev: 'NOTE', detail: 'the source ends with punctuation and the translation doesn\'t', values: [sp[1]] });
  else if (sp && tp && PUNCT_CLASS[sp[1]] !== PUNCT_CLASS[tp[1]] && !(PUNCT_CLASS[sp[1]] === '.' && tp[1] === '…')) f.push({ check: 'punctuation', sev: 'NOTE', detail: 'the translation ends with different punctuation (source, then translation)', values: [sp[1], tp[1]] });
  const sc = Array.from(s).length, tc = Array.from(t).length;
  if (sc >= 20 && (tc / sc > 3 || tc / sc < 0.33) && !opts.cjk) f.push({ check: 'length', sev: 'WARN', detail: `the translation is ${tc} characters for a ${sc}-character source; something may be missing or added` });
  return f;
}

// A glossary is lines of "source term = required translation" (# for comments). It checks each
// pair whose source has the term (whole word, any case) for the translation (any case).
export function parseGlossary(text) {
  const out = [];
  String(text).replace(/\r\n/g, '\n').split('\n').forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith('#')) return;
    const k = l.indexOf('=');
    if (k < 1) throw new Error(`glossary line ${i + 1} needs "term = translation"`);
    out.push({ term: l.slice(0, k).trim(), translation: l.slice(k + 1).trim() });
  });
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function checkGlossary(src, tgt, glossary) {
  const f = [];
  for (const g of glossary) {
    if (!new RegExp(`(^|[^\\p{L}\\p{N}])${esc(g.term)}($|[^\\p{L}\\p{N}])`, 'iu').test(src)) continue;
    if (g.translation === '' || !tgt.toLowerCase().includes(g.translation.toLowerCase())) f.push({ check: 'glossary', sev: 'WARN', detail: 'glossary term not translated as required (term, then required translation)', values: [g.term, g.translation] });
  }
  return f;
}
