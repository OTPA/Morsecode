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

  /** Play one character now (+delay). Returns its duration in seconds. */
  MorseAudio.prototype.playChar = function (ch, delay) {
    if (!this.unlock()) return 0;
    var s = this.getSettings();
    var t = root.Morse.timing(s.charWpm, s.effWpm);
    var seg = root.Morse.segments(ch, t);
    var ctx = this.ctx;
    var t0 = ctx.currentTime + (delay || 0.05);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = s.pitch;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    var vol = s.volume;
    seg.segments.forEach(function (e) {
      var start = t0 + e.start, end = start + e.dur;
      gain.gain.setValueCurveAtTime(ATTACK.map(function (v) { return v * vol; }), start, ENV);
      gain.gain.setValueAtTime(vol, start + ENV);
      gain.gain.setValueCurveAtTime(RELEASE.map(function (v) { return v * vol; }), end - ENV, ENV);
    });
    osc.start(t0 - 0.01);
    osc.stop(t0 + seg.duration + 0.05);
    return seg.duration + (delay || 0.05);
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
