/* Turns a raw microphone take into a clean short clip: trim silence, level it, shrink it, encode as WAV.
   Pure: works on Float32Array samples, no DOM, no Web Audio. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AudioEdit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var CLIP_RATE = 22050;
  var SILENT = 0.012; // a take whose loudest sample is below this is treated as "nothing recorded"

  function peak(s) {
    var p = 0;
    for (var i = 0; i < s.length; i++) { var a = Math.abs(s[i]); if (a > p) p = a; }
    return p;
  }

  /** Cut leading and trailing silence, keeping a little air before and a longer tail after. Null if all silent. */
  function trim(s, rate) {
    var p = peak(s);
    if (p < SILENT) return null;
    var thr = Math.max(SILENT, p * 0.1);
    var win = Math.max(1, Math.round(rate * 0.005));
    var first = -1, last = -1;
    for (var i = 0; i < s.length; i += win) {
      var m = 0;
      for (var j = i; j < Math.min(i + win, s.length); j++) { var a = Math.abs(s[j]); if (a > m) m = a; }
      if (m >= thr) { if (first < 0) first = i; last = Math.min(i + win, s.length); }
    }
    if (first < 0) return null;
    var start = Math.max(0, first - Math.round(rate * 0.03));
    var end = Math.min(s.length, last + Math.round(rate * 0.08));
    return s.slice(start, end);
  }

  /** Scale so the loudest sample reaches `target`, but never boost by more than maxGain (that would only raise noise). */
  function normalise(s, target, maxGain) {
    target = target || 0.9;
    maxGain = maxGain || 16;
    var p = peak(s);
    if (p <= 0) return s;
    var g = Math.min(target / p, maxGain);
    var out = new Float32Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s[i] * g;
    return out;
  }

  function fade(s, rate, ms) {
    var n = Math.min(Math.round(rate * ms / 1000), Math.floor(s.length / 2));
    var out = new Float32Array(s);
    for (var i = 0; i < n; i++) {
      var g = i / n;
      out[i] *= g;
      out[out.length - 1 - i] *= g;
    }
    return out;
  }

  /** Box-average when shrinking, linear interpolation otherwise. */
  function resample(s, from, to) {
    if (from === to) return s;
    var n = Math.max(1, Math.floor(s.length * to / from));
    var out = new Float32Array(n);
    var r = from / to;
    for (var i = 0; i < n; i++) {
      if (r > 1) {
        var a = Math.floor(i * r), b = Math.min(s.length, Math.max(a + 1, Math.floor((i + 1) * r)));
        var sum = 0;
        for (var k = a; k < b; k++) sum += s[k];
        out[i] = sum / (b - a);
      } else {
        var pos = i * r, i0 = Math.floor(pos), i1 = Math.min(s.length - 1, i0 + 1), f = pos - i0;
        out[i] = s[i0] * (1 - f) + s[i1] * f;
      }
    }
    return out;
  }

  /** 16-bit mono PCM WAV bytes. */
  function encodeWav(s, rate) {
    var bytes = new Uint8Array(44 + s.length * 2);
    var v = new DataView(bytes.buffer);
    function str(off, t) { for (var i = 0; i < t.length; i++) v.setUint8(off + i, t.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + s.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, s.length * 2, true);
    for (var i = 0; i < s.length; i++) {
      var x = Math.max(-1, Math.min(1, s[i]));
      v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    return bytes;
  }

  /** Whole pipeline. Returns {samples, rate, ms} or {error: 'quiet'} when nothing usable was said. */
  function process(samples, rate) {
    var t = trim(samples, rate);
    if (!t || t.length < rate * 0.08) return { error: 'quiet' };
    var out = fade(normalise(resample(t, rate, CLIP_RATE)), CLIP_RATE, 5);
    return { samples: out, rate: CLIP_RATE, ms: Math.round(out.length / CLIP_RATE * 1000) };
  }

  return { CLIP_RATE: CLIP_RATE, peak: peak, trim: trim, normalise: normalise, fade: fade, resample: resample, encodeWav: encodeWav, process: process };
});
