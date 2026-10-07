const test = require('node:test');
const assert = require('node:assert/strict');
const Morse = require('../js/morse.js');
const T = require('../js/trainer.js');
const Words = require('../js/words.js');
const Checks = require('../js/checks.js');
const Coach = require('../js/coach.js');

const fresh = () => T.defaults();
const day = (n) => new Date(Date.UTC(2026, 9, 1 + n, 12)).toISOString().slice(0, 10);
const ALL = Morse.KOCH_ORDER.slice();

/* ---------- ham pack and prosigns ---------- */

test('ham abbreviations are only offered when switched on and when their characters are unlocked', () => {
  const early = Morse.KOCH_ORDER.slice(0, 13);                 // no C, Q, D, H ...
  assert.ok(!Words.matching(early, [], { ham: true }).includes('CQ'));
  assert.ok(Words.matching(ALL, [], { ham: true }).includes('CQ'));
  assert.ok(!Words.matching(ALL, [], {}).includes('CQ'), 'off by default');
  assert.ok(Words.matching(ALL, [], { ham: true }).includes('73'));
  assert.ok(Words.matching(ALL, [], { ham: true }).includes('599'));
  const some = Morse.KOCH_ORDER.slice(0, 13);                  // K M U R E S N A P T L W I
  const ham = Words.matching(some, [], { ham: true }).filter((w) => Words.HAM.includes(w));
  assert.ok(ham.includes('PSE') && ham.includes('ANT') && ham.includes('UR') && ham.includes('ES'), ham.join(' '));
  Words.HAM.forEach((w) => assert.match(w, /^[A-Z0-9]{2,8}$/));
});

test('prosigns appear only when switched on and when all their letters are unlocked', () => {
  const rngLow = () => 0.05;                                   // always takes the prosign branch
  assert.equal(Words.next(ALL, rngLow, null, [], {}).kind !== 'prosign', true, 'off by default');
  const p = Words.next(ALL, rngLow, null, [], { prosigns: true });
  assert.equal(p.kind, 'prosign');
  assert.ok(Words.PROSIGNS.includes(p.text));
  const few = Words.next(['K', 'M'], rngLow, null, [], { prosigns: true });
  assert.notEqual(few.kind, 'prosign', 'KN needs N; nothing else fits K and M alone');
  const kn = Words.next(['K', 'N', 'M'], rngLow, null, [], { prosigns: true });
  assert.equal(kn.text, 'KN');
  assert.notEqual(Words.next(ALL, rngLow, 'AR', [], { prosigns: true }).text, 'AR', 'no immediate repeat');
  assert.deepEqual(Words.PROSIGNS, Object.keys(Morse.PROSIGNS));
});

test('a prosign answer is judged as one unit and never credits or blames its letters', () => {
  const st = fresh(); st.level = 40;
  T.recordWord(st, 'AR', 'AR', day(0), true);
  T.recordWord(st, 'SK', 'SA', day(0), true);
  assert.equal(st.words.n, 2); assert.equal(st.words.ok, 1);
  assert.deepEqual(st.mastery, {}, 'letters untouched');
  assert.deepEqual(st.confusions, {});
});

/* ---------- checks ---------- */

test('similarity: edit distance over length, spaces ignored', () => {
  assert.equal(Checks.similarity('THE TEAM', 'the team'), 1);
  assert.equal(Checks.similarity('THE TEAM', 'THETEAM'), 1);
  assert.ok(Math.abs(Checks.similarity('TEAM', 'TEAN') - 0.75) < 1e-9);
  assert.equal(Checks.similarity('TEAM', ''), 0);
  assert.equal(Checks.similarity('', ''), 1);
  assert.ok(Math.abs(Checks.similarity('ABCDEFGHIJ', 'ABCDEFGHIK') - 0.9) < 1e-9);
  assert.equal(Checks.similarity('AB', 'ABCD'), 0.5);
});

