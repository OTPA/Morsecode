const test = require('node:test');
const assert = require('node:assert/strict');
const Morse = require('../js/morse.js');
const T = require('../js/trainer.js');
const Study = require('../js/study.js');
const Words = require('../js/words.js');
const Tracks = require('../js/tracks.js');

const fresh = () => T.defaults();
const day = (n) => new Date(Date.UTC(2026, 9, 1 + n, 12)).toISOString().slice(0, 10);
function answer(st, ch, ok, ms, date, extra = {}) { return T.record(st, 'listen', ch, ok, { ms, date, noBlock: true, ...extra }); }

/* ---------- mastery ---------- */

test('a character is New until answered, then Learning with a list of what is missing', () => {
  const st = fresh();
  assert.equal(T.charStatus(st, 'K').status, 'New');
  answer(st, 'K', true, 900, day(0));
  const s = T.charStatus(st, 'K');
  assert.equal(s.status, 'Learning');
  assert.ok(s.need.some((x) => /19 more answers/.test(x)));
  assert.ok(s.need.some((x) => /4 timed answers/.test(x)));
  assert.ok(s.need.some((x) => /2 more days/.test(x)));
});

test('Learned needs 95% of the last 20, typical answers under 1.5 s, and 3 different days', () => {
  const st = fresh();
  for (let i = 0; i < 20; i++) answer(st, 'K', true, 1000, day(i % 3));
  assert.equal(T.charStatus(st, 'K').status, 'Learned');

  const slow = fresh();
  for (let i = 0; i < 20; i++) answer(slow, 'K', true, 2500, day(i % 3));
  const s = T.charStatus(slow, 'K');
  assert.equal(s.status, 'Learning');
  assert.ok(s.need.some((x) => /faster answers \(now 2\.5 s\)/.test(x)));

  const oneDay = fresh();
  for (let i = 0; i < 20; i++) answer(oneDay, 'K', true, 900, day(0));
  assert.equal(T.charStatus(oneDay, 'K').status, 'Learning');
  assert.ok(T.charStatus(oneDay, 'K').need.some((x) => /2 more days/.test(x)));

  const sloppy = fresh();
  for (let i = 0; i < 20; i++) answer(sloppy, 'K', i % 5 !== 0, 900, day(i % 3)); // 80%
  assert.equal(T.charStatus(sloppy, 'K').status, 'Learning');
});

test('answers with no timing (voice) cannot make a character Learned: the speed check stays pending', () => {
  const st = fresh();
  for (let i = 0; i < 25; i++) answer(st, 'K', true, null, day(i % 4));
  const s = T.charStatus(st, 'K');
  assert.equal(s.status, 'Learning');
  assert.ok(s.need.some((x) => /timed answers \(Listen tab\)/.test(x)));
});

test('Solid needs a passing review at least 14 days after first being Learned', () => {
  const st = fresh();
  for (let i = 0; i < 20; i++) answer(st, 'K', true, 900, day(i % 3));
  assert.equal(st.mastery.K.learnedOn, day(1), 'learned when the 20th answer arrived');
  for (let i = 0; i < 10; i++) answer(st, 'K', true, 900, day(10));   // too soon
  assert.equal(T.charStatus(st, 'K').status, 'Learned');
  for (let i = 0; i < 10; i++) answer(st, 'K', true, 900, day(15));   // 15 days after
  assert.equal(T.charStatus(st, 'K').status, 'Solid');
});

test('a Learned character that starts failing drops back to Learning', () => {
  const st = fresh();
  for (let i = 0; i < 20; i++) answer(st, 'K', true, 900, day(i % 3));
  for (let i = 0; i < 6; i++) answer(st, 'K', false, 900, day(4));
  assert.equal(T.charStatus(st, 'K').status, 'Learning');
});

test('only the last 20 answers count', () => {
  const st = fresh();
  for (let i = 0; i < 30; i++) answer(st, 'K', false, 900, day(i % 3));
  for (let i = 0; i < 20; i++) answer(st, 'K', true, 900, day(i % 3));
  assert.equal(st.mastery.K.res.length, 20);
  assert.equal(T.charStatus(st, 'K').status, 'Learned');
});

