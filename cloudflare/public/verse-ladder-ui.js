import {VERSE_MASTERY_POLICY} from './verse-mastery.js';
import {createLadder, ladderReducer, isLetterKey, transition} from './verse-ladder.js';

// DOM/network edge: all input and progression go through the shared reducer.
export async function openVerseLadder(ctx, verse, chooseMode) {
  const openingView = ctx.viewVersion;
  const history = await ctx.api('/api/progress?kid=' + ctx.kid.id);
  if (openingView !== ctx.viewVersion) return;
  let round = createLadder(verse.text, history.ladderSteps.find(v => v.id === verse.id)?.step || 1);
  let session, keyboard, saving = false;
  const desk = ctx.el('section', {class: 'desk ladder-desk', tabindex: '-1', 'aria-label': 'Verse first letters'});
  let activeView;
  const active = () => activeView === ctx.viewVersion && desk.isConnected;
  async function begin() {
    const before = ctx.viewVersion;
    session = await ctx.api('/api/sessions', {kid_id: ctx.kid.id, kind: 'verse'});
    if (before !== ctx.viewVersion) return;
    ctx.shell('practice', 'verses');
    activeView = ctx.viewVersion;
    ctx.app.append(ctx.practiceBand({title: verse.reference, status: `Learn it · Step ${round.step} of 4`,
      exit: ctx.exitButton('Back to modes', chooseMode)}), desk);
    draw();
    keyboard = ctx.dockKeyboard({force: true, target: () => null, onKey: key,
      numbers: round.words.some(w => /^\p{N}/u.test(w))});
    desk.focus({preventScroll: true});
    if (round.status === 'stepDone') await finish();
  }
  function draw() {
    const line = ctx.el('p', {class: 'verse ladder-words'});
    let cursor = 0;
    round.words.forEach((word, i) => {
      const start = verse.text.indexOf(word, cursor);
      line.append(document.createTextNode(verse.text.slice(cursor, start)));
      const hidden = round.mask[i] && i >= round.position;
      line.append(ctx.el('span', {
        class: 'ladder-word' + (i === round.position ? ' current' : '') +
          (round.misses.includes(i) ? ' miss' : '') + (hidden ? ' hidden-word' : ''),
        ...(i === round.position ? {'aria-current': 'step'} : {}),
        'aria-label': hidden ? 'Hidden word' : word,
      }, hidden ? '_'.repeat(Math.min(16, Array.from(word).length)) : word));
      cursor = start + word.length;
    });
    line.append(document.createTextNode(verse.text.slice(cursor)));
    desk.replaceChildren(ctx.el('h2', {}, `Step ${round.step} of 4`),
      ctx.el('p', {}, 'Tap the first letter of each word.'),
      ctx.el('p', {class: 'muted'}, round.step === 1 ? 'Read along. No memory score yet.' : 'Hidden words count. Keep going!'),
      line, ctx.el('p', {class: 'muted'}, `${round.position} of ${round.words.length} words`));
  }
  function key(letter) {
    if (!active() || saving || !isLetterKey(letter) || round.status !== 'typing') return;
    round = ladderReducer(round, {type: 'key', key: letter});
    draw();
    if (round.status === 'stepDone') void finish();
  }
  const inputLifetime = new AbortController();
  document.addEventListener('keydown', event => {
    if (!active()) return;
    if (event.target.closest?.('input, textarea, button, select, [contenteditable]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey || !isLetterKey(event.key) || event.repeat) return;
    event.preventDefault();
    key(event.key);
  }, {signal: inputLifetime.signal});
  const observer = new MutationObserver(() => {
    if (!desk.isConnected) { inputLifetime.abort(); observer.disconnect(); }
  });
  async function finish() {
    if (saving || !active()) return;
    saving = true;
    keyboard?.remove();
    desk.append(ctx.el('p', {role: 'status'}, 'Saving your practice…'));
    try {
      const result = await ctx.api('/api/verse-attempts', {session_id: session.id, verse_id: verse.id,
        mode: 'ladder', level: round.step, typed: round.typed});
      await ctx.api('/api/sessions/complete', {session_id: session.id});
      if (!active()) return;
      const hidden = round.mask.filter(Boolean).length;
      const outcome = transition(round.step, round.slips, hidden);
      const learnedTitle = result.accuracy >= VERSE_MASTERY_POLICY.twoStars ? 'You learned it!' : 'Step complete!';
      desk.replaceChildren(ctx.el('h2', {}, outcome.learned ? learnedTitle :
        result.passed ? 'Ready for the next step!' : 'You’re building a strong memory.'),
      ctx.el('p', {role: 'status'}, round.step === 1 ? 'Great reading along! Now let’s hide a few words.' :
        `${hidden - round.slips} of ${hidden} hidden words remembered.`),
      ctx.el('div', {class: 'comparison'}, result.details.map(d => ctx.el('span', {class: d.correct ? '' : 'miss'}, d.word))),
      ctx.el('div', {class: 'row form-actions'},
        !outcome.learned ? ctx.button(result.passed ? 'Next step' : 'Try again', () => {
          round = ladderReducer(round, {type: result.passed ? 'next' : 'restart'});
          void begin().catch(err => ctx.toast(err.message));
        }, 'primary') : null,
        ctx.button('Choose a mode', chooseMode, 'secondary')));
    } catch (err) {
      if (!active()) return;
      if (err.status === 400) {
        const latest = await ctx.api('/api/state?kid=' + ctx.kid.id);
        if (!active()) return;
        const fresh = latest.verses.find(v => v.id === verse.id && !v.archived);
        if (!fresh) { chooseMode(); return; }
        Object.assign(verse, fresh);
        round = createLadder(verse.text, round.step);
        desk.replaceChildren(ctx.el('h2', {}, 'Let’s start that step again'),
          ctx.el('p', {}, 'The verse may have changed. Your next try will use the latest words.'),
          ctx.button('Try again', () => void begin().catch(error => ctx.toast(error.message)), 'primary'),
          ctx.button('Choose a mode', chooseMode, 'secondary'));
        return;
      }
      ctx.toast(err.message);
      desk.replaceChildren(ctx.el('h2', {}, 'Let’s save that step'),
        ctx.el('p', {}, 'Your letters are still here. Tap to try saving again.'),
        ctx.button('Save again', () => void finish(), 'primary'),
        ctx.button('Choose a mode', chooseMode, 'secondary'));
    } finally { saving = false; }
  }
  await begin();
  if (active()) observer.observe(ctx.app, {childList: true, subtree: true});
  else inputLifetime.abort();
}
