/* Family profiles: several learners on one device, each with their own progress. Pure apart from the storage object
   it is given. Your existing progress becomes the first profile, untouched. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'), require('./trainer.js'));
  else root.Family = factory(root.Morse, root.Trainer);
})(typeof self !== 'undefined' ? self : this, function (Morse, Trainer) {
  var INDEX_KEY = 'morseear.family.v1';
  var MAX_PROFILES = 8;
  var MAX_NAME = 24;
  var TEACH_MINUTES = 3;    // a child's practice day counts towards "Teacher" from this many minutes
  var TEACH_DAYS = 10;

  var KINDS = {
    adult: { label: 'Adult', blurb: 'Learns on their own with the full app.' },
    child: { label: 'Child who reads letters', blurb: 'About 6 and up. The same method, with shorter sessions, a gentler speed, and settings behind a grown-up check.' },
    early: { label: 'Early learner', blurb: 'About 3 to 5. Plays with a grown-up: sound games and a few letters, in very short sessions. Not timed, and not expected to read.' }
  };

  function isKind(k) { return !!KINDS[k]; }

  /** Starting settings for a kind of learner. These are sensible starting points, not rules: a parent can change them. */
  function startingSettings(kind) {
    if (kind === 'child') return { goalMin: 15, charWpm: 18, effWpm: 6, thinkSec: 4, speechRate: 0.95, voiceAnswers: false, voiceMode: 'learn' };
    if (kind === 'early') return { goalMin: 5, charWpm: 15, effWpm: 5, thinkSec: 5, speechRate: 0.9, voiceAnswers: false, voiceMode: 'learn' };
    return {};
  }

  /** Letters to start with, from typed text or names: each valid letter or digit once, in the order given. Null if none. */
  function lettersFrom(text) {
    var out = [];
    String(text || '').toUpperCase().split('').forEach(function (c) {
      if (Morse.TABLE[c] && /[A-Z0-9]/.test(c) && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }

  /** The first letter of each name (letters only), as a string such as "MDS". */
  function initialsOf(names) {
    return (names || []).map(function (n) { var m = String(n).trim().toUpperCase().match(/[A-Z]/); return m ? m[0] : ''; }).join('');
  }

  /** A full 40-character order that begins with the starter letters and continues in Koch order. Null when there are none. */
  function orderFor(starters) {
    var first = lettersFrom(starters);
    if (!first.length) return null;
    return first.concat(Morse.KOCH_ORDER.filter(function (c) { return first.indexOf(c) < 0; }));
  }

  /** A fresh learner of this kind. opts: {starters}. */
  function newState(kind, opts) {
    opts = opts || {};
    var st = Trainer.defaults();
    st.kind = isKind(kind) ? kind : 'adult';
    st.relaxed = st.kind === 'early';
    var s = startingSettings(st.kind);
    Object.keys(s).forEach(function (k) { st.settings[k] = s[k]; });
    st.order = orderFor(opts.starters);
    return st;
  }

  /* ---------- the profile index ---------- */

  function defaultIndex() {
    return { v: 1, active: 'me', family: { names: [] },
      profiles: [{ id: 'me', name: 'Me', kind: 'adult', key: Trainer.STORE_KEY, created: null }] };
  }

  function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME); }

  function validate(index) {
    var out = defaultIndex();
    if (!index || typeof index !== 'object' || !Array.isArray(index.profiles)) return out;
    var seen = {};
    var profiles = index.profiles.filter(function (p) {
      if (!p || typeof p.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(p.id) || seen[p.id] || typeof p.key !== 'string') return false;
      seen[p.id] = true;
      return true;
    }).slice(0, MAX_PROFILES).map(function (p) {
      return { id: p.id, name: cleanName(p.name) || 'Learner', kind: isKind(p.kind) ? p.kind : 'adult', key: p.key, created: p.created || null };
    });
    if (!profiles.length) return out;
    out.profiles = profiles;
    out.active = seen[index.active] ? index.active : profiles[0].id;
    var names = index.family && Array.isArray(index.family.names) ? index.family.names : [];
    out.family = { names: names.map(cleanName).filter(Boolean).slice(0, 20) };
    return out;
  }

  function load(storage) {
    try {
      var raw = storage && storage.getItem(INDEX_KEY);
      if (raw) return validate(JSON.parse(raw));
    } catch (e) { /* fall through to a fresh index */ }
    return defaultIndex();
  }

  function save(storage, index) {
    try { storage && storage.setItem(INDEX_KEY, JSON.stringify(index)); } catch (e) { /* ignore */ }
  }

  function active(index) {
    return index.profiles.filter(function (p) { return p.id === index.active; })[0] || index.profiles[0];
  }

  function find(index, id) {
    return index.profiles.filter(function (p) { return p.id === id; })[0] || null;
  }

  function setActive(index, id) {
    if (find(index, id)) index.active = id;
    return index;
  }

  /** Add a learner. Returns the profile, or throws a readable Error. The caller stores newState() under profile.key. */
  function add(index, name, kind, now) {
    name = cleanName(name);
    if (!name) throw new Error('Please give the learner a name.');
    if (!isKind(kind)) throw new Error('Unknown kind of learner.');
    if (index.profiles.length >= MAX_PROFILES) throw new Error('A family can have up to ' + MAX_PROFILES + ' learners.');
    var n = 2;
    while (find(index, 'p' + n)) n++;
    var id = 'p' + n;
    var profile = { id: id, name: name, kind: kind, key: 'morseear.p.' + id, created: (now || new Date()).toISOString().slice(0, 10) };
    index.profiles.push(profile);
    return profile;
  }

  function rename(index, id, name) {
    var p = find(index, id);
    name = cleanName(name);
    if (!p || !name) throw new Error('Please give the learner a name.');
    p.name = name;
    return p;
  }

  /** Remove a learner and their progress. The last learner cannot be removed. */
  function remove(index, id, storage) {
    var p = find(index, id);
    if (!p) return index;
    if (index.profiles.length <= 1) throw new Error('At least one learner is needed.');
    index.profiles = index.profiles.filter(function (x) { return x.id !== id; });
    if (index.active === id) index.active = index.profiles[0].id;
    try { storage && storage.removeItem && storage.removeItem(p.key); } catch (e) { /* ignore */ }
    return index;
  }

  function setFamilyNames(index, names) {
    index.family.names = (names || []).map(cleanName).filter(Boolean).slice(0, 20);
    return index;
  }

  /* ---------- overview for the parent ---------- */

  function lastDay(st) {
    var days = Object.keys(st.log).filter(function (d) { return st.log[d] >= 30; }).sort();
    return days.length ? days[days.length - 1] : null;
  }

  /** One row per learner: where they are and how much they have practised. */
  function summary(index, storage, today) {
    return index.profiles.map(function (p) {
      var st = Trainer.load(storage, p.key);
      return { profile: p, level: st.level, counts: Trainer.countByStatus(st), minToday: Trainer.minutesOn(st, today),
        min7: Trainer.minutesLastDays(st, 7, today), last: lastDay(st), kind: st.kind || p.kind,
        letters: Trainer.unlocked(st).join(' ') };
    });
  }

  /** On how many different days has a child practised for at least a few minutes (any child, any profile)? */
  function teachingDays(index, storage) {
    var days = {};
    index.profiles.forEach(function (p) {
      if (p.kind === 'adult') return;
      var st = Trainer.load(storage, p.key);
      Object.keys(st.log).forEach(function (d) { if (st.log[d] >= TEACH_MINUTES * 60) days[d] = true; });
    });
    return Object.keys(days).length;
  }

  /* ---------- backup of the whole family ---------- */

  function exportAll(index, storage, now) {
    return JSON.stringify({ app: 'morse-ear-trainer', kind: 'family', v: 1, savedAt: (now || new Date()).toISOString(),
      index: index, states: index.profiles.reduce(function (acc, p) { acc[p.id] = Trainer.load(storage, p.key); return acc; }, {}) });
  }

  /** Read a family backup without touching anything. Throws a readable Error for other files. */
  function parseBackup(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || data.app !== 'morse-ear-trainer' || data.kind !== 'family' || !data.index || !data.states) {
      throw new Error('That file is not a Morse Ear Trainer family backup.');
    }
    var index = validate(data.index);
    var states = {};
    index.profiles.forEach(function (p) { states[p.id] = Trainer.importJson(JSON.stringify({ app: 'morse-ear-trainer', kind: 'progress', v: 1, state: data.states[p.id] || {} })); });
    return { index: index, states: states };
  }

  /** Replace the family with a parsed backup: removes the old learners' data, writes the new. */
  function applyBackup(storage, parsed, oldIndex) {
    (oldIndex ? oldIndex.profiles : []).forEach(function (p) { try { storage.removeItem(p.key); } catch (e) { /* ignore */ } });
    parsed.index.profiles.forEach(function (p) { Trainer.save(storage, parsed.states[p.id], p.key); });
    save(storage, parsed.index);
    return parsed.index;
  }

  return { INDEX_KEY: INDEX_KEY, MAX_PROFILES: MAX_PROFILES, TEACH_DAYS: TEACH_DAYS, TEACH_MINUTES: TEACH_MINUTES, KINDS: KINDS,
    startingSettings: startingSettings, lettersFrom: lettersFrom, initialsOf: initialsOf, orderFor: orderFor, newState: newState,
    defaultIndex: defaultIndex, validate: validate, load: load, save: save, active: active, find: find, setActive: setActive,
    add: add, rename: rename, remove: remove, setFamilyNames: setFamilyNames, summary: summary, teachingDays: teachingDays,
    exportAll: exportAll, parseBackup: parseBackup, applyBackup: applyBackup };
});