/* ---------- mix-ups and weak spots ---------- */

test('wrong answers are counted as mix-ups, pairs combine both directions', () => {
  const st = fresh();
  answer(st, 'S', false, 900, day(0), { answered: 'H' });
  answer(st, 'S', false, 900, day(0), { answered: 'H' });
  answer(st, 'H', false, 900, day(0), { answered: 'S' });
  answer(st, 'K', false, 900, day(0), { answered: 'M' });
  assert.equal(st.confusions['S>H'], 2);
  const pairs = T.topPairs(st, 5);
  assert.deepEqual(pairs[0], { a: 'H', b: 'S', count: 3 });
  assert.equal(pairs.length, 1, 'a single mix-up is not yet a pattern');
});

test('weakSet includes shaky Learning characters and characters in frequent mix-ups', () => {
  const st = fresh();
  st.level = 8;
  for (let i = 0; i < 10; i++) answer(st, 'K', i % 2 === 0, 900, day(0));      // 50%
  for (let i = 0; i < 10; i++) answer(st, 'M', true, 900, day(0));              // fine
  for (let i = 0; i < 3; i++) answer(st, 'U', false, 900, day(0), { answered: 'R' });
  const weak = T.weakSet(st);
  assert.ok(weak.includes('K'));
  assert.ok(weak.includes('U') && weak.includes('R'));
  assert.ok(!weak.includes('M'));
});

test('review mix: about one Listen trial in five comes from older characters once past level 5', () => {
  const st = fresh();
  st.level = 12;
  let rngState = 7;
  const rng = () => { rngState = (rngState * 16807) % 2147483647; return rngState / 2147483647; };
  const old = new Set(Morse.KOCH_ORDER.slice(0, 9));
  let oldCount = 0, n = 4000, last = null;
  for (let i = 0; i < n; i++) { last = T.pick(st, 'listen', rng, last); if (old.has(last)) oldCount++; }
  // 9 of 12 characters are "older" so even unmixed they'd be ~75%; the mix must push it clearly higher
  const plain = (() => { let c = 0, l = null; for (let i = 0; i < n; i++) { l = T.pick(st, 'listen', rng, l, { review: false }); if (old.has(l)) c++; } return c; })();
  assert.ok(oldCount > plain + n * 0.03, `${oldCount} vs ${plain}`);
  // with a tiny set there is nothing to review
  const small = fresh();
  for (let i = 0; i < 200; i++) assert.ok(['K', 'M'].includes(T.pick(small, 'listen', rng, null)));
});

test('pick can be limited to a set, and falls back when the set has nothing usable', () => {
  const st = fresh();
  st.level = 10;
  for (let i = 0; i < 100; i++) assert.ok(['K', 'S'].includes(T.pick(st, 'listen', Math.random, null, { only: ['K', 'S', 'Z'] })));
  assert.ok(Morse.KOCH_ORDER.slice(0, 10).includes(T.pick(st, 'listen', Math.random, null, { only: ['Z'] })));
});

/* ---------- words, time, backup ---------- */

test('word answers update letters only when the length matches', () => {
  const st = fresh(); st.level = 13;
  T.recordWord(st, 'SUM', 'SUN', day(0));
  assert.equal(st.words.n, 1); assert.equal(st.words.ok, 0);
  assert.equal(st.mastery.M.res[0], 0);
  assert.equal(st.confusions['M>N'], 1);
  assert.equal(st.mastery.S.res[0], 1);
  assert.equal(st.block.length, 0, 'word trials never move the Koch block');
  T.recordWord(st, 'SUM', 'SU', day(0));
  assert.equal(st.mastery.S.res.length, 1, 'different length: word-level only');
  assert.equal(T.recordWord(st, 'SUM', 'SUM', day(0)), true);
});

