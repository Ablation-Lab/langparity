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
  let cur = null, field = null, buf = [], flags = '';
  const flush = () => { if (field && cur) cur[field] = poString(buf); field = null; buf = []; };
  const end = () => {
    flush();
    if (cur && cur.msgid !== undefined && cur.msgid !== '') {
      const ctx = cur.msgctxt ? `${cur.msgctxt}|` : '';
      if (cur.msgid_plural !== undefined) {
        const forms = Object.keys(cur).filter(k => /^msgstr\[\d+\]$/.test(k)).sort();
        forms.forEach((k, i) => units.push({ key: `${ctx}${cur.msgid}[${i}]`, source: i === 0 ? cur.msgid : cur.msgid_plural, target: cur[k], meta: { fuzzy: cur.fuzzy, plural: true } }));
        if (!forms.length) units.push({ key: `${ctx}${cur.msgid}`, source: cur.msgid, target: '', meta: { fuzzy: cur.fuzzy } });
      } else units.push({ key: `${ctx}${cur.msgid}`, source: cur.msgid, target: cur.msgstr ?? '', meta: { fuzzy: cur.fuzzy } });
    }
    cur = null; flags = '';
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { end(); continue; }
    if (line.startsWith('#,')) { flags += line; continue; }
    if (line.startsWith('#')) continue;
    const m = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")\s*$/);
    if (m) {
      if (m[1] === 'msgctxt' || (m[1] === 'msgid' && cur && cur.msgid !== undefined)) end();
      if (!cur) cur = { fuzzy: /\bfuzzy\b/.test(flags) };
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
export function decodeEntities(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, c) => c)
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e] ?? (e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10))));
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`)); return m ? decodeEntities(m[2] ?? m[3]) : null; };

// ---- Android strings.xml: <string>, <plurals><item quantity>, <string-array><item>.
function androidText(inner) {
  let t = inner.trim().replace(/^"([\s\S]*)"$/, '$1');
  t = t.replace(new RegExp(BS + BS + "(['\"@?])", 'g'), '$1').replace(new RegExp(BS + BS + 'n', 'g'), '\n');
  return decodeEntities(t);
}
export function parseAndroid(text) {
  const units = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(/<string(\s[^>]*)?>([\s\S]*?)<\/string>/g)) {
    const name = attr(m[1] || '', 'name'); if (name == null) continue;
    if (attr(m[1] || '', 'translatable') === 'false') continue;
    units.push({ key: name, text: androidText(m[2]) });
  }
  for (const m of body.matchAll(/<plurals(\s[^>]*)>([\s\S]*?)<\/plurals>/g)) {
    const name = attr(m[1], 'name');
    for (const it of m[2].matchAll(/<item(\s[^>]*)>([\s\S]*?)<\/item>/g)) units.push({ key: `${name}#${attr(it[1], 'quantity')}`, text: androidText(it[2]), meta: { plural: true } });
  }
  for (const m of body.matchAll(/<string-array(\s[^>]*)>([\s\S]*?)<\/string-array>/g)) {
    const name = attr(m[1], 'name'); let k = 0;
    for (const it of m[2].matchAll(/<item(\s[^>]*)?>([\s\S]*?)<\/item>/g)) units.push({ key: `${name}[${k++}]`, text: androidText(it[2]) });
  }
  return units;
}

// ---- XLIFF 1.2 (<trans-unit>) and 2.0 (<unit><segment>). Inline tags are kept as text so they can be compared.
export function parseXliff(text) {
  const units = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  const inner = (block, tag) => { const m = block.match(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`)); return m ? { attrs: m[1] || '', text: decodeEntities(m[2]) } : null; };
  for (const m of body.matchAll(/<trans-unit(\s[^>]*)>([\s\S]*?)<\/trans-unit>/g)) {
    const id = attr(m[1], 'id') ?? attr(m[1], 'resname');
    const s = inner(m[2], 'source'), t = inner(m[2], 'target');
    units.push({ key: id, source: s ? s.text : '', target: t ? t.text : undefined, meta: { state: t ? attr(t.attrs, 'state') : null } });
  }
  for (const m of body.matchAll(/<unit(\s[^>]*)>([\s\S]*?)<\/unit>/g)) {
    const id = attr(m[1], 'id');
    const segs = [...m[2].matchAll(/<segment(\s[^>]*)?>([\s\S]*?)<\/segment>/g)];
    segs.forEach((sg, k) => {
      const s = inner(sg[2], 'source'), t = inner(sg[2], 'target');
      units.push({ key: segs.length > 1 ? `${id}#${attr(sg[1] || '', 'id') ?? k + 1}` : id, source: s ? s.text : '', target: t ? t.text : undefined, meta: { state: attr(sg[1] || '', 'state') } });
    });
  }
  return units;
}

// ---- Documents: blocks in order (heading, paragraph, list item, code, table row, quote, rule).
export function parseDocument(text, markdown = true) {
  const lines = text.replace(BOM_RE, '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [], start = 0;
  const flushPara = () => { if (para.length) blocks.push({ type: 'paragraph', text: para.join('\n'), line: start + 1 }); para = []; };
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
      while (j < lines.length && !lines[j].trim().startsWith(mark)) body.push(lines[j++]);
      blocks.push({ type: 'code', text: body.join('\n'), info: fence[2].trim(), line: i + 1 });
      i = j; continue;
    }
    if (!l.trim()) { flushPara(); continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); blocks.push({ type: `h${m[1].length}`, text: m[2].replace(/\s+#+\s*$/, ''), line: i + 1 }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flushPara(); blocks.push({ type: 'rule', text: '', line: i + 1 }); continue; }
    if ((m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) { flushPara(); blocks.push({ type: /\d/.test(m[2]) ? 'ordered item' : 'list item', text: m[3], depth: m[1].length, line: i + 1 }); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flushPara();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; // the separator row
      blocks.push({ type: 'table row', text: l.trim(), line: i + 1 }); continue;
    }
    if ((m = l.match(/^\s*>\s?(.*)$/))) { flushPara(); blocks.push({ type: 'quote', text: m[1], line: i + 1 }); continue; }
    if (!para.length) start = i;
    para.push(l);
  }
  flushPara();
  return blocks;
}
