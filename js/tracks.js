/* Audio tracks: a practice session rendered to one audio file you can play with the screen off.
   `layout` is pure (steps + durations -> timeline). `render` uses Web Audio's offline renderer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'), require('./study.js'), require('./trainer.js'));
  else root.Tracks = factory(root.Morse, root.Study, root.Trainer);
})(typeof self !== 'undefined' ? self : this, function (Morse, Study, Trainer) {
  var RATE = 22050;
  var KINDS = { learn: 'Learn the letters (name, sound, recall)', review: 'Listen and recall (sound, pause, name)' };

  /** Which characters a track would speak, so the learner knows which recordings are needed. */
  function charsFor(kind, st) {
    return kind === 'learn' ? (function () { var p = Study.plan(st); return p.target.concat(p.known); })() : Trainer.unlocked(st);
  }

  /** Characters that have no recording of their name yet. `has(id)` says whether a clip exists. */
  function missing(chars, has) {
    return chars.filter(function (c) { return !has('ch-' + c); });
  }

  /** Steps for one more stretch of the track. */
  function nextSteps(kind, st, rng, thinkSec) {
    if (kind === 'learn') {
      var p = Study.plan(st);
      return Study.session({ target: p.target, known: p.known, rng: rng, repsA: 2, repsB: 2, mix: 6 });
    }
    var steps = [];
    var last = null;
    for (var i = 0; i < 12; i++) {
      var ch = Trainer.pick(st, 'listen', rng, last, { review: false });
      last = ch;
      steps.push({ t: 'tone', ch: ch }, { t: 'pause', s: thinkSec }, { t: 'name', ch: ch }, { t: 'pause', s: 0.6 },
        { t: 'tone', ch: ch }, { t: 'pause', s: 1.6 });
    }
    return steps;
  }

  /**
   * Lay steps out on a timeline. dur = {tone(ch), name(ch)} in seconds.
   * Stops at the first step that would run past `limit` seconds. Returns {events:[{at, t, ch}], total}.
   */
  function layout(steps, dur, limit) {
    var events = [], at = 0;
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var d = s.t === 'pause' ? s.s : s.t === 'tone' ? dur.tone(s.ch) : dur.name(s.ch);
      if (at + d > limit) break;
      if (s.t !== 'pause') events.push({ at: at, t: s.t, ch: s.ch });
      at += d;
    }
    return { events: events, total: at };
  }

  /**
   * Render a track to a mono 22.05 kHz WAV (Uint8Array).
   * io: {OfflineAudioContext, MorseAudio (optional), getBuffer(id) -> Promise<AudioBuffer|null>, has(id), settings, encodeWav, progress(0..1)}
   */
  function render(kind, st, minutes, rng, io) {
    var settings = io.settings;
    var MorseAudio = io.MorseAudio || (typeof self !== 'undefined' ? self : globalThis).MorseAudio;
    var timing = Morse.timing(settings.charWpm, settings.charWpm);
    var ids = {};
    var chars = charsFor(kind, st);
    var all = chars.slice();
    var loads = [];
    all.forEach(function (c) {
      ['ch-' + c, 'nato-' + c].forEach(function (id) {
        if (io.has(id) && !(id in ids)) { ids[id] = null; loads.push(io.getBuffer(id).then(function (b) { ids[id] = b; })); }
      });
    });
    return Promise.all(loads).then(function () {
      function nameIds(ch) {
        var out = [];
        if (ids['ch-' + ch]) out.push('ch-' + ch);
        if (settings.phonetic && ids['nato-' + ch]) out.push('nato-' + ch);
        return out;
      }
      var dur = {
        tone: function (ch) { return Morse.segments(ch, timing).duration + 0.1; },
        name: function (ch) {
          return nameIds(ch).reduce(function (a, id) { return a + ids[id].duration + 0.06; }, 0.02);
        }
      };
      var limit = minutes * 60;
      var events = [], at = 0;
      while (at < limit - 3) {
        var steps = nextSteps(kind, st, rng, settings.thinkSec);
        var part = layout(steps, dur, limit - at);
        if (!part.events.length) break;
        part.events.forEach(function (e) { events.push({ at: at + e.at, t: e.t, ch: e.ch }); });
        at += part.total;
        if (io.progress) io.progress(Math.min(1, at / limit));
      }
      var length = Math.ceil((at + 2) * RATE);
      var ctx = new io.OfflineAudioContext(1, length, RATE);
      var master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      events.forEach(function (e) {
        if (e.t === 'tone') {
          MorseAudio.scheduleChar(ctx, master, e.ch, e.at + 0.05, settings);
        } else {
          var t = e.at + 0.02;
          nameIds(e.ch).forEach(function (id) {
            var src = ctx.createBufferSource();
            var g = ctx.createGain();
            g.gain.value = settings.speechVolume;
            src.buffer = ids[id];
            src.connect(g).connect(master);
            src.start(t);
            t += ids[id].duration + 0.06;
          });
        }
      });
      return ctx.startRendering().then(function (buf) {
        return { wav: io.encodeWav(buf.getChannelData(0), RATE), seconds: at + 2, events: events.length };
      });
    });
  }

  return { RATE: RATE, KINDS: KINDS, charsFor: charsFor, missing: missing, nextSteps: nextSteps, layout: layout, render: render };
});
