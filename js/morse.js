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

  // Prosigns are sent as one run-together character (no gap between the letters), so each has its own sound.
  var PROSIGNS = { AR: '.-.-.', SK: '...-.-', BT: '-...-', KN: '-.--.', AS: '.-...' };

  /** Tone segments for a dit/dah string, in seconds from 0: [{start, dur}], plus total length. */
  function segmentsForCode(code, t) {
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

  /** Tone segments for one character. */
  function segments(ch, t) {
    return segmentsForCode(TABLE[String(ch).toUpperCase()], t);
  }

  /** Tone segments for a prosign such as AR. */
  function prosignSegments(name, t) {
    return segmentsForCode(PROSIGNS[String(name).toUpperCase()], t);
  }

  /**
   * Practice conditions: how far the sound is from a clean computer tone.
   *  snr: noise level in dB below the tone (null = no noise); fade: how deep the random fading goes (0 to 1);
   *  jitter: pitch wobble in Hz within a character; swing: how unevenly a "hand" times the elements (0 to 0.3);
   *  pitchSpread: the pitch changes by up to this many Hz from one character to the next.
   */
  var CONDITIONS = {
    clean: { label: 'Clean', snr: null, fade: 0, jitter: 0, swing: 0, pitchSpread: 0 },
    light: { label: 'Light', snr: 18, fade: 0.15, jitter: 4, swing: 0.05, pitchSpread: 0 },
    real: { label: 'Realistic', snr: 10, fade: 0.35, jitter: 8, swing: 0.12, pitchSpread: 40 },
    hard: { label: 'Hard', snr: 4, fade: 0.55, jitter: 14, swing: 0.2, pitchSpread: 80 }
  };

  /** Segments with each element's length varied by up to +/- swing, as a human hand would. Order and gaps are kept sensible. */
  function humanize(seg, cond, rng) {
    if (!cond || !cond.swing || !seg.segments.length) return seg;
    rng = rng || Math.random;
    var out = [], x = 0, prevEnd = 0;
    seg.segments.forEach(function (e, i) {
      var gap = i === 0 ? 0 : e.start - prevEnd;                       // the original gap before this element
      prevEnd = e.start + e.dur;
      var f = function () { return 1 + cond.swing * (rng() * 2 - 1); };
      x += gap * f();
      var dur = e.dur * f();
      out.push({ start: x, dur: dur });
      x += dur;
    });
    return { segments: out, duration: x };
  }

  /** One random draw of how this character sounds: loudness, pitch offset and pitch drift. */
  function toneVariation(cond, rng) {
    rng = rng || Math.random;
    if (!cond) return { gain: 1, pitch: 0, drift: 0 };
    return { gain: 1 - cond.fade * rng(), pitch: (rng() * 2 - 1) * cond.pitchSpread, drift: (rng() * 2 - 1) * cond.jitter };
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

  return { TABLE: TABLE, PROSIGNS: PROSIGNS, KOCH_ORDER: KOCH_ORDER, CONDITIONS: CONDITIONS, timing: timing, segments: segments,
    segmentsForCode: segmentsForCode, prosignSegments: prosignSegments, humanize: humanize, toneVariation: toneVariation,
    classify: classify, decode: decode, spokenName: spokenName };
});
