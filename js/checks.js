/* Weekly checks: short, fixed-format tests with no feedback, whose results decide the levels.
   Pure: no DOM, no audio. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'), require('./trainer.js'), require('./words.js'));
  else root.Checks = factory(root.Morse, root.Trainer, root.Words);
})(typeof self !== 'undefined' ? self : this, function (Morse, Trainer, Words) {
  var PASS = 0.95;
  var WEEK = 7;
  var VALID_DAYS = 45;   // a pass counts towards a level for this long
  var TEACH_DAYS = 10;   // days children have practised, for the Teacher level

  // c / s: character and effective speed during the check (letters: whatever the learner has set).
  var DEFS = {
    letters: { title: 'Letters check', n: 40, minutes: 3, cond: 'clean', c: null, s: null,
      what: '40 letters, one at a time, at your current speed. Tap or type each one. No feedback until the end.' },
    words: { title: 'Words check', n: 20, minutes: 4, cond: 'clean', c: 20, s: 15,
      what: '20 words at 15 WPM effective. Type each word after it plays. No feedback until the end.' },
    text: { title: 'Text check', n: 20, minutes: 5, cond: 'light', c: 20, s: 20,
      what: '20 short phrases at 20 WPM with light background noise. Type each phrase after it plays. No feedback until the end.' },
    send: { title: 'Sending check', n: 20, minutes: 3, cond: 'clean', c: null, s: null, unitWpm: 15,
      what: '20 characters keyed at 15 WPM. Each must be decoded exactly. No feedback until the end.' }
  };

  function clean(t) { return String(t || '').toUpperCase().replace(/[^A-Z0-9.,?\/]/g, ''); }

  function distance(a, b) {
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /** How much of the target was copied, 0 to 1: one minus the edit distance over the length. Spaces are ignored. */
  function similarity(target, answer) {
    var a = clean(target), b = clean(answer);
    if (!a.length) return b.length ? 0 : 1;
    return Math.max(0, 1 - distance(a, b) / Math.max(a.length, b.length));
  }

  /** Can this check be taken now, and if not, why not. */
  function available(kind, st) {
    var allowed = Trainer.unlocked(st);
    if (kind === 'words' && Words.matching(allowed, [], {}).length < 40) return { ok: false, why: 'Unlock more letters first: not enough words yet.' };
    if (kind === 'text' && Words.matching(allowed, [], {}).length < 100) return { ok: false, why: 'Unlock more letters first: not enough words for a phrase check.' };
    if (allowed.length < 3) return { ok: false, why: 'Unlock a few more letters first.' };
    return { ok: true, why: '' };
  }

  /** The items to copy or send. Returns [{text}] for words and text, [{text}] single characters for letters and send. */
  function items(kind, st, rng) {
    rng = rng || Math.random;
    var def = DEFS[kind], allowed = Trainer.unlocked(st), out = [], last = null;
    var i;
    if (kind === 'letters' || kind === 'send') {
      for (i = 0; i < def.n; i++) {
        var c;
        do { c = allowed[Math.floor(rng() * allowed.length) % allowed.length]; } while (c === last && allowed.length > 1);
        last = c;
        out.push({ text: c });
      }
      return out;
    }
    if (kind === 'words') {
      for (i = 0; i < def.n; i++) { var w = Words.next(allowed, rng, last, [], {}); last = w.text; out.push({ text: w.text }); }
      return out;
    }
    for (i = 0; i < def.n; i++) {                        // text: three words per phrase
      var parts = [];
      for (var k = 0; k < 3; k++) { var x = Words.next(allowed, rng, last, [], {}); last = x.text; parts.push(x.text); }
      out.push({ text: parts.join(' ') });
    }
    return out;
  }

  /** results: [{target, answer, ok, ms}]. Returns {score, pass, correct, n, charAcc, medianMs}. */
  function score(kind, results) {
    var n = results.length;
    if (!n) return { score: 0, pass: false, correct: 0, n: 0, charAcc: 0, medianMs: null };
    var correct = results.filter(function (r) { return r.ok; }).length;
    var charAcc = results.reduce(function (a, r) { return a + similarity(r.target, r.answer); }, 0) / n;
    var times = results.map(function (r) { return r.ms; }).filter(function (m) { return m != null; });
    var med = Trainer.median(times);
    var sc, pass;
    if (kind === 'text') { sc = charAcc; pass = sc >= PASS; }
    else { sc = correct / n; pass = sc >= PASS; }
    if (kind === 'letters' && pass && med != null && med > Trainer.LEARNED_MS) pass = false;
    return { score: sc, pass: pass, correct: correct, n: n, charAcc: charAcc, medianMs: med };
  }

  /** Store a finished check. Keeps the last 50. */
  function record(st, kind, result, date, conditions) {
    var def = DEFS[kind];
    st.checks.push({ date: date, kind: kind, score: result.score, pass: result.pass, n: result.n, correct: result.correct,
      charAcc: result.charAcc, medianMs: result.medianMs, c: def.c || st.settings.charWpm, s: def.s || st.settings.effWpm,
      cond: conditions || def.cond });
    while (st.checks.length > 50) st.checks.shift();
  }

  function latest(st, kind) {
    for (var i = st.checks.length - 1; i >= 0; i--) if (st.checks[i].kind === kind) return st.checks[i];
    return null;
  }

  /** The latest check of this kind passed, recently enough to count. */
  function passed(st, kind, today) {
    var c = latest(st, kind);
    return !!(c && c.pass && Trainer.daysBetween(c.date, today) <= VALID_DAYS);
  }

  /** The four levels, with what each still needs. */
  function levels(st, today, ctx) {
    var s = st.settings;
    var learned = Morse.KOCH_ORDER.filter(function (c) { var q = Trainer.charStatus(st, c).status; return q === 'Learned' || q === 'Solid'; }).length;
    var l1 = learned === Morse.KOCH_ORDER.length && s.effWpm >= 12;
    var words = passed(st, 'words', today), text = passed(st, 'text', today), send = passed(st, 'send', today);
    var l2 = l1 && words;
    var l3 = l2 && text && send;
    var teachDays = (ctx && ctx.teachDays) || 0;
    function need(list) { return list.filter(Boolean); }
    return [
      { n: 1, title: 'Foundation', ok: l1, detail: 'all 40 characters learned (' + learned + ' of 40), at 12 WPM effective or faster (now ' + s.effWpm + ')',
        need: need([learned < 40 && (40 - learned) + ' characters still to learn', s.effWpm < 12 && 'effective speed 12 WPM']) },
      { n: 2, title: 'Fluent', ok: l2, detail: 'Foundation, and a Words check passed (whole words at 15 WPM effective, 95% right) in the last ' + VALID_DAYS + ' days',
        need: need([!l1 && 'Foundation first', l1 && !words && 'pass the Words check']) },
      { n: 3, title: 'Proficient', ok: l3, detail: 'Fluent, a Text check passed (20 WPM with light noise, 95% of characters) and a Sending check passed (15 WPM, 95%)',
        need: need([!l2 && 'Fluent first', l2 && !text && 'pass the Text check', l2 && !send && 'pass the Sending check']) },
      { n: 4, title: 'Teacher', ok: l3 && teachDays >= TEACH_DAYS,
        detail: 'Proficient, and you have helped children practise on at least ' + TEACH_DAYS + ' different days (' + teachDays + ' so far)',
        need: need([!l3 && 'Proficient first', l3 && teachDays < TEACH_DAYS && (TEACH_DAYS - teachDays) + ' more days of a child practising']) }
    ];
  }

  /** Is the weekly check due? Starts being suggested once ten letters are unlocked. */
  function due(st, today) {
    if (st.level < 10) return { due: false, days: null };
    if (!st.checks.length) return { due: true, days: null };
    var days = Trainer.daysBetween(st.checks[st.checks.length - 1].date, today);
    return { due: days >= WEEK, days: days };
  }

  return { DEFS: DEFS, PASS: PASS, WEEK: WEEK, VALID_DAYS: VALID_DAYS, TEACH_DAYS: TEACH_DAYS, similarity: similarity, available: available, items: items, score: score,
    record: record, latest: latest, passed: passed, levels: levels, due: due };
});
