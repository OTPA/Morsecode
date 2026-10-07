/* Web Audio: scheduled characters for listening, live side tone for keying. */
(function (root) {
  var ENV = 0.005; // 5 ms raised-cosine attack and release: no clicks

  function curve(up) {
    var n = 32, a = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var v = 0.5 * (1 - Math.cos(Math.PI * i / (n - 1)));
      a[i] = up ? v : 1 - v;
    }
    return a;
  }
  var ATTACK = curve(true), RELEASE = curve(false);

  function MorseAudio(getSettings) {
    this.getSettings = getSettings;
    this.ctx = null;
    this.live = null;
  }

  /** Must run inside a user gesture (phones block audio otherwise). */
  MorseAudio.prototype.unlock = function () {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  };

  /** The shared audio context (after unlock), for playing recorded clips. */
  MorseAudio.prototype.context = function () { return this.unlock() ? this.ctx : null; };

  // Band-pass noise is much quieter than the white noise it is cut from, so this scales it back up
  // to make the "noise level" setting mean roughly what it says (checked by measurement in the tests).
  var NOISE_COMP = 4.57;   // measured: band-passed noise came out 13.2 dB too quiet without this
  var NOISE_Q = 1.2;

  /** With noise on, both tone and noise are turned down a little so their sum cannot clip. */
  function headroom(cond) { return cond && cond.snr != null ? 1 / (1 + 1.5 * Math.pow(10, -cond.snr / 20)) : 1; }

  function conditionsFor(s) { return root.Morse.CONDITIONS[s.conditions] || root.Morse.CONDITIONS.clean; }

  /**
   * Schedule one character's tone on any context (live or offline), starting at t0 seconds.
   * Returns the character's length in seconds. Raised-cosine attack and release on every element.
   * opts (optional): {cond, rng, code}. `cond` is a practice-conditions preset; `code` is a dit/dah string (prosigns).
   */
  MorseAudio.scheduleChar = function (ctx, destination, ch, t0, s, opts) {
    opts = opts || {};
    var t = root.Morse.timing(s.charWpm, s.effWpm);
    var seg = opts.code ? root.Morse.segmentsForCode(opts.code, t) : root.Morse.segments(ch, t);
    seg = root.Morse.humanize(seg, opts.cond, opts.rng);
    var v = root.Morse.toneVariation(opts.cond, opts.rng);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    var f0 = Math.max(200, s.pitch + v.pitch);
    osc.frequency.setValueAtTime(f0, Math.max(0, t0 - 0.01));
    if (v.drift) osc.frequency.linearRampToValueAtTime(Math.max(200, f0 + v.drift), t0 + seg.duration);
    gain.gain.value = 0;
    osc.connect(gain).connect(destination);
    var vol = s.volume * v.gain * headroom(opts.cond);
    seg.segments.forEach(function (e) {
      var start = t0 + e.start, end = start + e.dur;
      gain.gain.setValueCurveAtTime(ATTACK.map(function (x) { return x * vol; }), start, ENV);
      gain.gain.setValueAtTime(vol, start + ENV);
      gain.gain.setValueCurveAtTime(RELEASE.map(function (x) { return x * vol; }), end - ENV, ENV);
    });
    osc.start(Math.max(0, t0 - 0.01));
    osc.stop(t0 + seg.duration + 0.05);
    return seg.duration;
  };

  /** A looping bit of white noise, made once per context. */
  function noiseBuffer(ctx) {
    if (!ctx.__morseNoise) {
      var n = Math.floor(ctx.sampleRate * 2);
      var buf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      ctx.__morseNoise = buf;
    }
    return ctx.__morseNoise;
  }

  /**
   * Band-limited noise around the tone's pitch from t0 to t1, `cond.snr` dB below the tone. Does nothing for clean.
   * Returns the node it started (so a caller can stop it early), or null.
   */
  MorseAudio.scheduleNoise = function (ctx, destination, t0, t1, s, cond) {
    if (!cond || cond.snr == null) return null;
    var src = ctx.createBufferSource();
    var bp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    var level = s.volume * headroom(cond) * Math.pow(10, -cond.snr / 20) * NOISE_COMP;
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    bp.type = 'bandpass';
    bp.frequency.value = s.pitch;
    bp.Q.value = NOISE_Q;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.06);
    g.gain.setValueAtTime(level, Math.max(t0 + 0.06, t1 - 0.06));
    g.gain.linearRampToValueAtTime(0, t1);
    src.connect(bp).connect(g).connect(destination);
    src.start(t0);
    src.stop(t1 + 0.05);
    return src;
  };

  /**
   * Play one character now (+delay), under the current practice conditions (or a clean tone when `clean` is true,
   * which teaching screens use). Returns its duration in seconds.
   */
  MorseAudio.prototype.playChar = function (ch, delay, clean) {
    if (!this.unlock()) return 0;
    var s = this.getSettings();
    var cond = clean ? root.Morse.CONDITIONS.clean : conditionsFor(s);
    var d = delay == null ? 0.05 : delay;
    var t0 = this.ctx.currentTime + d;
    var len = MorseAudio.scheduleChar(this.ctx, this.ctx.destination, ch, t0, s, { cond: cond });
    MorseAudio.scheduleNoise(this.ctx, this.ctx.destination, Math.max(this.ctx.currentTime, t0 - 0.3), t0 + len + 0.3, s, cond);
    return len + d;
  };

  /**
   * Play text as one word: each character at character speed, the Farnsworth gap between characters and the
   * word gap at a space. Returns the total length in seconds (including the start delay).
   */
  MorseAudio.prototype.playText = function (text, delay) {
    if (!this.unlock()) return 0;
    var s = this.getSettings();
    var cond = conditionsFor(s);
    var t = root.Morse.timing(s.charWpm, s.effWpm);
    var d = delay == null ? 0.1 : delay;
    var start = this.ctx.currentTime + d;
    var at = start;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === ' ') { at += t.wordGap - t.charGap; continue; }
      if (!root.Morse.TABLE[c]) continue;
      at += MorseAudio.scheduleChar(this.ctx, this.ctx.destination, c, at, s, { cond: cond }) + t.charGap;
    }
    var end = at - t.charGap;
    MorseAudio.scheduleNoise(this.ctx, this.ctx.destination, Math.max(this.ctx.currentTime, start - 0.3), end + 0.3, s, cond);
    return end - this.ctx.currentTime;
  };

  /** Play a prosign (AR, SK, BT, KN, AS) as one run-together character. */
  MorseAudio.prototype.playProsign = function (name, delay) {
    if (!this.unlock() || !root.Morse.PROSIGNS[name]) return 0;
    var s = this.getSettings();
    var cond = conditionsFor(s);
    var d = delay == null ? 0.1 : delay;
    var t0 = this.ctx.currentTime + d;
    var len = MorseAudio.scheduleChar(this.ctx, this.ctx.destination, name, t0, s, { cond: cond, code: root.Morse.PROSIGNS[name] });
    MorseAudio.scheduleNoise(this.ctx, this.ctx.destination, Math.max(this.ctx.currentTime, t0 - 0.3), t0 + len + 0.3, s, cond);
    return len + d;
  };

  /** Side tone while a key is held. */
  MorseAudio.prototype.keyDown = function () {
    if (!this.unlock()) return;
    var s = this.getSettings();
    var ctx = this.ctx;
    if (!this.live) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      this.live = { osc: osc, gain: gain };
    }
    this.live.osc.frequency.value = s.pitch;
    var g = this.live.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(s.volume, ctx.currentTime, ENV / 2.5);
  };

  MorseAudio.prototype.keyUp = function () {
    if (!this.ctx || !this.live) return;
    var g = this.live.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(0, this.ctx.currentTime, ENV / 2.5);
  };

  root.MorseAudio = MorseAudio;
})(typeof self !== 'undefined' ? self : this);
