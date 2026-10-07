/* The rhythm game for the youngest learners: listen to a short pattern of long and short sounds, tap it back.
   Sound only, no letters, nothing to fail. Pure. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'));
  else root.Rhythm = factory(root.Morse);
})(typeof self !== 'undefined' ? self : this, function (Morse) {
  var UNIT_WPM = 4;          // one short sound is 0.3 s: slow enough for small hands
  var UNIT = 1.2 / UNIT_WPM;
  var MIN_LEN = 2, MAX_LEN = 5, STREAK_UP = 3;

  /** A random pattern of '.' and '-'. Longer patterns always mix both sounds, so they are worth tapping. */
  function pattern(len, rng, last) {
    rng = rng || Math.random;
    var p;
    for (var tries = 0; tries < 20; tries++) {
      p = '';
      for (var i = 0; i < len; i++) p += rng() < 0.5 ? '.' : '-';
      var mixed = p.indexOf('.') >= 0 && p.indexOf('-') >= 0;
      if ((len < 3 || mixed) && p !== last) return p;
    }
    // a guaranteed fallback that differs from `last`
    p = '.-.-.'.slice(0, len);
    return p === last ? '-.-.-'.slice(0, len) : p;
  }

  /** How the taps were heard: each press of at least two units is long. */
  function heard(presses) {
    return presses.map(function (s) { return Morse.classify(s, UNIT); }).join('');
  }

  /** Was the pattern tapped back right? */
  function matches(target, presses) { return heard(presses) === target; }

  /** After a try: three right in a row make the next pattern one sound longer. A miss only resets the streak. */
  function progress(state, ok) {
    var len = state.len, streak = state.streak;
    if (ok) {
      streak++;
      if (streak >= STREAK_UP && len < MAX_LEN) { len++; streak = 0; }
    } else {
      streak = 0;
    }
    return { len: len, streak: streak };
  }

  return { UNIT: UNIT, UNIT_WPM: UNIT_WPM, MIN_LEN: MIN_LEN, MAX_LEN: MAX_LEN, STREAK_UP: STREAK_UP,
    pattern: pattern, heard: heard, matches: matches, progress: progress };
});
