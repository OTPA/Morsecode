/* Morse table, Koch order, Farnsworth timing and keying decode. Pure: no DOM, no audio. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Morse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var TABLE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
    K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
    U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....',
    '7': '--...', '8': '---..', '9': '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.'
  };

  // Koch order as used by LCWO.
  var KOCH_ORDER = 'KMURESNAPTLWI.JZFOY,VG5/Q92H38B?47C1D60X'.split('');

  var REVERSE = {};
  Object.keys(TABLE).forEach(function (ch) { REVERSE[TABLE[ch]] = ch; });

  /**
   * Farnsworth timing. c = character speed (WPM), s = effective speed (WPM).
   * Characters are always sent at c; only the gaps between characters and words stretch.
   * ta = (60c - 37.2s) / (19 s c); character gap = 3 ta, word gap = 7 ta.
   * When s >= c this is standard Morse timing.
   */
  function timing(c, s) {
    s = Math.min(s, c);
    var unit = 1.2 / c;
    var ta = s >= c ? unit : (60 * c - 37.2 * s) / (19 * s * c);
    return { unit: unit, dit: unit, dah: 3 * unit, gap: unit, ta: ta, charGap: 3 * ta, wordGap: 7 * ta };
  }

  /** Tone segments for one character, in seconds from 0: [{start, dur}], plus total length. */
  function segments(ch, t) {
    var code = TABLE[String(ch).toUpperCase()];
    if (!code) return { segments: [], duration: 0 };
    var out = [];
    var x = 0;
    for (var i = 0; i < code.length; i++) {
      var dur = code.charAt(i) === '-' ? t.dah : t.dit;
      out.push({ start: x, dur: dur });
      x += dur + (i < code.length - 1 ? t.gap : 0);
    }
    return { segments: out, duration: x };
  }

  /** A single key press is a dah once it lasts at least 2 units. */
  function classify(pressSeconds, unit) {
    return pressSeconds >= 2 * unit ? '-' : '.';
  }

  function decode(pattern) {
    return REVERSE[pattern] || null;
  }

  function spokenName(ch) {
    var code = TABLE[String(ch).toUpperCase()] || '';
    return code.split('').map(function (c) { return c === '-' ? 'dah' : 'di'; }).join(' ');
  }

  return { TABLE: TABLE, KOCH_ORDER: KOCH_ORDER, timing: timing, segments: segments, classify: classify, decode: decode, spokenName: spokenName };
});
