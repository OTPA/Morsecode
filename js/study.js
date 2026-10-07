/* Study sequences: how a letter is taught before anyone is tested on it.
   A study session never asks a question. Each letter goes through three rounds:
     A. its NAME, then its SOUND   (you are told the answer first)
     B. its SOUND, a pause, then its NAME   (you may guess in the pause; nothing is marked)
     C. the same, mixed with letters you already know
   Pure: returns steps; the screen, the voice and the audio-track maker each play them in their own way. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'), require('./trainer.js'));
  else root.Study = factory(root.Morse, root.Trainer);
})(typeof self !== 'undefined' ? self : this, function (Morse, Trainer) {
  // step: {t: 'name' | 'tone' | 'pause', ch, s (seconds, pauses only), show (is the letter on screen), round}

  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * opts: {target: [chars to teach], known: [chars already met], rng, repsA, repsB, mix}
   * Defaults: 3 reps of A, 3 reps of B per letter, then 8 mixed recalls per target letter.
   */
  function session(opts) {
    var rng = opts.rng || Math.random;
    var target = opts.target || [];
    var known = (opts.known || []).filter(function (c) { return target.indexOf(c) < 0; });
    var repsA = opts.repsA == null ? 3 : opts.repsA;
    var repsB = opts.repsB == null ? 3 : opts.repsB;
    var mix = opts.mix == null ? 8 : opts.mix;
    var steps = [];
    function name(ch, round) { steps.push({ t: 'name', ch: ch, show: true, round: round }); }
    function tone(ch, round, show) { steps.push({ t: 'tone', ch: ch, show: show, round: round }); }
    function pause(s, round, ch, show) { steps.push({ t: 'pause', s: s, ch: ch, show: show, round: round }); }

    target.forEach(function (ch) {
      for (var a = 0; a < repsA; a++) { name(ch, 'A'); pause(0.5, 'A', ch, true); tone(ch, 'A', true); pause(1.1, 'A', ch, true); }
      for (var b = 0; b < repsB; b++) { tone(ch, 'B', false); pause(2.4, 'B', ch, false); name(ch, 'B'); pause(0.9, 'B', ch, true); }
    });

    // C: mixed recall. Target letters come up twice as often as the letters you already know.
    var pool = [];
    target.forEach(function (c) { pool.push(c, c); });
    shuffle(known, rng).slice(0, 6).forEach(function (c) { pool.push(c); });
    var total = Math.min(mix * Math.max(1, target.length), 40);
    var last = null;
    for (var i = 0; pool.length && i < total; i++) {
      var at = Math.floor(rng() * pool.length) % pool.length;
      var ch = pool[at];
      if (ch === last) {                      // never the same letter twice in a row, when there is a choice
        for (var k = 1; k < pool.length; k++) {
          if (pool[(at + k) % pool.length] !== last) { ch = pool[(at + k) % pool.length]; break; }
        }
      }
      last = ch;
      tone(ch, 'C', false);
      pause(2.2, 'C', ch, false);
      name(ch, 'C');
      pause(0.7, 'C', ch, true);
    }
    return steps;
  }

  /**
   * What to study now. New letters first (the ones unlocked but never studied).
   * With nothing new, the shakiest letters. Returns {target, known, fresh}.
   */
  function plan(st) {
    var all = Trainer.unlocked(st);
    var fresh = Morse.KOCH_ORDER.slice(st.introduced, st.level);
    if (fresh.length) {
      return { target: fresh.slice(0, 2), known: all.filter(function (c) { return fresh.indexOf(c) < 0; }), fresh: true };
    }
    var ranked = all.map(function (c) { return { c: c, s: Trainer.charStatus(st, c) }; })
      .filter(function (x) { return x.s.status !== 'Solid'; })
      .sort(function (a, b) { return (a.s.acc == null ? -1 : a.s.acc) - (b.s.acc == null ? -1 : b.s.acc); });
    var target = ranked.slice(0, 2).map(function (x) { return x.c; });
    if (!target.length) target = all.slice(-2);
    return { target: target, known: all.filter(function (c) { return target.indexOf(c) < 0; }), fresh: false };
  }

  /** How many letters of the plan are new, as a short phrase for the screen. */
  function describe(p) {
    return (p.fresh ? 'New: ' : 'Review: ') + p.target.join(' and ');
  }

  return { session: session, plan: plan, describe: describe };
});
