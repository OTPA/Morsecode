(function () {
  var M = window.Morse, T = window.Trainer;

  function storage() { try { return window.localStorage; } catch (e) { return null; } }
  var st = T.load(storage());
  var audio = new window.MorseAudio(function () { return st.settings; });

  var ui = {
    tab: 'listen',
    listen: { phase: 'idle', last: null },
    send: { phase: 'idle', last: null, pattern: '', down: 0, endTimer: null },
    voice: { running: false, mode: 'quiz', last: null, message: '' }
  };
  var VP = window.VoiceParse, V = window.Voice;
  var timers = [];
  var view = document.getElementById('view');
  var live = document.getElementById('live');

  function save() { T.save(storage(), st); }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function say(text) { live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); }
  function pct(x) { return x === null ? '–' : Math.round(x * 100) + '%'; }

  /** Speak the verdict when "speak results" is on. Returns true if it is speaking; `then` runs when it ends. */
  function announce(ok, ch, then) {
    if (!st.settings.speak || !V.canSpeak) return false;
    var text = ok ? 'Correct.' : 'Not quite. It was ' + VP.say(ch, st.settings.phonetic) + '.';
    V.speak(text, st.settings.speechRate).then(then || function () {});
    return true;
  }

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
    stopVoice();
    V.cancel();
    clearTimeout(ui.send.endTimer);
    ui.tab = tab;
    // a half-finished trial restarts cleanly when you come back
    if (ui.listen.phase !== 'idle') ui.listen.phase = 'idle';
    if (ui.send.phase !== 'idle') ui.send.phase = 'idle';
    render();
  }
  function render() {
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === ui.tab)); });
    ({ listen: renderListen, send: renderSend, voice: renderVoice, progress: renderProgress, settings: renderSettings })[ui.tab]();
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
    var shown = L.ch;
    var spoke = announce(ok, shown, function () {
      if (!ok && ui.tab === 'listen' && L.phase === 'reveal' && L.ch === shown) audio.playChar(shown);
    });
    if (!ok && !spoke) later(function () { audio.playChar(L.ch); }, 400);
    else if (ok && !L.event) later(afterIntro, spoke ? 1400 : 900);
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
    var target = S.ch;
    var spoke = announce(S.ok, target, function () {
      if (!S.ok && ui.tab === 'send' && S.phase === 'reveal' && S.ch === target) audio.playChar(target);
    });
    if (!S.ok && !spoke) later(function () { audio.playChar(S.ch); }, 400);
    else if (S.ok) later(nextSend, spoke ? 1500 : 1000);
  }

  /* ---------- voice (hands-free) ---------- */
  var voiceToken = null;

  function renderVoice() {
    var vs = ui.voice, canListen = V.canListen, mode = canListen ? st.settings.voiceMode : 'listen';
    if (!vs.running) {
      view.innerHTML = '<section class="card center"><h2>Voice</h2>' +
        '<p>Practise hands-free. The app plays a character and tells you by voice what it was.</p>' +
        '<div class="choice" role="radiogroup" aria-label="Voice mode">' +
        '<label><input type="radio" name="vmode" value="quiz"' + (mode === 'quiz' ? ' checked' : '') + (canListen ? '' : ' disabled') +
        '><span><strong>Quiz me by voice</strong><br>Say the letter, or its phonetic word such as “Kilo”. The app says whether you were right. Say “repeat”, “skip” or “stop” at any time.</span></label>' +
        '<label><input type="radio" name="vmode" value="listen"' + (mode === 'listen' ? ' checked' : '') +
        '><span><strong>Just listen</strong><br>You hear the sound, a pause to think, then the letter spoken, then the sound again. No answers needed.</span></label></div>' +
        (vs.message ? '<p class="notice" role="alert">' + vs.message + '</p>' : '') +
        (canListen ? '' : '<p class="notice">Voice answers need speech recognition, which this browser does not have. Chrome on Android or on a laptop has it. “Just listen” works here.</p>') +
        (V.canSpeak ? '' : '<p class="notice">This browser cannot speak. Voice practice needs speech output.</p>') +
        '<button class="btn primary big-btn" id="vstart"' + (V.canSpeak ? '' : ' disabled') + '>Start</button>' +
        '<p class="hint" style="margin-top:16px">Only use this where it is safe and legal, and keep your attention on what you are doing. Keep the screen on and this app open: voice practice stops if the screen turns off or you switch apps. Voice answers go through Chrome’s speech service, so they need an internet connection and your voice is sent to Google to be transcribed. Headphones or a quiet room work best.</p></section>';
      Array.prototype.forEach.call(view.querySelectorAll('input[name=vmode]'), function (r) {
        r.addEventListener('change', function () { st.settings.voiceMode = r.value; save(); });
      });
      document.getElementById('vstart').addEventListener('click', startVoice);
    } else {
      view.innerHTML = '<section class="card center"><p class="label">' + (vs.mode === 'quiz' ? 'Quiz by voice' : 'Just listen') + '</p>' +
        '<div class="voice-status" id="vstatus">…</div><div class="voice-heard" id="vheard"></div>' +
        '<button class="btn primary big-btn" id="vstop">Stop</button></section>';
      document.getElementById('vstop').addEventListener('click', function () { stopVoice(); render(); });
    }
  }

  function setStatus(text) { var e = document.getElementById('vstatus'); if (e) e.textContent = text; }
  function setHeard(text) { var e = document.getElementById('vheard'); if (e) e.textContent = text; }

  function wait(ms, token) {
    return new Promise(function (resolve) {
      var id = setTimeout(done, ms);
      function done() {
        clearTimeout(id);
        var i = token.waiters.indexOf(done);
        if (i >= 0) token.waiters.splice(i, 1);
        resolve();
      }
      token.waiters.push(done);
    });
  }

  function stopVoice(message) {
    var t = voiceToken;
    if (!t) return;
    t.stop = true;
    t.waiters.slice().forEach(function (f) { f(); });
    V.cancel();
    voiceToken = null;
    ui.voice.running = false;
    if (message) ui.voice.message = message;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && voiceToken) {
      stopVoice('Voice practice stopped because the screen turned off or you switched apps. Browsers pause the microphone then.');
      if (ui.tab === 'voice') render();
    }
  });

  function startVoice() {
    audio.unlock();
    keepAwake();
    var mode = V.canListen ? st.settings.voiceMode : 'listen';
    ui.voice = { running: true, mode: mode, last: null, message: '', stoppedByVoice: false };
    var token = voiceToken = { stop: false, waiters: [] };
    render();
    runVoice(mode, token).catch(function () {
      ui.voice.message = 'Voice practice stopped because of an error.';
    }).then(function () {
      if (voiceToken === token) {
        voiceToken = null;
        ui.voice.running = false;
        if (ui.tab === 'voice') render();
      }
    });
  }

  function talk(text) { return V.speak(text, st.settings.speechRate); }
  function sayCh(c) { return VP.say(c, st.settings.phonetic); }
  function playAndWait(ch, token) {
    var dur = audio.playChar(ch);
    return wait((dur + 0.35) * 1000, token);
  }

  function blockMessage(r) {
    var head = 'Block complete: ' + Math.round(r.accuracy * 100) + ' percent. ';
    if (r.event === 'advance') return head + 'New character unlocked: ' + sayCh(r.newChar) + '.';
    if (r.event === 'regress') return head + 'Going back one character to firm it up.';
    return head + 'Same characters again.';
  }

  async function introduce(token) {
    var ch = M.KOCH_ORDER[st.introduced];
    setStatus('New character');
    await talk('New character: ' + sayCh(ch) + '. Listen.');
    for (var i = 0; i < 4 && !token.stop; i++) {
      var dur = audio.playChar(ch);
      await wait((dur + 1.2) * 1000, token);
    }
    if (token.stop) return;
    await talk('That was ' + sayCh(ch) + '.');
    st.introduced++;
    save();
  }

  async function fatal(token, text) {
    ui.voice.message = text;
    token.stop = true;
    await talk(text);
  }

  async function quizTrial(token) {
    var vs = ui.voice;
    var ch = T.pick(st, 'listen', Math.random, vs.last);
    vs.last = ch;
    var unlocked = T.unlocked(st), unclear = 0;
    setStatus('Listen…');
    setHeard('');
    await playAndWait(ch, token);
    while (!token.stop) {
      setStatus('Say the letter');
      var r = await V.listen(7000);
      if (token.stop) return;
      if (r.error === 'not-allowed' || r.error === 'service-not-allowed') {
        return fatal(token, 'The microphone is blocked. Allow it for this site in Chrome settings, or use Just listen.');
      }
      if (r.error === 'network') {
        return fatal(token, 'Voice answers need an internet connection. Use Just listen to practise offline.');
      }
      setHeard(r.alts[0] ? 'Heard: ' + r.alts[0] : '');
      var p = VP.parse(r.alts, unlocked);
      if (!p) {
        if (++unclear >= 3) {
          setStatus('It was ' + ch);
          await talk('Skipping. It was ' + sayCh(ch) + '.');
          return;
        }
        await talk(r.alts.length ? "Sorry, I didn't catch that. Say the letter, or say repeat." : 'Say the letter, or say repeat.');
        if (token.stop) return;
        await playAndWait(ch, token);
        continue;
      }
      if (p.type === 'stop') { vs.stoppedByVoice = true; token.stop = true; return; }
      if (p.type === 'repeat') { await playAndWait(ch, token); continue; }
      var skipped = p.type === 'skip';
      var ok = !skipped && p.ch === ch;
      var res = T.record(st, 'listen', ch, ok);
      save();
      setStatus(ok ? '✓ Correct' : '✕ It was ' + ch);
      await talk(ok ? 'Correct.' : (skipped ? 'It was ' : 'Not quite. It was ') + sayCh(ch) + '.');
      if (token.stop) return;
      if (!ok) await playAndWait(ch, token);
      if (res && !token.stop) await talk(blockMessage(res));
      return;
    }
  }

  async function listenTrial(token) {
    var vs = ui.voice;
    var ch = T.pick(st, 'listen', Math.random, vs.last);
    vs.last = ch;
    setStatus('Listen…');
    await playAndWait(ch, token);
    setStatus('Think…');
    await wait(st.settings.thinkSec * 1000, token);
    if (token.stop) return;
    setStatus(ch);
    await talk(sayCh(ch));
    if (token.stop) return;
    await wait(400, token);
    await playAndWait(ch, token);
  }

  async function runVoice(mode, token) {
    await talk(mode === 'quiz'
      ? 'Voice practice. After each sound, say the letter. Say repeat, skip or stop.'
      : 'Just listen. You will hear a sound, then the letter, then the sound again.');
    while (!token.stop) {
      if (st.introduced < st.level) await introduce(token);
      else if (mode === 'quiz') await quizTrial(token);
      else await listenTrial(token);
      if (!token.stop) await wait(600, token);
    }
    if (ui.voice.stoppedByVoice) await talk('Stopped.');
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
      '<div class="field check"><input type="checkbox" id="speak"' + (s.speak ? ' checked' : '') + '>' +
      '<label for="speak">Say “Correct” or “Not quite” out loud in Listen and Send</label></div>' +
      '<div class="field check"><input type="checkbox" id="phonetic"' + (s.phonetic ? ' checked' : '') + '>' +
      '<label for="phonetic">Also say the phonetic word, like “K, Kilo”</label></div>' +
      range('speechRate', 'Voice speed', 0.7, 1.4, 0.1, s.speechRate, '') +
      range('thinkSec', 'Pause before the answer in Just listen', 1, 8, 1, s.thinkSec, ' s') +
      '<div class="row"><button type="button" class="btn" id="test">Play test tone and voice</button>' +
      '<button type="button" class="btn danger" id="reset">Reset progress</button></div>' +
      '</form></section>';
    ['pitch', 'charWpm', 'effWpm', 'sendWpm', 'volume', 'speechRate', 'thinkSec'].forEach(function (k) {
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
    document.getElementById('speak').addEventListener('change', function (e) { st.settings.speak = e.target.checked; save(); });
    document.getElementById('phonetic').addEventListener('change', function (e) { st.settings.phonetic = e.target.checked; save(); });
    document.getElementById('test').addEventListener('click', function () {
      audio.unlock();
      audio.playChar('K');
      if (st.settings.speak) V.speak('Test. Correct. Not quite, it was ' + VP.say('K', st.settings.phonetic) + '.', st.settings.speechRate);
    });
    document.getElementById('reset').addEventListener('click', function () {
      if (window.confirm('Reset all progress and settings?')) {
        st = T.defaults();
        save();
        go('listen');
      }
    });
  }
  var UNITS = { pitch: ' Hz', charWpm: ' WPM', effWpm: ' WPM', sendWpm: ' WPM', thinkSec: ' s' };
  function fmt(k, v) {
    if (k === 'volume') return Math.round(v * 100) + '%';
    if (k === 'speechRate') return v.toFixed(1) + '×';
    return v + UNITS[k];
  }
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
