const test = require('node:test');
const assert = require('node:assert/strict');
const Morse = require('../js/morse.js');
const T = require('../js/trainer.js');
const Study = require('../js/study.js');
const Checks = require('../js/checks.js');
const Family = require('../js/family.js');
const Rhythm = require('../js/rhythm.js');

const day = (n) => new Date(Date.UTC(2026, 9, 1 + n, 12)).toISOString().slice(0, 10);
function memory() {
  const m = {};
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}
const answer = (st, ch, ok, ms, date) => T.record(st, 'listen', ch, ok, { ms, date, noBlock: true });

/* ---------- learner-specific order, relaxed criteria, block size ---------- */

test('a custom order is used only if it is exactly the 40 characters, each once', () => {
  const st = T.defaults();
  assert.deepEqual(T.unlocked(st), ['K', 'M']);
  st.order = Family.orderFor('MDS');
  assert.equal(st.order.length, 40);
  assert.deepEqual(T.unlocked(st), ['M', 'D']);
  st.level = 3;
  assert.deepEqual(T.unlocked(st), ['M', 'D', 'S']);
  assert.deepEqual(st.order.slice(3, 6), ['K', 'U', 'R'], 'continues in Koch order without repeats');
  st.order = ['M', 'D'];
  assert.deepEqual(T.unlocked(st), ['K', 'M', 'U'], 'a broken order falls back to Koch');
  st.order = Morse.KOCH_ORDER.slice(0, 39).concat(['K']);
  assert.equal(T.validOrder(st.order), false, 'a repeated character makes it invalid');
  assert.equal(T.validOrder(Morse.KOCH_ORDER.slice().reverse()), true);
});

test('order survives saving and loading, and a damaged one is dropped', () => {
  const store = memory();
  const st = Family.newState('early', { starters: 'MDS' });
  T.save(store, st, 'k1');
  assert.deepEqual(T.unlocked(T.load(store, 'k1')), ['M', 'D']);
  store.m.k2 = JSON.stringify({ level: 5, order: ['Z', 'Z'] });
  const bad = T.load(store, 'k2');
  assert.equal(bad.order, null);
  assert.equal(T.unlocked(bad)[0], 'K');
});

test('unlocking follows the learner\'s own order', () => {
  const st = Family.newState('adult', { starters: 'MD' });
  for (let i = 0; i < 50; i++) T.record(st, 'listen', 'M', true, { ms: 900, date: day(0) });
  assert.equal(st.level, 3);
  assert.deepEqual(T.unlocked(st), ['M', 'D', 'K']);
  assert.equal(Study.plan(Object.assign(T.defaults(), st, { introduced: 2 })).target[0], 'K');
});

test('young learners are judged more gently: 9 of 10, on 2 days, with no timing', () => {
  const adult = T.defaults(), early = Family.newState('early', {});
  for (let i = 0; i < 10; i++) { answer(adult, 'K', i !== 3, null, day(i % 2)); answer(early, 'K', i !== 3, null, day(i % 2)); }
  assert.equal(T.charStatus(early, 'K').status, 'Learned');
  assert.equal(T.charStatus(adult, 'K').status, 'Learning');
  assert.deepEqual(T.charStatus(early, 'K').need, []);
  const shaky = Family.newState('early', {});
  for (let i = 0; i < 10; i++) answer(shaky, 'K', i % 2 === 0, null, day(i % 2));
  assert.equal(T.charStatus(shaky, 'K').status, 'Learning');
  assert.match(T.charStatus(shaky, 'K').need[0], /accuracy 90%/);
  const oneDay = Family.newState('early', {});
  for (let i = 0; i < 10; i++) answer(oneDay, 'K', true, null, day(0));
  assert.deepEqual(T.charStatus(oneDay, 'K').need, ['1 more day']);
});

test('young learners unlock on a block of 20 instead of 50', () => {
  const early = Family.newState('early', {});
  assert.equal(T.blockSize(early), 20);
  assert.equal(T.blockSize(T.defaults()), 50);
  let ev = null;
  for (let i = 0; i < 20; i++) ev = T.record(early, 'listen', 'K', true, { date: day(0) });
  assert.equal(ev.event, 'advance');
  assert.equal(early.level, 3);
});

/* ---------- profile index ---------- */