test('scoring: letters, words, text and sending each pass at 95%', () => {
  const mk = (n, bad) => Array.from({ length: n }, (_, i) => ({ target: 'K', answer: i < bad ? 'M' : 'K', ok: i >= bad, ms: 900 }));
  assert.equal(Checks.score('words', mk(20, 1)).pass, true);          // 19/20 = 95%
  assert.equal(Checks.score('words', mk(20, 2)).pass, false);
  assert.equal(Checks.score('send', mk(20, 1)).pass, true);
  assert.equal(Checks.score('letters', mk(40, 2)).pass, true);        // 38/40 = 95%
  assert.equal(Checks.score('letters', mk(40, 3)).pass, false);
  const slow = mk(40, 0).map((r) => ({ ...r, ms: 2500 }));
  assert.equal(Checks.score('letters', slow).pass, false, 'right but slow is not recognition');
  const text = [{ target: 'THE TEAM', answer: 'THE TEAM', ok: true }, { target: 'SOME TREE', answer: 'SOME TREF', ok: false }];
  const r = Checks.score('text', text);
  assert.ok(Math.abs(r.score - (1 + 7 / 8) / 2) < 1e-9);
  assert.equal(r.pass, false);
  assert.equal(Checks.score('words', []).pass, false);
});

test('items: the right number, from unlocked characters only, no immediate repeats', () => {
  const st = fresh(); st.level = 16;
  const allowed = T.unlocked(st);
  const it1 = Checks.items('letters', st, Math.random);
  assert.equal(it1.length, 40);
  const it2 = Checks.items('send', st, Math.random);
  assert.equal(it2.length, 20);
  [it1, it2].forEach((it) => it.forEach((x, i) => { assert.ok(allowed.includes(x.text)); if (i) assert.notEqual(x.text, it[i - 1].text); }));
  const w = Checks.items('words', st, Math.random);
  assert.equal(w.length, 20);
  w.forEach((x) => assert.ok(Words.usable(x.text, allowed)));
  const t = Checks.items('text', st, Math.random);
  assert.equal(t.length, 20);
  t.forEach((x) => { assert.equal(x.text.split(' ').length, 3); x.text.split(' ').forEach((p) => assert.ok(Words.usable(p, allowed))); });
});

test('availability: word and text checks need enough unlocked letters', () => {
  const st = fresh();
  assert.equal(Checks.available('letters', st).ok, false);
  st.level = 5;
  assert.equal(Checks.available('letters', st).ok, true);
  assert.equal(Checks.available('send', st).ok, true);
  assert.equal(Checks.available('words', st).ok, false);
  st.level = 14;
  assert.equal(Checks.available('words', st).ok, true);
  assert.equal(Checks.available('text', st).ok, true);
});

function learnAll(st) {
  st.level = 40; st.introduced = 40;
  ALL.forEach((c) => { for (let i = 0; i < 20; i++) T.record(st, 'listen', c, true, { ms: 900, date: day(i % 3), noBlock: true }); });
}

test('levels: each one needs the one before it, and passes expire', () => {
  const st = fresh();
  const today = day(30);
  let L = Checks.levels(st, today);
  assert.deepEqual(L.map((x) => x.ok), [false, false, false, false]);
  assert.match(L[0].need[0], /40 characters still to learn/);
  learnAll(st);
  st.settings.effWpm = 12;
  L = Checks.levels(st, today);
  assert.deepEqual(L.map((x) => x.ok), [true, false, false, false]);
  assert.deepEqual(L[1].need, ['pass the Words check']);
  Checks.record(st, 'words', { score: 0.8, pass: false, n: 20, correct: 16, charAcc: 0.9, medianMs: null }, day(29));
  assert.equal(Checks.levels(st, today)[1].ok, false, 'a failed check changes nothing');
  Checks.record(st, 'words', { score: 1, pass: true, n: 20, correct: 20, charAcc: 1, medianMs: null }, day(29));
  L = Checks.levels(st, today);
  assert.deepEqual(L.map((x) => x.ok), [true, true, false, false]);
  assert.deepEqual(L[2].need, ['pass the Text check', 'pass the Sending check']);
  Checks.record(st, 'text', { score: 0.97, pass: true, n: 20, correct: 18, charAcc: 0.97, medianMs: null }, day(29));
  assert.equal(Checks.levels(st, today)[2].ok, false, 'sending still missing');
  Checks.record(st, 'send', { score: 1, pass: true, n: 20, correct: 20, charAcc: 1, medianMs: null }, day(29));
  assert.deepEqual(Checks.levels(st, today).map((x) => x.ok), [true, true, true, false]);
  assert.equal(Checks.levels(st, day(29 + 46))[1].ok, false, 'a pass is only good for 45 days');
  assert.equal(Checks.levels(st, day(29 + 45))[1].ok, true);
  st.settings.effWpm = 10;
  assert.deepEqual(Checks.levels(st, today).map((x) => x.ok), [false, false, false, false], 'Foundation slipping takes the others with it');
});

