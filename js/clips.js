/* The learner's own recorded voice: record, store (IndexedDB), play back in sequence, export and import.
   Clip ids: 'correct', 'notquite', 'itwas', 'ch-<char>' (letter, digit or punctuation name), 'nato-<LETTER>'. */
(function (root) {
  var DB_NAME = 'morseear-clips', STORE = 'clips';
  var ids = {};           // id -> true: what is stored, kept in memory so the app can ask synchronously
  var buffers = {};       // id -> decoded AudioBuffer
  var playing = [];       // sources currently sounding, for stop()
  var stopPlayback = null;
  var dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = root.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode);
        var out = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(out && out.result); };
        t.onerror = t.onabort = function () { reject(t.error); };
      });
    });
  }

  var Clips = {
    supported: !!(root.indexedDB && root.navigator && navigator.mediaDevices && root.MediaRecorder),
    canPlay: !!root.indexedDB,

    /** Load the list of stored ids. Call once at start-up. */
    init: function () {
      if (!Clips.canPlay) return Promise.resolve();
      return tx('readonly', function (s) { return s.getAllKeys(); }).then(function (keys) {
        ids = {};
        (keys || []).forEach(function (k) { ids[k] = true; });
      }).catch(function () { /* storage blocked: no clips */ });
    },

    has: function (id) { return !!ids[id]; },
    count: function () { return Object.keys(ids).length; },
    ids: function () { return Object.keys(ids); },

    put: function (id, blob) {
      return tx('readwrite', function (s) { return s.put({ id: id, blob: blob }); }).then(function () {
        ids[id] = true;
        delete buffers[id];
        try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* optional */ }
      });
    },

    remove: function (id) {
      return tx('readwrite', function (s) { return s.delete(id); }).then(function () { delete ids[id]; delete buffers[id]; });
    },

    clear: function () {
      return tx('readwrite', function (s) { return s.clear(); }).then(function () { ids = {}; buffers = {}; });
    },

    get: function (id) {
      return tx('readonly', function (s) { return s.get(id); }).then(function (row) { return row ? row.blob : null; });
    },

    decode: function (ctx, id) {
      if (buffers[id]) return Promise.resolve(buffers[id]);
      return Clips.get(id).then(function (blob) {
        if (!blob) return null;
        return blob.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); }).then(function (buf) {
          buffers[id] = buf;
          return buf;
        });
      }).catch(function () { return null; });
    },

    /** Play clips one after another. Resolves when the last one ends, or when stop() is called. */
    playSequence: function (ctx, clipIds, volume) {
      return Promise.all(clipIds.map(function (id) { return Clips.decode(ctx, id); })).then(function (bufs) {
        bufs = bufs.filter(Boolean);
        if (!bufs.length) return;
        return new Promise(function (resolve) {
          var t = ctx.currentTime + 0.05;
          var gain = ctx.createGain();
          gain.gain.value = volume == null ? 1 : volume;
          gain.connect(ctx.destination);
          bufs.forEach(function (b) {
            var src = ctx.createBufferSource();
            src.buffer = b;
            src.connect(gain);
            src.start(t);
            playing.push(src);
            t += b.duration + 0.04;
          });
          var timer = setTimeout(finish, Math.max(0, (t - ctx.currentTime) * 1000));
          function finish() {
            clearTimeout(timer);
            stopPlayback = null;
            resolve();
          }
          stopPlayback = function () {
            playing.forEach(function (s) { try { s.stop(); } catch (e) { /* already ended */ } });
            playing = [];
            finish();
          };
        });
      });
    },

    stop: function () { if (stopPlayback) stopPlayback(); },

    /**
     * Record one clip. Stops by itself after speech followed by a pause (or at maxMs, or if nothing is said).
     * Returns {stop(), result: Promise<{blob, ms} | {error}>}. onLevel(0..1) is called while listening.
     */
    record: function (ctx, opts) {
      opts = opts || {};
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } })
        .then(function (stream) {
          var rec = new root.MediaRecorder(stream);
          var chunks = [];
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          var src = ctx.createMediaStreamSource(stream);
          var an = ctx.createAnalyser();
          an.fftSize = 1024;
          src.connect(an);
          var buf = new Float32Array(an.fftSize);
          var started = false, quietSince = 0, t0 = performance.now(), timer = null, stopped = false, resolveResult;
          var result = new Promise(function (res) { resolveResult = res; });

          function stopNow() {
            if (stopped) return;
            stopped = true;
            clearTimeout(timer);
            try { rec.state !== 'inactive' && rec.stop(); } catch (e) { /* ignore */ }
          }
          rec.onstop = function () {
            stream.getTracks().forEach(function (t) { t.stop(); });
            try { src.disconnect(); } catch (e) { /* ignore */ }
            new Blob(chunks, { type: rec.mimeType }).arrayBuffer()
              .then(function (ab) { return ctx.decodeAudioData(ab); })
              .then(function (audio) {
                var out = root.AudioEdit.process(audio.getChannelData(0), audio.sampleRate);
                if (out.error) return resolveResult({ error: out.error });
                resolveResult({ blob: new Blob([root.AudioEdit.encodeWav(out.samples, out.rate)], { type: 'audio/wav' }), ms: out.ms });
              })
              .catch(function () { resolveResult({ error: 'decode' }); });
          };
          function tick() {
            an.getFloatTimeDomainData(buf);
            var sum = 0;
            for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            var rms = Math.sqrt(sum / buf.length), now = performance.now();
            if (opts.onLevel) opts.onLevel(Math.min(1, rms * 8));
            if (rms > 0.02) { started = true; quietSince = 0; }
            else if (started && rms < 0.012) {
              if (!quietSince) quietSince = now;
              else if (now - quietSince > 700) return stopNow();
            }
            if (now - t0 > (opts.maxMs || 5000) || (!started && now - t0 > 6000)) return stopNow();
            timer = setTimeout(tick, 50);
          }
          rec.start();
          tick();
          return { stop: stopNow, result: result };
        });
    },

    /** All clips as a JSON string (base64 WAV), for backing up or moving to another device. */
    exportJson: function () {
      return Clips.ids().reduce(function (p, id) {
        return p.then(function (acc) {
          return Clips.get(id).then(function (blob) {
            return new Promise(function (resolve) {
              var fr = new FileReader();
              fr.onload = function () { acc[id] = String(fr.result).split(',')[1]; resolve(acc); };
              fr.readAsDataURL(blob);
            });
          });
        });
      }, Promise.resolve({})).then(function (clips) { return JSON.stringify({ app: 'morse-ear-trainer', v: 1, clips: clips }); });
    },

    /** Restore clips from exportJson text. Resolves the number imported. */
    importJson: function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { return Promise.reject(new Error('That file is not a Morse Ear Trainer backup.')); }
      if (!data || data.app !== 'morse-ear-trainer' || !data.clips) return Promise.reject(new Error('That file is not a Morse Ear Trainer backup.'));
      var keys = Object.keys(data.clips).filter(function (id) { return /^(correct|notquite|itwas|ch-.|nato-[A-Z])$/.test(id); });
      return keys.reduce(function (p, id) {
        return p.then(function (n) {
          var bin = atob(data.clips[id]), bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return Clips.put(id, new Blob([bytes], { type: 'audio/wav' })).then(function () { return n + 1; });
        });
      }, Promise.resolve(0));
    }
  };

  root.Clips = Clips;
})(typeof self !== 'undefined' ? self : this);
