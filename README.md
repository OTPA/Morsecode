# Morse Ear Trainer

Learn Morse code by ear, so each letter becomes one recognisable sound instead of a count of dits and dahs.
One installable web app (PWA): works on an Android phone and on a laptop, offline, no account, no server.

## Method

- **Koch**: you start with two characters (K, M) and add one at a time, in the LCWO order
  `K M U R E S N A P T L W I . J Z F O Y , V G 5 / Q 9 2 H 3 8 B ? 4 7 C 1 D 6 0 X`.
  After every block of 50 characters: 90% or better unlocks the next character; below 70% takes the newest one back.
- **Farnsworth**: characters always play at the character speed (default 20 WPM). Only the gaps between characters and
  words stretch, starting at an effective 10 WPM. Gap = `3·ta` between characters, `7·ta` between words,
  `ta = (60c − 37.2s) / (19·s·c)`. When a block passes, effective speed rises by 1 WPM (can be switched off).
- Nothing spells the pattern out while you listen. The dit/dah picture appears only after you answer.

## Modes

1. **Listen** (main mode): a new character is introduced by sound five times with its letter shown; then one character
   at a time is played and you answer by typing it or tapping it. Misses come back more often.
2. **Send** (second mode): the character is shown (or, in *echo mode*, only played) and you key it yourself, holding the
   big key or the space bar. You hear your own side tone; the app decodes your timing and shows what you sent next to the
   target. Only characters you have unlocked are used. There are no flashing lights anywhere in the app.

Settings: tone pitch, character speed, effective speed, auto speed-up, sending speed, echo mode, volume.
Progress is saved on the device (localStorage).

## Run

It is plain static files; any static server works.

```sh
python3 -m http.server 8000     # then open http://localhost:8000
node --test tests/              # unit tests for timing, Koch progression, storage
```

- **Laptop**: open the page; type letters to answer, space bar to key in Send mode.
- **Android**: open the hosted page in Chrome, then menu → *Install app* / *Add to Home screen*. After the first visit it
  works offline. Audio starts on your first tap (a browser rule). The screen is kept awake during a session where the
  browser allows it.
- Hosting: GitHub Pages via `.github/workflows/pages.yml` (tests, then deploy on every push to the default branch). One-time setup:
  repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then at
  `https://<owner>.github.io/MorseIcode/`. Pages on a private repo needs a paid GitHub plan; otherwise make the repo public.
  Any other static host over HTTPS also works — service workers and install need HTTPS or localhost.

## Layout

```
index.html  manifest.webmanifest  sw.js
css/app.css            design tokens and screens
js/morse.js            table, Koch order, Farnsworth timing, keying decode (pure)
js/trainer.js          level, weighted picking, 50-character blocks, storage (pure)
js/audio.js            Web Audio: scheduled characters, live side tone
js/app.js              screens and input
tests/morse.test.js
icons/
```
