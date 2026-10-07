(function () {
  var M = window.Morse, T = window.Trainer, FA = window.Family, RH = window.Rhythm;

  function storage() { try { return window.localStorage; } catch (e) { return null; } }
  var fam = FA.load(storage());
  function profile() { return FA.active(fam); }
  var st = T.load(storage(), profile().key);
  function kind() { return st.kind || profile().kind; }
  function isKid() { return kind() !== 'adult'; }
  var audio = new window.MorseAudio(function () { return ui.override || st.settings; });

  function freshUi() { return {
    tab: st.kind === 'early' ? 'play' : 'today',
    lastPractice: null,
    session: null,
    listen: { phase: 'idle', last: null, focus: null, skipStudy: false, endAt: 0 },
    learn: { running: false, done: null, message: '', token: null },
    words: { phase: 'idle', last: null, item: null, cmp: null },
    send: { phase: 'idle', last: null, pattern: '', down: 0, endTimer: null },
    voice: { running: false, mode: 'quiz', last: null, message: '' },
    settingsView: 'main',
    rec: null,
    cal: null,
    check: null,
    checkResult: null,
    override: null,
    gate: null,
    gateUntil: 0,
    famView: 'main',
    famId: null,
    famMsg: '',
    playMore: false,
    together: { phase: 'idle', ch: null, last: null, msg: '' },
    rhythm: { phase: 'idle', pattern: '', presses: [], down: 0, len: 2, streak: 0, last: null, ok: false, endTimer: null }
  }; }
  var ui = freshUi();
  var VP = window.VoiceParse, V = window.Voice, C = window.Clips;
  var STU = window.Study, WD = window.Words, TR = window.Tracks, CK = window.Checks, CO = window.Coach;
  function wordOpts() { return { ham: st.settings.hamPack, prosigns: st.settings.prosigns }; }
  var timers = [];
  var view = document.getElementById('view');
  var live = document.getElementById('live');

  function save() { T.save(storage(), st, profile().key); }
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
  // Five main tabs; "Practice" opens one of four modes, picked from a second row.
  var GROUP = { today: 'today', learn: 'practice', listen: 'practice', words: 'practice', send: 'practice',
    voice: 'voice', progress: 'progress', settings: 'settings', together: 'practice', play: 'play', rhythm: 'play',
    family: 'family', gate: 'family', who: '' };
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs button'));
  var subtabs = document.getElementById('subtabs');
  var sessionbar = document.getElementById('sessionbar');

  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-tab');
      go(t === 'practice' ? (ui.lastPractice || (st.introduced < st.level ? 'learn' : 'listen')) : t);
    });
  });

  function stopAll() {
    abortCheck();
    clearTimers();
    releaseKey();
    stopVoice();
    stopStudy();
    stopCalibration();
    if (ui.rec && ui.rec.session) ui.rec.session.stop();
    cancelSpeech();
    clearTimeout(ui.send.endTimer);
    clearTimeout(ui.rhythm.endTimer);
  }

  function go(tab) {
    stopAll();
    ui.settingsView = 'main';
    if ((tab === 'settings' || tab === 'family') && !gateOpen()) return openGate(function () { go(tab); });
    if (tab === 'family') { ui.famView = 'main'; }
    ui.tab = tab;
    ui.gate = null;
    if (GROUP[tab] === 'practice') ui.lastPractice = tab;
    // a half-finished trial restarts cleanly when you come back
    if (ui.listen.phase !== 'idle') ui.listen.phase = 'idle';
    if (ui.send.phase !== 'idle') ui.send.phase = 'idle';
    if (ui.words.phase !== 'idle') ui.words.phase = 'idle';
    if (ui.together.phase !== 'idle') ui.together.phase = 'idle';
    if (ui.rhythm.phase !== 'idle') ui.rhythm.phase = 'idle';
    render();
  }

  var who = document.getElementById('who');
  who.addEventListener('click', function () { go(fam.profiles.length > 1 ? 'who' : 'family'); });
  var NAV = { adult: ['today', 'practice', 'voice', 'progress', 'settings'], child: ['today', 'practice', 'voice', 'progress', 'family'], early: ['play', 'family'] };

  function render() {
    var show = NAV[kind()] || NAV.adult;
    who.textContent = fam.profiles.length > 1 ? profile().name : 'Family';
    tabs.forEach(function (b) {
      var t = b.getAttribute('data-tab');
      var inSub = subtabs.contains(b);
      if (!inSub) b.hidden = show.indexOf(t) < 0;
      b.setAttribute('aria-selected', String(inSub ? t === ui.tab : t === GROUP[ui.tab]));
    });
    subtabs.hidden = GROUP[ui.tab] !== 'practice' || kind() === 'early';
    renderSessionBar();
    if (ui.check && ui.check.state === 'intro') return renderCheckIntro();
    ({ today: renderToday, learn: renderLearn, listen: renderListen, words: renderWords, send: renderSend, voice: renderVoice,
      progress: renderProgress, settings: renderSettings, together: renderTogether, rhythm: renderRhythm, play: renderPlay,
      family: renderFamily, gate: renderGate, who: renderWho })[ui.tab]();
    if (kind() === 'early' && { learn: 1, together: 1, rhythm: 1 }[ui.tab]) {
      var back = document.createElement('div');
      back.className = 'row noprint';
      back.innerHTML = '<button class="btn" id="backplay">Back to Play</button>';
      view.appendChild(back);
      document.getElementById('backplay').addEventListener('click', function () { go('play'); });
    }
  }

  /* ---------- today: the daily plan ---------- */
  var BLOCKS = [['warm', 0.125], ['study', 0.2], ['weak', 0.25], ['send', 0.175], ['words', 0.175], ['cool', 0.075]];

  function learnedLetters() {
    return T.unlocked(st).filter(function (c) { var s = T.charStatus(st, c).status; return s === 'Learned' || s === 'Solid'; });
  }

  /** The plan for today, scaled to the daily goal. New letters are studied before any quiz. */
  function buildPlan() {
    var goal = st.settings.goalMin;
    var p = STU.plan(st);
    var haveLearned = learnedLetters().length > 0;
    var wordsOk = WD.matching(T.unlocked(st), customList(), wordOpts()).length >= WD.MIN_WORDS;
    var mins = {};
    BLOCKS.forEach(function (b) { mins[b[0]] = Math.max(1, Math.round(goal * b[1])); });
    var info = {
      warm: { title: 'Warm-up review', tab: 'listen', focus: 'review', why: 'Letters you have already learned, so they stay sharp.' },
      study: { title: p.fresh ? 'Study new letters: ' + p.target.join(' and ') : 'Study your shakiest letters: ' + p.target.join(' and '), tab: 'learn',
        why: 'Each letter is named, then you hear its sound. Nothing is marked.' },
      weak: { title: 'Weak-spot drill', tab: 'listen', focus: 'weak', why: 'The letters and pairs you mix up most.' },
      send: { title: 'Send', tab: 'send', why: 'Key letters yourself and hear your own tone.' },
      words: { title: wordsOk ? 'Words' : 'Letter groups', tab: 'words', why: 'Copy a whole word after it has played.' },
      cool: { title: 'Cool-down: listen only', tab: 'voice', vmode: 'listen', why: 'Sound, a pause to think, then the letter. No answers needed.' }
    };
    var order = p.fresh ? ['study', 'warm', 'weak', 'send', 'words', 'cool'] : ['warm', 'study', 'weak', 'send', 'words', 'cool'];
    if (!haveLearned) {                       // nothing to review yet: fold the warm-up into quizzing
      order = order.filter(function (k) { return k !== 'warm'; });
      mins.weak += mins.warm;
      info.weak.title = 'Listen practice';
      info.weak.focus = null;
      info.weak.why = 'Quiz yourself on the letters you have studied.';
    }
    var blocks = order.map(function (k) { var b = info[k]; b.id = k; b.min = mins[k]; return b; });
    var sum = blocks.reduce(function (a, b) { return a + b.min; }, 0);
    blocks[blocks.length - 1].min = Math.max(1, blocks[blocks.length - 1].min + goal - sum);
    return blocks;
  }

  function renderToday() {
    var goal = st.settings.goalMin, mins = T.minutesOn(st), week = T.minutesLastDays(st, 7);
    var counts = T.countByStatus(st);
    var plan = buildPlan();
    var notes = CO.notes(st, T.today(), { checks: !isKid() }).map(function (n) {
      return '<li>' + n.text + (n.action ? ' <button class="btn small" data-act="' + n.action + '">' + (n.action === 'learn' ? 'Study' : 'Open Progress') + '</button>' : '') + '</li>';
    }).join('');
    var items = plan.map(function (b, i) {
      return '<li><div><strong>' + b.title + '</strong> <span class="hint">· ' + b.min + ' min</span><br><span class="hint">' + b.why +
        '</span></div><button class="btn" data-block="' + i + '">Start</button></li>';
    }).join('');
    view.innerHTML = '<section class="card"><h2>Today</h2>' +
      '<p class="readout">' + Math.floor(mins) + ' of ' + goal + ' min today · ' + Math.round(week) + ' min in the last 7 days</p>' +
      '<div class="meter wide" aria-hidden="true"><div style="width:' + Math.min(100, Math.round(mins / goal * 100)) + '%"></div></div>' +
      '<p class="readout">Level ' + st.level + ' of ' + M.KOCH_ORDER.length + ' · Solid ' + counts.Solid + ' · Learned ' + counts.Learned +
      ' · Learning ' + counts.Learning + ' · New ' + counts.New + '</p>' +
      (notes ? '<ul class="coach" aria-label="Coaching notes">' + notes + '</ul>' : '') +
      '<button class="btn primary big-btn" id="startplan">Start today’s plan</button>' +
      '<ol class="plan">' + items + '</ol>' +
      '<p class="hint">A new letter is always studied before it is ever quizzed. Short, regular sessions beat one long one: if you only have a few minutes, do the first block.</p></section>';
    document.getElementById('startplan').addEventListener('click', function () { startPlan(plan, 0); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-act')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-block]'), function (b) {
      b.addEventListener('click', function () { startPlan(plan, Number(b.getAttribute('data-block'))); });
    });
  }

  function startPlan(plan, i) {
    audio.unlock();
    ui.session = { blocks: plan, i: i, endAt: 0 };
    runBlock();
  }

  function runBlock() {
    var s = ui.session, b = s.blocks[s.i];
    s.endAt = Date.now() + b.min * 60000;
    s.over = false;
    ui.listen.focus = b.focus || null;
    ui.listen.skipStudy = false;
    if (b.vmode) st.settings.voiceMode = b.vmode;
    go(b.tab);
    var start = { listen: startListen, learn: startStudyScreen, send: startSend, words: startWords, voice: startVoice }[b.tab];
    start();
  }

  function renderSessionBar() {
    var s = ui.session;
    if (!s) { sessionbar.hidden = true; sessionbar.textContent = ''; return; }
    sessionbar.hidden = false;
    var b = s.blocks[s.i], last = s.i === s.blocks.length - 1;
    sessionbar.innerHTML = '<span id="sbtext"></span><span class="sbbtns">' +
      '<button class="btn small" id="sbnext">' + (last ? 'Finish plan' : 'Next block') + '</button>' +
      '<button class="btn small" id="sbend">End</button></span>';
    document.getElementById('sbnext').addEventListener('click', function () {
      if (last) { ui.session = null; go('today'); } else { s.i++; runBlock(); }
    });
    document.getElementById('sbend').addEventListener('click', function () { ui.session = null; render(); });
    updateSessionBar();
  }

  function updateSessionBar() {
    var s = ui.session, t = document.getElementById('sbtext');
    if (!s || !t) return;
    var left = Math.max(0, Math.round((s.endAt - Date.now()) / 1000));
    var b = s.blocks[s.i];
    var text = left > 0
      ? 'Block ' + (s.i + 1) + ' of ' + s.blocks.length + ' · ' + b.title.split(':')[0] + ' · ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) + ' left'
      : 'Block ' + (s.i + 1) + ' time is up. Finish this answer, then move on.';
    if (t.textContent !== text) t.textContent = text;
    if (left === 0 && !s.over) { s.over = true; say('This block is finished. Choose next block when you are ready.'); }
  }

  /** Once a second: count practice time and keep the session timer fresh. */
  var tickCount = 0;
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    var active = (ui.tab === 'listen' && ui.listen.phase !== 'idle') || (ui.tab === 'send' && ui.send.phase !== 'idle') ||
      (ui.tab === 'learn' && ui.learn.running) || (ui.tab === 'words' && ui.words.phase !== 'idle') ||
      (ui.tab === 'voice' && ui.voice.running) || (ui.tab === 'together' && ui.together.phase !== 'idle') ||
      (ui.tab === 'rhythm' && ui.rhythm.phase !== 'idle');
    if (active) {
      T.logSeconds(st, 1);
      if (++tickCount % 15 === 0) save();
    }
    updateSessionBar();
  }, 1000);

  /* ---------- listen: the quiz ---------- */
  function readout() {
    var s = st.settings;
    var cond = s.conditions && s.conditions !== 'clean' ? ' · sound: ' + M.CONDITIONS[s.conditions].label : '';
    return '<p class="readout">Level ' + st.level + ' of ' + M.KOCH_ORDER.length + ' · ' + s.charWpm + '/' + s.effWpm +
      ' WPM · block ' + st.block.length + '/' + T.BLOCK + cond + '</p>';
  }

  var FOCUS_LABEL = { review: 'Focus: letters you have already learned', weak: 'Focus: your weak spots' };

  function renderListen() {
    var L = ui.listen;
    var unstudied = st.introduced < st.level;
    if (L.phase === 'idle') {
      view.innerHTML = '<section class="card center"><h2>Listen</h2>' +
        '<p>This is the quiz. You hear one character at a time and say which one it was. There is nothing to look at: just listen.</p>' +
        (unstudied ? '<p class="notice" role="alert">You have letters you have not studied yet: ' + T.order(st).slice(st.introduced, st.level).join(' and ') +
          '. Study them first, so you know which sound belongs to which letter before you are tested.</p>' +
          '<div class="row"><button class="btn primary" id="gostudy">Study them now</button><button class="btn" id="skipstudy">Quiz me anyway</button></div>' : '') +
        (L.focus ? '<p class="hint">' + FOCUS_LABEL[L.focus] + '</p>' : '') +
        readout() + (unstudied ? '' : '<button class="btn primary" id="start">Start</button>') + '</section>';
      var s = document.getElementById('start');
      if (s) s.addEventListener('click', startListen);
      if (unstudied) {
        document.getElementById('gostudy').addEventListener('click', function () { go('learn'); startStudyScreen(); });
        document.getElementById('skipstudy').addEventListener('click', function () { L.skipStudy = true; startListen(); });
      }
    } else if (L.phase === 'prompt') {
      var keys = T.unlocked(st).map(function (c) { return '<button type="button" data-ch="' + c + '" aria-label="' + c + '">' + c + '</button>'; }).join('');
      view.innerHTML = '<section class="card center">' + (ui.check ? '<p class="label">' + checkLabel() + '</p>' : readout()) +
        '<h2>Which character?</h2><p class="hint">Type it or tap it.</p>' +
        '<div class="row"><button class="btn primary" id="replay">Replay</button></div>' +
        '<div class="pad" id="pad">' + keys + '</div></section>';
      document.getElementById('replay').addEventListener('click', function () { playListen(); });
      document.getElementById('pad').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-ch]');
        if (b) answerListen(b.getAttribute('data-ch'));
      });
    } else {
      var ok = L.ok, e = L.event, msg = '';
      if (e && e.event === 'advance') msg = 'Block complete: ' + pct(e.accuracy) + '. New character unlocked: ' + e.newChar + '. You will study it first.';
      else if (e && e.event === 'regress') msg = 'Block complete: ' + pct(e.accuracy) + '. Going back one character to firm it up.';
      else if (e) msg = 'Block complete: ' + pct(e.accuracy) + '. Same characters again.';
      var cs = T.charStatus(st, L.ch);
      var mastery = L.became ? L.ch + ' is now ' + L.became + '.' : L.ch + ': ' + cs.status + (cs.need.length ? ' (needs ' + cs.need[0] + ')' : '');
      view.innerHTML = '<section class="card center"><span class="status ' + (ok ? 'correct' : 'wrong') + '">' +
        (ok ? '✓ Correct' : '✕ Not quite, it was ' + L.ch) + '</span>' +
        '<div class="big">' + L.ch + '</div>' +
        '<div class="glyphs">' + glyph(M.TABLE[L.ch], 16) + '</div>' +
        '<p class="hint">' + mastery + '</p>' +
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

  /** Between questions: if a new letter has not been studied yet, study comes first. */
  function afterIntro() {
    clearTimers();
    if (st.introduced < st.level && !ui.listen.skipStudy) {
      ui.learn.message = 'A new letter is ready: ' + T.order(st).slice(st.introduced, st.level).join(' and ') +
        '. Study it first, then come back to the quiz.';
      go('learn');
      return;
    }
    nextListen();
  }

  function listenOpts() {
    var f = ui.listen.focus;
    if (f === 'weak') return { only: T.weakSet(st) };
    if (f === 'review') { var learned = learnedLetters(); return learned.length ? { only: learned, review: false } : {}; }
    return {};
  }

  function playListen() {
    var L = ui.listen;
    var dur = audio.playChar(L.ch);
    L.endAt = performance.now() + dur * 1000;   // answer time is measured from the end of the sound
  }

  function nextListen() {
    var L = ui.listen;
    if (checkRunning(['letters'])) L.ch = ui.check.items[ui.check.i].text;
    else L.ch = T.pick(st, 'listen', Math.random, L.last, listenOpts());
    L.last = L.ch;
    L.phase = 'prompt';
    render();
    later(playListen, 300);
  }

  function answerListen(letter) {
    var L = ui.listen;
    if (L.phase !== 'prompt') return;
    if (checkRunning(['letters'])) {             // a check: no feedback, no effect on mastery
      L.phase = 'checkwait';
      checkAdvance({ target: L.ch, answer: letter, ok: letter === L.ch, ms: Math.max(0, performance.now() - L.endAt) });
      return;
    }
    var ok = letter === L.ch;
    var ms = Math.max(0, performance.now() - L.endAt);
    var before = T.charStatus(st, L.ch).status;
    L.ok = ok;
    L.event = T.record(st, 'listen', L.ch, ok, { ms: ms, answered: letter });
    var after = T.charStatus(st, L.ch).status;
    L.became = (after === 'Learned' || after === 'Solid') && before !== after && before !== 'Solid' ? after : null;
    save();
    L.phase = 'reveal';
    render();
    say(ok ? 'Correct' : 'Not quite, it was ' + L.ch);
    var shown = L.ch;
    var spoke = announce(ok, shown, function () {
      if (!ok && ui.tab === 'listen' && L.phase === 'reveal' && L.ch === shown) audio.playChar(shown);
    });
    if (!ok && !spoke) later(function () { audio.playChar(L.ch); }, 400);
    else if (ok && !L.event && !L.became) later(afterIntro, spoke ? 1400 : 900);
  }

  /* ---------- send (keying practice) ---------- */
  function sendUnit() { return 1.2 / (checkRunning(['send']) ? CK.DEFS.send.unitWpm : st.settings.sendWpm); }

  function renderSend() {
    var S = ui.send;
    if (S.phase === 'idle') {
      view.innerHTML = '<section class="card center"><h2>Send</h2>' +
        '<p>Key each character yourself and hear your own tone. Hold the big key (or the space bar) for dits and dahs, then pause.</p>' +
        '<p class="hint">You only send characters you have unlocked. Speed and echo mode are in Settings.</p>' +
        '<button class="btn primary" id="start">Start</button></section>';
      document.getElementById('start').addEventListener('click', startSend);
    } else if (S.phase === 'prompt') {
      var echo = st.settings.echo && !ui.check;
      view.innerHTML = '<section class="card center"><p class="label">' + (ui.check ? checkLabel() : echo ? 'Listen, then send it back' : 'Send this character') + '</p>' +
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
    S.ch = checkRunning(['send']) ? ui.check.items[ui.check.i].text : T.pick(st, 'send', Math.random, S.last);
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
    if (ui.rhythm.down) { ui.rhythm.down = 0; audio.keyUp(); }
  }

  function finishSend() {
    var S = ui.send;
    if (S.phase !== 'prompt' || !S.pattern) return;
    if (checkRunning(['send'])) {
      S.phase = 'checkwait';
      checkAdvance({ target: S.ch, answer: M.decode(S.pattern) || S.pattern, ok: S.pattern === M.TABLE[S.ch] });
      return;
    }
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

  /* ---------- study engine (used by Learn, Voice and Today) ---------- */
  /**
   * Play study steps. hooks.step(step, i, n) lets the caller show what is happening.
   * token: {stop, paused, waiters}. A name is spoken (recorded voice or the chosen voice); a tone is played.
   */
  async function runStudy(steps, token, hooks) {
    for (var i = 0; i < steps.length && !token.stop; i++) {
      while (token.paused && !token.stop) await wait(200, token);
      if (token.stop) break;
      var s = steps[i];
      if (hooks && hooks.step) hooks.step(s, i, steps.length);
      if (s.t === 'pause') await wait(s.s * 1000, token);
      else if (s.t === 'tone') { var d = audio.playChar(s.ch, undefined, true); await wait((d + 0.15) * 1000, token); }
      else await talk(charParts(s.ch, ''));
    }
  }

  /** Mark the letters of a finished study session as studied, so the quiz may include them. */
  function markStudied(plan) {
    if (!plan.fresh) return;
    var last = T.order(st).indexOf(plan.target[plan.target.length - 1]) + 1;
    if (last > st.introduced) { st.introduced = Math.min(last, st.level); save(); }
  }

  /* ---------- learn ---------- */
  var ROUND_CAPTION = { A: 'Its name, then its sound', B: 'Its sound… think of the letter… then its name', C: 'Mixed: sound, think, name' };

  function stopStudy() {
    var t = ui.learn.token;
    if (t) { t.stop = true; t.waiters.slice().forEach(function (f) { f(); }); }
    ui.learn.token = null;
    ui.learn.running = false;
  }

  function renderLearn() {
    var Ln = ui.learn;
    if (Ln.running) {
      view.innerHTML = '<section class="card center"><p class="label" id="lround">Study</p>' +
        '<div class="big" id="lbig">…</div><p class="hint" id="lcap"> </p>' +
        '<div class="meter wide" aria-hidden="true"><div id="lprog"></div></div>' +
        '<div class="row"><button class="btn" id="lpause">Pause</button><button class="btn primary" id="lstop">Stop</button></div></section>';
      document.getElementById('lpause').addEventListener('click', function () {
        var t = Ln.token;
        if (!t) return;
        t.paused = !t.paused;
        document.getElementById('lpause').textContent = t.paused ? 'Resume' : 'Pause';
      });
      document.getElementById('lstop').addEventListener('click', function () { stopStudy(); render(); });
      return;
    }
    if (Ln.done) {
      view.innerHTML = '<section class="card center"><h2>Studied</h2>' +
        '<p>You have met ' + Ln.done.join(' and ') + '. Nothing was marked. When you can think of the letter <em>before</em> its name is spoken, you are ready to be quizzed.</p>' +
        '<div class="row"><button class="btn" id="again">Study again</button><button class="btn primary" id="toquiz">' + (kind() === 'early' ? 'Listen together' : 'Go to the quiz') + '</button></div></section>';
      document.getElementById('again').addEventListener('click', function () { Ln.done = null; startStudyScreen(); });
      document.getElementById('toquiz').addEventListener('click', function () { Ln.done = null; go(kind() === 'early' ? 'together' : 'listen'); });
      return;
    }
    var p = STU.plan(st);
    var chips = p.target.map(function (c) { return '<span class="chip current" aria-label="' + c + '">' + c + '</span>'; }).join('');
    view.innerHTML = '<section class="card center"><h2>Learn</h2>' +
      '<p>Meet each letter before you are tested on it. For every letter you hear its <strong>name</strong>, then its <strong>sound</strong>. Then you hear the sound first, get a moment to think of the letter, and hear the name. Nothing is marked, so you cannot get it wrong.</p>' +
      (Ln.message ? '<p class="notice" role="status">' + Ln.message + '</p>' : '') +
      '<p class="label">' + (p.fresh ? 'New letters' : 'Review: your shakiest letters') + '</p><div class="ladder" style="justify-content:center">' + chips + '</div>' +
      '<button class="btn primary big-btn" id="lstart">Start studying</button>' +
      '<p class="hint">This takes about two minutes for two letters. The name is spoken with the voice or recordings you chose in Settings.</p></section>';
    document.getElementById('lstart').addEventListener('click', startStudyScreen);
  }

  function startStudyScreen() {
    audio.unlock();
    keepAwake();
    var Ln = ui.learn;
    stopStudy();
    Ln.message = '';
    Ln.done = null;
    var plan = STU.plan(st);
    var steps = STU.session({ target: plan.target, known: plan.known });
    var token = Ln.token = { stop: false, paused: false, waiters: [] };
    Ln.running = true;
    render();
    function show(s, i, n) {
      var big = document.getElementById('lbig'), cap = document.getElementById('lcap'), rd = document.getElementById('lround'), pr = document.getElementById('lprog');
      if (!big) return;
      big.textContent = s.show ? s.ch : '?';
      cap.textContent = ROUND_CAPTION[s.round] || '';
      rd.textContent = 'Study · ' + (s.round === 'A' ? 'Round 1' : s.round === 'B' ? 'Round 2' : 'Round 3');
      pr.style.width = Math.round(i / n * 100) + '%';
    }
    runStudy(steps, token, { step: show }).then(function () {
      if (token.stop) return;
      markStudied(plan);
      Ln.running = false;
      Ln.token = null;
      Ln.done = plan.target;
      if (ui.tab === 'learn') render();
    });
  }

  /* ---------- words (head copy) ---------- */
  function renderWords() {
    var Wd = ui.words, allowed = T.unlocked(st);
    var n = WD.matching(allowed, customList(), wordOpts()).length;
    if (Wd.phase === 'idle') {
      var custom = st.customWords.map(function (w, i) {
        return '<span class="chip" style="width:auto;padding:0 8px">' + w + ' <button type="button" class="x" data-rm="' + i + '" aria-label="Remove ' + w + '">×</button></span>';
      }).join(' ');
      view.innerHTML = '<section class="card center"><h2>Words</h2>' +
        '<p>Listen to the <strong>whole word</strong>, then type it. This trains you to hold a few letters in your head, which is how real copying works.</p>' +
        '<p class="readout">' + (n >= WD.MIN_WORDS ? n + ' words use only your unlocked letters' : 'Not enough words yet: you will copy short groups of letters') +
        ' · last 20: ' + pct(T.accuracy(st.words.recent)) + '</p>' +
        '<div class="choice">' +
        '<label><input type="checkbox" id="hamPack"' + (st.settings.hamPack ? ' checked' : '') + '><span>Include ham abbreviations and Q-codes (CQ, QTH, 73, …)</span></label>' +
        '<label><input type="checkbox" id="prosigns"' + (st.settings.prosigns ? ' checked' : '') + '><span>Include prosigns (AR, SK, BT, KN, AS). Each is one run-together sound with no gap between its letters.</span></label></div>' +
        '<button class="btn primary big-btn" id="wstart">Start</button>' +
        '<h3>Your own words</h3><p class="hint">Add names or words that matter to you. They are used once all their letters are unlocked.</p>' +
        '<form id="wform" class="row"><input id="wnew" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" aria-label="A word to add" placeholder="e.g. a name">' +
        '<button class="btn" type="submit">Add</button></form><div class="ladder" style="justify-content:center">' + custom + '</div></section>';
      document.getElementById('wstart').addEventListener('click', startWords);
      ['hamPack', 'prosigns'].forEach(function (k) {
        document.getElementById(k).addEventListener('change', function (e) { st.settings[k] = e.target.checked; save(); renderWords(); });
      });
      document.getElementById('wform').addEventListener('submit', function (e) {
        e.preventDefault();
        var w = WD.clean(document.getElementById('wnew').value);
        if (w && /^[A-Z0-9]+$/.test(w) && st.customWords.indexOf(w) < 0 && st.customWords.length < 30) { st.customWords.push(w); save(); }
        renderWords();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-rm]'), function (b) {
        b.addEventListener('click', function () { st.customWords.splice(Number(b.getAttribute('data-rm')), 1); save(); renderWords(); });
      });
    } else if (Wd.phase === 'prompt') {
      view.innerHTML = '<section class="card center"><p class="label">' + (ui.check ? checkLabel() : Wd.item.kind === 'word' ? 'Copy the whole word' :
        Wd.item.kind === 'prosign' ? 'Prosign: one run-together sound. Type its two letters.' : 'Copy the letters') + '</p>' +
        '<h2>Listen, then type what you heard</h2>' +
        '<div class="row"><button class="btn primary" id="wreplay">Replay</button></div>' +
        '<form id="wanswer" class="row"><input id="wtext" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Your answer">' +
        '<button class="btn primary" type="submit">Check</button></form></section>';
      document.getElementById('wreplay').addEventListener('click', playWord);
      document.getElementById('wanswer').addEventListener('submit', function (e) { e.preventDefault(); answerWord(document.getElementById('wtext').value); });
      document.getElementById('wtext').focus();
    } else {
      var c = Wd.cmp;
      var letters = c.letters.map(function (l) {
        return '<span class="wl ' + (l.ok ? 'ok' : 'bad') + '" aria-label="' + (l.want || 'extra') + (l.ok ? ' right' : ' wrong') + '">' + (l.want || '·') + '</span>';
      }).join('');
      view.innerHTML = '<section class="card center"><span class="status ' + (c.ok ? 'correct' : 'wrong') + '">' + (c.ok ? '✓ Correct' : '✕ Not quite') + '</span>' +
        '<div class="word">' + letters + '</div>' +
        (c.ok ? '' : '<p class="hint">You typed ' + (c.answer || 'nothing') + '.</p>') +
        '<div class="row"><button class="btn" id="wagain">Hear it again</button><button class="btn primary" id="wnext">Next</button></div></section>';
      document.getElementById('wagain').addEventListener('click', playWord);
      var nx = document.getElementById('wnext');
      nx.addEventListener('click', nextWord);
      nx.focus();
    }
  }

  function startWords() {
    audio.unlock();
    keepAwake();
    nextWord();
  }

  function nextWord() {
    clearTimers();
    var Wd = ui.words;
    if (checkRunning(['words', 'text'])) Wd.item = { text: ui.check.items[ui.check.i].text, kind: ui.check.kind === 'text' ? 'text' : 'word' };
    else Wd.item = WD.next(T.unlocked(st), Math.random, Wd.last, customList(), wordOpts());
    Wd.last = Wd.item.text;
    Wd.phase = 'prompt';
    render();
    later(playWord, 400);
  }

  function playWord() {
    var it = ui.words.item;
    if (it.kind === 'prosign') audio.playProsign(it.text); else audio.playText(it.text);
  }

  function answerWord(text) {
    var Wd = ui.words;
    if (Wd.phase !== 'prompt') return;
    var cmp = WD.compare(Wd.item.text, text);
    if (!cmp.answer) return;                       // nothing typed yet
    if (checkRunning(['words', 'text'])) {
      Wd.phase = 'checkwait';
      checkAdvance({ target: Wd.item.text, answer: text, ok: cmp.ok });
      return;
    }
    Wd.cmp = cmp;
    T.recordWord(st, cmp.target, cmp.answer, undefined, Wd.item.kind === 'prosign');
    save();
    Wd.phase = 'reveal';
    render();
    say(cmp.ok ? 'Correct' : 'Not quite, it was ' + cmp.target.split('').join(' '));
    var spoken = Wd.item.kind === 'word' ? cmp.target.toLowerCase() : cmp.target.split('').join(' ');
    var spoke = st.settings.speak && V.canSpeak;
    if (spoke) {
      speakParts(cmp.ok ? [{ clip: 'correct', text: 'Correct.' }] : [{ clip: 'notquite', text: 'Not quite.' }, { text: 'It was ' + spoken + '.' }])
        .then(function () { if (!cmp.ok && ui.tab === 'words' && Wd.phase === 'reveal') playWord(); });
    } else if (!cmp.ok) later(playWord, 400);
    if (cmp.ok) later(nextWord, spoke ? 1500 : 1100);
  }

  /* ---------- voice (hands-free) ---------- */
  var voiceToken = null;
  function recogOk() { return V.canListen && st.settings.voiceAnswers !== false; }

  function renderVoice() {
    var vs = ui.voice, canListen = recogOk(), mode = st.settings.voiceMode;
    if (!canListen && mode === 'quiz') mode = 'learn';
    if (!vs.running) {
      view.innerHTML = '<section class="card center"><h2>Voice</h2>' +
        '<p>Practise hands-free. The app plays a character and tells you by voice what it was.</p>' +
        '<div class="choice" role="radiogroup" aria-label="Voice mode">' +
        '<label><input type="radio" name="vmode" value="learn"' + (mode === 'learn' ? ' checked' : '') +
        '><span><strong>Learn the letters</strong> (start here)<br>For each new letter I say its name, then you hear its sound; then the sound first, a pause to think, and the name. Nothing is marked, so you can simply listen and absorb.</span></label>' +
        '<label><input type="radio" name="vmode" value="listen"' + (mode === 'listen' ? ' checked' : '') +
        '><span><strong>Listen and recall</strong><br>Sound, a pause to think of the letter, then the letter spoken, then the sound again. No answers needed.</span></label>' +
        '<label><input type="radio" name="vmode" value="quiz"' + (mode === 'quiz' ? ' checked' : '') + (canListen ? '' : ' disabled') +
        '><span><strong>Quiz me by voice</strong><br>Say the letter, or its phonetic word such as “Kilo”. The app says whether you were right. Say “repeat”, “skip” or “stop” at any time.</span></label></div>' +
        (vs.message ? '<p class="notice" role="alert">' + vs.message + '</p>' : '') +
        (canListen ? '' : V.canListen ? '<p class="notice">Answering by voice is off for this learner. A grown-up can turn it on in Settings. Learning and listening work as they are.</p>'
          : '<p class="notice">Voice answers need speech recognition, which this browser does not have. Chrome on Android or on a laptop has it. Learning and listening work here.</p>') +
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
      view.innerHTML = '<section class="card center"><p class="label">' + ({ learn: 'Learn the letters', quiz: 'Quiz by voice', listen: 'Listen and recall' }[vs.mode] || '') + '</p>' +
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
    var mode = st.settings.voiceMode;
    if (!recogOk() && mode === 'quiz') mode = 'learn';
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
    var dur = audio.playChar(ch, undefined, true);
    return wait((dur + 0.35) * 1000, token);
  }

  function blockMessage(r) {
    var head = 'Block complete: ' + Math.round(r.accuracy * 100) + ' percent. ';
    if (r.event === 'advance') return head + 'New character unlocked: ' + sayCh(r.newChar) + '.';
    if (r.event === 'regress') return head + 'Going back one character to firm it up.';
    return head + 'Same characters again.';
  }

  /** Hands-free study: name each new letter, then its sound, then recall rounds. Never a test. */
  async function voiceStudy(token, loop) {
    var plan = STU.plan(st);
    var steps = STU.session({ target: plan.target, known: plan.known });
    setStatus(STU.describe(plan));
    setHeard('');
    await talk(plan.fresh
      ? 'New letters: ' + plan.target.map(sayCh).join(' and ') + '. First I will name each one, then you hear its sound.'
      : 'Review: ' + plan.target.map(sayCh).join(' and ') + '.');
    await runStudy(steps, token, { step: function (s) {
      setStatus(s.t === 'pause' && s.show === false ? 'Think…' : s.t === 'tone' && !s.show ? 'Listen…' : s.ch);
    } });
    if (token.stop) return;
    markStudied(plan);
    await talk(loop ? 'Again.' : 'That is all for the new letters.');
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
        return fatal(token, 'The microphone is blocked. Allow it for this site in Chrome settings, or use Learn or Listen and recall.');
      }
      if (r.error === 'network') {
        return fatal(token, 'Voice answers need an internet connection. Use Learn or Listen and recall to practise offline.');
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
      var res = T.record(st, 'listen', ch, ok, { answered: skipped ? null : p.ch });
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
    await talk(mode === 'learn'
      ? 'Learn the letters. I will name each letter, then play its sound. Nothing is marked.'
      : mode === 'quiz'
        ? 'Voice practice. After each sound, say the letter. Say repeat, skip or stop.'
        : 'Listen and recall. You will hear a sound, then the letter, then the sound again.');
    while (!token.stop) {
      if (mode === 'learn') await voiceStudy(token, true);
      else if (st.introduced < st.level) await voiceStudy(token, false);   // new letters are studied before any question
      else if (mode === 'quiz') await quizTrial(token);
      else await listenTrial(token);
      if (!token.stop) await wait(600, token);
    }
    if (ui.voice.stoppedByVoice) await talk('Stopped.');
  }

  /* ---------- who is learning: gate, switching, family screens ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function home() { return kind() === 'early' ? 'play' : 'today'; }
  function gateOpen() { return !isKid() || ui.gateUntil > Date.now(); }

  /** Words to practise: the learner's own plus the family names a grown-up entered. */
  function customList() {
    var seen = {}, out = [];
    var names = [];
    fam.family.names.forEach(function (n) { String(n).split(/\s+/).forEach(function (w) { names.push(w); }); });
    st.customWords.concat(names).forEach(function (w) {
      w = WD.clean(w);
      if (w && /^[A-Z0-9]{2,12}$/.test(w) && !seen[w]) { seen[w] = 1; out.push(w); }
    });
    return out;
  }

  function openGate(then) {
    ui.gate = { a: 12 + Math.floor(Math.random() * 8), b: 6 + Math.floor(Math.random() * 4), then: then, wrong: false };
    ui.tab = 'gate';
    render();
  }

  function renderGate() {
    var g = ui.gate;
    view.innerHTML = '<section class="card center gatebox"><h2>Grown-ups only</h2><p>To open this part, answer: what is <strong>' + g.a + ' × ' + g.b + '</strong>?</p>' +
      (g.wrong ? '<p class="notice" role="alert">Not quite. Here is a new one.</p>' : '') +
      '<form id="gform" class="row"><input id="gans" type="text" inputmode="numeric" autocomplete="off" aria-label="Your answer"><button class="btn primary" type="submit">Open</button></form>' +
      '<div class="row"><button class="btn" id="gback" type="button">Back</button></div></section>';
    document.getElementById('gans').focus();
    document.getElementById('gform').addEventListener('submit', function (e) {
      e.preventDefault();
      if (Number(document.getElementById('gans').value.trim()) === g.a * g.b) {
        ui.gateUntil = Date.now() + 10 * 60000;
        ui.gate = null;
        g.then();
      } else {
        ui.gate = { a: 12 + Math.floor(Math.random() * 8), b: 6 + Math.floor(Math.random() * 4), then: g.then, wrong: true };
        renderGate();
      }
    });
    document.getElementById('gback').addEventListener('click', function () { ui.gate = null; go(home()); });
  }

  /** Load the active learner's progress and start their screens from scratch. */
  function loadActive() {
    st = T.load(storage(), profile().key);
    var f = freshUi();
    Object.keys(f).forEach(function (k) { ui[k] = f[k]; });
  }

  function switchProfile(id) {
    stopAll();
    save();
    FA.setActive(fam, id);
    FA.save(storage(), fam);
    loadActive();
    render();
  }

  /** Switching from a child to a grown-up's profile needs the grown-up check. */
  function chooseProfile(id) {
    var target = FA.find(fam, id);
    if (!target || id === profile().id) return go(home());
    if (isKid() && target.kind === 'adult' && !gateOpen()) return openGate(function () { switchProfile(id); });
    switchProfile(id);
  }

  function renderWho() {
    var buttons = fam.profiles.map(function (p) {
      return '<button type="button" class="bigcard" data-who="' + p.id + '">' + esc(p.name) + '<small>' + FA.KINDS[p.kind].label + (p.id === profile().id ? ' · learning now' : '') + '</small></button>';
    }).join('');
    view.innerHTML = '<section class="card center"><h2>Who is learning?</h2><div class="cards">' + buttons + '</div>' +
      '<div class="row"><button class="btn" id="whofam">Family (grown-ups)</button></div></section>';
    Array.prototype.forEach.call(view.querySelectorAll('[data-who]'), function (b) {
      b.addEventListener('click', function () { chooseProfile(b.getAttribute('data-who')); });
    });
    document.getElementById('whofam').addEventListener('click', function () { go('family'); });
  }

  function famMessage() {
    var m = ui.famMsg;
    ui.famMsg = '';
    return m ? '<p class="notice" role="status">' + esc(m) + '</p>' : '';
  }

  function downloadText(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function renderFamily() {
    if (ui.famView === 'add') return renderFamAdd();
    if (ui.famView === 'edit') return renderFamEdit();
    if (ui.famView === 'guide') return renderGuide();
    var rows = FA.summary(fam, storage(), T.today()).map(function (r) {
      var p = r.profile;
      return '<li class="famrow"><div><strong>' + esc(p.name) + '</strong> <span class="hint">· ' + FA.KINDS[p.kind].label + (p.id === profile().id ? ' · learning now' : '') + '</span></div>' +
        '<div class="hint">Letters: ' + r.letters + '<br>Solid ' + r.counts.Solid + ' · Learned ' + r.counts.Learned + ' · Learning ' + r.counts.Learning +
        '<br>Today ' + Math.floor(r.minToday) + ' min · last 7 days ' + Math.round(r.min7) + ' min · ' + (r.last ? 'last practised ' + ago(r.last) : 'not practised yet') + '</div>' +
        '<div class="row"><button class="btn small" data-open="' + p.id + '">Learn as ' + esc(p.name) + '</button><button class="btn small" data-edit="' + p.id + '">Edit</button></div></li>';
    }).join('');
    var td = FA.teachingDays(fam, storage());
    view.innerHTML = '<section class="card"><h2>Family</h2>' + famMessage() +
      '<p>Everyone has their own progress, settings and letters. Recorded voices are shared.</p><ul class="fam">' + rows + '</ul>' +
      '<div class="row"><button class="btn primary" id="famadd"' + (fam.profiles.length >= FA.MAX_PROFILES ? ' disabled' : '') + '>Add a learner</button></div>' +
      '<p class="readout">Teacher level: children have practised on ' + td + ' of ' + FA.TEACH_DAYS + ' days (' + FA.TEACH_MINUTES + '+ minutes each day).</p></section>' +

      '<section class="card"><h2>Family names</h2><p>Names of people in the family, separated by commas. They become practice words, for every learner, once their letters are unlocked.</p>' +
      '<form id="famnames" class="row"><input id="famnamesin" type="text" autocomplete="off" aria-label="Family names" value="' + esc(fam.family.names.join(', ')) + '"><button class="btn" type="submit">Save</button></form></section>' +

      '<section class="card"><h2>For grown-ups</h2><div class="row">' +
      '<button class="btn" id="famset">Settings for ' + esc(profile().name) + '</button>' +
      '<button class="btn" id="famguide">Lesson guide</button></div>' +
      '<p class="label">Family backup</p><p class="hint">Saves every learner’s progress in one file. Restoring replaces everything on this device.</p>' +
      '<div class="row"><button class="btn" id="famsave">Save a family backup</button><button class="btn" id="famrestore">Restore a family backup</button></div>' +
      '<input type="file" id="famfile" accept="application/json,.json" class="sr"><p class="hint" id="fammsg" role="status"></p></section>';
    Array.prototype.forEach.call(view.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () { chooseProfile(b.getAttribute('data-open')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { ui.famId = b.getAttribute('data-edit'); ui.famView = 'edit'; render(); });
    });
    document.getElementById('famadd').addEventListener('click', function () { ui.famView = 'add'; render(); });
    document.getElementById('famnames').addEventListener('submit', function (e) {
      e.preventDefault();
      FA.setFamilyNames(fam, document.getElementById('famnamesin').value.split(','));
      FA.save(storage(), fam);
      ui.famMsg = 'Family names saved.';
      render();
    });
    document.getElementById('famset').addEventListener('click', function () { go('settings'); });
    document.getElementById('famguide').addEventListener('click', function () { ui.famView = 'guide'; render(); });
    var msg = document.getElementById('fammsg');
    document.getElementById('famsave').addEventListener('click', function () {
      save();
      downloadText('morse-ear-trainer-family-' + T.today() + '.json', FA.exportAll(fam, storage()));
      msg.textContent = 'Backup saved to your downloads.';
    });
    document.getElementById('famrestore').addEventListener('click', function () { document.getElementById('famfile').click(); });
    document.getElementById('famfile').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      f.text().then(function (text) {
        var parsed = FA.parseBackup(text);
        if (!window.confirm('Replace everyone’s progress on this device with this backup?')) return;
        fam = FA.applyBackup(storage(), parsed, fam);
        loadActive();
        ui.famMsg = 'Restored ' + fam.profiles.length + ' learner' + (fam.profiles.length === 1 ? '' : 's') + '.';
        ui.tab = 'family';
        render();
      }).catch(function (err) { msg.textContent = err.message || 'Could not restore that file.'; });
    });
  }

  function renderFamAdd() {
    var kinds = Object.keys(FA.KINDS).map(function (k, i) {
      return '<label><input type="radio" name="fkind" value="' + k + '"' + (i === 1 ? ' checked' : '') + '><span><strong>' + FA.KINDS[k].label + '</strong><br>' + FA.KINDS[k].blurb + '</span></label>';
    }).join('');
    view.innerHTML = '<section class="card"><h2>Add a learner</h2><form id="addform" class="settings">' +
      '<div class="field"><label for="fname">Name</label><input id="fname" type="text" maxlength="24" autocomplete="off"></div>' +
      '<div class="choice" role="radiogroup" aria-label="Kind of learner">' + kinds + '</div>' +
      '<div class="field"><label for="fstart">Letters to learn first (optional)</label><input id="fstart" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(FA.initialsOf(fam.family.names)) + '">' +
      '<output>Such as the initials of family names. The rest follow in the usual order.</output></div>' +
      '<p class="notice" id="adderr" role="alert" hidden></p>' +
      '<div class="row"><button class="btn primary" type="submit">Add</button><button class="btn" type="button" id="addcancel">Cancel</button></div></form></section>';
    document.getElementById('addcancel').addEventListener('click', function () { ui.famView = 'main'; render(); });
    document.getElementById('addform').addEventListener('submit', function (e) {
      e.preventDefault();
      var kindVal = view.querySelector('input[name=fkind]:checked').value;
      try {
        var p = FA.add(fam, document.getElementById('fname').value, kindVal);
        T.save(storage(), FA.newState(kindVal, { starters: document.getElementById('fstart').value }), p.key);
        FA.save(storage(), fam);
        ui.famMsg = 'Added ' + p.name + '. Use “Learn as ' + p.name + '” to start.';
        ui.famView = 'main';
        render();
      } catch (err) {
        var box = document.getElementById('adderr');
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  }

  function renderFamEdit() {
    var p = FA.find(fam, ui.famId);
    if (!p) { ui.famView = 'main'; return renderFamily(); }
    view.innerHTML = '<section class="card"><h2>Edit ' + esc(p.name) + '</h2><form id="editform" class="settings">' +
      '<div class="field"><label for="ename">Name</label><input id="ename" type="text" maxlength="24" autocomplete="off" value="' + esc(p.name) + '"></div>' +
      '<p class="hint">' + FA.KINDS[p.kind].label + '. The kind cannot be changed; add a new learner instead.</p>' +
      '<p class="notice" id="editerr" role="alert" hidden></p>' +
      '<div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="editback">Back</button>' +
      '<button class="btn danger" type="button" id="editdel"' + (fam.profiles.length <= 1 ? ' disabled' : '') + '>Delete this learner</button></div></form></section>';
    document.getElementById('editback').addEventListener('click', function () { ui.famView = 'main'; render(); });
    document.getElementById('editform').addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        FA.rename(fam, p.id, document.getElementById('ename').value);
        FA.save(storage(), fam);
        ui.famView = 'main';
        render();
      } catch (err) {
        var box = document.getElementById('editerr');
        box.textContent = err.message;
        box.hidden = false;
      }
    });
    document.getElementById('editdel').addEventListener('click', function () {
      if (!window.confirm('Delete ' + p.name + ' and all of their progress? This cannot be undone.')) return;
      var wasActive = p.id === profile().id;
      FA.remove(fam, p.id, storage());
      FA.save(storage(), fam);
      if (wasActive) loadActive();
      ui.tab = 'family';
      ui.famView = 'main';
      ui.famMsg = 'Deleted ' + p.name + '.';
      render();
    });
  }

  function renderGuide() {
    view.innerHTML = '<section class="card guide"><h2>Teaching Morse to children</h2>' +
      '<p class="hint">Practical suggestions for a grown-up, not research findings. You know your children best: adjust freely.</p>' +
      '<h3>The idea</h3><p>The same method you use: learn each letter as one sound, with its name, never by counting dits and dahs. Children pick up sounds and songs easily, so lean on play.</p>' +
      '<h3>Ages 3 to 5 (Early learner)</h3><ul class="needs"><li>Sit together. Sessions of about five minutes, once or twice a day, stop while it is still fun.</li>' +
      '<li>Start with two or three letters, such as the first letters of their names. The app can start with your chosen letters.</li>' +
      '<li>“My letters”: they hear the name, then the sound. Say the name along with it.</li>' +
      '<li>“Echo the rhythm”: long and short sounds to tap back, no letters. It trains the ear for timing and can be played before they know any letter.</li>' +
      '<li>“Listen together”: you press play, they say which letter they think it is (a guess is fine), you press Show and tell the app if they were right.</li>' +
      '<li>Praise the trying. Do not push past tiredness; a missed day costs very little.</li></ul>' +
      '<h3>Ages 6 and up (Child who reads letters)</h3><ul class="needs"><li>About 15 minutes a day is a sensible start; shorter is fine.</li>' +
      '<li>Use Learn first, then Listen. Let them choose the order of the blocks in Today.</li>' +
      '<li>Add their own names as practice words, so the first words they copy mean something.</li>' +
      '<li>Take turns: you play a letter, they answer, then swap. Sending with the key is often the favourite part.</li></ul>' +
      '<h3>Becoming a teacher</h3><p>Level 4, “Teacher”, needs Proficient plus children practising on ' + FA.TEACH_DAYS + ' different days. The Parent screen counts those days. A short lesson of five to ten minutes, a few times a week, is plenty.</p>' +
      '<h3>Looking after their data</h3><p>Everything stays on this device. Voice answers are off for children until a grown-up turns them on in Settings, because the browser sends spoken answers to its speech service.</p>' +
      '<div class="row noprint"><button class="btn primary" id="guideprint">Print or save as PDF</button><button class="btn" id="guideback">Back</button></div></section>';
    document.getElementById('guideprint').addEventListener('click', function () { window.print(); });
    document.getElementById('guideback').addEventListener('click', function () { ui.famView = 'main'; render(); });
  }

  /* ---------- early learners: play screen ---------- */
  function renderPlay() {
    var mins = T.minutesOn(st), goal = st.settings.goalMin;
    if (mins >= goal && !ui.playMore) {
      view.innerHTML = '<section class="card center"><h2>All done for today!</h2><p>That was a good bit of listening. Time for something else. See you tomorrow!</p>' +
        '<div class="row noprint"><button class="btn" id="playmore">A grown-up can keep going</button></div></section>';
      document.getElementById('playmore').addEventListener('click', function () { openGate(function () { ui.playMore = true; go('play'); }); });
      return;
    }
    view.innerHTML = '<section class="card center"><h2>Let’s play</h2><div class="cards">' +
      '<button type="button" class="bigcard" data-go="learn">My letters<small>' + T.unlocked(st).join(' ') + '</small></button>' +
      '<button type="button" class="bigcard" data-go="together">Listen together<small>A grown-up joins in</small></button>' +
      '<button type="button" class="bigcard" data-go="rhythm">Echo the rhythm<small>Listen, then tap it back</small></button></div></section>';
    Array.prototype.forEach.call(view.querySelectorAll('[data-go]'), function (b) {
      b.addEventListener('click', function () { audio.unlock(); go(b.getAttribute('data-go')); });
    });
  }

  /* ---------- together: a grown-up assists the quiz ---------- */
  function renderTogether() {
    var Tg = ui.together;
    var unstudied = st.introduced < st.level;
    if (Tg.phase === 'idle') {
      view.innerHTML = '<section class="card center"><h2>Listen together</h2>' +
        '<p>For a grown-up and a learner, side by side. A letter plays, the learner says which letter they think it is (a guess is fine), then you press <strong>Show</strong> and tell the app whether they were right. Nobody has to type.</p>' +
        (unstudied ? '<p class="notice" role="alert">There are letters not studied yet: ' + T.order(st).slice(st.introduced, st.level).join(' and ') + '. Study them first.</p>' +
          '<div class="row"><button class="btn primary" id="tgstudy">Study them now</button></div>' : '<button class="btn primary big-btn" id="tgstart">Start</button>') +
        '<p class="hint">Answers here are not timed.</p></section>';
      var s = document.getElementById('tgstart');
      if (s) s.addEventListener('click', startTogether);
      var b = document.getElementById('tgstudy');
      if (b) b.addEventListener('click', function () { go('learn'); startStudyScreen(); });
    } else if (Tg.phase === 'prompt') {
      view.innerHTML = '<section class="card center">' + (Tg.msg ? '<p class="notice" role="status">' + esc(Tg.msg) + '</p>' : '') +
        '<h2>Which letter?</h2><p>Let ' + esc(profile().name) + ' say their answer, then press Show.</p>' +
        '<div class="row"><button class="btn" id="tgreplay">Play again</button></div>' +
        '<button class="btn primary big-btn" id="tgshow">Show</button></section>';
      document.getElementById('tgreplay').addEventListener('click', function () { audio.playChar(Tg.ch); });
      document.getElementById('tgshow').addEventListener('click', function () { Tg.phase = 'reveal'; Tg.msg = ''; render(); });
    } else {
      view.innerHTML = '<section class="card center"><div class="big">' + Tg.ch + '</div><div class="glyphs">' + glyph(M.TABLE[Tg.ch], 16) + '</div>' +
        '<p>Was the answer right?</p><div class="row"><button class="btn" id="tgagain">Hear it again</button></div>' +
        '<div class="row"><button class="btn primary" id="tgyes">Yes</button><button class="btn" id="tgno">Not yet</button></div></section>';
      document.getElementById('tgagain').addEventListener('click', function () { audio.playChar(Tg.ch); });
      document.getElementById('tgyes').addEventListener('click', function () { rateTogether(true); });
      document.getElementById('tgno').addEventListener('click', function () { rateTogether(false); });
    }
  }

  function startTogether() { audio.unlock(); keepAwake(); nextTogether(); }

  function nextTogether() {
    clearTimers();
    var Tg = ui.together;
    if (st.introduced < st.level) {
      ui.learn.message = 'A new letter is ready: ' + T.order(st).slice(st.introduced, st.level).join(' and ') + '. Study it first, then come back.';
      go('learn');
      return;
    }
    Tg.ch = T.pick(st, 'listen', Math.random, Tg.last, {});
    Tg.last = Tg.ch;
    Tg.phase = 'prompt';
    render();
    later(function () { audio.playChar(Tg.ch); }, 300);
  }

  function rateTogether(ok) {
    var Tg = ui.together;
    var e = T.record(st, 'listen', Tg.ch, ok, { ms: null, answered: ok ? Tg.ch : null });
    save();
    Tg.msg = !e ? '' : e.event === 'advance' ? 'Well done! A new letter is unlocked: ' + e.newChar + '. Study it first.'
      : e.event === 'regress' ? 'Going back a letter to firm it up.' : 'Same letters again.';
    nextTogether();
  }

  /* ---------- echo the rhythm ---------- */
  function renderRhythm() {
    var R = ui.rhythm, r = st.rhythm;
    if (R.phase === 'idle') {
      view.innerHTML = '<section class="card center"><h2>Echo the rhythm</h2>' +
        '<p>Listen to a few long and short sounds, then tap them back: a quick tap for a short sound, a longer press for a long one. There are no letters, and nothing is marked wrong.</p>' +
        '<p class="readout">Played ' + r.played + ' · matched ' + r.matched + ' · longest ' + r.best + '</p>' +
        '<button class="btn primary big-btn" id="rstart">Start</button></section>';
      document.getElementById('rstart').addEventListener('click', startRhythm);
    } else if (R.phase === 'listen') {
      view.innerHTML = '<section class="card center"><h2>Listen…</h2><p class="hint">Get ready to tap it back.</p></section>';
    } else if (R.phase === 'tap') {
      view.innerHTML = '<section class="card center"><h2>Your turn</h2>' +
        '<div class="row"><button class="btn" id="rreplay">Hear it again</button></div>' +
        '<div class="key tap" id="rkey" role="button" tabindex="0" aria-label="Tap here. Hold longer for a long sound.">Tap here · or space bar</div></section>';
      document.getElementById('rreplay').addEventListener('click', function () { R.presses = []; audio.playCode(R.pattern, 0.1, RH.UNIT); });
      var key = document.getElementById('rkey');
      key.addEventListener('pointerdown', function (e) { e.preventDefault(); key.setPointerCapture(e.pointerId); rhythmOn(); });
      key.addEventListener('pointerup', rhythmOff);
      key.addEventListener('pointercancel', rhythmOff);
    } else {
      view.innerHTML = '<section class="card center"><h2>' + (R.ok ? 'You matched it!' : 'Nearly. Listen once more.') + '</h2>' +
        '<div class="glyphs">' + glyph(R.pattern, 20) + '</div>' +
        '<div class="row"><button class="btn" id="ragain">Hear it again</button><button class="btn primary" id="rnext">Next</button></div></section>';
      document.getElementById('ragain').addEventListener('click', function () { audio.playCode(R.pattern, 0.1, RH.UNIT); });
      var nx = document.getElementById('rnext');
      nx.addEventListener('click', nextRhythm);
      nx.focus();
    }
  }

  function startRhythm() {
    audio.unlock();
    keepAwake();
    var R = ui.rhythm;
    R.len = Math.max(RH.MIN_LEN, Math.min(RH.MAX_LEN, (st.rhythm.best || RH.MIN_LEN) - 1));
    R.streak = 0;
    R.last = null;
    nextRhythm();
  }

  function nextRhythm() {
    clearTimers();
    var R = ui.rhythm;
    clearTimeout(R.endTimer);
    R.pattern = RH.pattern(R.len, Math.random, R.last);
    R.last = R.pattern;
    R.presses = [];
    R.down = 0;
    R.phase = 'listen';
    render();
    var d = audio.playCode(R.pattern, 0.5, RH.UNIT);
    later(function () { if (R.phase === 'listen') { R.phase = 'tap'; render(); } }, (d + 0.4) * 1000);
  }

  function rhythmOn() {
    var R = ui.rhythm;
    if (ui.tab !== 'rhythm' || R.phase !== 'tap' || R.down) return;
    clearTimeout(R.endTimer);
    R.down = performance.now();
    audio.keyDown();
    var k = document.getElementById('rkey');
    if (k) k.classList.add('down');
  }

  function rhythmOff() {
    var R = ui.rhythm;
    if (!R.down) return;
    var seconds = (performance.now() - R.down) / 1000;
    R.down = 0;
    audio.keyUp();
    var k = document.getElementById('rkey');
    if (k) k.classList.remove('down');
    R.presses.push(seconds);
    if (R.presses.length >= R.pattern.length) finishRhythm();
    else R.endTimer = setTimeout(finishRhythm, 1500);
  }

  function finishRhythm() {
    var R = ui.rhythm;
    if (R.phase !== 'tap' || !R.presses.length) return;
    var ok = RH.matches(R.pattern, R.presses);
    var r = st.rhythm;
    r.played++;
    if (ok) { r.matched++; r.best = Math.max(r.best, R.pattern.length); }
    var p = RH.progress({ len: R.len, streak: R.streak }, ok);
    R.len = p.len;
    R.streak = p.streak;
    R.ok = ok;
    save();
    R.phase = 'result';
    render();
    say(ok ? 'You matched it' : 'Nearly. Listen once more');
    if (!ok) later(function () { audio.playCode(R.pattern, 0.1, RH.UNIT); }, 500);
  }

  /* ---------- weekly checks ---------- */
  var CHECK_TAB = { letters: 'listen', words: 'words', text: 'words', send: 'send' };

  function abortCheck() { ui.check = null; ui.override = null; }

  function startCheck(kind) {
    var def = CK.DEFS[kind];
    if (!CK.available(kind, st).ok) return;
    go(CHECK_TAB[kind]);                       // go() also clears any check that was running
    audio.unlock();
    keepAwake();
    ui.override = Object.assign({}, st.settings, { charWpm: def.c || st.settings.charWpm, effWpm: def.s || st.settings.effWpm,
      conditions: def.cond, echo: false });
    ui.check = { kind: kind, state: 'intro', i: 0, items: CK.items(kind, st), results: [] };
    ui.checkResult = null;
    render();
  }

  function renderCheckIntro() {
    var ck = ui.check, def = CK.DEFS[ck.kind];
    view.innerHTML = '<section class="card center"><p class="label">Weekly check</p><h2>' + def.title + '</h2><p>' + def.what + '</p>' +
      '<p class="hint">About ' + def.minutes + ' minutes. Pass mark ' + Math.round(CK.PASS * 100) + '%. You can replay a sound, but nothing is marked until the end, and a check never changes which letters you have unlocked.</p>' +
      '<div class="row"><button class="btn primary" id="ckstart">Start the check</button><button class="btn" id="ckcancel">Not now</button></div></section>';
    document.getElementById('ckstart').addEventListener('click', function () { ck.state = 'run'; runCheckItem(); });
    document.getElementById('ckcancel').addEventListener('click', function () { abortCheck(); go('progress'); });
  }

  function levelCtx() { return { teachDays: FA.teachingDays(fam, storage()) }; }
  function checkLabel() { var ck = ui.check; return CK.DEFS[ck.kind].title + ' · ' + (ck.i + 1) + ' of ' + ck.items.length; }
  function checkRunning(kinds) { return ui.check && ui.check.state === 'run' && kinds.indexOf(ui.check.kind) >= 0; }

  function runCheckItem() {
    var k = ui.check.kind;
    if (k === 'letters') nextListen(); else if (k === 'send') nextSend(); else nextWord();
  }

  function checkAdvance(result) {
    var ck = ui.check;
    ck.results.push(result);
    ck.i++;
    if (ck.i >= ck.items.length) return finishCheck();
    later(runCheckItem, 350);
  }

  function finishCheck() {
    var ck = ui.check, today = T.today();
    var before = CK.levels(st, today, levelCtx()).map(function (x) { return x.ok; });
    var res = CK.score(ck.kind, ck.results);
    CK.record(st, ck.kind, res, today, CK.DEFS[ck.kind].cond);
    save();
    var reached = CK.levels(st, today, levelCtx()).filter(function (x, i) { return x.ok && !before[i]; }).map(function (x) { return x.n + ': ' + x.title; });
    ui.checkResult = { kind: ck.kind, res: res, results: ck.results, reached: reached };
    abortCheck();
    go('progress');
  }

  function resultSummary(kind, r) {
    var pc = Math.round(r.score * 100) + '%';
    if (kind === 'letters') return r.correct + ' of ' + r.n + ' right (' + pc + ')' + (r.medianMs == null ? '' : ', typical answer ' + (r.medianMs / 1000).toFixed(1) + ' s after the sound');
    if (kind === 'words') return r.correct + ' of ' + r.n + ' words exactly right (' + pc + '); ' + Math.round(r.charAcc * 100) + '% of letters';
    if (kind === 'text') return Math.round(r.charAcc * 100) + '% of characters copied right over ' + r.n + ' phrases';
    return r.correct + ' of ' + r.n + ' characters keyed exactly right (' + pc + ')';
  }

  function ago(date) {
    var d = T.daysBetween(date, T.today());
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }

  /* ---------- progress ---------- */
  function renderProgress() {
    var s = st.settings, today = T.today();
    var counts = T.countByStatus(st);
    var rows = T.unlocked(st).map(function (c) {
      var x = T.charStatus(st, c);
      return '<tr><th scope="row">' + c + '</th><td class="st-' + x.status.toLowerCase() + '">' + x.status + '</td><td>' + pct(x.acc) + '</td><td>' +
        (x.medianMs == null ? '–' : (x.medianMs / 1000).toFixed(1) + ' s') + '</td><td>' + x.days + '</td></tr>';
    }).join('');
    var needs = T.unlocked(st).map(function (c) { return { c: c, s: T.charStatus(st, c) }; })
      .filter(function (x) { return x.s.status === 'Learning' && x.s.n > 0; })
      .slice(0, 4).map(function (x) { return '<li><strong>' + x.c + '</strong> needs ' + x.s.need.join('; ') + '</li>'; }).join('');
    var pairs = T.topPairs(st, 5).map(function (p) { return p.a + '/' + p.b + ' ×' + p.count; }).join(' · ');
    var chips = T.order(st).map(function (c, i) {
      var state = i < st.level - 1 ? 'mastered' : i === st.level - 1 ? 'current' : 'locked';
      var label = c + ', ' + (state === 'locked' ? 'not yet unlocked' : state === 'current' ? 'newest character' : 'unlocked');
      return '<span class="chip ' + state + '" aria-label="' + label + '">' + c + '</span>';
    }).join('');

    var result = '';
    var cr = ui.checkResult;
    if (cr) {
      var wrong = cr.results.filter(function (r) { return !r.ok; }).slice(0, 8)
        .map(function (r) { return '<li>' + r.target + ' → ' + (r.answer || 'nothing') + '</li>'; }).join('');
      result = '<section class="card" role="status"><p class="label">' + CK.DEFS[cr.kind].title + ' result</p>' +
        '<span class="status ' + (cr.res.pass ? 'correct' : 'wrong') + '">' + (cr.res.pass ? '✓ Passed' : '✕ Not yet') + '</span>' +
        '<p>' + resultSummary(cr.kind, cr.res) + '. Pass mark ' + Math.round(CK.PASS * 100) + '%.</p>' +
        (cr.reached.length ? '<p><strong>You reached level ' + cr.reached.join(', ') + '.</strong></p>' : '') +
        (wrong ? '<p class="label">Mistakes (what it was → what you gave)</p><ul class="needs">' + wrong + '</ul>' : '') +
        '<div class="row"><button class="btn primary" id="ckdone">Done</button></div></section>';
    }

    var checks = Object.keys(CK.DEFS).map(function (k) {
      var def = CK.DEFS[k], av = CK.available(k, st), last = CK.latest(st, k);
      return '<li><div><strong>' + def.title + '</strong> <span class="hint">· about ' + def.minutes + ' min</span><br><span class="hint">' +
        (av.ok ? (last ? 'Last: ' + Math.round(last.score * 100) + '% ' + (last.pass ? 'passed' : 'not passed') + ', ' + ago(last.date) : 'Not taken yet') : av.why) +
        '</span></div><button class="btn small" data-check="' + k + '"' + (av.ok ? '' : ' disabled') + '>Start</button></li>';
    }).join('');

    var lv = CK.levels(st, today, levelCtx()).map(function (x) {
      return '<li>' + (x.ok ? '✓ ' : '○ ') + '<strong>' + x.n + '. ' + x.title + ':</strong> ' + x.detail + (x.ok || !x.need.length ? '' : '<br><span class="hint">Still needed: ' + x.need.join('; ') + '</span>') + '</li>';
    }).join('');

    view.innerHTML = result + '<section class="card"><h2>Progress</h2>' +
      '<p class="readout">Solid ' + counts.Solid + ' · Learned ' + counts.Learned + ' · Learning ' + counts.Learning + ' · New ' + counts.New +
      ' (of ' + st.level + ' unlocked)</p>' +
      '<p class="label">Koch order</p><div class="ladder">' + chips + '</div>' +
      '<p class="label">Each letter against the criteria</p>' +
      '<table class="mastery"><thead><tr><th scope="col">Letter</th><th scope="col">Status</th><th scope="col">Last 20</th><th scope="col">Typical time</th><th scope="col">Days</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">Learned means: at least 95% of the last 20 answers right, typical answer under 1.5 s after the sound ends, on at least 3 different days. Solid means it still holds two weeks later.</p>' +
      (needs ? '<p class="label">What each shaky letter still needs</p><ul class="needs">' + needs + '</ul>' : '') +
      '<p class="label">Letters you mix up</p><p>' + (pairs || 'No pattern yet.') + '</p>' +
      (pairs ? '<div class="row"><button class="btn" id="drill">Drill my weak spots</button></div>' : '') +
      '<dl class="stats">' +
      '<dt>Listening accuracy (last 50)</dt><dd>' + pct(T.accuracy(st.recent.listen)) + '</dd>' +
      '<dt>Sending accuracy (last 50)</dt><dd>' + pct(T.accuracy(st.recent.send)) + '</dd>' +
      '<dt>Speed (character / effective)</dt><dd>' + s.charWpm + ' / ' + s.effWpm + ' WPM</dd>' +
      '<dt>Practised today / 7 days</dt><dd>' + Math.floor(T.minutesOn(st)) + ' / ' + Math.round(T.minutesLastDays(st, 7)) + ' min</dd></dl>' +
      '<p class="hint">The next letter unlocks when a block of 50 answers is 90% right. Below 70% the newest one steps back.</p></section>' +

      (isKid() ? '' : '<section class="card"><h2>Weekly check</h2>' +
      '<p>Short tests with no feedback until the end. They decide your levels, so they measure what you can really do. About once a week is right; do one or all four.</p>' +
      '<ol class="plan">' + checks + '</ol></section>' +

      '<section class="card"><h2>Your levels</h2><ul class="needs">' + lv + '</ul>' +
      '<p class="hint">Levels 2 and 3 count a passed check for ' + CK.VALID_DAYS + ' days.</p></section>');

    var d = document.getElementById('drill');
    if (d) d.addEventListener('click', function () { ui.listen.focus = 'weak'; go('listen'); startListen(); });
    var done = document.getElementById('ckdone');
    if (done) done.addEventListener('click', function () { ui.checkResult = null; render(); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-check]'), function (b) {
      b.addEventListener('click', function () { startCheck(b.getAttribute('data-check')); });
    });
  }

  /* ---------- settings ---------- */
  var UNITS = { pitch: ' Hz', charWpm: ' WPM', effWpm: ' WPM', sendWpm: ' WPM', thinkSec: ' s', goalMin: ' min' };
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
      range('goalMin', 'Daily practice goal', 5, 90, 5, s.goalMin) +
      '<div class="row"><button type="button" class="btn" id="test">Play test tone</button>' +
      '<button type="button" class="btn danger" id="reset">Reset progress</button></div></form></section>' +

      '<section class="card"><h2>Practice conditions</h2><form class="settings" onsubmit="return false">' +
      '<p>Real signals are never a clean computer tone. Turn these on once the letters feel solid, to train your ear for noise, fading, a wandering pitch and an uneven hand. They apply to Listen, Words and the sound in Send. Learn, Voice and audio tracks always stay clean.</p>' +
      '<div class="field"><label for="conditions">Sound</label><select id="conditions">' +
      Object.keys(M.CONDITIONS).map(function (k) { return '<option value="' + k + '"' + (s.conditions === k ? ' selected' : '') + '>' + M.CONDITIONS[k].label + '</option>'; }).join('') +
      '</select><output id="cond-note"></output></div>' +
      '<div class="row"><button type="button" class="btn" id="condtest">Hear an example</button></div></form></section>' +

      '<section class="card"><h2>Voice</h2><form class="settings" onsubmit="return false">' +
      check('speak', 'Say “Correct” or “Not quite” out loud in Listen and Send', s.speak) +
      check('phonetic', 'Also say the phonetic word, like “K, Kilo”', s.phonetic) +
      check('voiceAnswers', 'Allow answering by voice (the browser sends your voice to its speech service, run by Google in Chrome)', s.voiceAnswers !== false) +
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

      '<section class="card"><h2>Audio tracks</h2>' +
      '<p>Make a practice recording to play with the screen off, in any music app or over the car stereo. It uses your own recorded voice, so record the letters first.</p>' +
      '<div class="field"><label for="trackkind">Track</label><select id="trackkind"><option value="learn">' + TR.KINDS.learn + '</option><option value="review">' + TR.KINDS.review + '</option></select></div>' +
      '<div class="field"><label for="tracklen">Length</label><select id="tracklen"><option value="5">5 minutes</option><option value="10" selected>10 minutes</option><option value="15">15 minutes</option></select></div>' +
      '<p class="notice" id="trackneed" hidden></p>' +
      '<div class="row"><button type="button" class="btn primary" id="maketrack">Make track</button></div>' +
      '<p class="hint" id="trackmsg" role="status"></p><div id="trackout"></div></section>' +

      '<section class="card"><h2>Voice calibration</h2>' +
      '<p>Teach the app how the speech recogniser hears <em>you</em>. You say each letter you have unlocked once, and then its phonetic word, and the app remembers any way it mishears you.</p>' +
      '<p class="readout" id="aliascount">' + Object.keys(st.aliases).length + ' learned word' + (Object.keys(st.aliases).length === 1 ? '' : 's') + '</p>' +
      '<div class="row"><button type="button" class="btn primary" id="calbtn"' + (recogOk() ? '' : ' disabled') + '>Calibrate my voice</button>' +
      '<button type="button" class="btn danger" id="clearaliases"' + (Object.keys(st.aliases).length ? '' : ' disabled') + '>Clear learned words</button></div>' +
      (recogOk() ? '' : '<p class="notice">Voice answers are off or not available in this browser.</p>') + '</section>' +

      '<section class="card"><h2>Progress backup</h2>' +
      '<p>Your progress lives only in this browser. Save a backup now and then, and use it to move to another device. Your recorded voice has its own backup above.</p>' +
      '<div class="row"><button type="button" class="btn primary" id="savebackup">Save a backup</button><button type="button" class="btn" id="restorebackup">Restore a backup</button></div>' +
      '<input type="file" id="restorefile" accept="application/json,.json" class="sr"><p class="hint" id="backupmsg" role="status"></p></section>';

    bindRanges(['pitch', 'charWpm', 'effWpm', 'sendWpm', 'volume', 'goalMin', 'speechRate', 'speechPitch', 'speechVolume', 'thinkSec']);
    bindChecks(['auto', 'echo', 'speak', 'phonetic', 'voiceAnswers']);
    document.getElementById('test').addEventListener('click', function () { audio.unlock(); audio.playChar('K'); });
    var COND_NOTE = { clean: 'A clean tone, nothing else.', light: 'A little noise and fading, a slightly human hand.',
      real: 'Noticeable noise, fading, a wandering pitch and an uneven hand. Like a real band.', hard: 'Heavy noise and fading. For when Realistic feels easy.' };
    function showCond() { document.getElementById('cond-note').textContent = COND_NOTE[st.settings.conditions]; }
    showCond();
    document.getElementById('conditions').addEventListener('change', function (e) { st.settings.conditions = e.target.value; save(); showCond(); });
    document.getElementById('condtest').addEventListener('click', function () { audio.unlock(); audio.playText('CQ TEST'); });
    document.getElementById('reset').addEventListener('click', function () {
      if (window.confirm('Reset all progress and settings? Your recordings are kept.')) {
        var keepOrder = st.order;
        st = FA.newState(kind());
        st.order = keepOrder;
        save();
        go(home());
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
    bindTracks();
    bindBackup();
  }

  /* ---------- audio tracks ---------- */
  var trackUrl = null;

  function bindTracks() {
    var kind = document.getElementById('trackkind'), btn = document.getElementById('maketrack'), need = document.getElementById('trackneed');
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    function refresh() {
      var miss = TR.missing(TR.charsFor(kind.value, st), C.has);
      var problem = !C.supported || !OAC ? 'This browser cannot record or render audio.'
        : miss.length ? 'Record your voice saying these letters first: ' + miss.join(', ') + '. (Settings → My own voice → Record my voice.)' : '';
      need.hidden = !problem;
      need.textContent = problem;
      btn.disabled = !!problem;
    }
    kind.addEventListener('change', refresh);
    refresh();
    btn.addEventListener('click', function () {
      var msg = document.getElementById('trackmsg'), out = document.getElementById('trackout');
      var minutes = Number(document.getElementById('tracklen').value);
      audio.unlock();
      btn.disabled = true;
      out.textContent = '';
      msg.textContent = 'Making the track… 0%';
      TR.render(kind.value, st, minutes, Math.random, {
        OfflineAudioContext: OAC,
        has: C.has,
        getBuffer: function (id) { return C.decode(audio.context(), id); },
        settings: st.settings,
        encodeWav: window.AudioEdit.encodeWav,
        progress: function (x) { msg.textContent = 'Making the track… ' + Math.round(x * 100) + '%'; }
      }).then(function (res) {
        var blob = new Blob([res.wav], { type: 'audio/wav' });
        if (trackUrl) URL.revokeObjectURL(trackUrl);
        trackUrl = URL.createObjectURL(blob);
        msg.textContent = 'Ready: ' + Math.round(res.seconds / 60 * 10) / 10 + ' minutes, ' + (blob.size / 1048576).toFixed(1) + ' MB.';
        var audioEl = document.createElement('audio');
        audioEl.controls = true;
        audioEl.src = trackUrl;
        var a = document.createElement('a');
        a.className = 'btn';
        a.href = trackUrl;
        a.download = 'morse-ear-trainer-' + kind.value + '-' + minutes + 'min.wav';
        a.textContent = 'Save the track';
        out.appendChild(audioEl);
        out.appendChild(a);
      }).catch(function (err) {
        if (window.console) console.warn('Track failed', err);
        msg.textContent = 'Could not make the track on this device.';
      })
        .then(function () { btn.disabled = false; });
    });
  }

  /* ---------- progress backup ---------- */
  function bindBackup() {
    var msg = document.getElementById('backupmsg');
    document.getElementById('savebackup').addEventListener('click', function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([T.exportJson(st)], { type: 'application/json' }));
      a.download = 'morse-ear-trainer-progress-' + T.today() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      msg.textContent = 'Backup saved to your downloads.';
    });
    document.getElementById('restorebackup').addEventListener('click', function () { document.getElementById('restorefile').click(); });
    document.getElementById('restorefile').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      f.text().then(function (text) {
        var next = T.importJson(text);
        if (!window.confirm('Replace your current progress with this backup?')) return;
        st = next;
        save();
        msg.textContent = 'Restored.';
        render();
      }).catch(function (err) { msg.textContent = err.message || 'Could not restore that file.'; });
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
    } else if (ui.tab === 'words') {
      if (ui.words.phase === 'reveal' && e.key === 'Enter') { e.preventDefault(); nextWord(); }
    } else if (ui.tab === 'rhythm') {
      if (e.key === ' ' && ui.rhythm.phase === 'tap') { e.preventDefault(); if (!e.repeat) rhythmOn(); }
    } else if (ui.tab === 'send') {
      if (e.key === ' ' && ui.send.phase === 'prompt') { e.preventDefault(); if (!e.repeat) keyOn(); }
      else if (e.key === 'Enter' && ui.send.phase === 'reveal') { e.preventDefault(); nextSend(); }
    }
  });
  document.addEventListener('keyup', function (e) {
    if (ui.tab === 'send' && e.key === ' ') { e.preventDefault(); keyOff(); }
    else if (ui.tab === 'rhythm' && e.key === ' ') { e.preventDefault(); rhythmOff(); }
  });

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  C.init().then(function () { if (ui.tab === 'settings' && ui.settingsView === 'main') render(); });
  V.onVoicesChanged(function () { if (ui.tab === 'settings' && ui.settingsView === 'main') fillVoices(); });

  render();
  window.__app = { st: function () { return st; }, ui: ui, fam: function () { return fam; } };
})();