test('first run: your existing progress becomes the first profile, under the same storage key', () => {
  const store = memory();
  T.save(store, Object.assign(T.defaults(), { level: 9 }));          // the old single-learner key
  const index = Family.load(store);
  assert.equal(index.profiles.length, 1);
  assert.deepEqual(index.profiles[0], { id: 'me', name: 'Me', kind: 'adult', key: T.STORE_KEY, created: null });
  assert.equal(T.load(store, Family.active(index).key).level, 9, 'nothing was moved or lost');
});

test('add, switch, rename, remove: each learner keeps separate progress', () => {
  const store = memory();
  const index = Family.load(store);
  const mia = Family.add(index, '  Mia  ', 'early', new Date(Date.UTC(2026, 9, 7)));
  assert.equal(mia.name, 'Mia'); assert.equal(mia.id, 'p2'); assert.equal(mia.key, 'morseear.p.p2'); assert.equal(mia.created, '2026-10-07');
  const sam = Family.add(index, 'Sam', 'child');
  assert.equal(sam.id, 'p3');
  T.save(store, Family.newState('early', { starters: 'M' }), mia.key);
  T.save(store, Family.newState('child', {}), sam.key);
  const me = T.load(store, 'morseear.v1'); me.level = 12; T.save(store, me, 'morseear.v1');
  Family.setActive(index, 'p2');
  assert.equal(Family.active(index).name, 'Mia');
  Family.setActive(index, 'nope');
  assert.equal(Family.active(index).name, 'Mia', 'unknown id is ignored');
  assert.equal(T.load(store, mia.key).level, 2);
  assert.equal(T.load(store, 'morseear.v1').level, 12);
  assert.equal(T.load(store, mia.key).kind, 'early');
  assert.equal(T.load(store, sam.key).settings.goalMin, 15);
  Family.rename(index, 'p3', 'Samuel');
  assert.equal(Family.find(index, 'p3').name, 'Samuel');
  Family.save(store, index);
  assert.deepEqual(Family.load(store), index, 'the index round-trips');
  Family.remove(index, 'p2', store);
  assert.equal(index.profiles.length, 2);
  assert.equal(index.active, 'me', 'removing the active learner switches to the first');
  assert.equal(store.m['morseear.p.p2'], undefined, 'their progress is deleted');
  assert.equal(T.load(store, 'morseear.v1').level, 12, 'others are untouched');
  const again = Family.add(index, 'Zoe', 'early');
  assert.equal(again.id, 'p2', 'a freed id can be reused, so keys never clash');
});

test('rules: names are required, trimmed and capped; at least one learner stays; up to eight', () => {
  const index = Family.defaultIndex();
  assert.throws(() => Family.add(index, '   ', 'child'), /give the learner a name/);
  assert.throws(() => Family.add(index, 'X', 'robot'), /Unknown kind/);
  assert.equal(Family.add(index, 'A'.repeat(60), 'child').name.length, 24);
  const solo = Family.defaultIndex();
  assert.throws(() => Family.remove(solo, 'me'), /At least one learner/);
  for (let i = 0; i < 6; i++) Family.add(index, 'L' + i, 'child');
  assert.equal(index.profiles.length, 8);
  assert.throws(() => Family.add(index, 'Nine', 'child'), /up to 8/);
});

test('a damaged index is repaired, never trusted', () => {
  const store = memory();
  store.m[Family.INDEX_KEY] = '{not json';
  assert.equal(Family.load(store).profiles[0].id, 'me');
  const fixed = Family.validate({ active: 'ghost', profiles: [{ id: 'p2', name: '', kind: 'wizard', key: 'k' }, { id: 'p2', name: 'dup', kind: 'child', key: 'k' }, { id: '../x', name: 'bad', kind: 'child', key: 'k' }, null], family: { names: ['Ann', '', 5] } });
  assert.deepEqual(fixed.profiles, [{ id: 'p2', name: 'Learner', kind: 'adult', key: 'k', created: null }]);
  assert.equal(fixed.active, 'p2');
  assert.deepEqual(fixed.family.names, ['Ann', '5']);
  assert.equal(Family.validate({ profiles: [] }).profiles[0].id, 'me');
});