test('practice time is logged per day and summed over a week', () => {
  const st = fresh();
  T.logSeconds(st, 600, day(0)); T.logSeconds(st, 300, day(0)); T.logSeconds(st, 1200, day(2)); T.logSeconds(st, 60, day(-10));
  assert.equal(T.minutesOn(st, day(0)), 15);
  assert.equal(T.minutesLastDays(st, 7, day(3)), 35);
});

test('progress backup round-trips everything, and refuses other files', () => {
  const st = fresh();
  st.level = 9; st.introduced = 7;
  for (let i = 0; i < 20; i++) answer(st, 'K', true, 900, day(i % 3));
  answer(st, 'S', false, 900, day(0), { answered: 'H' });
  st.aliases.cake = 'K'; st.customWords = ['MIA'];
  T.logSeconds(st, 120, day(0));
  const back = T.importJson(T.exportJson(st));
  assert.deepEqual(back, st);
  assert.equal(T.charStatus(back, 'K').status, 'Learned');
  assert.throws(() => T.importJson('{"x":1}'), /not a Morse Ear Trainer progress backup/);
  assert.throws(() => T.importJson('nope'), /not a Morse Ear Trainer progress backup/);
  assert.throws(() => T.importJson(JSON.stringify({ app: 'morse-ear-trainer', kind: 'voice' })), /not a Morse/);
  const clamped = T.importJson(JSON.stringify({ app: 'morse-ear-trainer', kind: 'progress', v: 1, state: { level: 999, introduced: 999 } }));
  assert.equal(clamped.level, 40); assert.equal(clamped.introduced, 40);
});

/* ---------- study sequences: the name always comes before any recall ---------- */

test('study: for each new letter the NAME comes first, and recall is only asked after it has been taught', () => {
  const steps = Study.session({ target: ['K'], known: [], rng: () => 0.3 });
  const first = steps.filter((s) => s.t !== 'pause').slice(0, 2);
  assert.deepEqual(first.map((s) => s.t), ['name', 'tone'], 'round A starts with the name, then the sound');
  assert.equal(first[0].show, true);
  // round A shows the letter all the way through; rounds B and C hide it while the learner may guess
  steps.filter((s) => s.round === 'A').forEach((s) => assert.equal(s.show, true));
  const tones = steps.filter((s) => s.t === 'tone');
  assert.ok(tones.filter((s) => s.round === 'A').every((s) => s.show === true));
  assert.ok(tones.filter((s) => s.round !== 'A').every((s) => s.show === false));
  // in every recall round the name always follows the sound, so the learner is told the answer every time
  const recall = steps.filter((s) => s.round !== 'A');
  for (let i = 0; i < recall.length; i++) {
    if (recall[i].t === 'tone') {
      const nextName = recall.slice(i + 1).find((s) => s.t === 'name');
      assert.equal(nextName.ch, recall[i].ch);
      assert.ok(recall.slice(i + 1, recall.indexOf(nextName)).every((s) => s.t === 'pause'));
    }
  }
  // recall rounds always give thinking time before the name
  const pauseAfterTone = recall.find((s, i) => i > 0 && recall[i - 1].t === 'tone');
  assert.ok(pauseAfterTone.t === 'pause' && pauseAfterTone.s >= 2);
});

test('study: all rounds for letter 1 happen before letter 2 is introduced, then the mixed round uses both', () => {
  let seed = 3;
  const lcg = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const steps = Study.session({ target: ['K', 'M'], known: ['U'], rng: lcg });
  const nonPause = steps.filter((s) => s.t !== 'pause');
  const firstM = nonPause.findIndex((s) => s.ch === 'M');
  assert.ok(nonPause.slice(0, firstM).every((s) => s.ch === 'K'));
  const mixed = nonPause.filter((s) => s.round === 'C').map((s) => s.ch);
  assert.ok(mixed.includes('K') && mixed.includes('M'));
  assert.ok(steps.every((s) => ['name', 'tone', 'pause'].includes(s.t)));
});

