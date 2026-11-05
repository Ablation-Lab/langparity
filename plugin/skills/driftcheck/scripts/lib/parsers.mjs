// Parsers for translation files. Each returns { units: [{ key, source?, target?, text?, meta }], format }.
// Key-value formats give one text per key (paired later by key); .po and XLIFF hold source and
// target together. Documents (Markdown, text) give ordered blocks instead.
// Nothing here runs code from the files or follows links: it only reads text.

const BS = String.fromCharCode(92); // a backslash, kept out of the source as an escape sequence
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff)); // a byte-order mark at the start

export function detectFormat(name, text) {
  const n = name.toLowerCase();
  if (/\.(json|arb)$/.test(n)) return 'json';
  if (/\.(po|pot)$/.test(n)) return 'po';
  if (/\.properties$/.test(n)) return 'properties';
  if (/\.strings$/.test(n)) return 'strings';
  if (/\.(xlf|xliff)$/.test(n)) return 'xliff';
  if (/\.xml$/.test(n) && /<resources[\s>]/.test(text)) return 'android';
  if (/\.(md|markdown|mdx)$/.test(n)) return 'markdown';
  if (/\.txt$/.test(n)) return 'text';
  return null;
}

// ---- JSON and ARB: nested objects become dotted keys; ARB "@" metadata is skipped.
export function parseJson(text) {
  let data;
  try { data = JSON.parse(text.replace(BOM_RE, '')); } catch (e) { throw new Error(`not valid JSON: ${e.message}`); }
  const units = [];
  const walk = (v, key) => {
    if (typeof v === 'string') units.push({ key, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, key ? `${key}[${i}]` : `[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k.startsWith('@')) continue; walk(x, key ? `${key}.${k}` : k); }
    else if (v != null) units.push({ key, text: String(v), meta: { nonString: true } });
  };
  walk(data, '');
  return units;
}

// ---- gettext .po: msgctxt, msgid, msgid_plural, msgstr and msgstr[n]; "#, fuzzy" flags.
function poString(lines) {
  return lines.map(l => {
    const m = l.match(/^"(.*)"\s*$/);
    return m ? unescapeC(m[1]) : '';
  }).join('');
}
export function parsePo(text) {
  const units = [];
  let cur = null, field = null, buf = [], flags = '', nplurals = null;
  const flush = () => { if (field && cur) cur[field] = poString(buf); field = null; buf = []; };
  const hasMsgstr = () => !!cur && (Object.keys(cur).some(k => k.startsWith('msgstr')) || String(field).startsWith('msgstr'));
  const end = () => {
    flush();
    if (cur && cur.msgid === '' && typeof cur.msgstr === 'string') { const m = cur.msgstr.match(/nplurals\s*=\s*(\d+)/); if (m) nplurals = Number(m[1]); }
    if (cur && cur.msgid !== undefined && cur.msgid !== '') {
      const ctx = cur.msgctxt ? `${cur.msgctxt}|` : '';
      if (cur.msgid_plural !== undefined) {
        const forms = Object.keys(cur).filter(k => /^msgstr\[\d+\]$/.test(k)).sort((a, b) => Number(a.slice(7, -1)) - Number(b.slice(7, -1)));
        // With one plural form (Japanese, Chinese...) form 0 translates the plural message.
        forms.forEach((k, i) => units.push({ key: `${ctx}${cur.msgid}[${i}]`, source: i === 0 && nplurals !== 1 ? cur.msgid : cur.msgid_plural, target: cur[k], meta: { fuzzy: cur.fuzzy, plural: true, form: i, nplurals, sourceForms: [cur.msgid, cur.msgid_plural] } }));
        if (!forms.length) units.push({ key: `${ctx}${cur.msgid}`, source: cur.msgid, target: '', meta: { fuzzy: cur.fuzzy } });
      } else units.push({ key: `${ctx}${cur.msgid}`, source: cur.msgid, target: cur.msgstr ?? '', meta: { fuzzy: cur.fuzzy } });
    }
    cur = null;
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { end(); flags = ''; continue; }
    // A comment after a finished entry starts the next one, even without a blank line between.
    if (line.startsWith('#') && hasMsgstr()) { end(); flags = ''; }
    if (line.startsWith('#,')) { flags += line; continue; }
    if (line.startsWith('#')) continue;
    const m = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")\s*$/);
    if (m) {
      if ((m[1] === 'msgctxt' || m[1] === 'msgid') && hasMsgstr()) { end(); }
      if (!cur) { cur = { fuzzy: /\bfuzzy\b/.test(flags) }; flags = ''; }
      flush(); field = m[1]; buf = [m[2]];
    } else if (line.startsWith('"')) buf.push(line);
  }
  end();
  return units;
}

// C-style escapes used by .po and .strings.
export function unescapeC(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== BS || i === s.length - 1) { out += c; continue; }
    const n = s[++i];
    out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n === '"' ? '"' : n === BS ? BS : n === "'" ? "'" : BS + n;
  }
  return out;
}

// ---- Java .properties: key=value or key: value or key value; trailing-backslash continuations; escapes.
export function parseProperties(text) {
  const units = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    while (/\\$/.test(line) && !/\\\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].replace(/^\s+/, '');
    let k = 0, key = '';
    for (; k < line.length; k++) {
      const c = line[k];
      if (c === BS) { key += line[k + 1] ?? ''; k++; continue; }
      if (c === '=' || c === ':' || /\s/.test(c)) break;
      key += c;
    }
    let rest = line.slice(k).replace(/^\s*[=:]?\s*/, '');
    units.push({ key, text: unescapeProps(rest) });
  }
  return units;
}
const UESC = new RegExp(BS + BS + 'u([0-9a-fA-F]{4})', 'g');
function unescapeProps(s) {
  return unescapeC(s.replace(UESC, (m, h) => String.fromCharCode(parseInt(h, 16))));
}

// ---- Apple .strings: "key" = "value"; with /* */ and // comments.
export function parseStrings(text) {
  const units = [];
  const src = text.replace(BOM_RE, '');
  let i = 0;
  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      if (src.startsWith('//', i)) { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e + 1; continue; }
      return;
    }
  };
  const str = () => {
    if (src[i] !== '"') {
      const m = src.slice(i).match(/^[A-Za-z0-9_.$-]+/);
      if (!m) throw new Error(`.strings: expected a quoted string near character ${i}`);
      i += m[0].length; return m[0];
    }
    let j = i + 1, raw = '';
    while (j < src.length && src[j] !== '"') { if (src[j] === BS) { raw += src[j] + (src[j + 1] ?? ''); j += 2; } else raw += src[j++]; }
    i = j + 1;
    return unescapeC(raw);
  };
  for (;;) {
    skip(); if (i >= src.length) break;
    const key = str(); skip();
    if (src[i] !== '=') { if (src[i] === ';') { i++; units.push({ key, text: key }); continue; } throw new Error(`.strings: expected "=" after "${key.slice(0, 40)}"`); }
    i++; skip();
    const value = str(); skip();
    if (src[i] === ';') i++;
    units.push({ key, text: value });
  }
  return units;
}

// ---- XML helpers (no DTDs or external entities are read; only the five standard entities and numeric ones).
const fromCode = n => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null);
export function decodeEntities(s, cdata = true) {
  // CDATA content is taken as it is; entities are decoded only outside it.
  const parts = cdata ? s.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/) : [s];
  return parts.map(p => (p.startsWith('<![CDATA[') ? p.slice(9, -3)
    : p.replace(/&(lt|gt|amp|quot|apos|#\d{1,8}|#x[0-9a-fA-F]{1,8});/g, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e] ?? (fromCode(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) ?? m)))).join('');
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`)); return m ? decodeEntities(m[2] ?? m[3], false) : null; };
// Removes <!-- comments --> with a linear scan.
function stripComments(s) {
  let out = '', i = 0;
  for (;;) {
    const a = s.indexOf('<!--', i);
    if (a < 0) return out + s.slice(i);
    out += s.slice(i, a);
    const b = s.indexOf('-->', a + 4);
    if (b < 0) return out;
    i = b + 3;
  }
}
// The text between <tag ...> and </tag> for every element named tag, found with indexOf.
function elements(s, tag) {
  const out = [];
  const open = new RegExp(`<${tag}(?=[\\s>/])`, 'g');
  let m;
  while ((m = open.exec(s))) {
    const gt = s.indexOf('>', m.index);
    if (gt < 0) break;
    const attrs = s.slice(m.index + tag.length + 1, gt);
    if (attrs.endsWith('/')) { out.push({ attrs: attrs.slice(0, -1), inner: null }); open.lastIndex = gt + 1; continue; }
    const close = s.indexOf(`</${tag}>`, gt + 1);
    if (close < 0) break;
    out.push({ attrs, inner: s.slice(gt + 1, close) });
    open.lastIndex = close + tag.length + 3;
  }
  return out;
}

// ---- Android strings.xml: <string>, <plurals><item quantity>, <string-array><item>.
const UESC_A = new RegExp(BS + BS + 'u([0-9a-fA-F]{4})', 'g');
function androidText(inner) {
  let t = inner.trim();
  const quoted = /^"[\s\S]*"$/.test(t);
  if (quoted) t = t.slice(1, -1);
  // Android collapses runs of whitespace outside double quotes.
  else t = t.replace(/\s+/g, ' ');
  t = t.replace(UESC_A, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(new RegExp(BS + BS + "(['\"@?])", 'g'), '$1')
    .replace(new RegExp(BS + BS + 'n', 'g'), '\n').replace(new RegExp(BS + BS + 't', 'g'), '\t');
  return decodeEntities(t);
}
export function parseAndroid(text) {
  const units = [];
  const body = stripComments(text);
  const skip = a => attr(a, 'translatable') === 'false';
  for (const e of elements(body, 'string')) {
    const name = attr(e.attrs, 'name'); if (name == null || skip(e.attrs)) continue;
    units.push({ key: name, text: e.inner == null ? '' : androidText(e.inner) });
  }
  for (const e of elements(body, 'plurals')) {
    if (e.inner == null || skip(e.attrs)) continue;
    const name = attr(e.attrs, 'name');
    for (const it of elements(e.inner, 'item')) units.push({ key: `${name}#${attr(it.attrs, 'quantity')}`, text: it.inner == null ? '' : androidText(it.inner), meta: { plural: true } });
  }
  for (const e of elements(body, 'string-array')) {
    if (e.inner == null || skip(e.attrs)) continue;
    const name = attr(e.attrs, 'name'); let k = 0;
    for (const it of elements(e.inner, 'item')) units.push({ key: `${name}[${k++}]`, text: it.inner == null ? '' : androidText(it.inner) });
  }
  return units;
}

// ---- XLIFF 1.2 (<trans-unit>) and 2.0 (<unit><segment>). Inline tags are kept as text so they can be compared.
export function parseXliff(text) {
  const units = [];
  const body = stripComments(text);
  // Translation-memory suggestions (<alt-trans>) aren't the translation.
  const own = block => elements(block, 'alt-trans').reduce((b, e) => b.replace(`<alt-trans${e.attrs}>${e.inner}</alt-trans>`, ''), block);
  const first = (block, tag) => { const e = elements(block, tag)[0]; return e ? { attrs: e.attrs, text: e.inner == null ? '' : decodeEntities(e.inner) } : null; };
  const files = elements(body, 'file');
  const scopes = files.length > 1 ? files.map((f, i) => ({ prefix: `${attr(f.attrs, 'original') ?? attr(f.attrs, 'id') ?? `file ${i + 1}`}|`, text: f.inner || '' })) : [{ prefix: '', text: body }];
  for (const sc of scopes) {
    for (const u of elements(sc.text, 'trans-unit')) {
      if (u.inner == null || attr(u.attrs, 'translate') === 'no') continue;
      const id = attr(u.attrs, 'id') ?? attr(u.attrs, 'resname');
      const block = own(u.inner);
      const s = first(block, 'source'), t = first(block, 'target');
      units.push({ key: sc.prefix + id, source: s ? s.text : '', target: t && t.text !== '' ? t.text : undefined, meta: { state: t ? attr(t.attrs, 'state') : null } });
    }
    for (const u of elements(sc.text, 'unit')) {
      if (u.inner == null || attr(u.attrs, 'translate') === 'no') continue;
      const id = attr(u.attrs, 'id');
      const segs = elements(u.inner, 'segment');
      segs.forEach((sg, k) => {
        const block = sg.inner || '';
        const s = first(block, 'source'), t = first(block, 'target');
        units.push({ key: sc.prefix + (segs.length > 1 ? `${id}#${attr(sg.attrs, 'id') ?? k + 1}` : id), source: s ? s.text : '', target: t && t.text !== '' ? t.text : undefined, meta: { state: attr(sg.attrs, 'state') } });
      });
    }
  }
  return units;
}

// ---- Documents: blocks in order (heading, paragraph, list item, code, table row, quote, rule).
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const startsBlock = l => /^\s*(`{3,}|~{3,})/.test(l) || /^#{1,6}\s/.test(l) || LIST.test(l) || /^\s*\|.*\|\s*$/.test(l) || /^\s*>/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
export function parseDocument(text, markdown = true) {
  const lines = text.replace(BOM_RE, '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [], start = 0;
  const flushPara = () => { if (para.length) blocks.push({ type: 'paragraph', text: para.join('\n'), line: start + 1 }); para = []; };
  const last = () => blocks[blocks.length - 1];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!markdown) {
      if (!l.trim()) { flushPara(); continue; }
      if (!para.length) start = i; para.push(l); continue;
    }
    const fence = l.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flushPara();
      const mark = fence[1], body = [];
      let j = i + 1;
      // A closing fence is the same character, at least as long, with nothing after it.
      while (j < lines.length && !(lines[j].trim().startsWith(mark) && /^[`~]+$/.test(lines[j].trim()) && lines[j].trim()[0] === mark[0])) body.push(lines[j++]);
      blocks.push({ type: 'code', text: body.join('\n'), info: fence[2].trim(), line: i + 1 });
      i = j; continue;
    }
    if (!l.trim()) { flushPara(); continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); blocks.push({ type: `h${m[1].length}`, text: m[2].replace(/[ \t]+#+[ \t]*$/, ''), line: i + 1 }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flushPara(); blocks.push({ type: 'rule', text: '', line: i + 1 }); continue; }
    if ((m = l.match(LIST))) { flushPara(); blocks.push({ type: /\d/.test(m[2]) ? 'ordered item' : 'list item', text: m[3], depth: m[1].length, line: i + 1 }); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flushPara();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; // the separator row
      blocks.push({ type: 'table row', text: l.trim(), line: i + 1 }); continue;
    }
    if ((m = l.match(/^\s*>\s?(.*)$/))) {
      flushPara();
      // Consecutive quote lines are one quote.
      if (last()?.type === 'quote' && last().endLine === i) { last().text += '\n' + m[1]; last().endLine = i + 1; }
      else blocks.push({ type: 'quote', text: m[1], line: i + 1, endLine: i + 1 });
      continue;
    }
    // A line straight after a list item (no blank line) that starts no new block continues the item.
    if (!para.length && last() && (last().type === 'list item' || last().type === 'ordered item') && (last().endLine ?? last().line) === i && !startsBlock(l)) {
      last().text += '\n' + l.trim(); last().endLine = i + 1; continue;
    }
    if (!para.length) start = i;
    para.push(l);
  }
  flushPara();
  for (const b of blocks) delete b.endLine;
  return blocks;
}
