/* Turns what speech recognition heard into a character or a command, and builds what to say back.
   Pure: no DOM, no speech APIs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var NATO = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
    J: 'Juliet', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
    S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu'
  };
  var SPOKEN = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '.': 'period', ',': 'comma', '/': 'slash', '?': 'question mark'
  };

  /** What to say for a character, e.g. "K, Kilo" (phonetic) or "K". */
  function say(ch, phonetic) {
    ch = String(ch).toUpperCase();
    if (SPOKEN[ch]) return SPOKEN[ch];
    return phonetic && NATO[ch] ? ch + ', ' + NATO[ch] : ch;
  }

  // Spoken word -> candidate characters. NATO words are unambiguous; the rest are letter names and homophones.
  var NATO_WORDS = { alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H',
    india: 'I', juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q',
    romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', whisky: 'W', xray: 'X', yankee: 'Y', zulu: 'Z' };

  var NAMES = {
    A: 'a ay eh hey', B: 'b bee be', C: 'c see sea cee', D: 'd dee', E: 'e ee', F: 'f eff ef', G: 'g gee jee', H: 'h aitch age',
    I: 'i eye aye', J: 'j jay', K: 'k kay okay ok', L: 'l el ell elle', M: 'm em', N: 'n en and', O: 'o oh owe', P: 'p pee pea',
    Q: 'q queue cue kew', R: 'r are ar', S: 's ess es', T: 't tee tea', U: 'u you ewe yu', V: 'v vee', W: 'w doubleu',
    X: 'x ex', Y: 'y why wye', Z: 'z zee zed'
  };
  var OTHER = {
    '0': 'zero', '1': 'one won', '2': 'two too to', '3': 'three', '4': 'four for fore', '5': 'five fife', '6': 'six',
    '7': 'seven', '8': 'eight ate', '9': 'nine niner',
    '.': 'period dot fullstop', ',': 'comma', '/': 'slash stroke', '?': 'question questionmark'
  };

  var WORDS = {}; // word -> [chars]
  function add(word, ch) {
    if (!WORDS[word]) WORDS[word] = [];
    if (WORDS[word].indexOf(ch) < 0) WORDS[word].push(ch);
  }
  [NAMES, OTHER].forEach(function (table) {
    Object.keys(table).forEach(function (ch) { table[ch].split(' ').forEach(function (w) { add(w, ch); }); });
  });
  add('oh', '0'); // "oh" may mean zero when O is not on the pad

  var COMMANDS = [
    ['stop', /\b(stop|quit|exit|finish|end session)\b/],
    ['skip', /\b(skip|pass|next|give up|dont know|do not know|no idea)\b/],
    ['repeat', /\b(repeat|again|replay|say that again|pardon|sorry)\b/]
  ];

  function normalise(text) {
    return String(text || '').toLowerCase()
      .replace(/['’]/g, '')
      .replace(/double[\s-]*(you|u)\b/g, 'w')
      .replace(/x[\s-]+ray/g, 'xray')
      .replace(/question[\s-]+mark/g, 'question')
      .replace(/full[\s-]+stop/g, 'fullstop')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** Characters one transcript could mean: a NATO word wins, otherwise the last recognised word. */
  function candidates(text) {
    var tokens = normalise(text).split(' ').filter(Boolean);
    var nato = null, last = null;
    tokens.forEach(function (t) {
      if (NATO_WORDS[t]) nato = [NATO_WORDS[t]];
      var list = WORDS[t] || (/^[0-9]$/.test(t) ? [t] : null);
      if (list) last = list;
    });
    return nato || last || [];
  }

  /**
   * alternatives: transcripts from the recogniser, best first. allowed: characters on the pad.
   * Returns {type:'char', ch} | {type:'stop'|'skip'|'repeat'} | null.
   * An allowed character beats a more likely one that is not on the pad.
   */
  function parse(alternatives, allowed) {
    var alts = (alternatives || []).filter(function (a) { return a && a.trim(); });
    var fallback = null;
    for (var i = 0; i < alts.length; i++) {
      var norm = normalise(alts[i]);
      for (var c = 0; c < COMMANDS.length; c++) {
        if (COMMANDS[c][1].test(norm)) return { type: COMMANDS[c][0] };
      }
      var cands = candidates(alts[i]);
      for (var j = 0; j < cands.length; j++) {
        if (!allowed || allowed.indexOf(cands[j]) >= 0) return { type: 'char', ch: cands[j] };
      }
      if (!fallback && cands.length) fallback = { type: 'char', ch: cands[0] };
    }
    return fallback;
  }

  return { say: say, parse: parse, normalise: normalise, NATO: NATO };
});