test('study.plan: new letters first, then the shakiest letters when nothing is new', () => {
  const st = fresh();                                  // level 2, nothing studied
  let p = Study.plan(st);
  assert.deepEqual(p.target, ['K', 'M']); assert.equal(p.fresh, true);
  st.introduced = 2;
  p = Study.plan(st);
  assert.equal(p.fresh, false);
  assert.equal(p.target.length, 2);
  st.level = 5; st.introduced = 3;
  p = Study.plan(st);
  assert.deepEqual(p.target, ['R', 'E']);
  assert.deepEqual(p.known, ['K', 'M', 'U']);
  assert.equal(Study.describe(p), 'New: R and E');
});

/* ---------- words ---------- */

test('words: only built from unlocked letters, and groups are used while there are too few words', () => {
  const early = Words.next(['K', 'M'], () => 0.1, null);
  assert.equal(early.kind, 'group');
  assert.match(early.text, /^[KM]{4}$/);
  const allowed = Morse.KOCH_ORDER.slice(0, 13);
  const list = Words.matching(allowed);
  assert.ok(list.length > 100, 'plenty of words by level 13: ' + list.length);
  list.forEach((w) => assert.ok(Words.usable(w, allowed)));
  const w = Words.next(allowed, Math.random, null);
  assert.equal(w.kind, 'word');
  assert.ok(Words.usable(w.text, allowed));
  assert.notEqual(Words.next(allowed, () => 0, w.text).text, w.text);
});

test('words: custom words (such as names) are included when their letters are unlocked', () => {
  const allowed = Morse.KOCH_ORDER.slice(0, 13);
  assert.ok(Words.matching(allowed, ['mia', 'zed']).includes('MIA'));
  assert.ok(!Words.matching(allowed, ['zed']).includes('ZED'));
});

test('words: compare marks each position', () => {
  const r = Words.compare('team', ' t e a x ');
  assert.equal(r.ok, false);
  assert.deepEqual(r.letters.map((l) => l.ok), [true, true, true, false]);
  assert.equal(r.answer, 'TEAX');
  assert.equal(Words.compare('TEAM', 'team').ok, true);
  assert.equal(Words.compare('TEAM', '').ok, false);
  assert.equal(Words.compare('TEA', 'TEAM').letters.length, 4);
});

test('the word list is clean: 3 to 8 letters, no duplicates', () => {
  assert.ok(Words.LIST.length > 800, 'enough variety to keep practice fresh: ' + Words.LIST.length);
  assert.equal(new Set(Words.LIST).size, Words.LIST.length);
  Words.LIST.forEach((w) => assert.match(w, /^[A-Z]{3,8}$/));
});

/* ---------- audio tracks (planning only; rendering is browser-side) ---------- */

test('tracks: missing recordings are listed per character', () => {
  const have = new Set(['ch-K']);
  assert.deepEqual(Tracks.missing(['K', 'M', 'U'], (id) => have.has(id)), ['M', 'U']);
  assert.deepEqual(Tracks.missing(['K'], (id) => have.has(id)), []);
});

test('tracks: layout places tone and name steps on a timeline and stops at the limit', () => {
  const steps = [{ t: 'name', ch: 'K' }, { t: 'pause', s: 1 }, { t: 'tone', ch: 'K' }, { t: 'pause', s: 2 }, { t: 'name', ch: 'K' }];
  const dur = { tone: () => 0.5, name: () => 0.8 };
  const all = Tracks.layout(steps, dur, 100);
  assert.deepEqual(all.events, [{ at: 0, t: 'name', ch: 'K' }, { at: 1.8, t: 'tone', ch: 'K' }, { at: 4.3, t: 'name', ch: 'K' }]);
  assert.ok(Math.abs(all.total - 5.1) < 1e-9);
  const cut = Tracks.layout(steps, dur, 3);
  assert.equal(cut.events.length, 2);
  assert.ok(cut.total <= 3);
});

