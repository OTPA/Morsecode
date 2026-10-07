/* Coaching notes for the Today screen: plain advice drawn from what the app already knows. Pure. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./trainer.js'), require('./checks.js'));
  else root.Coach = factory(root.Trainer, root.Checks);
})(typeof self !== 'undefined' ? self : this, function (Trainer, Checks) {
  function lastPracticeDay(st) {
    var days = Object.keys(st.log).filter(function (d) { return st.log[d] >= 30; }).sort();
    return days.length ? days[days.length - 1] : null;
  }

  /**
   * Up to two notes, most useful first: [{text, action?}]. action is a screen to open ('learn', 'progress').
   */
  function notes(st, today, opts) {
    opts = opts || {};
    var out = [];
    var goal = st.settings.goalMin;
    var last = lastPracticeDay(st);
    var gap = last ? Trainer.daysBetween(last, today) : null;

    if (gap !== null && gap >= 4) {
      out.push({ text: 'Welcome back after ' + gap + ' days. Letters fade without review, so start with the study block and go gently: it comes back quickly.', action: 'learn' });
    }

    var stuck = Trainer.unlocked(st).map(function (c) { return { c: c, s: Trainer.charStatus(st, c) }; })
      .filter(function (x) { return x.s.status === 'Learning' && x.s.n >= 20 && x.s.acc < 0.8; })
      .sort(function (a, b) { return a.s.acc - b.s.acc; });
    if (stuck.length) {
      var x = stuck[0];
      out.push({ text: x.c + ' is proving hard (' + Math.round(x.s.acc * 100) + '% over your last ' + x.s.n + '). Study it again, slowly, and let the sound settle before you quiz it. Lowering the effective speed in Settings can also help.', action: 'learn' });
    }

    if (st.levelDate && Trainer.daysBetween(st.levelDate, today) >= 10 && st.block.length >= 20 && Trainer.accuracy(st.block) < 0.85) {
      out.push({ text: 'You have been on level ' + st.level + ' for ' + Trainer.daysBetween(st.levelDate, today) + ' days. A plateau is normal. Short daily sessions, a rest day, and the study block usually break it.' });
    }

    var d = opts.checks === false ? { due: false } : Checks.due(st, today);
    if (d.due) {
      out.push({ text: d.days === null ? 'You have unlocked enough letters for a first weekly check. It shows where you really stand.' : 'Your weekly check is due (last one ' + d.days + ' days ago).', action: 'progress' });
    }

    if (Trainer.minutesOn(st, today) >= goal) {
      out.push({ text: 'Today’s goal is done. More is optional: rest helps memory settle.' });
    }
    return out.slice(0, 2);
  }

  return { notes: notes, lastPracticeDay: lastPracticeDay };
});
