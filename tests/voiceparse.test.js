const test = require('node:test');
const assert = require('node:assert/strict');
const VP = require('../js/voiceparse.js');

const ALLOWED = ['K', 'M', 'U', 'R', 'E', 'S'];
const ch = (alts, allowed = ALLOWED) => { const p = VP.parse(alts, allowed); return p && p.type === 'char' ? p.ch : p && p.type; };

test('letter names, NATO words and plain letters', () => {
  assert.equal(ch(['K']), 'K');
  assert.equal(ch(['kilo']), 'K');
  assert.equal(ch(['Romeo.']), 'R');
  assert.equal(ch(['okay']), 'K');
  assert.equal(ch(['you']), 'U');
  assert.equal(ch(['are']), 'R');
  assert.equal(ch(['em']), 'M');
  assert.equal(ch(['ess']), 'S');
});

test('"k as in kilo" and "it is a K" pick the intended letter', () => {
  assert.equal(ch(['k as in kilo']), 'K');
  assert.equal(ch(["it's a K"]), 'K');
  assert.equal(ch(['uniform']), 'U');
});

test('an allowed letter in a lower alternative beats a likelier one that is not on the pad', () => {
  assert.equal(ch(['see', 'es', 'ess'], ['S', 'K']), 'S');
  assert.equal(ch(['see'], ['S', 'K']), 'C'); // nothing allowed: falls back to the best guess
});

test('numbers, "oh" as zero, and punctuation', () => {
  const all = ['5', '0', '.', ',', '/', '?', '2', '4', 'O'];
  assert.equal(ch(['five'], all), '5');
  assert.equal(ch(['5'], all), '5');
  assert.equal(ch(['zero'], all), '0');
  assert.equal(ch(['oh'], ['0', 'K']), '0');
  assert.equal(ch(['oh'], ['O', '0']), 'O');
  assert.equal(ch(['period'], all), '.');
  assert.equal(ch(['comma'], all), ',');
  assert.equal(ch(['slash'], all), '/');
  assert.equal(ch(['question mark'], all), '?');
  assert.equal(ch(['for'], all), '4');
  assert.equal(ch(['to'], all), '2');
});

test('double you and x-ray', () => {
  assert.equal(ch(['double you'], ['W', 'U']), 'W');
  assert.equal(ch(['x-ray'], ['X', 'K']), 'X');
  assert.equal(ch(['whiskey'], ['W']), 'W');
});

test('commands', () => {
  assert.equal(ch(['repeat']), 'repeat');
  assert.equal(ch(['say that again']), 'repeat');
  assert.equal(ch(['skip']), 'skip');
  assert.equal(ch(["I don't know"]), 'skip');
  assert.equal(ch(['stop']), 'stop');
  assert.equal(ch(['quit']), 'stop');
});

test('nothing usable returns null', () => {
  assert.equal(VP.parse([], ALLOWED), null);
  assert.equal(VP.parse(['', '  '], ALLOWED), null);
  assert.equal(VP.parse(['blah blah'], ALLOWED), null);
});

test('say() builds what the voice speaks back', () => {
  assert.equal(VP.say('K', true), 'K, Kilo');
  assert.equal(VP.say('k', false), 'K');
  assert.equal(VP.say('5', true), 'five');
  assert.equal(VP.say('?', true), 'question mark');
  assert.equal(VP.say('X', true), 'X, X-ray');
});

test('every Koch character can be spoken and understood back', () => {
  const Morse = require('../js/morse.js');
  Morse.KOCH_ORDER.forEach((c) => {
    const words = VP.say(c, false);
    assert.equal(ch([words], Morse.KOCH_ORDER), c, c + ' via "' + words + '"');
    if (/[A-Z]/.test(c)) assert.equal(ch([VP.NATO[c]], Morse.KOCH_ORDER), c, c + ' via NATO');
  });
});
