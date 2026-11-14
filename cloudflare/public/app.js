import {newLearnWord, advanceLearn} from "/learn.js";
const $ = (id) => document.getElementById(id);
const app = $("app");
const FAMILY_STORAGE = "family-practice-code";
let familyCode = "";
try { familyCode = localStorage.getItem(FAMILY_STORAGE) || ""; } catch {}
function rememberFamily(code) {
  if (code !== familyCode) { stopSpeaking(); clearSpeechCache(); cooldown = 0; }
  familyCode = code;
  try {
    if (code) localStorage.setItem(FAMILY_STORAGE, code);
    else localStorage.removeItem(FAMILY_STORAGE);
  } catch { toast("This browser cannot remember your family. Keep your code handy."); }
}
function familyFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("X-Family-Code", familyCode);
  return fetch(path, { ...options, headers, credentials: "same-origin" });
}
let state = {
    kids: [],
    lists: [],
    verses: [],
    settings: { voice: "cloud", speed: 1 },
    parent: false,
  },
  kid = null,
  tab = "Spelling";
let viewVersion = 0;
let cooldown = 0,
  audio = null,
  speechGeneration = 0,
  cancelPending = null;
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else if (v !== false && v != null)
      n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of children.flat(Infinity))
    if (child != null)
      n.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return n;
}
function toast(s) {
  $("toast").textContent = s;
  $("toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").style.display = "none"), 4500);
}
function button(text, fn, cls = "") {
  return el(
    "button",
    {
      type: "button",
      class: cls,
      onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await fn(e);
        } catch (err) {
          toast(err.message);
        } finally {
          b.disabled = false;
        }
      },
    },
    text,
  );
}
async function api(p, data) {
  const r = await familyFetch(
    p,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "Please try again");
  return b;
}
const focus = (n) => setTimeout(() => n?.focus(), 40);
const titleDate = () =>
  `Week of ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
const today = () => new Date().toISOString().slice(0, 10);
function field(label, input) {
  return el("div", {}, el("label", { for: input.id }, label), input);
}
function input(id, value = "", attrs = {}) {
  return el("input", { id, value, ...attrs });
}
function textArea(id, value = "", attrs = {}) {
  return el("textarea", { id, ...attrs }, value);
}
// Session-only, family-scoped audio. No speech text or audio is stored on disk.
const speechCache = new Map();
const SPEECH_CACHE_LIMIT = 24;
// Reuse one media element: iOS unlocks media per element, not per AudioContext.
const speechPlayer = new Audio();
speechPlayer.preload = "auto";
let mediaUnlocked = false;
function unlockSpeechPlayer() {
  if (mediaUnlocked) return;
  const bytes = new Uint8Array(46), data = new DataView(bytes.buffer);
  const label = (offset, text) => [...text].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); });
  label(0, "RIFF"); data.setUint32(4, 38, true); label(8, "WAVEfmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, 22050, true); data.setUint32(28, 44100, true);
  data.setUint16(32, 2, true); data.setUint16(34, 16, true); label(36, "data"); data.setUint32(40, 2, true);
  const silentURL = URL.createObjectURL(new Blob([bytes], {type: "audio/wav"}));
  delete speechPlayer.dataset.voiceClip;
  speechPlayer.src = silentURL;
  // play() is invoked synchronously inside the gesture, before any session fetch.
  const playing = speechPlayer.play();
  mediaUnlocked = true;
  playing.then(() => { if (speechPlayer.src === silentURL) speechPlayer.pause(); }).catch(() => { if (speechPlayer.src === silentURL) mediaUnlocked = false; }).finally(() => URL.revokeObjectURL(silentURL));
}
document.addEventListener("pointerdown", unlockSpeechPlayer, {capture: true, passive: true});
document.addEventListener("keydown", unlockSpeechPlayer, {capture: true});
const cloudVoice = () => state.settings.voice !== "device";
function clearSpeechCache() {
  for (const entry of speechCache.values()) {
    entry.controller?.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  speechCache.clear();
}
function stopSpeaking() {
  speechGeneration++;
  if (audio) {
    audio.pause();
    audio = null;
  }
  // Cancel pending downloads as well as the active playback/utterance.
  for (const [key, entry] of speechCache) {
    if (entry.controller) { entry.controller.abort(); speechCache.delete(key); }
  }
  window.speechSynthesis?.cancel();
  cancelPending?.();
  cancelPending = null;
}
function browserSay(text, rate = 1, generation = speechGeneration) {
  return new Promise((resolve) => {
    if (generation !== speechGeneration || !window.speechSynthesis) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice =
      voices.find((v) => v.lang === "en-US" && /Chrome OS US English|Samantha|Ava/i.test(v.name)) ||
      voices.find((v) => v.lang === "en-US" && v.localService) ||
      voices.find((v) => v.lang === "en-US") || null;
    u.lang = "en-US";
    u.rate = Math.max(0.5, Math.min(1.5, state.settings.speed * rate));
    u.onend = u.onerror = resolve;
    cancelPending = resolve;
    speechSynthesis.speak(u);
  });
}
function cloudClip(text) {
  const key = JSON.stringify([familyCode, text]);
  let entry = speechCache.get(key);
  if (entry) {
    speechCache.delete(key);
    speechCache.set(key, entry);
    return entry.promise;
  }
  const controller = new AbortController();
  entry = { controller, url: null, promise: null };
  const timer = setTimeout(() => controller.abort(), 4000);
  entry.promise = (async () => {
    try {
      const r = await familyFetch("/api/tts?" + new URLSearchParams({ text, lang: "en" }), { signal: controller.signal, cache: "no-store" });
      if (!r.ok) throw Error("Cloud voice unavailable");
      const blob = await r.blob();
      if (!blob.size || controller.signal.aborted) throw Error("Empty or canceled audio");
      entry.url = URL.createObjectURL(blob);
      entry.controller = null;
      return entry.url;
    } catch (err) {
      if (speechCache.get(key) === entry) speechCache.delete(key);
      throw err;
    } finally { clearTimeout(timer); }
  })();
  speechCache.set(key, entry);
  while (speechCache.size > SPEECH_CACHE_LIMIT) {
    const [oldKey, old] = speechCache.entries().next().value;
    speechCache.delete(oldKey);
    old.controller?.abort();
    if (old.url) URL.revokeObjectURL(old.url);
  }
  return entry.promise;
}
function prefetchSpeech(texts) {
  if (!cloudVoice() || Date.now() < cooldown) return;
  for (const text of texts.filter(Boolean)) cloudClip(text).catch(() => {});
}
async function clip(text, rate, generation) {
  if (generation !== speechGeneration) return;
  if (!cloudVoice()) { $("voice-status").textContent = "Device voice active"; return browserSay(text, rate, generation); }
  if (Date.now() < cooldown) return browserSay(text, rate, generation);
  let player;
  try {
    const url = await cloudClip(text);
    if (generation !== speechGeneration) return;
    player = speechPlayer;
    player.src = url;
    player.dataset.voiceClip = "true";
    audio = player;
    player.preservesPitch = true;
    player.playbackRate = Math.max(0.5, Math.min(1.5, state.settings.speed * rate));
    await new Promise((resolve, reject) => {
      cancelPending = resolve;
      player.onended = resolve;
      player.onerror = reject;
      player.play().catch(reject);
    });
    if (generation === speechGeneration) $("voice-status").textContent = "Cloud voice active";
  } catch {
    if (generation === speechGeneration) {
      player?.pause();
      cooldown = Date.now() + 60000;
      $("voice-status").textContent = "Device voice active · cloud voice temporarily unavailable";
      await browserSay(text, rate, generation);
    }
  } finally {
    if (audio === player) audio = null;
    if (generation === speechGeneration) cancelPending = null;
  }
}
async function say(texts, rate = 1) {
  stopSpeaking();
  const generation = speechGeneration;
  for (const text of [].concat(texts).filter(Boolean)) {
    if (generation !== speechGeneration) break;
    await clip(text, rate, generation);
  }
}
async function reload() {
  state = await api("/api/state" + (kid ? "?kid=" + kid.id : ""));
  if (kid) kid = state.kids.find((k) => k.id === kid.id) || null;
  header();
}
function header() {
  const actions = $("header-actions");
  actions.replaceChildren(
    familyCode ? button("Family code", codeCard, "quiet small") : null,
    familyCode ? button("Switch family", async () => { await api("/api/parent/lock", {}).catch(() => {}); rememberFamily(""); kid = null; state.parent = false; history.replaceState({}, "", "/"); landing(); }, "quiet small") : null,
    el(
      "div",
      { class: "row" },
      kid
        ? button(
            "← Switch kid",
            () => {
              kid = null;
              render();
            },
            "quiet small",
          )
        : null,
      state.parent
        ? button(
            "Lock Parent mode",
            async () => {
              await api("/api/parent/lock", {});
              await reload();
              render();
            },
            "secondary small",
          )
        : button("Parent mode", unlock, "secondary small"),
    ),
  );
}
function shell() {
  viewVersion++;
  stopSpeaking();
  app.replaceChildren();
  header();
  if (!kid) return false;
  app.append(
    el(
      "div",
      { class: "row spread" },
      el("h1", {}, kid.name + "’s practice"),
      el("span", { class: "badge" }, "Grade " + (kid.grade || "—")),
    ),
    el(
      "nav",
      { class: "tabs", "aria-label": "Practice sections" },
      [
        "Spelling",
        "Bible Verses",
        "Progress",
        ...(state.parent ? ["Parent"] : []),
      ].map((t) =>
        button(
          t,
          () => {
            tab = t;
            render();
          },
          t === tab ? "active" : "",
        ),
      ),
    ),
  );
  return true;
}
async function selectKid(k) {
  kid = k;
  tab = "Spelling";
  await reload();
  render();
}
function render() {
  if (!shell()) {
    app.append(
      el(
        "section",
        { class: "hero" },
        el("span", { class: "badge" }, state.family?.name || "Welcome home"),
        el("h1", {}, "Who’s ready to grow?"),
        el(
          "p",
          {},
          "Pick your name for spelling, Bible verses, and a little daily progress.",
        ),
      ),
      el(
        "div",
        { class: "grid" },
        state.kids.map((k, i) =>
          button(
            [
              el("span", {}, ["🌻 ", "🌷 ", "🌳 "][i % 3] + k.name),
              el("small", {}, "Grade " + (k.grade || "—")),
            ],
            () => selectKid(k),
            "kid",
          ),
        ),
      ),
    );
    if (!state.kids.length)
      app.append(el("section", { class: "card" },
        el("h2", {}, "Your family’s garden starts here"),
        el("p", {}, state.parent ? "Add a first name or nickname to begin. Then add your own spelling words and Bible verses." : "Ask a parent to unlock Parent mode and add a profile."),
        state.parent ? button("+ Add your first kid", () => editKid()) : button("Unlock Parent mode", unlock),
      ));
    if (state.parent)
      app.append(
        button("Manage family & settings", () => parentHome(), "secondary"),
      );
    return;
  }
  if (tab === "Spelling") spellingHome();
  else if (tab === "Bible Verses") verseHome();
  else if (tab === "Progress") progressHome();
  else parentHome(true);
}
function listCard(l) {
  return el(
    "section",
    { class: "card" },
    el(
      "div",
      { class: "row" },
      l.sample ? el("span", { class: "badge" }, "Sample") : null,
      l.archived ? el("span", { class: "badge" }, "Archived") : null,
    ),
    el("h3", {}, l.title),
    el("p", { class: "muted" }, `${l.date} · ${l.words.length} words`),
    el("small", {}, "New list? Learn first, then take the test."),
    el(
      "div",
      { class: "row" },
      button("Learn", () => startLearning(l.words, l)),
      button("Test", () => startSpelling(l.words, l), "secondary"),
      button("View words", () => wordSheet(l), "secondary"),
    ),
    state.parent
      ? el(
          "div",
          { class: "row form-actions" },
          button("Edit", () => editList(l), "quiet small"),
          button(
            l.archived ? "Restore" : "Archive",
            () => archive("lists", l),
            "quiet small",
          ),
        )
      : null,
  );
}
function spellingHome() {
  const active = state.lists.filter((l) => !l.archived);
  app.append(
    el(
      "div",
      { class: "row spread" },
      el(
        "p",
        {},
        "Listen carefully. Type confidently. Try again when you need to.",
      ),
      state.parent ? button("+ Add spelling list", () => editList()) : null,
    ),
  );
  app.append(
    el(
      "section",
      { class: "card row spread" },
      el(
        "div",
        {},
        el("h2", {}, "Tricky words garden"),
        el(
          "p",
          { class: "muted" },
          "A little extra practice for words you’ve missed. Three first-try wins help a word graduate.",
        ),
      ),
      button(
        "Review tricky words",
        async () => {
          const ws = await api("/api/tricky?kid=" + kid.id);
          if (!ws.length) {
            toast("No tricky words yet. Keep growing!");
            return;
          }
          startSpelling(
            ws.map((w) => ({ ...w, id: w.word_id })),
            null,
            "tricky",
          );
        },
        "secondary",
      ),
    ),
  );
  if (!active.length)
    app.append(
      el("p", {}, "No lists yet. A parent can add this week’s words."),
    );
  if (active[0]) app.append(el("h2", {}, "This week"), listCard(active[0]));
  if (active.length > 1)
    app.append(
      el("h2", {}, "Past weeks"),
      el("div", { class: "grid" }, active.slice(1).map(listCard)),
    );
  if (state.parent && state.lists.some((l) => l.archived))
    app.append(
      el(
        "details",
        {},
        el("summary", {}, "Archived lists"),
        state.lists.filter((l) => l.archived).map(listCard),
      ),
    );
}
function wordSheet(l) {
  shell();
  const ol = el(
    "ol",
    {},
    l.words.map((w) =>
      el(
        "li",
        {},
        el("strong", {}, w.word),
        w.sentence ? el("div", { class: "muted" }, w.sentence) : null,
      ),
    ),
  );
  app.append(
    el(
      "section",
      { class: "print-sheet card" },
      el("h2", {}, l.title),
      el("p", {}, kid.name + " · " + l.date),
      ol,
      el(
        "div",
        { class: "row" },
        button("Print", () => window.print()),
        button("Back", render, "secondary"),
      ),
    ),
  );
}
function shuffled(a) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
// Every Learn attempt is tagged independently from first-try spelling tests.
function startLearning(ws, list) {
  shell();
  app.append(el("section", {class: "practice card"},
    el("span", {class: "badge"}, "Learn · recommended for new lists"),
    el("h2", {}, list.title),
    el("p", {}, "Listen, copy the word, then try with fewer letters. Always type the whole word. If you miss, compare and try an easier clue."),
    el("small", {}, "Inspired by Copy–Cover–Compare and vanishing-cue practice."),
    button("Start learning", async () => {
      const view = viewVersion;
      const session = await api("/api/sessions", {kid_id: kid.id, list_id: list.id, word_ids: ws.map(w => w.id), kind: "learn"});
      if (view !== viewVersion) return;
      const round = {ws: [...ws], list, session: session.id, index: 0, comparisons: 0};
      round.learning = newLearnWord(ws[0].word);
      learnStep(round);
    }), button("Back", render, "secondary")));
}
function learnStep(round) {
  shell();
  const view = viewVersion, w = round.ws[round.index], step = round.learning.steps[round.learning.index];
  const answer = input("learn-answer", "", {class: "answer", autocomplete: "off", inputmode: "text", autocapitalize: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "done", "aria-label": "Type the full word"});
  const cue = el("p", {class: "verse learn-cue", "aria-label": step.level === 100 ? "No letter clues" : "Letter clues"}, step.cue);
  const feedback = el("p", {class: "feedback", role: "status", "aria-live": "polite"}, "Type the full word, including the hidden letters.");
  let done = false, comparisonTimer;
  const check = el("button", {type: "submit"}, "Check word");
  const continueButton = button("Continue", async () => {
    clearTimeout(comparisonTimer);
    if (round.learning.learned) {
      if (round.index + 1 === round.ws.length) return finishLearning(round);
      round.index++;
      round.learning = newLearnWord(round.ws[round.index].word);
    }
    learnStep(round);
  });
  continueButton.hidden = true;
  const form = el("form", {onsubmit: async e => {
    e.preventDefault();
    if (done || check.disabled) return;
    check.disabled = true;
    try {
      const result = await api("/api/attempts", {session_id: round.session, word_id: w.id, typed: answer.value, mode: "learn", level: step.level});
      if (view !== viewVersion) return;
      round.learning = advanceLearn(round.learning, result.correct);
      done = true;
      answer.disabled = true;
      check.hidden = true;
      continueButton.hidden = false;
      if (result.correct) {
        feedback.textContent = round.learning.learned ? "Learned! You spelled it with no clues." : "Yes! Let’s try with fewer clues.";
        feedback.className = "feedback good";
        focus(continueButton);
      } else {
        round.comparisons++;
        cue.textContent = w.word;
        feedback.textContent = "Compare: " + w.word + ". Next, try one easier clue.";
        feedback.className = "feedback retry";
        continueButton.disabled = true;
        comparisonTimer = setTimeout(() => {
          if (view !== viewVersion) return;
          cue.textContent = round.learning.steps[round.learning.index].cue;
          continueButton.disabled = false;
          focus(continueButton);
        }, 1800);
        say(w.word);
      }
    } catch (err) {toast(err.message); check.disabled = false;}
  }}, el("label", {for: "learn-answer"}, "Type the full word"), answer, feedback, check, continueButton);
  app.append(el("section", {class: "practice card"},
    el("span", {class: "badge"}, `Learn · word ${round.index + 1} of ${round.ws.length} · ${step.level}% hidden`),
    el("h2", {}, step.level === 0 ? "Listen and copy" : step.level === 100 ? "Now spell from memory" : "Fill in the fading letters"),
    cue, button("🔊 Say again", () => say([w.word, w.sentence, w.word]), "secondary"), form,
    button("End learning", () => {if (confirm("Leave learning? Your attempts will still be saved.")) render();}, "quiet")));
  focus(answer);
  say([w.word, w.sentence, w.word]);
  prefetchSpeech(round.ws.slice(round.index, round.index + 2).flatMap(word => [word.word, word.sentence]));
}
async function finishLearning(round) {
  const view = viewVersion;
  await api("/api/sessions/complete", {session_id: round.session});
  if (view !== viewVersion) return;
  shell();
  app.append(el("section", {class: "practice card"}, el("span", {class: "badge"}, "Learning complete"),
    el("h1", {}, "Ready to try on your own!"),
    el("p", {}, `${round.ws.length} words learned · ${round.comparisons} compare-and-try-again moments.`),
    el("p", {}, "Learning is practice. Only first tries in Test count toward spelling accuracy."),
    button("Take the test now", () => startSpelling(round.ws, round.list)), button("Back to lists", render, "secondary")));
}
async function startSpelling(ws, list = null, kind = "spelling") {
  shell();
  const shuffle = input("shuffle", "", { type: "checkbox", checked: true });
  app.append(
    el(
      "section",
      { class: "practice card" },
      el(
        "span",
        { class: "badge" },
        kind === "tricky" ? "Tricky words" : "Spelling practice",
      ),
      el("h2", {}, list?.title || "Your review round"),
      el(
        "p",
        {},
        `${ws.length} words. You get one retry. Listen to the word, a sentence, then the word again.`,
      ),
      el("label", { class: "inline" }, shuffle, "Shuffle the words"),
      el(
        "div",
        { class: "row" },
        button("Let’s begin", async () => {
          const view = viewVersion;
          const session = await api("/api/sessions", {
            kid_id: kid.id,
            list_id: list?.id,
            word_ids: ws.map((w) => w.id),
            kind,
          });
          if (view !== viewVersion) return;
          const round = {
            ws: shuffle.checked ? shuffled(ws) : [...ws],
            list,
            kind,
            session: session.id,
            index: 0,
            first: 0,
            misses: [],
          };
          spellingStep(round);
        }),
        button("Back", render, "secondary"),
      ),
    ),
  );
}
function spellingStep(round) {
  shell();
  const view = viewVersion;
  const w = round.ws[round.index];
  let retry = false,
    done = false;
  const answer = input("answer", "", {
    class: "answer",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    inputmode: "text",
    enterkeyhint: "done",
    spellcheck: "false",
    "aria-label": "Type the spelling word",
  });
  const feedback = el(
    "p",
    { class: "feedback", role: "status", "aria-live": "polite" },
    "Ready when you are.",
  );
  const check = el("button", { type: "submit" }, "Check word ↵");
  const replay = () => say([w.word, w.sentence, w.word]);
  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (check.disabled) return;
        if (done) {
          check.disabled = true;
          try {
            if (round.index + 1 === round.ws.length)
              await finishSpelling(round);
            else {
              round.index++;
              spellingStep(round);
            }
          } catch (err) {
            toast(err.message);
          } finally {
            check.disabled = false;
          }
          return;
        }
        check.disabled = true;
        try {
          const result = await api("/api/attempts", {
            session_id: round.session,
            word_id: w.id,
            typed: answer.value,
          });
          if (view !== viewVersion) return;
          if (result.correct) {
            if (!retry) round.first++;
            feedback.textContent = retry
              ? "You got it. Nice persistence!"
              : "Yes! First-try success!";
            feedback.className = "feedback good";
            done = true;
          } else if (!retry) {
            retry = true;
            round.misses.push(w);
            feedback.textContent = "Almost. Listen once more and try again.";
            feedback.className = "feedback retry";
            answer.select();
            say(w.word);
          } else {
            feedback.textContent = "Let’s learn it: " + w.word;
            feedback.className = "feedback retry";
            done = true;
            say(`${w.word}. ${[...w.word].join(", ")}. ${w.word}.`, 0.8);
          }
          if (done) {
            answer.disabled = true;
            check.textContent =
              round.index === round.ws.length - 1
                ? "See my results ↵"
                : "Next word ↵";
            focus(check);
          } else focus(answer);
        } catch (err) {
          toast(err.message);
        } finally {
          check.disabled = false;
        }
      },
    },
    el("label", { for: "answer" }, "Type the word you hear"),
    answer,
    feedback,
    check,
  );
  app.append(
    el(
      "section",
      { class: "practice card" },
      el(
        "span",
        { class: "badge" },
        `Word ${round.index + 1} of ${round.ws.length}`,
      ),
      el("h2", {}, "Listen, then spell"),
      el(
        "div",
        { class: "row" },
        button("🔊 Say again", replay, "secondary"),
        button(
          "Sentence",
          () =>
            w.sentence ? say(w.sentence) : toast("This word has no sentence."),
          "secondary",
        ),
        button("🐢 Slowly", () => say(w.word, 0.75), "secondary"),
      ),
      form,
      el(
        "div",
        { class: "form-actions" },
        button(
          "End practice",
          () => {
            if (confirm("Leave this round? Your attempts will still be saved."))
              render();
          },
          "quiet small",
        ),
      ),
    ),
  );
  focus(answer);
  replay();
  // Warm this word and the next word (including their sentences), then one ahead.
  prefetchSpeech(round.ws.slice(round.index, round.index + 2).flatMap(word => [word.word, word.sentence]));
}
async function finishSpelling(r) {
  const view = viewVersion;
  await api("/api/sessions/complete", { session_id: r.session });
  if (view !== viewVersion) return;
  shell();
  app.append(
    el(
      "section",
      { class: "practice card" },
      el("span", { class: "badge" }, "Round complete"),
      el("h1", {}, "Look at you grow!"),
      el("div", { class: "score" }, `${r.first} / ${r.ws.length}`),
      el("p", {}, "Words spelled correctly on the first try."),
      r.misses.length
        ? el(
            "div",
            {},
            el("h3", {}, "A little more practice"),
            el("p", {}, r.misses.map((w) => w.word).join(" · ")),
            button("Practice missed words", () =>
              startSpelling(r.misses, r.list, r.kind),
            ),
          )
        : el("p", {}, "Every word was a first-try win. 🌟"),
      el(
        "div",
        { class: "row form-actions" },
        button("Back to spelling", render, "secondary"),
        button(
          "See progress",
          () => {
            tab = "Progress";
            render();
          },
          "secondary",
        ),
      ),
    ),
  );
}
function verseHome() {
  const active = state.verses.filter((v) => !v.archived);
  app.append(
    el(
      "div",
      { class: "row spread" },
      el("p", {}, "Read it. Remember it. Carry it with you."),
      state.parent ? button("+ Add Bible verse", () => editVerse()) : null,
    ),
  );
  if (!active.length)
    app.append(el("p", {}, "No verses yet. A parent can paste one to begin."));
  app.append(el("div", { class: "grid" }, active.map(verseCard)));
  if (state.parent && state.verses.some((v) => v.archived))
    app.append(
      el(
        "details",
        {},
        el("summary", {}, "Archived verses"),
        state.verses.filter((v) => v.archived).map(verseCard),
      ),
    );
}
function verseCard(v) {
  return el(
    "section",
    { class: "card" },
    el(
      "div",
      {},
      v.sample ? el("span", { class: "badge" }, "Sample") : null,
      el("span", { class: "badge" }, v.translation || "Family verse"),
    ),
    el("h2", {}, v.reference),
    el("p", { class: "verse" }, v.text),
    v.due_date
      ? el("p", { class: "muted" }, "Practice by " + v.due_date)
      : null,
    button("Practice this verse", () => verseMenu(v)),
    state.parent
      ? el(
          "div",
          { class: "row form-actions" },
          button("Edit", () => editVerse(v), "quiet small"),
          button(
            v.archived ? "Restore" : "Archive",
            () => archive("verses", v),
            "quiet small",
          ),
        )
      : null,
  );
}
function verseMenu(v) {
  shell();
  app.append(
    el(
      "section",
      { class: "card" },
      el("span", { class: "badge" }, v.translation || "Bible verse"),
      el("h2", {}, v.reference),
      el("p", {}, "Take one step at a time. Choose your challenge."),
      el(
        "div",
        { class: "grid" },
        [
          [
            "read",
            "1 · Read & listen",
            "Hear the reference and the whole verse.",
          ],
          [
            "blanks",
            "2 · Fill the blanks",
            "Build from a few blanks to every word.",
          ],
          [
            "first",
            "3 · First-letter clues",
            "Use the first letter of each word.",
          ],
          ["memory", "4 · From memory", "Type the whole verse, with no clues."],
          [
            "reference",
            "5 · Reference quiz",
            "Remember where the verse is found.",
          ],
        ].map(([mode, title, description]) =>
          el(
            "section",
            { class: "card" },
            el("h3", {}, title),
            el("p", {}, description),
            button("Start", () => versePractice(v, mode)),
          ),
        ),
      ),
      el(
        "div",
        { class: "form-actions" },
        button("Back to verses", render, "secondary"),
      ),
    ),
  );
}
async function versePractice(v, mode, level = 25) {
  const previousView = viewVersion;
  const session = await api("/api/sessions", { kid_id: kid.id, kind: "verse" });
  if (previousView !== viewVersion) return;
  shell();
  const area = el("section", { class: "card" }),
    ws = v.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  let indices = [],
    blankInputs = [];
  area.append(
    el(
      "span",
      { class: "badge" },
      {
        read: "Read & listen",
        blanks: "Fill the blanks",
        first: "First-letter clues",
        memory: "From memory",
        reference: "Reference quiz",
      }[mode],
    ),
    el(
      "h2",
      {},
      mode === "reference" ? "Where is this verse found?" : v.reference,
    ),
  );
  const response = textArea("verse-answer", "", {
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "none",
    spellcheck: "false",
    placeholder:
      mode === "reference" ? "Book chapter:verse" : "Type the verse here…",
    "aria-label":
      mode === "reference" ? "Bible reference" : "Your verse from memory",
  });
  if (mode === "read") {
    area.append(
      el("p", { class: "verse" }, v.text),
      button("🔊 Listen", () => say([v.reference, v.text])),
      el(
        "p",
        { class: "muted" },
        "Read along, then try saying it without looking.",
      ),
      button(
        "I practiced this verse",
        async () => {
          await api("/api/verse-attempts", {
            session_id: session.id,
            verse_id: v.id,
            mode,
            typed: "",
          });
          await api("/api/sessions/complete", { session_id: session.id });
          toast("Practice saved. Keep growing!");
          verseMenu(v);
        },
        "secondary",
      ),
    );
  } else {
    if (mode === "blanks") {
      const select = el(
        "select",
        {
          id: "blank-level",
          onchange: (e) => versePractice(v, mode, Number(e.target.value)),
        },
        [25, 50, 75, 100].map((n) =>
          el("option", { value: n, selected: n === level }, `${n}% hidden`),
        ),
      );
      area.append(field("Choose your challenge", select));
      indices = shuffled(ws.map((_, i) => i))
        .slice(0, Math.ceil((ws.length * level) / 100))
        .sort((a, b) => a - b);
      const blanks = el("div", { class: "blanks" });
      ws.forEach((w, i) => {
        if (indices.includes(i)) {
          const n = input("blank-" + i, "", {
            "aria-label": `Missing word ${i + 1}`,
            autocomplete: "off",
            autocorrect: "off",
            autocapitalize: "none",
            spellcheck: "false",
          });
          blankInputs.push(n);
          blanks.append(n);
        } else blanks.append(el("span", {}, w));
      });
      area.append(
        el("p", {}, "Type one word in each blank. Tab moves to the next one."),
        blanks,
      );
    }
    if (mode === "first")
      area.append(
        el("p", { class: "verse" }, ws.map((w) => w[0] + "·").join(" ")),
      );
    if (mode === "reference") area.append(el("p", { class: "verse" }, v.text));
    if (mode !== "blanks")
      area.append(
        field(mode === "reference" ? "Reference" : "Your verse", response),
      );
    const form = el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        const submit = form.querySelector("button[type=submit]");
        if (submit.disabled) return;
        submit.disabled = true;
        try {
          const result = await api("/api/verse-attempts", {
            session_id: session.id,
            verse_id: v.id,
            mode,
            level,
            indices,
            typed:
              mode === "blanks"
                ? blankInputs.map((n) => n.value).join(" ")
                : response.value,
          });
          await api("/api/sessions/complete", { session_id: session.id });
          stopSpeaking();
          area.replaceChildren(
            el("span", { class: "badge" }, "Practice saved"),
            el(
              "h2",
              {},
              result.accuracy === 100
                ? "You remembered every word!"
                : "You’re building a strong memory.",
            ),
            el("div", { class: "score" }, result.accuracy + "%"),
            el(
              "p",
              {},
              "Green words matched. Peach words are a gentle reminder for next time.",
            ),
            el(
              "div",
              { class: "comparison" },
              result.details.map((d) =>
                el(
                  "span",
                  {
                    class: d.correct ? "" : "miss",
                    title: d.typed && !d.correct ? "You typed: " + d.typed : "",
                  },
                  d.word || `+ ${d.typed}`,
                ),
              ),
            ),
            el(
              "div",
              { class: "row form-actions" },
              button("Try this again", () => versePractice(v, mode, level)),
              mode === "blanks" && level < 100
                ? button(
                    "Next level",
                    () => versePractice(v, mode, level + 25),
                    "secondary",
                  )
                : null,
              button("Choose a mode", () => verseMenu(v), "secondary"),
            ),
          );
        } catch (err) {
          toast(err.message);
          submit.disabled = false;
        }
      },
    });
    // Move the challenge fields into the form so Enter checks short blank inputs.
    const content = [...area.children].slice(2);
    for (const n of content) form.append(n);
    form.append(
      el("button", { type: "submit", class: "form-actions" }, "Check my work"),
    );
    area.append(form);
    focus(blankInputs[0] || response);
  }
  area.append(
    el(
      "div",
      { class: "form-actions" },
      button("Back to modes", () => verseMenu(v), "quiet"),
    ),
  );
  app.append(area);
}
async function progressHome() {
  const k = kid.id,
    view = viewVersion;
  app.append(el("p", { id: "progress-loading" }, "Gathering your growth…"));
  try {
    const p = await api("/api/progress?kid=" + k);
    if (kid?.id !== k || tab !== "Progress" || view !== viewVersion) return;
    $("progress-loading")?.remove();
    app.append(
      el(
        "div",
        { class: "grid" },
        el(
          "section",
          { class: "card" },
          el("span", { class: "metric" }, p.listsCompleted),
          "Lists completed",
        ),
        el(
          "section",
          { class: "card" },
          el("span", { class: "metric" }, p.streak + " 🌱"),
          "Day practice streak",
          el("small", {}, "Practice days use UTC."),
        ),
        el(
          "section",
          { class: "card" },
          el("span", { class: "metric" }, p.tricky.length),
          "Tricky words growing stronger",
        ),
      ),
    );
    const chart = el(
      "section",
      { class: "card" },
      el("h2", {}, "Spelling first-try accuracy"),
    );
    if (!p.charts.length)
      chart.append(el("p", {}, "Your spelling progress will grow here."));
    else chart.append(drawChart(p.charts));
    app.append(chart);
    if (p.learning) app.append(el("section", {class: "card"},
      el("h2", {}, "Learn practice · separate from test accuracy"),
      el("p", {}, `${p.learning.wordsLearned} words learned · ${p.learning.attempts} fading-cue attempts · ${p.learning.sessionsCompleted} completed learning rounds`)));
    if (state.parent && p.learnAttempts?.length) app.append(el("details", {},
      el("summary", {}, "Parent detail · recent Learn attempts"),
      table(["Word", "Letters hidden", "Typed", "Correct"], p.learnAttempts.slice(0, 100).map(a => [a.word, a.step + "%", a.typed, a.correct ? "Yes" : "Compare"]))));
    app.append(
      el(
        "div",
        { class: "two" },
        el(
          "section",
          { class: "card" },
          el("h2", {}, "Words to keep practicing"),
          p.tricky.length
            ? el(
                "ol",
                {},
                p.tricky
                  .slice(0, 12)
                  .map((w) =>
                    el(
                      "li",
                      {},
                      w.word,
                      el(
                        "small",
                        {},
                        `${w.misses} misses · ${w.streak}/3 first-try wins since last miss`,
                      ),
                    ),
                  ),
              )
            : el("p", {}, "No tricky words right now!"),
        ),
        el(
          "section",
          { class: "card" },
          el("h2", {}, "Verse garden"),
          p.mastery.map((v) =>
            el(
              "p",
              {},
              v.reference + " ",
              el("strong", {}, "★".repeat(v.stars) + "☆".repeat(3 - v.stars)),
              el(
                "small",
                {},
                `${v.best}% best of last 10 attempts · ${v.attempts} recent practices`,
              ),
            ),
          ),
          el(
            "small",
            {},
            "One star: 70%+. Two: 95%+. Three: 95%+ from memory or first-letter clues. Read/listen does not earn mastery.",
          ),
        ),
      ),
    );
    app.append(
      el(
        "section",
        { class: "card" },
        el("h2", {}, "Recent practice sessions"),
        p.sessions.length
          ? el(
              "ul",
              {},
              p.sessions
                .slice(0, 12)
                .map((s) =>
                  el(
                    "li",
                    {},
                    `${new Date(s.created_at).toLocaleString()} · ${s.kind === "learn" ? "Learn" : s.kind === "verse" ? "Verse" : "Test"} · ${s.title || s.kind} · ${s.completed ? "Complete" : "In progress"}`,
                  ),
                ),
            )
          : el("p", {}, "Your first practice can be today."),
      ),
    );
    if (state.parent) {
      app.append(
        el(
          "details",
          {},
          el("summary", {}, "Parent detail · recent spelling attempts"),
          table(
            ["When", "Mode", "Word", "Typed", "Correct", "First try"],
            p.attempts
              .slice(0, 100)
              .map((a) => [
                new Date(a.created_at).toLocaleString(),
                a.mode === "learn" ? `Learn · ${a.step}% hidden` : "Test",
                a.word,
                a.typed,
                a.correct ? "Yes" : "Not yet",
                a.first_try ? "Yes" : "Retry",
              ]),
          ),
        ),
        el(
          "details",
          {},
          el("summary", {}, "Parent detail · verse attempts"),
          table(
            ["When", "Verse", "Mode", "Accuracy"],
            p.verseAttempts.map((a) => [
              new Date(a.created_at).toLocaleString(),
              a.verse_reference ||
                state.verses.find((v) => v.id === a.verse_id)?.reference ||
                a.verse_id,
              a.mode,
              a.accuracy + "%",
            ]),
          ),
        ),
      );
    }
  } catch (e) {
    toast(e.message);
  }
}
function table(head, rows) {
  return el(
    "div",
    { class: "scroll" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          head.map((h) => el("th", { scope: "col" }, h)),
        ),
      ),
      el(
        "tbody",
        {},
        rows.map((r) =>
          el(
            "tr",
            {},
            r.map((c) => el("td", {}, c)),
          ),
        ),
      ),
    ),
  );
}
function drawChart(charts) {
  const ns = "http://www.w3.org/2000/svg",
    n = (tag, attrs, text) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text) e.textContent = text;
      return e;
    };
  const width = 700,
    height = 90 + charts.length * 46,
    svg = n("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": "First-try spelling accuracy by list",
      class: "chart",
    });
  svg.append(n("title", {}, "First-try spelling accuracy"));
  charts.forEach((c, i) => {
    const y = 25 + i * 46;
    svg.append(
      n(
        "text",
        { x: 0, y: y + 17 },
        c.title.length > 20 ? c.title.slice(0, 18) + "…" : c.title,
      ),
      n("rect", { x: 200, y, width: 420, height: 26, rx: 8, fill: "#e0eee2" }),
      n("rect", {
        x: 200,
        y,
        width: (420 * c.accuracy) / 100,
        height: 26,
        rx: 8,
        fill: "#315d51",
      }),
      n("text", { x: 630, y: y + 18 }, c.total ? c.accuracy + "%" : "—"),
    );
  });
  return svg;
}
function modal(title, content) {
  const d = el(
    "dialog",
    {},
    el(
      "div",
      { class: "row spread" },
      el("h2", {}, title),
      button("✕", () => d.close(), "quiet"),
    ),
    content,
  );
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
function unlock() {
  const pin = input("parent-pin", "", {
    type: "password",
    inputmode: "numeric",
    autocomplete: "current-password",
    required: true,
    maxlength: 1000,
  });
  const error = el("p", { role: "alert" });
  let d;
  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api("/api/parent/unlock", { pin: pin.value });
          d.close();
          await reload();
          render();
          toast("Parent mode is unlocked.");
        } catch (err) {
          error.textContent = err.message;
          pin.select();
        }
      },
    },
    field("Parent PIN", pin),
    error,
    el("button", { type: "submit" }, "Unlock"),
  );
  d = modal("Parent mode", form);
  focus(pin);
}
function formDialog(title, fields, onSave) {
  const error = el("p", { role: "alert" });
  let d;
  const save = el("button", { type: "submit" }, "Save");
  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        save.disabled = true;
        try {
          await onSave();
          d.close();
          await reload();
          render();
          toast("Saved. Audio is warming up in the background.");
        } catch (err) {
          error.textContent = err.message;
        } finally {
          save.disabled = false;
        }
      },
    },
    fields,
    error,
    el(
      "div",
      { class: "row form-actions" },
      save,
      button("Cancel", () => d.close(), "secondary"),
    ),
  );
  d = modal(title, form);
  return d;
}
function editList(l) {
  const title = input("list-title", l?.title || titleDate(), {
      required: true,
      maxlength: 120,
    }),
    day = input("list-date", l?.date || today(), {
      type: "date",
      required: true,
    }),
    ws = textArea(
      "list-words",
      l?.words
        .map((w) => w.word + (w.sentence ? " | " + w.sentence : ""))
        .join("\n") || "",
      {
        required: true,
        rows: 10,
        placeholder:
          "journey | We began our journey at sunrise.\nbeautiful | The garden is beautiful.",
      },
    );
  formDialog(
    l ? "Edit spelling list" : "Add spelling list",
    [
      field("Week title", title),
      field("Date", day),
      field("One word per line · word | optional sentence", ws),
      el(
        "small",
        {},
        "1–100 words. Editing preserves history and replaces the current word set.",
      ),
    ],
    () =>
      api("/api/admin/lists", {
        id: l?.id,
        kid_id: kid.id,
        title: title.value,
        date: day.value,
        words: ws.value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((line) => {
            const split = line.indexOf("|");
            return {
              word: (split < 0 ? line : line.slice(0, split)).trim(),
              sentence: split < 0 ? "" : line.slice(split + 1).trim(),
            };
          }),
      }),
  );
}
function editVerse(v) {
  const ref = input("reference", v?.reference || "", {
      required: true,
      maxlength: 120,
    }),
    text = textArea("verse-text", v?.text || "", {
      required: true,
      maxlength: 6000,
    }),
    translation = input("translation", v?.translation || "", { maxlength: 60 }),
    due = input("due", v?.due_date || "", { type: "date" });
  formDialog(
    v ? "Edit Bible verse" : "Add Bible verse",
    [
      field("Reference (for example Psalm 23:1)", ref),
      field("Verse text · paste your chosen wording", text),
      field("Translation label (optional)", translation),
      field("Due date (optional)", due),
    ],
    () =>
      api("/api/admin/verses", {
        id: v?.id,
        kid_id: kid.id,
        reference: ref.value,
        text: text.value,
        translation: translation.value,
        due_date: due.value,
      }),
  );
}
async function archive(type, item) {
  if (
    !item.archived &&
    !confirm("Archive this item? Practice history will be kept.")
  )
    return;
  await api("/api/admin/archive", {
    type,
    id: item.id,
    archived: !item.archived,
  });
  await reload();
  render();
}
function editKid(k) {
  const name = input("kid-name", k?.name || "", {
      required: true,
      maxlength: 60,
    }),
    grade = input("kid-grade", k?.grade || "", { maxlength: 30 });
  formDialog(
    k ? "Rename profile" : "Add a kid",
    [field("First name or nickname", name), el("small", {}, "No last names needed. Use a first name or nickname."), field("Grade (optional)", grade)],
    () =>
      api("/api/admin/kids", {
        id: k?.id,
        name: name.value,
        grade: grade.value,
      }),
  );
}
function parentHome(inShell = false) {
  if (!state.parent) return unlock();
  if (!inShell) {
    viewVersion++;
    stopSpeaking();
    app.replaceChildren();
    header();
    app.append(
      el("h1", {}, "Family settings"),
      button("Back", render, "secondary"),
    );
  }
  app.append(
    el(
      "section",
      { class: "card" },
      el("h2", {}, "Family profiles"),
      el(
        "div",
        { class: "row" },
        state.kids.map((k) => el("div", { class: "profile-controls" },
          el("strong", {}, k.name),
          button("Rename / edit", () => editKid(k), "secondary small"),
          button("Remove", async () => {
            if (!confirm(`Remove ${k.name} and all their lists, verses, and practice history? This cannot be undone.`)) return;
            await api("/api/admin/remove-kid", { id: k.id });
            await reload();
            render();
            toast("Profile removed.");
          }, "danger small"),
        )),
        button("+ Add kid", () => editKid()),
      ),
    ),
  );
  app.append(familyControls());
  const voice = el("select", { id: "voice" },
    el("option", {value: "cloud", selected: cloudVoice()}, "Cloud voice (recommended)"),
    el("option", {value: "device", selected: !cloudVoice()}, "This device’s voice")),
    speed = input("speed", state.settings.speed, {
      type: "number", min: 0.5, max: 1.5, step: 0.05, required: true,
    });
  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api("/api/admin/settings", {
            voice: voice.value,
            speed: Number(speed.value),
          });
          stopSpeaking();
          cooldown = 0;
          await reload();
          toast("Voice settings saved.");
        } catch (err) {
          toast(err.message);
        }
      },
    },
    field("Reading voice", voice),
    field("Speech speed · 0.5 slow to 1.5 fast", speed),
    el(
      "p",
      { class: "muted" },
      "Cloud voice sends only the text being read to Cloudflare for speech. If it takes more than 4 seconds or is unavailable, this device’s English voice takes over. Device voice uses your browser and operating system.",
    ),
    el(
      "div",
      { class: "row" },
      el("button", { type: "submit" }, "Save voice settings"),
      button(
        "Test voice",
        () => say("A little practice helps us grow."),
        "secondary",
      ),
    ),
  );
  app.append(
    el("section", { class: "card" }, el("h2", {}, "Listen your way"), form),
  );
  const upload = input("backup-file", "", {
    type: "file",
    accept: ".json,application/json",
  });
  app.append(
    el(
      "section",
      { class: "card" },
      el("h2", {}, "Backups"),
      el(
        "p",
        {},
        "Export includes all profiles, lists, verses, settings, sessions, and attempts. JSON can restore this app; CSV is a spreadsheet-friendly table with a table-name column and shared fields.",
      ),
      el(
        "div",
        { class: "row" },
        button("Export JSON", () => downloadBackup("json"), "secondary"),
        button("Export CSV", () => downloadBackup("csv"), "secondary"),
      ),
      field("Restore a JSON backup", upload),
      el(
        "p",
        { class: "notice" },
        `Import replaces all current family data. Export a backup first. Files are limited to ${state.settings.serverTts === false ? 2 : 32} MB.`,
      ),
      button(
        "Import backup",
        async () => {
          const f = upload.files[0];
          if (!f) throw Error("Choose a JSON backup first.");
          const limitMB = state.settings.serverTts === false ? 2 : 32;
          if (f.size > limitMB * 1024 * 1024)
            throw Error(`Backup is larger than ${limitMB} MB.`);
          let b;
          try {
            b = JSON.parse(await f.text());
          } catch {
            throw Error("That file is not valid JSON.");
          }
          if (!confirm("Replace all current family data with this backup?"))
            return;
          await api("/api/admin/import", b);
          await reload();
          render();
          toast("Backup restored.");
        },
        "danger",
      ),
    ),
  );
}
async function downloadBackup(format) {
  const r = await familyFetch("/api/admin/export?format=" + format);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Error(body.error || "Could not download backup.");
  }
  const url = URL.createObjectURL(await r.blob());
  const a = el("a", { href: url, download: "family-practice." + format });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function clearView() {
  viewVersion++;
  stopSpeaking();
  app.replaceChildren();
  $("header-actions").replaceChildren();
  $("voice-status").textContent = "";
}
function familyControls() {
  return el("section", { class: "card" },
    el("h2", {}, "Your family space"),
    el("p", {}, state.family?.name || "Family Practice"),
    el("div", { class: "row" },
      button("Save your family code", codeCard, "secondary"),
      button("Add sample practice", async () => {
        const target = kid || state.kids[0];
        if (!target) { toast("Add a kid first, then add sample practice."); return; }
        if (!confirm(`Add a sample spelling list and Bible verse for ${target.name}? Existing practice will be kept.`)) return;
        await api("/api/admin/sample", { kid_id: target.id });
        await reload();
        render();
        toast("Sample practice added.");
      }, "secondary"),
      button("Change parent PIN", changePin, "secondary"),
    ),
    el("p", { class: "muted" }, "Your family code opens practice on another device. The parent PIN protects settings and backups. Keep both safe; there is no email-based recovery."),
    el("details", {}, el("summary", {}, "Delete this family"),
      el("p", {}, "Permanently remove every profile and all practice data. Export a backup first. This cannot be undone."),
      button("Delete family…", deleteFamily, "danger")),
  );
}
function changePin() {
  const current = input("current-pin", "", { type: "password", required: true, autocomplete: "current-password" });
  const pin = input("new-pin", "", { type: "password", required: true, minlength: 4, maxlength: 8, pattern: "[0-9]{4,8}", inputmode: "numeric", autocomplete: "new-password" });
  const repeat = input("repeat-pin", "", { type: "password", required: true, autocomplete: "new-password" });
  formDialog("Change parent PIN", [field("Current PIN", current), field("New PIN (4–8 digits)", pin), field("Repeat new PIN", repeat)], async () => {
    if (pin.value !== repeat.value) throw Error("The new PINs do not match.");
    await api("/api/admin/pin", { currentPin: current.value, pin: pin.value });
  });
}
function deleteFamily() {
  const expected = state.family?.name || familyCode;
  const pin = input("delete-pin", "", { type: "password", required: true, autocomplete: "current-password" });
  const confirmation = input("delete-confirmation", "", { required: true, autocomplete: "off" });
  const error = el("p", { role: "alert" });
  let d;
  const submit = el("button", { type: "submit", class: "danger" }, "Permanently delete family");
  d = modal("Delete family permanently", el("form", { onsubmit: async (e) => {
    e.preventDefault();
    if (confirmation.value !== expected) { error.textContent = "Type your family name exactly to confirm."; return; }
    submit.disabled = true;
    try {
      await api("/api/admin/delete-family", { pin: pin.value, confirmation: confirmation.value });
      d.close();
      rememberFamily("");
      kid = null;
      history.replaceState({}, "", "/");
      landing();
      toast("Family deleted.");
    } catch (err) { error.textContent = err.message; }
    finally { submit.disabled = false; }
  } }, el("p", { class: "notice" }, "This deletes all family data and cannot be undone. Download a backup before continuing."),
    field("Parent PIN", pin), field(`Type ${expected} to confirm`, confirmation), error,
    el("div", { class: "row form-actions" }, submit, button("Cancel", () => d.close(), "secondary"))));
}
function codeCard() {
  clearView();
  header();
  const joinURL = location.origin + "/f/" + encodeURIComponent(familyCode);
  app.append(el("section", { class: "card print-sheet code-card" },
    el("span", { class: "badge" }, "Keep this card somewhere private"),
    el("h1", {}, state.family?.name || "Your family practice space"),
    el("p", {}, "Family code"), el("strong", { class: "family-code" }, familyCode),
    el("p", { class: "notice" }, "Save this code — it’s the only way back in. Write it down or copy it. We can’t recover it."),
    el("p", { class: "join-url" }, joinURL),
    el("p", {}, "Open Family Practice on another device and enter this code, or use the link above. Anyone with the code can view and use your family’s practice. Share it only with trusted family members."),
    el("p", {}, "Your parent PIN is separate. It is not printed on this card. Keep the PIN safe: there is no email-based recovery."),
    el("div", { class: "row" },
      button("Copy code", async () => { await navigator.clipboard.writeText(familyCode); toast("Family code copied."); }),
      button("Copy join link", async () => { await navigator.clipboard.writeText(joinURL); toast("Join link copied. Share privately."); }, "secondary"),
      button("Print code card", () => window.print(), "secondary"),
      button("Back to practice", render, "secondary")),
  ));
}
async function openFamily(code) {
  const previous = familyCode;
  familyCode = code.trim();
  kid = null;
  try { await reload(); }
  catch (err) { familyCode = previous; throw err; }
  rememberFamily(familyCode);
  history.replaceState({}, "", "/");
  render();
}
function landing(prefill = "", message = "") {
  clearView();
  const resumeCode = familyCode;
  app.append(el("section", { class: "hero" },
    el("span", { class: "badge" }, "A little practice, a lot of growth"),
    el("h1", {}, "A small daily habit. A family that grows."),
    el("p", {}, "Spelling tests read aloud with helpful sentences, Bible verse memorization, and progress worth celebrating. Create your family’s own space or join one you already use."),
    el("p", { class: "muted" }, "Data is stored by family code. No email or accounts. Use first names or nicknames only. Save your family code and parent PIN to come back."),
  ));
  app.append(el("div", { class: "row" },
    button("Create a family space", () => { name.focus(); name.scrollIntoView({behavior:"smooth",block:"center"}); }),
    button("I have a family code", () => { code.focus(); code.scrollIntoView({behavior:"smooth",block:"center"}); }, "secondary")));
  if (message) app.append(el("p", { role: "alert", class: "notice" }, message));
  if (resumeCode && !prefill) app.append(button("Return to saved family", () => openFamily(resumeCode), "secondary"));
  const name = input("family-name", "", { maxlength: 80, autocomplete: "off", placeholder: "Our practice garden" });
  const pin = input("create-pin", "", { type: "password", required: true, minlength: 4, maxlength: 8, pattern: "[0-9]{4,8}", inputmode: "numeric", autocomplete: "new-password" });
  const repeat = input("create-pin-repeat", "", { type: "password", required: true, autocomplete: "new-password" });
  const createError = el("p", { role: "alert" });
  const createButton = el("button", { type: "submit" }, "Create family space");
  const create = el("form", { onsubmit: async (e) => {
    e.preventDefault();
    if (pin.value !== repeat.value) { createError.textContent = "The PINs do not match."; return; }
    createButton.disabled = true;
    createError.textContent = "";
    try {
      const family = await api("/api/families", { name: name.value.trim(), pin: pin.value });
      rememberFamily(family.code);
      kid = null;
      await reload();
      history.replaceState({}, "", "/");
      codeCard();
      toast("Family created! Save your code before you begin.");
    } catch (err) { createError.textContent = err.message; }
    finally { createButton.disabled = false; }
  } }, field("Family space name (optional)", name), field("Parent PIN (4–8 digits)", pin), field("Repeat parent PIN", repeat),
    el("p", { class: "muted" }, "Use a PIN you can remember. There is no email-based PIN recovery. Start with an empty space and add only what you need."), createError, createButton);
  const code = input("join-code", prefill, { required: true, maxlength: 128, autocomplete: "off", autocapitalize: "none", spellcheck: "false" });
  const joinError = el("p", { role: "alert" });
  const joinButton = el("button", { type: "submit" }, "Join family");
  const join = el("form", { onsubmit: async (e) => {
    e.preventDefault();
    joinButton.disabled = true;
    joinError.textContent = "";
    try { await openFamily(code.value); }
    catch (err) { joinError.textContent = err.message; }
    finally { joinButton.disabled = false; }
  } }, field("Family code", code),
    el("p", { class: "notice" }, prefill ? "This link contains a family code. Join only if a trusted family member shared it with you. Joining saves this family on this browser and replaces its previously saved family." : "Ask a parent for your family’s code. Joining remembers this family on this browser. Use a trusted device."), joinError, joinButton);
  app.append(el("div", { class: "grid onboarding" },
    el("section", { class: "card" }, el("h2", {}, "Start your family"), create),
    el("section", { class: "card" }, el("h2", {}, "Already have a code?"), join)));
}
function privacy() {
  clearView();
  app.append(el("section", { class: "card" },
    el("h1", {}, "Privacy & your family’s data"),
    el("p", {}, "Family Practice stores the profiles, spelling lists, Bible verses, practice answers, progress, and voice settings your family enters. Use first names or nicknames, not full names, school names, addresses, or other sensitive details."),
    el("h2", {}, "Your code is a key"),
    el("p", {}, "No tracking, no analytics, and no ads. You can delete your family anytime. Anyone with your family code can open your family’s practice and view its profiles and progress. It is not a public username. Share the code and join link privately with trusted family members only. Your parent PIN protects management actions, backups, and deletion; it does not hide practice from someone who knows your code."),
    el("h2", {}, "On this device"),
    el("p", {}, "This browser remembers your family code in local storage. Parent mode uses a cookie after you enter your PIN. Lock Parent mode when you finish on a shared device. Forgetting a family here removes its saved code, not its server data."),
    el("h2", {}, "Speech & hosting"),
    el("p", {}, "Cloud voice is the default. Text being read aloud (spelling words, practice sentences, and Bible verses) is sent to Cloudflare Workers AI to generate speech; family profile names and typed answers are not included in speech requests. Already-heard audio is cached in bounded browser memory for replay, and Cloudflare caches generated clips for reuse. The app shell is saved on this device for faster loading; family data and answers are not saved in the offline cache. You can choose Device voice in family settings; it is also the automatic fallback when cloud speech is unavailable. Device voice availability and whether speech is processed locally depend on your browser and operating system. Practice data is stored with the app’s Cloudflare hosting services; normal hosting request logs may include technical information such as IP addresses."),
    el("h2", {}, "You stay in control"),
    el("p", {}, "In Parent mode you can export a backup, remove a child and their practice history, or permanently delete the whole family. Keep backups private. No email is collected for account recovery, so keep both your code and PIN safe."),
    el("div", { class: "row" }, button("Back", () => { history.replaceState({}, "", "/"); if (familyCode && state.family) render(); else landing(); }, "secondary"),
      familyCode ? button("Forget family on this device", async () => {
        if (!confirm("Forget the saved family code on this device? Keep a copy first. Your family’s server data will not be deleted.")) return;
        await api("/api/parent/lock", {}).catch(() => {});
        rememberFamily(""); kid = null; state.parent = false;
        history.replaceState({}, "", "/"); landing();
      }, "secondary") : null),
  ));
}
(async () => {
  if (location.pathname === "/privacy" || location.pathname === "/privacy/") { privacy(); return; }
  const match = location.pathname.match(/^\/f\/([^/]+)\/?$/);
  if (match) {
    let code;
    try { code = decodeURIComponent(match[1]); } catch { landing("", "That join link is invalid. Ask your family for a fresh code."); return; }
    landing(code);
    return;
  }
  if (!familyCode) { landing(); return; }
  try { await reload(); render(); }
  catch (e) { landing("", e.message + " You can retry your saved family or enter another code."); }
})();
window.addEventListener("pagehide", stopSpeaking);