test('letters from names and typed text', () => {
  assert.equal(Family.initialsOf(['Mia', ' dad', '4th', '']), 'MD' + 'T');
  assert.deepEqual(Family.lettersFrom('m d, s! m 5'), ['M', 'D', 'S', '5']);
  assert.equal(Family.orderFor(''), null);
  assert.equal(Family.orderFor('!!'), null);
  assert.equal(Family.orderFor('Mia').slice(0, 3).join(''), 'MIA');
  assert.equal(new Set(Family.orderFor('MIA')).size, 40);
});

test('kinds start with sensible settings; adults keep the defaults', () => {
  const a = Family.newState('adult', {}), c = Family.newState('child', {}), e = Family.newState('early', {});
  assert.deepEqual([a.kind, c.kind, e.kind], ['adult', 'child', 'early']);
  assert.deepEqual([a.relaxed, c.relaxed, e.relaxed], [false, false, true]);
  assert.equal(a.settings.goalMin, 40); assert.equal(c.settings.goalMin, 15); assert.equal(e.settings.goalMin, 5);
  assert.equal(a.settings.voiceAnswers, true);
  assert.equal(c.settings.voiceAnswers, false, 'a child\'s voice is not sent to a speech service unless a parent allows it');
  assert.equal(e.settings.voiceAnswers, false);
  assert.ok(e.settings.effWpm < c.settings.effWpm || e.settings.effWpm <= c.settings.effWpm);
  assert.equal(Family.newState('nonsense', {}).kind, 'adult');
});

/* ---------- parent overview ---------- */

test('summary shows each learner\'s level, status counts, letters and practice time', () => {
  const store = memory(), index = Family.load(store);
  const mia = Family.add(index, 'Mia', 'early');
  const st = Family.newState('early', { starters: 'MD' });
  for (let i = 0; i < 10; i++) answer(st, 'M', true, null, day(i % 2));
  T.logSeconds(st, 600, day(5)); T.logSeconds(st, 300, day(3)); T.logSeconds(st, 10, day(6));
  T.save(store, st, mia.key);
  const rows = Family.summary(index, store, day(6));
  assert.equal(rows.length, 2);
  const r = rows[1];
  assert.equal(r.profile.name, 'Mia'); assert.equal(r.letters, 'M D'); assert.equal(r.counts.Learned, 1);
  assert.ok(Math.abs(r.min7 - 910 / 60) < 1e-9);
  assert.equal(r.last, day(5), 'a few seconds is not a practice day');
  assert.equal(rows[0].last, null);
});

test('teaching days count the days any child practised for a few minutes', () => {
  const store = memory(), index = Family.load(store);
  const mia = Family.add(index, 'Mia', 'early'), sam = Family.add(index, 'Sam', 'child');
  const a = Family.newState('early', {}), b = Family.newState('child', {});
  T.logSeconds(a, 200, day(1)); T.logSeconds(a, 100, day(2)); T.logSeconds(b, 400, day(1)); T.logSeconds(b, 400, day(4));
  T.save(store, a, mia.key); T.save(store, b, sam.key);
  const me = T.load(store, 'morseear.v1'); T.logSeconds(me, 3000, day(7)); T.save(store, me, 'morseear.v1');
  assert.equal(Family.teachingDays(index, store), 2, 'days 1 and 4: the adult\'s own practice does not count, nor does a 100 s session');
});

test('the Teacher level needs Proficient and enough days of children practising', () => {
  const st = T.defaults();
  Morse.KOCH_ORDER.forEach((c) => { for (let i = 0; i < 20; i++) answer(st, c, true, 900, day(i % 3)); });
  st.level = 40; st.settings.effWpm = 12;
  ['words', 'text', 'send'].forEach((k) => Checks.record(st, k, { score: 1, pass: true, n: 20, correct: 20, charAcc: 1, medianMs: null }, day(29)));
  assert.equal(Family.TEACH_DAYS, Checks.TEACH_DAYS);
  let L = Checks.levels(st, day(30), { teachDays: 9 });
  assert.equal(L[2].ok, true); assert.equal(L[3].ok, false);
  assert.deepEqual(L[3].need, ['1 more days of a child practising']);
  L = Checks.levels(st, day(30), { teachDays: 10 });
  assert.equal(L[3].ok, true);
  assert.equal(Checks.levels(st, day(30))[3].ok, false, 'no context: no teaching days');
  st.settings.effWpm = 10;
  assert.equal(Checks.levels(st, day(30), { teachDays: 99 })[3].ok, false, 'needs Proficient first');
});

