const test = require('node:test');
const assert = require('node:assert/strict');
const Morse = require('../js/morse.js');
const Trainer = require('../js/trainer.js');

test('table is round-trippable and Koch order has 40 unique characters', () => {
  assert.equal(Morse.KOCH_ORDER.length, 40);
  assert.equal(new Set(Morse.KOCH_ORDER).size, 40);
  Morse.KOCH_ORDER.forEach((c) => assert.ok(Morse.TABLE[c], c));
  Object.keys(Morse.TABLE).forEach((c) => assert.equal(Morse.decode(Morse.TABLE[c]), c));
});

test('Farnsworth timing matches the worked example (c=20, s=10)', () => {
  const t = Morse.timing(20, 10);
  assert.ok(Math.abs(t.dit - 0.06) < 1e-9);
  assert.ok(Math.abs(t.ta - 0.21789) < 1e-4);
  assert.ok(Math.abs(t.charGap - 0.6537) < 1e-3);
  assert.ok(Math.abs(t.wordGap - 1.5253) < 1e-3);
});

test('when effective speed reaches character speed, timing is standard Morse', () => {
  const t = Morse.timing(20, 20);
  assert.ok(Math.abs(t.charGap - 3 * t.unit) < 1e-9);
  assert.ok(Math.abs(t.wordGap - 7 * t.unit) < 1e-9);
  const over = Morse.timing(20, 35);
  assert.deepEqual(over, t);
});

test('a PARIS word at effective speed s takes 60/s seconds', () => {
  const c = 20, s = 10, t = Morse.timing(c, s);
  const chars = 'PARIS'.split('');
  let total = 0;
  chars.forEach((ch) => { total += Morse.segments(ch, t).duration; });
  total += 4 * t.charGap + t.wordGap;
  assert.ok(Math.abs(total - 60 / s) < 1e-6, total);
});

test('segments are ordered with 1-unit gaps', () => {
  const t = Morse.timing(20, 20);
  const { segments, duration } = Morse.segments('K', t); // dah dit dah
  assert.equal(segments.length, 3);
  assert.ok(Math.abs(segments[1].start - (t.dah + t.gap)) < 1e-9);
  assert.ok(Math.abs(duration - (2 * t.dah + t.dit + 2 * t.gap)) < 1e-9);
  assert.equal(Morse.segments('#', t).segments.length, 0);
});

test('keying classification splits at 2 units', () => {
  assert.equal(Morse.classify(0.1, 0.12), '.');
  assert.equal(Morse.classify(0.2, 0.12), '.');
  assert.equal(Morse.classify(0.25, 0.12), '-');
});

function fresh() { return Trainer.defaults(); }
function feed(st, n, okFn, ch) { let last = null; for (let i = 0; i < n; i++) last = Trainer.record(st, 'listen', ch || 'K', okFn(i)); return last; }

test('starts with K and M only', () => {
  assert.deepEqual(Trainer.unlocked(fresh()), ['K', 'M']);
});

test('90% over a block unlocks the next character and raises effective speed', () => {
  const st = fresh();
  const r = feed(st, 50, (i) => i % 10 !== 0); // 45/50 = 90%
  assert.equal(r.event, 'advance');
  assert.equal(r.newChar, 'U');
  assert.equal(st.level, 3);
  assert.equal(st.settings.effWpm, 11);
  assert.equal(st.block.length, 0);
});

test('effective speed does not rise when auto is off or already at character speed', () => {
  const a = fresh(); a.settings.auto = false;
  feed(a, 50, () => true);
  assert.equal(a.settings.effWpm, 10);
  const b = fresh(); b.settings.effWpm = 20;
  feed(b, 50, () => true);
  assert.equal(b.settings.effWpm, 20);
});

test('below 70% steps back, but never below two characters', () => {
  const st = fresh(); st.level = 5; st.introduced = 5;
  let r = feed(st, 50, (i) => i % 2 === 0);
  assert.equal(r.event, 'regress');
  assert.equal(st.level, 4);
  const low = fresh();
  r = feed(low, 50, () => false);
  assert.equal(low.level, 2);
  assert.equal(r.event, 'stay');
});

test('between 70% and 90% stays; level stops at 40', () => {
  const st = fresh();
  assert.equal(feed(st, 50, (i) => i % 5 !== 0 && i % 10 !== 1).event, 'stay'); // 40/50 = 80%
  const top = fresh(); top.level = 40;
  feed(top, 50, () => true);
  assert.equal(top.level, 40);
});

test('send trials never move the level or block', () => {
  const st = fresh();
  for (let i = 0; i < 80; i++) assert.equal(Trainer.record(st, 'send', 'K', true), null);
  assert.equal(st.level, 2);
  assert.equal(st.block.length, 0);
  assert.equal(st.recent.send.length, 50);
});

test('pick only returns unlocked characters, avoids repeats, and favours misses', () => {
  const st = fresh();
  for (let i = 0; i < 200; i++) assert.ok(['K', 'M'].includes(Trainer.pick(st, 'listen', Math.random, null)));
  assert.equal(Trainer.pick(st, 'listen', Math.random, 'K'), 'M');
  st.level = 3;
  for (let i = 0; i < 6; i++) Trainer.record(st, 'listen', 'U', false);
  assert.equal(st.weights.listen.U, 8);
  const counts = { K: 0, M: 0, U: 0 };
  for (let i = 0; i < 3000; i++) counts[Trainer.pick(st, 'listen', Math.random, null)]++;
  assert.ok(counts.U > counts.K * 3, JSON.stringify(counts));
});

test('save and load round-trip, survive corrupt and missing storage', () => {
  const mem = {}; const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const st = fresh(); st.level = 7; st.settings.pitch = 700;
  Trainer.save(storage, st);
  const back = Trainer.load(storage);
  assert.equal(back.level, 7);
  assert.equal(back.settings.pitch, 700);
  assert.equal(back.settings.charWpm, 20);
  mem[Trainer.STORE_KEY] = '{not json';
  assert.equal(Trainer.load(storage).level, 2);
  assert.equal(Trainer.load(null).level, 2);
});

test('per-character stats, weights, learned words and block survive a save and load', () => {
  const mem = {}; const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const st = fresh();
  Trainer.record(st, 'listen', 'K', false);
  Trainer.record(st, 'listen', 'M', true);
  Trainer.record(st, 'send', 'K', true);
  st.aliases.cake = 'K';
  Trainer.save(storage, st);
  const back = Trainer.load(storage);
  assert.deepEqual(back.chars.listen.K, { n: 1, ok: 0 });
  assert.equal(back.chars.send.K.n, 1);
  assert.equal(back.weights.listen.K, 2);
  assert.equal(back.aliases.cake, 'K');
  assert.deepEqual(back.block, [false, true]);
  assert.equal(back.recent.listen.length, 2);
});

test('saved data from before new settings existed still loads with defaults filled in', () => {
  const storage = { getItem: () => JSON.stringify({ level: 5, settings: { pitch: 700 } }), setItem() {} };
  const st = Trainer.load(storage);
  assert.equal(st.level, 5);
  assert.equal(st.settings.pitch, 700);
  assert.equal(st.settings.speechPitch, 1);
  assert.equal(st.settings.recogLang, 'en-US');
  assert.equal(st.settings.ownVoice, false);
  assert.deepEqual(st.aliases, {});
});
