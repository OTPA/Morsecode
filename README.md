# Morse Ear Trainer

Learn Morse code by ear, so each letter becomes one recognisable sound instead of a count of dits and dahs.
One installable web app (PWA): works on an Android phone and on a laptop, offline, no account, no server.

## The method

- **Koch**: you start with two characters (K, M) and add one at a time, in the LCWO order
  `K M U R E S N A P T L W I . J Z F O Y , V G 5 / Q 9 2 H 3 8 B ? 4 7 C 1 D 6 0 X`.
  After every block of 50 quiz answers: 90% or better unlocks the next character; below 70% takes the newest one back.
- **Farnsworth**: characters always play at the character speed (default 20 WPM). Only the gaps between characters and
  words stretch, starting at an effective 10 WPM (`ta = (60c − 37.2s) / (19·s·c)`; gap = `3·ta` between characters,
  `7·ta` between words). Each passed block raises effective speed by 1 WPM (can be switched off).
- **Learn before you are tested.** A new letter is never quizzed until it has been studied. Studying has no wrong answers:
  1. *Name, then sound* (3 times): you are told the answer first.
  2. *Sound, a pause to think, then the name* (3 times): you may guess in the pause; nothing is marked.
  3. *Mixed*: the same, with letters you already know.
- Nothing spells the pattern out while you listen. The dit/dah picture appears only after an answer.
- No flashing lights anywhere.

## Learning criteria (the app's own proposed thresholds, not an external standard)

A character is **Learned** when all of these hold:

- at least 95% of your last 20 answers are right, and
- your typical answer time is under 1.5 s, measured from the end of the sound (this shows you *recognise* it rather than work it out), and
- you have answered on at least 3 different days.

It becomes **Solid** when it still passes a review at least two weeks after it was first Learned. The Progress screen
shows each letter against these criteria and what it still needs. Voice answers have no reliable timing, so only
tapped or typed answers count towards the speed criterion.

Levels: **1 Foundation** (all 40 learned, 12 WPM effective), **2 Fluent** (whole words at 15 WPM effective, 95% over
the last 20), **3 Proficient** (20 WPM plain text with noise; sending at 15 WPM), **4 Teacher** (lead a short lesson with
children). Levels 3 and 4 need features that come in later phases.

## Screens

- **Today**: the daily plan, scaled to your goal (default 40 minutes): study new letters, warm-up review of learned
  letters, weak-spot drill, send, words, and a listen-only cool-down. A timer shows the current block; nothing is forced.
  Practice minutes are counted automatically.
- **Practice**, with four modes:
  - **Learn**: the study sequence above, on screen, with the name spoken.
  - **Listen**: the quiz. About one question in five reviews an older letter. Wrong answers are recorded as mix-ups.
  - **Words**: listen to a whole word (or, early on, a short letter group), then type it. Uses only unlocked letters;
    add your own words, such as names.
  - **Send**: key letters yourself and hear your own tone; the app decodes your timing. Echo mode hides the letter.
- **Voice** (hands-free, with the screen on):
  - **Learn the letters**: the study sequence, spoken and played, no microphone, no test. Start here.
  - **Listen and recall**: sound, pause, spoken letter, sound again.
  - **Quiz me by voice**: say the letter (or its phonetic word, e.g. "Kilo"); the app says "Correct" or "Not quite, it
    was K, Kilo" and replays the sound. Say "repeat", "skip" or "stop". Unstudied letters are always studied first.
- **Progress**: letters against the criteria, what each shaky letter needs, mix-ups (with a drill button), levels, time practised.
- **Settings**: tone and speeds, daily goal, voice (device voice picker, speed, pitch, volume, accent for recognition),
  **My own voice** (record your own "Correct", "Not quite", letter names, phonetic words), **Voice calibration**
  (teach the app how it mishears you), **Audio tracks**, **Progress backup**.

### Audio tracks (screen-off practice)

Settings → Audio tracks renders a 5, 10 or 15 minute WAV file: either the study sequence or "sound, pause, your
voice says the letter". Play it in any music app, over Bluetooth in the car, or in the shower with the screen off.
It needs your own recordings of the letters it uses (the app tells you which are missing).

### Limits

Voice answers need Chrome (Android or laptop) and an internet connection: Chrome sends your voice to its speech service.
Browsers pause the microphone when the screen turns off or you switch apps, so live voice sessions stop (with a message)
instead of failing silently; audio tracks are the way to practise with the screen off. Progress and recordings live only
in this browser, so use *Save a backup* now and then. Use hands-free practice only where it is safe and legal.

## Run

It is plain static files; any static server works.

```sh
python3 -m http.server 8000     # then open http://localhost:8000
node --test tests/*.test.js     # unit tests: timing, mastery, study order, words, tracks, voice parsing, storage
```

- **Laptop**: open the page; type letters to answer, space bar to key in Send mode.
- **Android**: open the hosted page in Chrome, then menu → *Install app* / *Add to Home screen*. After the first visit it
  works offline. Audio starts on your first tap (a browser rule). The screen is kept awake during a session where the
  browser allows it.
- Hosting: GitHub Pages via `.github/workflows/pages.yml` (tests, then deploy on every push to the default branch).
  One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. Pages on a private repo
  needs a paid GitHub plan; otherwise make the repo public.

## Layout

```
index.html  manifest.webmanifest  sw.js
css/app.css            design tokens and screens
js/morse.js            table, Koch order, Farnsworth timing, keying decode (pure)
js/trainer.js          level, mastery criteria, mix-ups, weighted picking, blocks, time log, backup (pure)
js/study.js            the study sequences: name, sound, recall (pure)
js/words.js            word list, word and group picking, answer comparison (pure)
js/tracks.js           audio-track planning and offline rendering
js/audio.js            Web Audio: scheduled characters and words, live side tone
js/voiceparse.js       what you said -> character or command; what to say back (pure)
js/voice.js            browser speech synthesis and recognition
js/audioedit.js        trim, level, resample and WAV-encode a recorded clip (pure)
js/clips.js            record, store (IndexedDB), play, back up and restore your own clips
js/app.js              screens and input
tests/*.test.js
icons/
```