/* ---------- family backup ---------- */

test('family backup round-trips every learner, and restoring replaces the old family', () => {
  const store = memory(), index = Family.load(store);
  const mia = Family.add(index, 'Mia', 'early');
  Family.setFamilyNames(index, ['Mia', 'Dad', '']);
  const me = T.load(store, 'morseear.v1'); me.level = 7; T.save(store, me, 'morseear.v1');
  const st = Family.newState('early', { starters: 'MD' }); st.level = 4; T.save(store, st, mia.key);
  Family.save(store, index);
  const text = Family.exportAll(index, store);

  const other = memory(), oldIndex = Family.load(other);
  const extra = Family.add(oldIndex, 'Old', 'child'); T.save(other, Family.newState('child', {}), extra.key);
  const me2 = T.load(other, 'morseear.v1'); me2.level = 30; T.save(other, me2, 'morseear.v1');
  const parsed = Family.parseBackup(text);
  assert.equal(other.m[extra.key] !== undefined, true, 'parsing alone changes nothing');
  Family.applyBackup(other, parsed, oldIndex);
  const idx = Family.load(other);
  assert.deepEqual(idx.profiles.map((p) => p.name), ['Me', 'Mia']);
  assert.deepEqual(idx.family.names, ['Mia', 'Dad']);
  assert.equal(T.load(other, 'morseear.v1').level, 7);
  assert.equal(T.load(other, 'morseear.p.p2').level, 4);
  assert.deepEqual(T.unlocked(T.load(other, 'morseear.p.p2')), ['M', 'D', 'K', 'U']);
  assert.equal(other.m['morseear.p.p2'] !== undefined, true);
  assert.throws(() => Family.parseBackup('{"x":1}'), /not a Morse Ear Trainer family backup/);
  assert.throws(() => Family.parseBackup(T.exportJson(T.defaults())), /not a Morse Ear Trainer family backup/);
});

/* ---------- rhythm game ---------- */

test('rhythm patterns: right length, long and short mixed from three sounds up, no immediate repeat', () => {
  let seed = 11; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let last = null;
  for (let len = 2; len <= 5; len++) {
    for (let i = 0; i < 60; i++) {
      const p = Rhythm.pattern(len, rng, last);
      assert.equal(p.length, len); assert.match(p, /^[.-]+$/);
      if (len >= 3) assert.ok(p.includes('.') && p.includes('-'), p);
      assert.notEqual(p, last);
      last = p;
    }
  }
  assert.notEqual(Rhythm.pattern(2, () => 0, '..'), '..', 'even a stuck random source cannot repeat');
});

test('rhythm: taps of two units or more are long; a pattern must match exactly', () => {
  const u = Rhythm.UNIT;
  assert.ok(Math.abs(u - 0.3) < 1e-9);
  assert.equal(Rhythm.heard([0.2, 0.9, 0.3]), '.-.');
  assert.equal(Rhythm.heard([u * 2, u * 2 - 0.01]), '-.');
  assert.equal(Rhythm.matches('.-', [0.25, 0.8]), true);
  assert.equal(Rhythm.matches('.-', [0.25]), false);
  assert.equal(Rhythm.matches('.-', [0.25, 0.8, 0.2]), false);
  assert.equal(Rhythm.matches('.-', []), false);
});

test('rhythm progress: three right in a row make it longer, a miss only resets the streak, never below 2 or above 5', () => {
  let s = { len: 2, streak: 0 };
  s = Rhythm.progress(s, true); s = Rhythm.progress(s, true);
  assert.deepEqual(s, { len: 2, streak: 2 });
  s = Rhythm.progress(s, false);
  assert.deepEqual(s, { len: 2, streak: 0 });
  for (let i = 0; i < 3; i++) s = Rhythm.progress(s, true);
  assert.deepEqual(s, { len: 3, streak: 0 });
  for (let i = 0; i < 30; i++) s = Rhythm.progress(s, true);
  assert.equal(s.len, 5);
  for (let i = 0; i < 30; i++) s = Rhythm.progress(s, false);
  assert.equal(s.len, 5, 'a miss never makes it shorter, so a small child is never pushed back');
});
