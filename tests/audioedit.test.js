const test = require('node:test');
const assert = require('node:assert/strict');
const AE = require('../js/audioedit.js');

function take(rate, parts) {
  // parts: [[seconds, amplitude]] -> 440 Hz bursts and silences
  const n = parts.reduce((a, [s]) => a + Math.round(s * rate), 0);
  const out = new Float32Array(n);
  let i = 0;
  for (const [sec, amp] of parts) {
    for (let k = 0; k < Math.round(sec * rate); k++, i++) out[i] = amp * Math.sin(2 * Math.PI * 440 * k / rate);
  }
  return out;
}

test('trims silence either side of a spoken burst, keeping a little air', () => {
  const rate = 44100;
  const t = AE.trim(take(rate, [[0.6, 0], [0.3, 0.2], [0.7, 0]]), rate);
  const sec = t.length / rate;
  assert.ok(sec > 0.3 && sec < 0.3 + 0.03 + 0.08 + 0.02, 'trimmed length ' + sec);
});

test('all-silent or near-silent takes are rejected', () => {
  assert.equal(AE.trim(new Float32Array(44100), 44100), null);
  assert.deepEqual(AE.process(take(44100, [[1, 0.003]]), 44100), { error: 'quiet' });
  assert.deepEqual(AE.process(new Float32Array(10), 44100), { error: 'quiet' });
});

test('normalise brings the peak to the target but never boosts noise more than 16x', () => {
  const loud = AE.normalise(take(8000, [[0.1, 0.1]]));
  assert.ok(Math.abs(AE.peak(loud) - 0.9) < 0.01);
  const faint = AE.normalise(Float32Array.from([0.01, -0.01]));
  assert.ok(Math.abs(AE.peak(faint) - 0.16) < 1e-6);
});

test('resample changes length by the rate ratio', () => {
  const s = take(44100, [[1, 0.5]]);
  assert.equal(AE.resample(s, 44100, 22050).length, 22050);
  assert.equal(AE.resample(s, 44100, 44100), s);
  assert.equal(AE.resample(Float32Array.from([0, 1]), 8000, 16000).length, 4);
});

test('process gives a short, loud, 22.05 kHz clip with faded ends', () => {
  const r = AE.process(take(48000, [[0.5, 0], [0.4, 0.1], [0.5, 0]]), 48000);
  assert.equal(r.rate, 22050);
  assert.ok(r.ms > 400 && r.ms < 600, 'ms ' + r.ms);
  assert.ok(Math.abs(AE.peak(r.samples) - 0.9) < 0.02);
  assert.equal(r.samples[0], 0);
  assert.ok(Math.abs(r.samples[r.samples.length - 1]) < 0.01);
});

test('encodeWav writes a valid 16-bit mono header and clamps samples', () => {
  const wav = AE.encodeWav(Float32Array.from([0, 0.5, -0.5, 2, -2]), 22050);
  const dv = new DataView(wav.buffer);
  const str = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(str(36, 4), 'data');
  assert.equal(dv.getUint32(4, true), wav.length - 8);
  assert.equal(dv.getUint32(24, true), 22050);
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint32(40, true), 10);
  assert.equal(dv.getInt16(44 + 3 * 2, true), 32767);
  assert.equal(dv.getInt16(44 + 4 * 2, true), -32768);
});