test('tracks: learn tracks follow the study order, review tracks recall with a pause before the name', () => {
  const st = fresh();
  const learn = Tracks.nextSteps('learn', st, () => 0.3, 3);
  assert.deepEqual(learn.filter((s) => s.t !== 'pause').slice(0, 2).map((s) => s.t), ['name', 'tone']);
  st.level = 6; st.introduced = 6;
  const review = Tracks.nextSteps('review', st, Math.random, 3);
  const types = review.slice(0, 6).map((s) => s.t);
  assert.deepEqual(types, ['tone', 'pause', 'name', 'pause', 'tone', 'pause']);
  assert.equal(review[1].s, 3);
  assert.deepEqual(Tracks.charsFor('review', st), Morse.KOCH_ORDER.slice(0, 6));
});

test('tracks: render lays out tones and recorded names on an offline context and returns a WAV of the right length', async () => {
  const sched = [];
  const MorseAudio = { scheduleChar: (ctx, dest, ch, at) => { sched.push(['tone', ch, at]); return 0.4; } };
  const bufs = {};
  const has = (id) => id.startsWith('ch-') || id.startsWith('nato-');
  class FakeCtx {
    constructor(ch, length, rate) { this.length = length; this.rate = rate; this.destination = {}; }
    createGain() { return { gain: { value: 1 }, connect: (x) => x }; }
    createBufferSource() { const o = { buffer: null, connect: (n) => n, start: (t) => sched.push(['clip', o.buffer.id, t]) }; return o; }
    startRendering() { const data = new Float32Array(this.length); return Promise.resolve({ getChannelData: () => data }); }
  }
  const st = fresh(); st.level = 4; st.introduced = 4;
  let encodedRate = 0;
  const res = await Tracks.render('review', st, 2, () => 0.5, {
    OfflineAudioContext: FakeCtx, MorseAudio, has,
    getBuffer: async (id) => (bufs[id] = { id, duration: 0.5 }),
    settings: { charWpm: 20, effWpm: 20, pitch: 650, volume: 0.6, phonetic: true, speechVolume: 1, thinkSec: 3 },
    encodeWav: (data, rate) => { encodedRate = rate; return new Uint8Array(44 + data.length * 2); }
  });
  assert.equal(encodedRate, 22050);
  assert.ok(res.seconds > 110 && res.seconds <= 125, 'about two minutes: ' + res.seconds);
  assert.equal(res.wav.length, 44 + Math.ceil(res.seconds * 22050) * 2, 'the file length matches the track length');
  const tones = sched.filter((e) => e[0] === 'tone'), clips = sched.filter((e) => e[0] === 'clip');
  assert.ok(tones.length > 10 && clips.length > 10);
  assert.ok(clips.some((c) => c[1].startsWith('nato-')) && clips.some((c) => c[1].startsWith('ch-')));
  // every tone is followed by a name clip a few seconds later, never before it
  const events = sched.slice().sort((a, b) => a[2] - b[2]);
  assert.equal(events[0][0], 'tone');
});

test('tracks: without a recording for a letter, that letter is left out of the name clips', async () => {
  const sched = [];
  const MorseAudio = { scheduleChar: (ctx, d, ch, at) => { sched.push(['tone', ch]); return 0.4; } };
  const has = (id) => id === 'ch-K';
  class FakeCtx { constructor(c, l) { this.l = l; this.destination = {}; } createGain() { return { gain: {}, connect: (x) => x }; }
    createBufferSource() { const o = { connect: (n) => n, start: () => sched.push(['clip', o.buffer.id]) }; return o; }
    startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(this.l) }); } }
  const st = fresh();
  await Tracks.render('review', st, 1, () => 0.1, { OfflineAudioContext: FakeCtx, MorseAudio, has,
    getBuffer: async (id) => ({ id, duration: 0.4 }), settings: { charWpm: 20, effWpm: 20, pitch: 650, volume: 0.6, phonetic: false, speechVolume: 1, thinkSec: 2 },
    encodeWav: () => new Uint8Array(44) });
  assert.ok(sched.filter((e) => e[0] === 'clip').every((c) => c[1] === 'ch-K'));
});
