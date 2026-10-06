(function () {
  var M = window.Morse, T = window.Trainer;

  function storage() { try { return window.localStorage; } catch (e) { return null; } }
  var st = T.load(storage());
  var audio = new window.MorseAudio(function () { return st.settings; });

  var ui = {
    tab: 'listen',
    listen: { phase: 'idle', last: null },
    send: { phase: 'idle', last: null, pattern: '', down: 0, endTimer: null }
  };
  var timers = [];
  var view = document.getElementById('view');
  var live = document.getElementById('live');

  function save() { T.save(storage(), st); }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function say(text) { live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); }
  function pct(x) { return x === null ? '–' : Math.round(x * 100) + '%'; }

  /* ---------- wake lock ---------- */
  var wake = null;
  function keepAwake() {
    try {
      if (navigator.wakeLock && !wake) {
        navigator.wakeLock.request('screen').then(function (l) {
          wake = l;
          l.addEventListener('release', function () { wake = null; });
        }).catch(function () {});
      }
    } catch (e) { /* not available */ }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (ui.listen.phase !== 'idle' || ui.send.phase !== 'idle')) keepAwake();
  });

  /* ---------- pattern glyph (feedback screens only) ---------- */
  function glyph(code, unit) {
    unit = unit || 14;
    var x = 0, rects = '';
    for (var i = 0; i < code.length; i++) {
      var w = code.charAt(i) === '-' ? unit * 3 : unit;
      rects += '<rect x="' + x + '" y="0" width="' + w + '" height="' + unit + '" rx="' + unit / 2 + '"/>';
      x += w + unit;
    }
    x = Math.max(x - unit, unit);
    var spoken = code.split('').map(function (c) { return c === '-' ? 'dah' : 'di'; }).join(' ');
    return '<svg class="me-glyph" viewBox="0 0 ' + x + ' ' + unit + '" width="' + x + '" height="' + unit +
      '" role="img" aria-label="' + (spoken || 'no sound') + '">' + rects + '</svg>';
  }

  /* ---------- tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs button'));
  tabs.forEach(function (b) {
    b.addEventListener('click', function () { go(b.getAttribute('data-tab')); });
  });
  function go(tab) {
    clearTimers();
    releaseKey();
    clearTimeout(ui.send.endTimer);
    ui.tab = tab;
    // a half-finished trial restarts cleanly when you come back
    if (ui.listen.phase !== 'idle') ui.listen.phase = 'idle';
    if (ui.send.phase !== 'idle') ui.send.phase = 'idle';
    render();
  }
  function render() {
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === ui.tab)); });
    ({ listen: renderListen, send: renderSend, progress: renderProgress, settings: renderSettings })[ui.tab]();
  }

  /* ---------- listen ---------- */
  function readout() {
    var s = st.settings;
    return '<p class="readout">Level ' + st.level + ' of ' + M.KOCH_ORDER.length + ' · ' + s.charWpm + '/' + s.effWpm +
      ' WPM · block ' + st.block.length + '/' + T.BLOCK + '</p>';
  }

  function renderListen() {
    var L = ui.listen;
    if (L.phase === 'idle') {
      view.innerHTML = '<section class="card center"><h2>Listen</h2>' +
        '<p>You will hear one character at a time. Say which one it was. There is nothing to look at: just listen.</p>' +
        readout() + '<button class="btn primary" id="start">Start</button></section>';
      document.getElementById('start').addEventListener('click', startListen);
    } else if (L.phase === 'intro') {
      view.innerHTML = '<section class="card center"><p class="label">New character</p>' +
        '<div class="big" aria-label="' + L.introChar + '">' + L.introChar + '</div>' +
        '<p class="hint" id="count">Played 0 of 5</p>' +
        '<div class="row"><button class="btn" id="again">Play again</button>' +
        '<button class="btn primary" id="gotit">Got it</button></div></section>';
      document.getElementById('again').addEventListener('click', function () { audio.playChar(L.introChar); });
      document.getElementById('gotit').addEventListener('click', function () {
        clearTimers();
        st.introduced++;
        save();
        afterIntro();
      });
    } else if (L.phase === 'prompt') {
      var keys = T.unlocked(st).map(function (c) { return '<button type="button" data-ch="' + c + '" aria-label="' + c + '">' + c + '</button>'; }).join('');
      view.innerHTML = '<section class="card center">' + readout() +
        '<h2>Which character?</h2><p class="hint">Type it or tap it.</p>' +
        '<div class="row"><button class="btn primary" id="replay">Replay</button></div>' +
        '<div class="pad" id="pad">' + keys + '</div></section>';
      document.getElementById('replay').addEventListener('click', function () { audio.playChar(L.ch); });
      document.getElementById('pad').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-ch]');
        if (b) answerListen(b.getAttribute('data-ch'));
      });
    } else {
      var ok = L.ok, e = L.event, msg = '';
      if (e && e.event === 'advance') msg = 'Block complete: ' + pct(e.accuracy) + '. New character unlocked: ' + e.newChar + '.';
      else if (e && e.event === 'regress') msg = 'Block complete: ' + pct(e.accuracy) + '. Going back one character to firm it up.';
      else if (e) msg = 'Block complete: ' + pct(e.accuracy) + '. Same characters again.';
      view.innerHTML = '<section class="card center"><span class="status ' + (ok ? 'correct' : 'wrong') + '">' +
        (ok ? '✓ Correct' : '✕ Not quite, it was ' + L.ch) + '</span>' +
        '<div class="big">' + L.ch + '</div>' +
        '<div class="glyphs">' + glyph(M.TABLE[L.ch], 16) + '</div>' +
        (msg ? '<p>' + msg + '</p>' : '') +
        '<div class="row"><button class="btn" id="again">Play again</button>' +
        '<button class="btn primary" id="next">Next</button></div></section>';
      document.getElementById('again').addEventListener('click', function () { audio.playChar(L.ch); });
      var next = document.getElementById('next');
      next.addEventListener('click', afterIntro);
      next.focus();
    }
  }

  function startListen() {
    audio.unlock();
    keepAwake();
    afterIntro();
  }

  function afterIntro() {
    clearTimers();
    if (st.introduced < st.level) startIntro();
    else nextListen();
  }

  function startIntro() {
    var L = ui.listen;
    L.phase = 'intro';
    L.introChar = M.KOCH_ORDER[st.introduced];
    var played = 0;
    render();
    (function loop() {
      if (ui.tab !== 'listen' || L.phase !== 'intro') return;
      var dur = audio.playChar(L.introChar);
      played++;
      var c = document.getElementById('count');
      if (c) c.textContent = 'Played ' + played + ' of 5';
      if (played < 5) later(loop, (dur + 1.1) * 1000);
    })();
  }

  function nextListen() {
    var L = ui.listen;
    L.ch = T.pick(st, 'listen', Math.random, L.last);
    L.last = L.ch;
    L.phase = 'prompt';
    render();
    later(function () { audio.playChar(L.ch); }, 300);
  }

  function answerListen(letter) {
    var L = ui.listen;
    if (L.phase !== 'prompt') return;
    var ok = letter === L.ch;
    L.ok = ok;
    L.event = T.record(st, 'listen', L.ch, ok);
    save();
    L.phase = 'reveal';
    render();
    say(ok ? 'Correct' : 'Not quite, it was ' + L.ch);
    if (!ok) later(function () { audio.playChar(L.ch); }, 400);
    else if (!L.event) later(afterIntro, 900);
  }

  /* ---------- send (keying practice) ---------- */
  function sendUnit() { return 1.2 / st.settings.sendWpm; }

  function renderSend() {
    var S = ui.send;
    if (S.phase === 'idle') {
      view.innerHTML = '<section class="card center"><h2>Send</h2>' +
        '<p>Key each character yourself and hear your own tone. Hold the big key (or the space bar) for dits and dahs, then pause.</p>' +
        '<p class="hint">You only send characters you have unlocked. Speed and echo mode are in Settings.</p>' +
        '<button class="btn primary" id="start">Start</button></section>';
      document.getElementById('start').addEventListener('click', startSend);
    } else if (S.phase === 'prompt') {
      var echo = st.settings.echo;
      view.innerHTML = '<section class="card center"><p class="label">' + (echo ? 'Listen, then send it back' : 'Send this character') + '</p>' +
        '<div class="big" aria-label="' + (echo ? 'hidden' : S.ch) + '">' + (echo ? '?' : S.ch) + '</div>' +
        '<div class="row"><button class="btn" id="hear">Hear it</button></div>' +
        '<div class="key" id="key" role="button" tabindex="0" aria-label="Morse key. Hold to sound the tone.">Hold to send · or space bar</div></section>';
      document.getElementById('hear').addEventListener('click', function () { audio.playChar(S.ch); });
      var key = document.getElementById('key');
      key.addEventListener('pointerdown', function (e) { e.preventDefault(); key.setPointerCapture(e.pointerId); keyOn(); });
      key.addEventListener('pointerup', keyOff);
      key.addEventListener('pointercancel', keyOff);
    } else {
      var ok = S.ok;
      view.innerHTML = '<section class="card center"><span class="status ' + (ok ? 'correct' : 'wrong') + '">' +
        (ok ? '✓ Correct' : '✕ Not quite, it was ' + S.ch) + '</span>' +
        '<div class="big">' + S.ch + '</div>' +
        '<div class="glyphs"><div><div class="label">Target</div>' + glyph(M.TABLE[S.ch], 16) + '</div>' +
        '<div><div class="label">You sent</div>' + (S.pattern ? glyph(S.pattern, 16) : '<p class="hint">nothing</p>') + '</div></div>' +
        '<div class="row"><button class="btn" id="again">Hear it</button><button class="btn primary" id="next">Next</button></div></section>';
      document.getElementById('again').addEventListener('click', function () { audio.playChar(S.ch); });
      var next = document.getElementById('next');
      next.addEventListener('click', nextSend);
      next.focus();
    }
  }

  function startSend() {
    audio.unlock();
    keepAwake();
    nextSend();
  }

  function nextSend() {
    clearTimers();
    var S = ui.send;
    S.ch = T.pick(st, 'send', Math.random, S.last);
    S.last = S.ch;
    S.pattern = '';
    S.down = 0;
    S.phase = 'prompt';
    render();
    later(function () { audio.playChar(S.ch); }, 300);
  }

  function keyOn() {
    var S = ui.send;
    if (ui.tab !== 'send' || S.phase !== 'prompt' || S.down) return;
    clearTimeout(S.endTimer);
    S.down = performance.now();
    audio.keyDown();
    var k = document.getElementById('key');
    if (k) k.classList.add('down');
  }

  function keyOff() {
    var S = ui.send;
    if (!S.down) return;
    var seconds = (performance.now() - S.down) / 1000;
    S.down = 0;
    audio.keyUp();
    var k = document.getElementById('key');
    if (k) k.classList.remove('down');
    S.pattern += M.classify(seconds, sendUnit());
    // a pause of about three and a half units ends the character
    S.endTimer = setTimeout(finishSend, 3.5 * sendUnit() * 1000);
  }

  function releaseKey() {
    if (ui.send.down) { ui.send.down = 0; audio.keyUp(); }
  }

  function finishSend() {
    var S = ui.send;
    if (S.phase !== 'prompt' || !S.pattern) return;
    S.ok = S.pattern === M.TABLE[S.ch];
    T.record(st, 'send', S.ch, S.ok);
    save();
    S.phase = 'reveal';
    render();
    say(S.ok ? 'Correct' : 'Not quite, it was ' + S.ch);
    if (!S.ok) later(function () { audio.playChar(S.ch); }, 400);
    else later(nextSend, 1000);
  }

  /* ---------- progress ---------- */
  function renderProgress() {
    var chips = M.KOCH_ORDER.map(function (c, i) {
      var state = i < st.level - 1 ? 'mastered' : i === st.level - 1 ? 'current' : 'locked';
      var label = c + ', ' + (state === 'locked' ? 'not yet unlocked' : state === 'current' ? 'newest character' : 'mastered');
      return '<span class="chip ' + state + '" aria-label="' + label + '">' + c + '</span>';
    }).join('');
    var weak = Object.keys(st.chars.listen).map(function (c) {
      var x = st.chars.listen[c];
      return { c: c, n: x.n, acc: x.ok / x.n };
    }).filter(function (x) { return x.n >= 3 && x.acc < 1; })
      .sort(function (a, b) { return a.acc - b.acc; }).slice(0, 5)
      .map(function (x) { return x.c + ' ' + pct(x.acc); }).join(' · ') || '–';
    var s = st.settings;
    view.innerHTML = '<section class="card"><h2>Progress</h2>' +
      '<p class="label">Koch order</p><div class="ladder">' + chips + '</div>' +
      '<dl class="stats">' +
      '<dt>Level</dt><dd>' + st.level + ' of ' + M.KOCH_ORDER.length + '</dd>' +
      '<dt>Listening accuracy (last 50)</dt><dd>' + pct(T.accuracy(st.recent.listen)) + '</dd>' +
      '<dt>Sending accuracy (last 50)</dt><dd>' + pct(T.accuracy(st.recent.send)) + '</dd>' +
      '<dt>Speed (character / effective)</dt><dd>' + s.charWpm + ' / ' + s.effWpm + ' WPM</dd>' +
      '<dt>Weakest by ear</dt><dd>' + weak + '</dd></dl>' +
      '<p class="hint">At 90% over 50 characters the next character unlocks. Below 70% the newest one steps back.</p></section>';
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    var s = st.settings;
    view.innerHTML = '<section class="card"><h2>Settings</h2><form class="settings" id="form" onsubmit="return false">' +
      range('pitch', 'Tone pitch', 400, 900, 10, s.pitch, ' Hz') +
      range('charWpm', 'Character speed', 15, 30, 1, s.charWpm, ' WPM') +
      range('effWpm', 'Effective speed (gaps stretched below this)', 5, 30, 1, s.effWpm, ' WPM') +
      '<div class="field check"><input type="checkbox" id="auto"' + (s.auto ? ' checked' : '') + '>' +
      '<label for="auto">Raise effective speed by 1 WPM each time a block passes</label></div>' +
      range('sendWpm', 'Sending speed (your keying)', 5, 20, 1, s.sendWpm, ' WPM') +
      '<div class="field check"><input type="checkbox" id="echo"' + (s.echo ? ' checked' : '') + '>' +
      '<label for="echo">Echo mode: hear the character, letter hidden, send it back</label></div>' +
      range('volume', 'Volume', 0.1, 1, 0.05, s.volume, '') +
      '<div class="row"><button type="button" class="btn" id="test">Play test tone</button>' +
      '<button type="button" class="btn danger" id="reset">Reset progress</button></div>' +
      '</form></section>';
    ['pitch', 'charWpm', 'effWpm', 'sendWpm', 'volume'].forEach(function (k) {
      var input = document.getElementById(k);
      input.addEventListener('input', function () {
        st.settings[k] = Number(input.value);
        if (st.settings.effWpm > st.settings.charWpm) st.settings.effWpm = st.settings.charWpm;
        document.getElementById(k + '-out').textContent = fmt(k, st.settings[k]);
        if (k === 'charWpm' || k === 'effWpm') {
          var e = document.getElementById('effWpm');
          e.value = st.settings.effWpm;
          document.getElementById('effWpm-out').textContent = fmt('effWpm', st.settings.effWpm);
        }
        save();
      });
    });
    document.getElementById('auto').addEventListener('change', function (e) { st.settings.auto = e.target.checked; save(); });
    document.getElementById('echo').addEventListener('change', function (e) { st.settings.echo = e.target.checked; save(); });
    document.getElementById('test').addEventListener('click', function () { audio.unlock(); audio.playChar('K'); });
    document.getElementById('reset').addEventListener('click', function () {
      if (window.confirm('Reset all progress and settings?')) {
        st = T.defaults();
        save();
        go('listen');
      }
    });
  }
  var UNITS = { pitch: ' Hz', charWpm: ' WPM', effWpm: ' WPM', sendWpm: ' WPM', volume: '' };
  function fmt(k, v) { return (k === 'volume' ? Math.round(v * 100) + '%' : v + UNITS[k]); }
  function range(id, label, min, max, step, value, unit) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<output id="' + id + '-out">' + fmt(id, value) + '</output></div>';
  }

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' && e.target.type !== 'checkbox') return;
    if (ui.tab === 'listen') {
      var L = ui.listen;
      if (L.phase === 'prompt') {
        var c = e.key.length === 1 ? e.key.toUpperCase() : '';
        if (c && T.unlocked(st).indexOf(c) >= 0) { e.preventDefault(); answerListen(c); }
        else if (e.key === ' ') { e.preventDefault(); audio.playChar(L.ch); }
      } else if (L.phase === 'reveal' && e.key === 'Enter') {
        e.preventDefault();
        afterIntro();
      }
    } else if (ui.tab === 'send') {
      if (e.key === ' ' && ui.send.phase === 'prompt') { e.preventDefault(); if (!e.repeat) keyOn(); }
      else if (e.key === 'Enter' && ui.send.phase === 'reveal') { e.preventDefault(); nextSend(); }
    }
  });
  document.addEventListener('keyup', function (e) {
    if (ui.tab === 'send' && e.key === ' ') { e.preventDefault(); keyOff(); }
  });

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  render();
  window.__app = { st: function () { return st; }, ui: ui };
})();