test('check records are kept in order, capped at 50, and latest() finds the newest of a kind', () => {
  const st = fresh();
  for (let i = 0; i < 60; i++) Checks.record(st, i % 2 ? 'words' : 'send', { score: i / 100, pass: false, n: 20, correct: 0, charAcc: 0, medianMs: null }, day(i));
  assert.equal(st.checks.length, 50);
  assert.equal(Checks.latest(st, 'words').date, day(59));
  assert.equal(Checks.latest(st, 'text'), null);
  assert.equal(st.checks[0].date, day(10));
});

test('weekly check becomes due once ten letters are unlocked, then every seven days', () => {
  const st = fresh();
  assert.deepEqual(Checks.due(st, day(0)), { due: false, days: null });
  st.level = 10;
  assert.deepEqual(Checks.due(st, day(0)), { due: true, days: null });
  Checks.record(st, 'letters', { score: 1, pass: true, n: 40, correct: 40, charAcc: 1, medianMs: 800 }, day(0));
  assert.equal(Checks.due(st, day(6)).due, false);
  assert.equal(Checks.due(st, day(7)).due, true);
});

test('recording a check never changes mastery, mix-ups or the Koch block', () => {
  const st = fresh();
  Checks.record(st, 'letters', { score: 0.5, pass: false, n: 40, correct: 20, charAcc: 0.5, medianMs: 2000 }, day(0));
  assert.deepEqual(st.mastery, {}); assert.deepEqual(st.confusions, {}); assert.equal(st.block.length, 0);
});

/* ---------- level dates ---------- */

test('the date the level changed is remembered', () => {
  const st = fresh();
  for (let i = 0; i < 50; i++) T.record(st, 'listen', 'K', true, { ms: 900, date: day(3) });
  assert.equal(st.level, 3);
  assert.equal(st.levelDate, day(3));
  for (let i = 0; i < 50; i++) T.record(st, 'listen', 'K', i % 2 === 0, { ms: 900, date: day(9) });   // 50%: steps back
  assert.equal(st.level, 2);
  assert.equal(st.levelDate, day(9));
});

/* ---------- coach ---------- */

test('coach: welcome back after a gap; short sessions do not count as practice days', () => {
  const st = fresh(); st.level = 6;
  st.log[day(0)] = 1200; st.log[day(5)] = 10;
  const n = Coach.notes(st, day(6));
  assert.match(n[0].text, /Welcome back after 6 days/);
  assert.equal(n[0].action, 'learn');
  assert.equal(Coach.notes(st, day(2)).length, 0);
});

test('coach: a stubborn letter gets specific advice', () => {
  const st = fresh(); st.level = 6;
  for (let i = 0; i < 20; i++) T.record(st, 'listen', 'U', i % 3 === 0, { ms: 900, date: day(0), noBlock: true });   // ~35%
  st.log[day(0)] = 1200;
  const n = Coach.notes(st, day(0));
  assert.match(n[0].text, /^U is proving hard/);
});

test('coach: plateau note, check due note, goal done note, never more than two', () => {
  const st = fresh(); st.level = 12; st.levelDate = day(0);
  st.block = Array(30).fill(false).map((_, i) => i % 2 === 0);
  st.log[day(11)] = 600;
  let n = Coach.notes(st, day(11));
  assert.ok(n.some((x) => /on level 12 for 11 days/.test(x.text)));
  assert.ok(n.some((x) => /weekly check/.test(x.text)));
  st.log[day(11)] = 41 * 60;
  n = Coach.notes(st, day(11));
  assert.equal(n.length, 2);
  assert.ok(Coach.notes(fresh(), day(0)).length === 0, 'a brand-new learner gets no nagging');
});
