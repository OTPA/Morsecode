(function () {
  var M = window.Morse, T = window.Trainer;

  function storage() { try { return window.localStorage; } catch (e) { return null; } }
  var st = T.load(storage());
  var audio = new window.MorseAudio(function () { return st.settings; });

  var ui = {
    tab: 'listen',
    listen: { phase: 'idle', last: null },
    send: { phase: 'idle', last: null, pattern: '', down: 0, endTimer: null },
    voice: { running: false, mode: 'quiz', last: null, message: '' },
    settingsView: 'main',
    rec: null,
    cal: null
  };
  var VP = window.VoiceParse, V = window.Voice, C = window.Clips;
  var timers = [];
  var view = document.getElementById('view');
  var live = document.getElementById('live');

  function save() { T.save(storage(), st); }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function say(text) { live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); }
  function pct(x) { return x === null ? '–' : Math.round(x * 100) + '%'; }

  /* ---------- speech: the chosen voice, or the learner's own recordings ---------- */
  var speechGen = 0;

  function ttsOpts() {
    var s = st.settings;
    return { rate: s.speechRate, pitch: s.speechPitch, volume: s.speechVolume, voiceURI: s.voiceURI };
  }

  function cancelSpeech() {
    speechGen++;
    V.cancel();
    C.stop();
  }

  /** Parts are {clip, text}: the recorded clip is used when "my own voice" is on and it exists, otherwise `text` is spoken. */
  function speakParts(parts) {
    var gen = speechGen;
    var own = st.settings.ownVoice && C.canPlay;
    var segs = [];
    parts.forEach(function (p) {
      var last = segs[segs.length - 1];
      if (own && p.clip && C.has(p.clip)) {
        if (last && last.clips) last.clips.push(p.clip); else segs.push({ clips: [p.clip] });
      } else if (p.text) {
        if (last && last.text !== undefined) last.text += ' ' + p.text; else segs.push({ text: p.text });
      }
    });
    return segs.reduce(function (chain, seg) {
      return chain.then(function () {
        if (gen !== speechGen) return null; // cancelled meanwhile
        if (seg.clips) {
          var ctx = audio.context();
          return ctx ? C.playSequence(ctx, seg.clips, st.settings.speechVolume) : null;
        }
        return V.speak(seg.text, ttsOpts());
      });
    }, Promise.resolve());
  }

  function talk(what) { return typeof what === 'string' ? V.speak(what, ttsOpts()) : speakParts(what); }

  /** A character as spoken parts, e.g. "K, Kilo" with `end` appended to the last word. */
  function charParts(c, end) {
    var n = VP.NATO[c];
    var withNato = st.settings.phonetic && n;
    var parts = [{ clip: 'ch-' + c, text: VP.say(c, false) + (withNato ? ',' : (end || '')) }];
    if (withNato) parts.push({ clip: 'nato-' + c, text: n + (end || '') });
    return parts;
  }

  function verdictParts(ok, ch, skipped) {
    if (ok) return [{ clip: 'correct', text: 'Correct.' }];
    var head = skipped ? [] : [{ clip: 'notquite', text: 'Not quite.' }];
    return head.concat([{ clip: 'itwas', text: 'It was' }], charParts(ch, '.'));
  }

  /** Speak the verdict when "speak results" is on. Returns true if it is speaking; `then` runs when it ends. */
  function announce(ok, ch, then) {
    if (!st.settings.speak || !(V.canSpeak || (st.settings.ownVoice && C.canPlay))) return false;
    speakParts(verdictParts(ok, ch)).then(then || function () {});
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
    stopCalibration();
    if (ui.rec && ui.rec.session) ui.rec.session.stop();
    cancelSpeech();
    clearTimeout(ui.send.endTimer);
    ui.settingsView = 'main';
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
        '<div class="row"><button class="btn" id="vsettings">Voice settings</button></div>' +
        '<p class="hint" style="margin-top:16px">Only use this where it is safe and legal, and keep your attention on what you are doing. Keep the screen on and this app open: voice practice stops if the screen turns off or you switch apps. Voice answers go through Chrome’s speech service, so they need an internet connection and your voice is sent to Google to be transcribed. Headphones or a quiet room work best.</p></section>';
      Array.prototype.forEach.call(view.querySelectorAll('input[name=vmode]'), function (r) {
        r.addEventListener('change', function () { st.settings.voiceMode = r.value; save(); });
      });
      document.getElementById('vstart').addEventListener('click', startVoice);
      document.getElementById('vsettings').addEventListener('click', function () { go('settings'); });
    } else {
      view.innerHTML = '<section class="card center"><p class="label">' + (vs.mode === 'quiz' ? 'Quiz by voice' : 'Just listen') + '</p>' +
        '<div class="voice-status" id="vstatus">…</div><div class="voice-heard" id="vheard"></div><div id="vteach"></div>' +
        '<button class="btn primary big-btn" id="vstop">Stop</button></section>';
      document.getElementById('vstop').addEventListener('click', function () { stopVoice(); render(); });
    }
  }

  function setStatus(text) { var e = document.getElementById('vstatus'); if (e) e.textContent = text; }
  function setHeard(text) { var e = document.getElementById('vheard'); if (e) e.textContent = text; }

  /** After a wrong answer, offer to remember what the recogniser heard as this character. */
  function setTeach(heard, target) {
    var e = document.getElementById('vteach');
    if (!e) return;
    e.textContent = '';
    if (!heard) return;
    var b = document.createElement('button');
    b.className = 'btn';
    b.textContent = 'I said ' + target + ': remember “' + heard + '”';
    b.addEventListener('click', function () {
      var res = VP.learn(st.aliases, heard, target, T.unlocked(st));
      save();
      e.textContent = '';
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = res === 'added' ? 'Saved. “' + heard + '” now counts as ' + target + '.'
        : res === 'conflict' ? '“' + heard + '” already means something else for you.' : 'Nothing to change.';
      e.appendChild(p);
    });
    e.appendChild(b);
  }

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
    cancelSpeech();
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
    await talk([{ text: 'New character:' }].concat(charParts(ch, '.'), [{ text: 'Listen.' }]));
    for (var i = 0; i < 4 && !token.stop; i++) {
      var dur = audio.playChar(ch);
      await wait((dur + 1.2) * 1000, token);
    }
    if (token.stop) return;
    await talk([{ text: 'That was' }].concat(charParts(ch, '.')));
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
    setTeach();
    await playAndWait(ch, token);
    while (!token.stop) {
      setStatus('Say the letter');
      var r = await V.listen(7000, st.settings.recogLang);
      if (token.stop) return;
      if (r.error === 'not-allowed' || r.error === 'service-not-allowed') {
        return fatal(token, 'The microphone is blocked. Allow it for this site in Chrome settings, or use Just listen.');
      }
      if (r.error === 'network') {
        return fatal(token, 'Voice answers need an internet connection. Use Just listen to practise offline.');
      }
      setHeard(r.alts[0] ? 'Heard: ' + r.alts[0] : '');
      var p = VP.parse(r.alts, unlocked, st.aliases);
      if (!p) {
        if (++unclear >= 3) {
          setStatus('It was ' + ch);
          await talk([{ text: 'Skipping.' }, { clip: 'itwas', text: 'It was' }].concat(charParts(ch, '.')));
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
      if (!ok && !skipped && r.alts[0]) setTeach(r.alts[0], ch);
      await talk(verdictParts(ok, ch, skipped));
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
    await talk(charParts(ch, ''));
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
  var UNITS = { pitch: ' Hz', charWpm: ' WPM', effWpm: ' WPM', sendWpm: ' WPM', thinkSec: ' s' };
  function fmt(k, v) {
    if (k === 'volume' || k === 'speechVolume') return Math.round(v * 100) + '%';
    if (k === 'speechRate' || k === 'speechPitch') return Number(v).toFixed(1) + '×';
    return v + UNITS[k];
  }
  function range(id, label, min, max, step, value) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<output id="' + id + '-out">' + fmt(id, value) + '</output></div>';
  }
  function check(id, label, on, disabled) {
    return '<div class="field check"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') +
      '><label for="' + id + '">' + label + '</label></div>';
  }
  function bindRanges(ids) {
    ids.forEach(function (k) {
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
  }
  function bindChecks(ids) {
    ids.forEach(function (k) {
      document.getElementById(k).addEventListener('change', function (e) { st.settings[k] = e.target.checked; save(); });
    });
  }

  var ACCENTS = [['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['en-AU', 'English (Australia)'],
    ['en-CA', 'English (Canada)'], ['en-IE', 'English (Ireland)'], ['en-IN', 'English (India)'], ['en-NZ', 'English (New Zealand)'],
    ['en-ZA', 'English (South Africa)'], ['en-NG', 'English (Nigeria)'], ['en-PH', 'English (Philippines)']];

  /** Fill the voice picker from the voices this device has. */
  function fillVoices() {
    var sel = document.getElementById('voiceURI');
    if (!sel) return;
    var all = document.getElementById('allLangs').checked;
    var list = V.voices().filter(function (v) { return all || /^en([-_]|$)/i.test(v.lang); })
      .sort(function (a, b) { return a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name); });
    sel.innerHTML = '<option value="">Device default</option>';
    list.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = v.name + ' (' + v.lang + ')' + (v.localService ? '' : ' · needs internet');
      sel.appendChild(o);
    });
    sel.value = st.settings.voiceURI;
    if (sel.value !== st.settings.voiceURI) sel.value = '';
    var note = document.getElementById('voice-note');
    note.textContent = !V.canSpeak ? 'This browser cannot speak.'
      : !list.length ? 'No voices listed yet. Your browser may still be loading them, or this device has none for this language.'
      : list.length + ' voice' + (list.length === 1 ? '' : 's') + ' on this device. On Android, more voices can be added under Settings → Languages → Text-to-speech.';
  }

  var ESSENTIAL_COUNT = 0;

  function renderSettings() {
    if (ui.settingsView === 'record') return renderRecord();
    if (ui.settingsView === 'calibrate') return renderCalibrate();
    var s = st.settings;
    var have = RECORD_ITEMS.slice(0, ESSENTIAL_COUNT).filter(function (it) { return C.has(it.id); }).length;
    var extra = C.count() - have;
    var accents = ACCENTS.map(function (a) {
      return '<option value="' + a[0] + '"' + (a[0] === s.recogLang ? ' selected' : '') + '>' + a[1] + '</option>';
    }).join('');
    view.innerHTML =
      '<section class="card"><h2>Settings</h2><form class="settings" onsubmit="return false">' +
      range('pitch', 'Tone pitch', 400, 900, 10, s.pitch) +
      range('charWpm', 'Character speed', 15, 30, 1, s.charWpm) +
      range('effWpm', 'Effective speed (gaps stretched below this)', 5, 30, 1, s.effWpm) +
      check('auto', 'Raise effective speed by 1 WPM each time a block passes', s.auto) +
      range('sendWpm', 'Sending speed (your keying)', 5, 20, 1, s.sendWpm) +
      check('echo', 'Echo mode: hear the character, letter hidden, send it back', s.echo) +
      range('volume', 'Tone volume', 0.1, 1, 0.05, s.volume) +
      '<div class="row"><button type="button" class="btn" id="test">Play test tone</button>' +
      '<button type="button" class="btn danger" id="reset">Reset progress</button></div></form></section>' +

      '<section class="card"><h2>Voice</h2><form class="settings" onsubmit="return false">' +
      check('speak', 'Say “Correct” or “Not quite” out loud in Listen and Send', s.speak) +
      check('phonetic', 'Also say the phonetic word, like “K, Kilo”', s.phonetic) +
      '<div class="field"><label for="voiceURI">Voice</label><select id="voiceURI"></select><output id="voice-note"></output></div>' +
      check('allLangs', 'Show voices in all languages', false) +
      range('speechRate', 'Voice speed', 0.7, 1.4, 0.1, s.speechRate) +
      range('speechPitch', 'Voice pitch', 0.5, 1.5, 0.1, s.speechPitch) +
      range('speechVolume', 'Voice volume', 0.2, 1, 0.1, s.speechVolume) +
      range('thinkSec', 'Pause before the answer in Just listen', 1, 8, 1, s.thinkSec) +
      '<div class="field"><label for="recogLang">Accent the app expects when you answer by voice</label><select id="recogLang">' + accents + '</select></div>' +
      '<div class="row"><button type="button" class="btn" id="testvoice">Test voice</button></div></form></section>' +

      '<section class="card"><h2>My own voice</h2>' +
      (C.supported
        ? '<p>Record yourself saying “Correct”, “Not quite”, “It was” and each letter, digit and punctuation mark, and the app will use your voice for its feedback. Anything you have not recorded is spoken by the voice above.</p>' +
          '<p class="readout" id="clipcount">' + have + ' of ' + ESSENTIAL_COUNT + ' essential clips recorded' + (extra > 0 ? ' (+' + extra + ' phonetic words)' : '') + '</p>' +
          check('ownVoice', 'Use my own voice for spoken feedback', s.ownVoice, C.count() === 0) +
          '<div class="row"><button type="button" class="btn primary" id="recordbtn">Record my voice</button></div>' +
          '<div class="row"><button type="button" class="btn" id="exportclips"' + (C.count() ? '' : ' disabled') + '>Save a backup</button>' +
          '<button type="button" class="btn" id="importclips">Restore a backup</button>' +
          '<button type="button" class="btn danger" id="deleteclips"' + (C.count() ? '' : ' disabled') + '>Delete recordings</button></div>' +
          '<input type="file" id="importfile" accept="application/json,.json" class="sr">' +
          '<p class="hint" id="clipmsg" role="status"></p>' +
          '<p class="hint">Recordings stay on this device, in this browser. Clearing the browser’s site data deletes them, so save a backup.</p>'
        : '<p class="notice">Recording needs a browser that can use the microphone and store files, such as Chrome.</p>') +
      '</section>' +

      '<section class="card"><h2>Voice calibration</h2>' +
      '<p>Teach the app how the speech recogniser hears <em>you</em>. You say each letter you have unlocked once, and then its phonetic word, and the app remembers any way it mishears you.</p>' +
      '<p class="readout" id="aliascount">' + Object.keys(st.aliases).length + ' learned word' + (Object.keys(st.aliases).length === 1 ? '' : 's') + '</p>' +
      '<div class="row"><button type="button" class="btn primary" id="calbtn"' + (V.canListen ? '' : ' disabled') + '>Calibrate my voice</button>' +
      '<button type="button" class="btn danger" id="clearaliases"' + (Object.keys(st.aliases).length ? '' : ' disabled') + '>Clear learned words</button></div>' +
      (V.canListen ? '' : '<p class="notice">Speech recognition is not available in this browser.</p>') + '</section>';

    bindRanges(['pitch', 'charWpm', 'effWpm', 'sendWpm', 'volume', 'speechRate', 'speechPitch', 'speechVolume', 'thinkSec']);
    bindChecks(['auto', 'echo', 'speak', 'phonetic']);
    document.getElementById('test').addEventListener('click', function () { audio.unlock(); audio.playChar('K'); });
    document.getElementById('reset').addEventListener('click', function () {
      if (window.confirm('Reset all progress and settings? Your recordings are kept.')) {
        st = T.defaults();
        save();
        go('listen');
      }
    });

    fillVoices();
    document.getElementById('voiceURI').addEventListener('change', function (e) { st.settings.voiceURI = e.target.value; save(); });
    document.getElementById('allLangs').addEventListener('change', fillVoices);
    document.getElementById('recogLang').addEventListener('change', function (e) { st.settings.recogLang = e.target.value; save(); });
    document.getElementById('testvoice').addEventListener('click', function () {
      audio.unlock();
      cancelSpeech();
      speakParts(verdictParts(true, 'K')).then(function () { return speakParts(verdictParts(false, 'K')); });
    });

    if (C.supported) {
      document.getElementById('ownVoice').addEventListener('change', function (e) { st.settings.ownVoice = e.target.checked; save(); });
      document.getElementById('recordbtn').addEventListener('click', function () {
        audio.unlock();
        ui.rec = { i: firstMissing(), state: 'idle', msg: '', pending: null, session: null };
        ui.settingsView = 'record';
        render();
      });
      var msg = document.getElementById('clipmsg');
      document.getElementById('exportclips').addEventListener('click', function () {
        C.exportJson().then(function (text) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
          a.download = 'morse-ear-trainer-voice-backup.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
          msg.textContent = 'Backup saved to your downloads.';
        }).catch(function () { msg.textContent = 'Could not make a backup.'; });
      });
      document.getElementById('importclips').addEventListener('click', function () { document.getElementById('importfile').click(); });
      document.getElementById('importfile').addEventListener('change', function (e) {
        var f = e.target.files[0];
        if (!f) return;
        f.text().then(C.importJson).then(function (n) {
          msg.textContent = 'Restored ' + n + ' clip' + (n === 1 ? '' : 's') + '.';
          render();
        }).catch(function (err) { msg.textContent = err.message || 'Could not restore that file.'; });
      });
      document.getElementById('deleteclips').addEventListener('click', function () {
        if (window.confirm('Delete all your recorded clips from this device?')) {
          C.clear().then(function () { st.settings.ownVoice = false; save(); render(); });
        }
      });
    }
    document.getElementById('calbtn').addEventListener('click', function () {
      audio.unlock();
      ui.cal = { running: true, i: 0, total: 0, item: null, text: '', learned: 0, done: false, msg: '' };
      ui.settingsView = 'calibrate';
      render();
      startCalibration();
    });
    document.getElementById('clearaliases').addEventListener('click', function () {
      if (window.confirm('Forget all learned words?')) { st.aliases = {}; save(); render(); }
    });
  }

  /* ---------- record my voice ---------- */
  var DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  var PUNCT = [['.', 'period'], [',', 'comma'], ['/', 'slash'], ['?', 'question mark']];
  var RECORD_ITEMS = (function () {
    var items = [
      { id: 'correct', show: '✓', say: 'Correct', what: 'the word' },
      { id: 'notquite', show: '✕', say: 'Not quite', what: 'the words' },
      { id: 'itwas', show: '…', say: 'It was', what: 'the words' }
    ];
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (c) { items.push({ id: 'ch-' + c, show: c, say: c, what: 'the letter name' }); });
    DIGIT_WORDS.forEach(function (w, d) { items.push({ id: 'ch-' + d, show: String(d), say: w, what: 'the digit' }); });
    PUNCT.forEach(function (p) { items.push({ id: 'ch-' + p[0], show: p[0], say: p[1], what: 'the mark' }); });
    ESSENTIAL_COUNT = items.length;
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (c) { items.push({ id: 'nato-' + c, show: c, say: VP.NATO[c], what: 'the phonetic word', optional: true }); });
    return items;
  })();

  function firstMissing() {
    for (var i = 0; i < RECORD_ITEMS.length; i++) if (!C.has(RECORD_ITEMS[i].id)) return i;
    return 0;
  }

  function onRecordScreen() { return ui.tab === 'settings' && ui.settingsView === 'record'; }

  function renderRecord() {
    var R = ui.rec, it = RECORD_ITEMS[R.i], have = C.has(it.id);
    var buttons = R.state === 'listening'
      ? '<button class="btn primary big-btn" id="recstop">Stop</button>'
      : R.state === 'review'
        ? '<div class="row"><button class="btn" id="recplay">Play</button><button class="btn" id="recredo">Record again</button>' +
          '<button class="btn primary" id="reckeep">Keep and next</button></div>'
        : '<button class="btn primary big-btn" id="recgo">' + (have ? 'Record again' : 'Record') + '</button>' +
          (have ? '<div class="row"><button class="btn" id="recplayold">Play my recording</button></div>' : '');
    view.innerHTML = '<section class="card center"><p class="label">Record my voice · ' + (R.i + 1) + ' of ' + RECORD_ITEMS.length +
      (it.optional ? ' · optional' : '') + (have ? ' · recorded ✓' : '') + '</p>' +
      '<div class="big' + (it.show.length > 1 ? ' small' : '') + '">' + it.show + '</div>' +
      '<p>Say “<strong>' + it.say + '</strong>” (' + it.what + ') clearly, in your normal voice.</p>' +
      '<div class="meter" aria-hidden="true"><div id="meter"></div></div>' +
      '<p class="hint" id="recmsg" role="status">' + (R.state === 'listening' ? 'Listening… I stop on my own after you pause.' : (R.msg || ' ')) + '</p>' +
      buttons +
      '<div class="row"><button class="btn" id="recback"' + (R.i === 0 ? ' disabled' : '') + '>Back</button>' +
      '<button class="btn" id="recskip"' + (R.i === RECORD_ITEMS.length - 1 ? ' disabled' : '') + '>Skip</button>' +
      '<button class="btn" id="recdone">Finish</button></div>' +
      '<p class="hint">Find a quiet spot and hold the phone as you would normally. The first ' + ESSENTIAL_COUNT +
      ' are the essentials; the phonetic words after them are optional.</p></section>';
    function on(id, fn) { var e = document.getElementById(id); if (e) e.addEventListener('click', fn); }
    on('recgo', recStart);
    on('recstop', function () { if (R.session) R.session.stop(); });
    on('recplay', function () { playBlob(R.pending); });
    on('recplayold', function () { speakIds([it.id]); });
    on('recredo', recStart);
    on('reckeep', function () {
      C.put(it.id, R.pending).then(function () { R.pending = null; R.state = 'idle'; recMove(1); });
    });
    on('recback', function () { recMove(-1); });
    on('recskip', function () { recMove(1); });
    on('recdone', function () { leaveRecord(); });
  }

  function recMove(d) {
    var R = ui.rec;
    R.i = Math.max(0, Math.min(RECORD_ITEMS.length - 1, R.i + d));
    R.state = 'idle';
    R.msg = '';
    R.pending = null;
    if (onRecordScreen()) renderRecord();
  }

  function leaveRecord() {
    if (ui.rec && ui.rec.session) ui.rec.session.stop();
    cancelSpeech();
    ui.settingsView = 'main';
    render();
  }

  function setLevel(x) {
    var m = document.getElementById('meter');
    if (m) m.style.width = Math.round(x * 100) + '%';
  }

  function recStart() {
    var R = ui.rec;
    cancelSpeech();
    R.state = 'listening';
    R.msg = '';
    R.pending = null;
    renderRecord();
    var ctx = audio.context();
    C.record(ctx, { onLevel: setLevel, maxMs: 5000 }).then(function (session) {
      R.session = session;
      return session.result;
    }).then(function (res) {
      R.session = null;
      if (!onRecordScreen()) return;
      if (res.error) {
        R.state = 'idle';
        R.msg = res.error === 'quiet' ? 'I did not hear anything. Try again, a little closer or louder.' : 'That take could not be read. Please try again.';
      } else {
        R.pending = res.blob;
        R.state = 'review';
        playBlob(res.blob);
      }
      renderRecord();
    }).catch(function () {
      R.session = null;
      R.state = 'idle';
      R.msg = 'The microphone is not available. Allow it for this site in Chrome’s settings.';
      if (onRecordScreen()) renderRecord();
    });
  }

  function playBlob(blob) {
    var ctx = audio.context();
    if (!blob || !ctx) return;
    blob.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); }).then(function (buf) {
      var src = ctx.createBufferSource();
      var gain = ctx.createGain();
      gain.gain.value = st.settings.speechVolume;
      src.buffer = buf;
      src.connect(gain).connect(ctx.destination);
      src.start();
    });
  }

  function speakIds(ids) {
    var ctx = audio.context();
    if (ctx) C.playSequence(ctx, ids, st.settings.speechVolume);
  }

  /* ---------- calibrate my voice ---------- */
  var calToken = null;

  function renderCalibrate() {
    var A = ui.cal;
    if (A.done) {
      view.innerHTML = '<section class="card center"><h2>Calibration done</h2>' +
        '<p>' + (A.learned ? 'Learned ' + A.learned + ' new way' + (A.learned === 1 ? '' : 's') + ' you say letters.' : 'The app already understood everything you said.') +
        '</p>' + (A.msg ? '<p class="notice" role="alert">' + A.msg + '</p>' : '') +
        '<p class="hint">Run it again after unlocking more characters.</p>' +
        '<button class="btn primary big-btn" id="caldone">Back to settings</button></section>';
      document.getElementById('caldone').addEventListener('click', function () { ui.settingsView = 'main'; render(); });
      return;
    }
    view.innerHTML = '<section class="card center"><p class="label">Calibrate · <span id="calprog">' + (A.i + 1) + ' of ' + (A.total || '…') + '</span></p>' +
      '<div class="big' + (A.item && A.item.c.length && A.item.kind === 'nato' ? ' small' : '') + '" id="calbig">' + (A.item ? (A.item.kind === 'nato' ? VP.NATO[A.item.c] : A.item.c) : '…') + '</div>' +
      '<div class="voice-status" id="calstatus">' + (A.text || ' ') + '</div>' +
      '<button class="btn primary big-btn" id="calstop">Stop</button></section>';
    document.getElementById('calstop').addEventListener('click', function () { stopCalibration(); ui.settingsView = 'main'; render(); });
  }

  function updateCalibrate() {
    var A = ui.cal;
    if (!(ui.tab === 'settings' && ui.settingsView === 'calibrate') || A.done) return;
    var p = document.getElementById('calprog'), b = document.getElementById('calbig'), s = document.getElementById('calstatus');
    if (p) p.textContent = (A.i + 1) + ' of ' + A.total;
    if (b) { b.textContent = A.item.kind === 'nato' ? VP.NATO[A.item.c] : A.item.c; b.classList.toggle('small', A.item.kind === 'nato'); }
    if (s) s.textContent = A.text || ' ';
  }

  function stopCalibration() {
    if (calToken) { calToken.stop = true; calToken.waiters.slice().forEach(function (f) { f(); }); calToken = null; }
    cancelSpeech();
  }

  async function startCalibration() {
    var A = ui.cal, token = calToken = { stop: false, waiters: [] };
    var unlocked = T.unlocked(st);
    var items = [];
    unlocked.forEach(function (c) {
      items.push({ c: c, kind: 'name' });
      if (VP.NATO[c]) items.push({ c: c, kind: 'nato' });
    });
    A.total = items.length;
    for (A.i = 0; A.i < items.length && !token.stop; A.i++) {
      var it = A.item = items[A.i];
      var word = it.kind === 'nato' ? VP.NATO[it.c] : VP.say(it.c, false);
      var outcome = null;
      for (var attempt = 0; attempt < 2 && !token.stop && !outcome; attempt++) {
        A.text = 'Listen…';
        updateCalibrate();
        await talk('Say ' + word + '.');
        if (token.stop) break;
        A.text = 'Say “' + word + '”';
        updateCalibrate();
        var r = await V.listen(6000, st.settings.recogLang);
        if (token.stop) break;
        if (r.error === 'not-allowed' || r.error === 'service-not-allowed') { A.msg = 'The microphone is blocked. Allow it for this site in Chrome settings.'; token.stop = true; break; }
        if (r.error === 'network') { A.msg = 'Calibration needs an internet connection.'; token.stop = true; break; }
        if (!r.alts.length) { A.text = 'I did not hear anything.'; updateCalibrate(); continue; }
        var heard = r.alts[0];
        var result = VP.learn(st.aliases, heard, it.c, unlocked);
        if (result === 'added') { A.learned++; save(); A.text = 'Heard “' + heard + '”. Now it counts as ' + it.c + '.'; }
        else if (result === 'known') A.text = 'Heard “' + heard + '”. Already understood.';
        else if (result === 'conflict') A.text = 'Heard “' + heard + '”, which already means something else. Skipped.';
        else A.text = 'Heard “' + heard + '”. Skipped.';
        outcome = result;
        updateCalibrate();
      }
      if (!token.stop) await wait(1100, token);
    }
    if (calToken === token) {
      calToken = null;
      A.done = true;
      if (ui.tab === 'settings' && ui.settingsView === 'calibrate') renderCalibrate();
    }
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

  C.init().then(function () { if (ui.tab === 'settings' && ui.settingsView === 'main') render(); });
  V.onVoicesChanged(function () { if (ui.tab === 'settings' && ui.settingsView === 'main') fillVoices(); });

  render();
  window.__app = { st: function () { return st; }, ui: ui };
})();
