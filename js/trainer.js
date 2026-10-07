/* Learner state: Koch level, mastery per character, confusions, weighted picking, 50-character blocks,
   practice log, backup. Pure: no DOM, no audio. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'));
  else root.Trainer = factory(root.Morse);
})(typeof self !== 'undefined' ? self : this, function (Morse) {
  var BLOCK = 50;          // trials per unlock decision
  var PASS = 0.9;          // block accuracy that unlocks the next character
  var FALL_BACK = 0.7;     // block accuracy below which the newest character steps back
  var STORE_KEY = 'morseear.v1';

  // "Learned" criteria (see README): accuracy over the last WINDOW answers, answer speed, and different days.
  var WINDOW = 20;
  var LEARNED_ACC = 0.95;
  var LEARNED_MS = 1500;   // typical answer time, measured from the end of the sound
  var LEARNED_DAYS = 3;
  var MIN_TIMED = 5;       // timed answers needed before the speed criterion can be judged
  var SOLID_AFTER_DAYS = 14;
  var REVIEW_SHARE = 0.2;  // share of Listen trials spent on older, already-learned characters

  function defaults() {
    return {
      level: 2,              // characters unlocked (Koch order); starts with K and M
      introduced: 0,         // how many unlocked characters have been studied (named, then heard)
      block: [],             // last results of the current listening block (true/false)
      weights: { listen: {}, send: {} },
      chars: { listen: {}, send: {} },   // per-character {n, ok}
      recent: { listen: [], send: [] },  // last 50 results per mode
      mastery: {},           // per character: {res:[0|1], ms:[answer ms], days:[dates], learnedOn, solidOn}
      confusions: {},        // "K>M" -> times K was answered as M
      words: { recent: [], n: 0, ok: 0 },
      customWords: [],
      log: {},               // date -> seconds practised
      aliases: {},           // how recognition hears this learner: heard phrase -> character
      settings: { pitch: 650, charWpm: 20, effWpm: 10, auto: true, sendWpm: 10, echo: false, volume: 0.6,
        speak: true, phonetic: true, speechRate: 1, thinkSec: 3, voiceMode: 'learn',
        voiceURI: '', speechPitch: 1, speechVolume: 1, recogLang: 'en-US', ownVoice: false, goalMin: 40 }
    };
  }

  function isObject(x) { return x && typeof x === 'object' && !Array.isArray(x); }

  /** Defaults first, then everything saved on top (keys the defaults do not list, such as per-character stats, are kept). */
  function merge(base, saved) {
    if (!isObject(saved)) return base;
    Object.keys(saved).forEach(function (k) {
      base[k] = isObject(base[k]) && isObject(saved[k]) ? merge(base[k], saved[k]) : saved[k];
    });
    return base;
  }

  function normalise(st) {
    st.level = Math.max(2, Math.min(Number(st.level) || 2, Morse.KOCH_ORDER.length));
    st.introduced = Math.max(0, Math.min(Number(st.introduced) || 0, st.level));
    return st;
  }

  function load(storage) {
    var st = defaults();
    try {
      var raw = storage && storage.getItem(STORE_KEY);
      if (raw) st = merge(st, JSON.parse(raw));
    } catch (e) { /* unreadable or blocked storage: start fresh */ }
    return normalise(st);
  }

  function save(storage, st) {
    try { storage && storage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
  }

  /** Whole progress as a file's text, for backup or moving to another device. */
  function exportJson(st, now) {
    return JSON.stringify({ app: 'morse-ear-trainer', kind: 'progress', v: 1, savedAt: (now || new Date()).toISOString(), state: st });
  }

  /** Read a backup. Throws a readable Error if the file is not one of ours. */
  function importJson(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || data.app !== 'morse-ear-trainer' || data.kind !== 'progress' || !isObject(data.state)) {
      throw new Error('That file is not a Morse Ear Trainer progress backup.');
    }
    return normalise(merge(defaults(), data.state));
  }

  /* ---------- dates and small maths ---------- */

  function today(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  function median(list) {
    if (!list.length) return null;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }

  function accuracy(list) {
    if (!list.length) return null;
    return list.filter(Boolean).length / list.length;
  }

  function unlocked(st) {
    return Morse.KOCH_ORDER.slice(0, st.level);
  }

  /* ---------- mastery ---------- */

  function cell(st, ch) {
    return st.mastery[ch] || (st.mastery[ch] = { res: [], ms: [], days: [], learnedOn: null, solidOn: null });
  }

  /**
   * Where a character stands against the criteria. status: New | Learning | Learned | Solid.
   * `need` lists what is still missing, in plain words.
   */
  function charStatus(st, ch) {
    var m = st.mastery[ch];
    if (!m || !m.res.length) return { status: 'New', n: 0, acc: null, medianMs: null, timed: 0, days: 0, need: ['first answers'] };
    var n = m.res.length;
    var acc = m.res.reduce(function (a, b) { return a + b; }, 0) / n;
    var med = median(m.ms);
    var days = m.days.length;
    var need = [];
    if (n < WINDOW) need.push((WINDOW - n) + ' more answers');
    else if (acc < LEARNED_ACC) need.push('accuracy ' + Math.round(LEARNED_ACC * 100) + '% (now ' + Math.round(acc * 100) + '%)');
    if (m.ms.length < MIN_TIMED) need.push((MIN_TIMED - m.ms.length) + ' timed answers (Listen tab)');
    else if (med > LEARNED_MS) need.push('faster answers (now ' + (med / 1000).toFixed(1) + ' s)');
    if (days < LEARNED_DAYS) need.push((LEARNED_DAYS - days) + ' more day' + (LEARNED_DAYS - days === 1 ? '' : 's'));
    var last10 = m.res.slice(-10);
    var acc10 = last10.reduce(function (a, b) { return a + b; }, 0) / last10.length;
    var status = 'Learning';
    if (!need.length) status = 'Learned';
    if (m.solidOn && acc10 >= 0.8) status = 'Solid';
    return { status: status, n: n, acc: acc, medianMs: med, timed: m.ms.length, days: days, need: status === 'Learning' ? need : [] };
  }

  function updateMastery(st, ch, ok, ms, date) {
    var m = cell(st, ch);
    m.res.push(ok ? 1 : 0);
    if (m.res.length > WINDOW) m.res.shift();
    if (ms != null) {
      m.ms.push(Math.round(ms));
      if (m.ms.length > WINDOW) m.ms.shift();
    }
    if (m.days[m.days.length - 1] !== date) {
      m.days.push(date);
      if (m.days.length > 60) m.days.shift();
    }
    var s = charStatus(st, ch);
    if (s.status === 'Learned' || s.status === 'Solid') {
      if (!m.learnedOn) m.learnedOn = date;
      var last10 = m.res.slice(-10);
      var acc10 = last10.reduce(function (a, b) { return a + b; }, 0) / last10.length;
      if (!m.solidOn && daysBetween(m.learnedOn, date) >= SOLID_AFTER_DAYS && acc10 >= 0.9) m.solidOn = date;
    }
  }

  function countByStatus(st) {
    var out = { New: 0, Learning: 0, Learned: 0, Solid: 0 };
    unlocked(st).forEach(function (c) { out[charStatus(st, c).status]++; });
    return out;
  }

  /** Characters that need work: still Learning with shaky accuracy, or part of a frequent mix-up. */
  function weakSet(st) {
    var set = {};
    unlocked(st).forEach(function (c) {
      var s = charStatus(st, c);
      if (s.status === 'Learning' && s.n >= 3 && s.acc < 0.9) set[c] = true;
    });
    topPairs(st, 3).forEach(function (p) { set[p.a] = true; set[p.b] = true; });
    return Object.keys(set).filter(function (c) { return unlocked(st).indexOf(c) >= 0; });
  }

  /** Mix-ups, either direction counted together, most frequent first. */
  function topPairs(st, n) {
    var pairs = {};
    Object.keys(st.confusions).forEach(function (k) {
      var parts = k.split('>');
      var a = parts[0], b = parts[1];
      var key = a < b ? a + '/' + b : b + '/' + a;
      pairs[key] = (pairs[key] || 0) + st.confusions[k];
    });
    return Object.keys(pairs).map(function (k) {
      var p = k.split('/');
      return { a: p[0], b: p[1], count: pairs[k] };
    }).filter(function (p) { return p.count >= 2; })
      .sort(function (x, y) { return y.count - x.count; }).slice(0, n || 5);
  }

  /* ---------- picking ---------- */

  /**
   * Weighted random pick from unlocked characters, avoiding an immediate repeat.
   * Misses weigh more, solid characters less. In Listen about one trial in five reviews an older character.
   * opts: {only: [chars]} restricts the pool; {review: false} switches the review mix off.
   */
  function pick(st, mode, rng, last, opts) {
    opts = opts || {};
    rng = rng || Math.random;
    var pool = unlocked(st);
    var cands = pool.length > 1 ? pool.filter(function (c) { return c !== last; }) : pool;
    if (opts.only) {
      var only = cands.filter(function (c) { return opts.only.indexOf(c) >= 0; });
      if (only.length) cands = only;
    } else if (mode === 'listen' && opts.review !== false && st.level > 5 && rng() < REVIEW_SHARE) {
      var older = cands.filter(function (c) { return pool.indexOf(c) < st.level - 3; });
      if (older.length) cands = older;
    }
    var w = st.weights[mode];
    var total = 0;
    var ws = cands.map(function (c) {
      var factor = 1;
      if (mode === 'listen') {
        var s = charStatus(st, c).status;
        factor = s === 'Solid' ? 0.6 : s === 'Learning' ? 1.5 : 1;
      }
      var x = (w[c] || 1) * factor;
      total += x;
      return x;
    });
    var r = rng() * total;
    for (var i = 0; i < cands.length; i++) {
      r -= ws[i];
      if (r < 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  /* ---------- recording answers ---------- */

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

  /**
   * Record one trial. opts: {ms: answer time in ms (null if untimed), answered: what the learner said, date}.
   * Listening trials also feed mastery, mix-ups and the block; at BLOCK trials the block is judged:
   * >= 90% unlocks the next character (and raises effective speed by 1 WPM when auto),
   * < 70% takes the newest character back, otherwise nothing changes.
   * Returns null, or {event: 'advance'|'regress'|'stay', accuracy, newChar?}.
   */
  function record(st, mode, ch, ok, opts) {
    opts = opts || {};
    track(st, mode, ch, ok);
    if (mode !== 'listen') return null;
    updateMastery(st, ch, ok, opts.ms == null ? null : opts.ms, opts.date || today());
    if (!ok && opts.answered && opts.answered !== ch) {
      var key = ch + '>' + opts.answered;
      st.confusions[key] = (st.confusions[key] || 0) + 1;
    }
    if (opts.noBlock) return null;
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

  /** Record a whole-word trial (Words mode). Letter-level results are kept only when the answer has the same length. */
  function recordWord(st, target, answer, date) {
    var ok = target === answer;
    st.words.n++;
    if (ok) st.words.ok++;
    st.words.recent.push(ok);
    if (st.words.recent.length > WINDOW) st.words.recent.shift();
    if (target.length === answer.length) {
      for (var i = 0; i < target.length; i++) {
        if (Morse.TABLE[target.charAt(i)]) {
          record(st, 'listen', target.charAt(i), target.charAt(i) === answer.charAt(i),
            { answered: answer.charAt(i), date: date, noBlock: true });
        }
      }
    }
    return ok;
  }

  /* ---------- practice time ---------- */

  function logSeconds(st, seconds, date) {
    date = date || today();
    st.log[date] = (st.log[date] || 0) + seconds;
    // keep about three months
    var keys = Object.keys(st.log).sort();
    while (keys.length > 100) delete st.log[keys.shift()];
  }

  function minutesOn(st, date) { return (st.log[date || today()] || 0) / 60; }

  function minutesLastDays(st, days, end) {
    end = end || today();
    var total = 0;
    for (var i = 0; i < days; i++) {
      var d = new Date(Date.parse(end + 'T12:00:00Z') - i * 86400000);
      total += (st.log[d.toISOString().slice(0, 10)] || 0) / 60;
    }
    return total;
  }

  return { BLOCK: BLOCK, PASS: PASS, FALL_BACK: FALL_BACK, STORE_KEY: STORE_KEY, WINDOW: WINDOW, LEARNED_ACC: LEARNED_ACC,
    LEARNED_MS: LEARNED_MS, LEARNED_DAYS: LEARNED_DAYS, SOLID_AFTER_DAYS: SOLID_AFTER_DAYS, REVIEW_SHARE: REVIEW_SHARE,
    defaults: defaults, load: load, save: save, exportJson: exportJson, importJson: importJson,
    unlocked: unlocked, pick: pick, record: record, recordWord: recordWord, accuracy: accuracy,
    charStatus: charStatus, countByStatus: countByStatus, weakSet: weakSet, topPairs: topPairs,
    today: today, daysBetween: daysBetween, median: median,
    logSeconds: logSeconds, minutesOn: minutesOn, minutesLastDays: minutesLastDays };
});
