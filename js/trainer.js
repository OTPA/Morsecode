/* Learner state: Koch level, weighted picking, 50-character blocks. Pure: no DOM, no audio. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'));
  else root.Trainer = factory(root.Morse);
})(typeof self !== 'undefined' ? self : this, function (Morse) {
  var BLOCK = 50;
  var PASS = 0.9;
  var FALL_BACK = 0.7;
  var STORE_KEY = 'morseear.v1';

  function defaults() {
    return {
      level: 2,              // characters unlocked (Koch order); starts with K and M
      introduced: 0,         // how many unlocked characters have had their introduction
      block: [],             // last results of the current listening block (true/false)
      weights: { listen: {}, send: {} },
      chars: { listen: {}, send: {} },   // per-character {n, ok}
      recent: { listen: [], send: [] },  // last 50 results per mode
      settings: { pitch: 650, charWpm: 20, effWpm: 10, auto: true, sendWpm: 10, echo: false, volume: 0.6,
        speak: true, phonetic: true, speechRate: 1, thinkSec: 3, voiceMode: 'quiz' }
    };
  }

  function merge(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (saved[k] === undefined) return;
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = merge(base[k], saved[k]);
      else base[k] = saved[k];
    });
    return base;
  }

  function load(storage) {
    var st = defaults();
    try {
      var raw = storage && storage.getItem(STORE_KEY);
      if (raw) st = merge(st, JSON.parse(raw));
    } catch (e) { /* unreadable or blocked storage: start fresh */ }
    st.level = Math.max(2, Math.min(st.level, Morse.KOCH_ORDER.length));
    st.introduced = Math.min(st.introduced, st.level);
    return st;
  }

  function save(storage, st) {
    try { storage && storage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
  }

  function unlocked(st) {
    return Morse.KOCH_ORDER.slice(0, st.level);
  }

  /** Weighted random pick from unlocked characters, avoiding an immediate repeat. */
  function pick(st, mode, rng, last) {
    var pool = unlocked(st);
    var cands = pool.length > 1 ? pool.filter(function (c) { return c !== last; }) : pool;
    var w = st.weights[mode];
    var total = 0;
    var ws = cands.map(function (c) { var x = w[c] || 1; total += x; return x; });
    var r = (rng || Math.random)() * total;
    for (var i = 0; i < cands.length; i++) {
      r -= ws[i];
      if (r < 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  function track(st, mode, ch, ok) {
    var w = st.weights[mode];
    w[ch] = ok ? Math.max((w[ch] || 1) * 0.8, 1) : Math.min((w[ch] || 1) * 2, 8);
    var c = st.chars[mode][ch] || (st.chars[mode][ch] = { n: 0, ok: 0 });
    c.n++;
    if (ok) c.ok++;
    var recent = st.recent[mode];
    recent.push(ok);
    if (recent.length > BLOCK) recent.shift();
  }

  function accuracy(list) {
    if (!list.length) return null;
    return list.filter(Boolean).length / list.length;
  }

  /**
   * Record one trial. Listening trials also feed the block; at BLOCK trials the block is judged:
   * >= 90% unlocks the next character (and raises effective speed by 1 WPM when auto),
   * < 70% takes the newest character back, otherwise nothing changes.
   * Returns null, or {event: 'advance'|'regress'|'stay', accuracy, newChar?}.
   */
  function record(st, mode, ch, ok) {
    track(st, mode, ch, ok);
    if (mode !== 'listen') return null;
    st.block.push(ok);
    if (st.block.length < BLOCK) return null;
    var acc = accuracy(st.block);
    st.block = [];
    var s = st.settings;
    if (acc >= PASS) {
      if (st.level < Morse.KOCH_ORDER.length) {
        st.level++;
        st.weights.listen[Morse.KOCH_ORDER[st.level - 1]] = 3;
      }
      if (s.auto && s.effWpm < s.charWpm) s.effWpm = Math.min(s.charWpm, s.effWpm + 1);
      return { event: 'advance', accuracy: acc, newChar: Morse.KOCH_ORDER[st.level - 1] };
    }
    if (acc < FALL_BACK && st.level > 2) {
      st.level--;
      st.introduced = Math.min(st.introduced, st.level);
      return { event: 'regress', accuracy: acc };
    }
    return { event: 'stay', accuracy: acc };
  }

  return { BLOCK: BLOCK, PASS: PASS, FALL_BACK: FALL_BACK, STORE_KEY: STORE_KEY, defaults: defaults, load: load, save: save,
    unlocked: unlocked, pick: pick, record: record, accuracy: accuracy };
});
