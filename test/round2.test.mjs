// Regression tests for Driftcheck recheck 1 (council round 2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, parseArgs, alignBlocks } from '../plugin/skills/driftcheck/scripts/driftcheck.mjs';
import { parseDocument } from '../plugin/skills/driftcheck/scripts/lib/parsers.mjs';
import { checkPair } from '../plugin/skills/driftcheck/scripts/lib/checks.mjs';

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'driftcheck-r2-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
const go = (d, files, extra = []) => run({ ...parseArgs([...files, ...extra]), out: path.join(d, 'o' + Math.random().toString(36).slice(2)) });
const pairsOf = r => fs.readFileSync(r.pairsFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

test('N1: a complete translation pairs in order, with no false missing blocks, even with very different lengths', () => {
  const en = Array.from({ length: 14 }, (_, i) => `- Menu item number ${i + 1} with a fairly long English description`).join('\n') + '\n';
  const ja = Array.from({ length: 14 }, (_, i) => `- 項目${i % 3 ? '' : 'の長い説明文がここにあります'}`).join('\n') + '\n';
  const out = alignBlocks(parseDocument(en), parseDocument(ja));
  assert.equal(out.length, 14);
  assert.ok(out.every(([s, t, info]) => s && t && !info.uncertain));
  const txt = alignBlocks(parseDocument('A.\n\nB.\n\nC.\n', false), parseDocument('Aaaaaaaaaaaaaaaaa.\n\nB.\n\nCccccccccccccccc.\n', false));
  assert.deepEqual(txt.map(([s, t]) => [s.text, t.text]), [['A.', 'Aaaaaaaaaaaaaaaaa.'], ['B.', 'B.'], ['C.', 'Cccccccccccccccc.']]);
});

test('N2: sections next to an added or removed section are flagged uncertain', () => {
  const a = parseDocument('# A\n\npara a\n\n# B\n\npara b\n\n# C\n\npara c\n');
  const b = parseDocument('# A2\n\nabsatz a\n\n# C2\n\nabsatz c\n');
  const out = alignBlocks(a, b);
  assert.ok(out.filter(([s]) => s && /para b|^B$/.test(s.text)).every(([, , i]) => i.uncertain));
  assert.ok(out.some(([, , i]) => i.uncertain));
});

test('N3: nested ICU branch keys from the file stay in values, not in the detail', () => {
  const evil = '![p](https://evil.example/pixel.png)**x**';
  const src = `{g, select, ${evil} {{n, plural, one {# a} other {# b}}} other {c}}`;
  const tgt = `{g, select, ${evil} {{n, plural, one {# a}}} other {c}}`;
  const f = checkPair(src, tgt);
  assert.ok(f.length);
  for (const x of f) assert.ok(!x.detail.includes('evil.example'), x.detail);
  assert.ok(f.some(x => (x.values || []).some(v => String(v).includes('evil.example'))));
});

test('N4: JSON _one keys are plurals only with a matching _other; a missing _other stays a FAIL', () => {
  const d = tmp();
  const r = go(d, [write(d, 'en.json', '{"items_one":"One item","items_other":"{{count}} items","option_one":"Use {{name}}"}'), write(d, 'fr.json', '{"items_one":"{{count}} article","option_one":"Utiliser"}')]);
  const ps = pairsOf(r);
  const other = ps.find(p => p.key === 'items_other');
  assert.equal(other.target, null);
  assert.ok(other.findings.some(f => f.sev === 'FAIL' && f.check === 'missing'));
  assert.ok(ps.find(p => p.key === 'option_one').findings.some(f => f.check === 'placeholder' && f.sev === 'FAIL'), 'not a plural, so a dropped placeholder is a FAIL');
});

test('N5/N6: ordinary en to ja ICU translations get no false FAILs; a nested miss counts once', () => {
  assert.deepEqual(checkPair('{count, plural, one {# item} other {{count} items}}', '{count, plural, other {#個}}').filter(f => f.sev === 'FAIL'), []);
  assert.deepEqual(checkPair('{g, select, male {{n, plural, one {# x} other {# y}}} other {z}}', '{g, select, male {{n, plural, other {# y}}} other {z}}').filter(f => f.sev === 'FAIL'), []);
  assert.deepEqual(checkPair('On {d, date, medium}', 'Le {d, date, long}').filter(f => f.sev === 'FAIL'), []);
  const nested = checkPair('{g, select, male {{n, plural, one {{who} x} other {{who} y}}} other {z}}', '{g, select, male {{n, plural, one {x} other {y}}} other {z}}');
  assert.equal(nested.filter(f => f.check === 'placeholder').length, 1);
});
