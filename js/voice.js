/* Browser speech: text-to-speech out, speech recognition in. Both come from the browser (Chrome on Android and laptop). */
(function (root) {
  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  var current = null;

  function voices() {
    try { return (root.speechSynthesis && root.speechSynthesis.getVoices()) || []; } catch (e) { return []; }
  }

  var Voice = {
    canSpeak: !!(root.speechSynthesis && root.SpeechSynthesisUtterance),
    canListen: !!SR,

    /** Installed text-to-speech voices. The list can be empty until the browser has loaded it. */
    voices: voices,

    /** Call back when the browser finishes loading (or changes) its voice list. */
    onVoicesChanged: function (cb) {
      try { root.speechSynthesis.addEventListener('voiceschanged', cb); } catch (e) { /* not supported */ }
    },

    /**
     * Speak text, resolve when finished (or after a safety timeout: some Android builds never fire onend).
     * opts: {rate, pitch, volume, voiceURI}. A bare number is treated as the rate.
     */
    speak: function (text, opts) {
      if (typeof opts === 'number') opts = { rate: opts };
      opts = opts || {};
      return new Promise(function (resolve) {
        if (!Voice.canSpeak) return resolve();
        var u = new root.SpeechSynthesisUtterance(text);
        var chosen = null;
        if (opts.voiceURI) {
          var all = voices();
          for (var i = 0; i < all.length; i++) if (all[i].voiceURI === opts.voiceURI) chosen = all[i];
        }
        if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else u.lang = 'en-US';
        u.rate = opts.rate || 1;
        u.pitch = opts.pitch || 1;
        u.volume = opts.volume == null ? 1 : opts.volume;
        var done = false;
        var finish = function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        var timer = setTimeout(finish, 4000 + text.length * 120);
        u.onend = finish;
        u.onerror = finish;
        try { root.speechSynthesis.speak(u); } catch (e) { finish(); }
      });
    },

    /** Listen for one utterance in `lang`. Resolves {alts: [transcripts]} or {alts: [], error}. */
    listen: function (timeoutMs, lang) {
      return new Promise(function (resolve) {
        if (!SR) return resolve({ alts: [], error: 'unsupported' });
        var r = new SR();
        r.lang = lang || 'en-US';
        r.interimResults = false;
        r.continuous = false;
        r.maxAlternatives = 5;
        var done = false;
        var finish = function (value) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (current === r) current = null;
          try { r.abort(); } catch (e) { /* already stopped */ }
          resolve(value);
        };
        var timer = setTimeout(function () { finish({ alts: [] }); }, timeoutMs || 7000);
        r.onresult = function (e) {
          var res = e.results && e.results[0];
          var alts = [];
          for (var i = 0; res && i < res.length; i++) alts.push(res[i].transcript);
          finish({ alts: alts });
        };
        r.onerror = function (e) { finish({ alts: [], error: e.error }); };
        r.onend = function () { finish({ alts: [] }); };
        current = r;
        try { r.start(); } catch (e) { finish({ alts: [], error: 'start' }); }
      });
    },

    /** Stop anything speaking or listening right now. */
    cancel: function () {
      try { root.speechSynthesis && root.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      try { current && current.abort(); } catch (e) { /* ignore */ }
    }
  };

  root.Voice = Voice;
})(typeof self !== 'undefined' ? self : this);
