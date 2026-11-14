import {createIdentityUI} from "/identity.js";
import {createSharingUI} from "/sharing-ui.js";
import {newLearnWord, advanceLearn} from "/learn.js";
import {icon} from "/icons.js";
import {createKeyboard} from "/keyboard.js";
import {deviceSettings, setDeviceSettings, supportsHaptics, onScreenKeyboard, previewSound} from "/feedback.js";
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
let parentPage = false, parentSection = "Kids";
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
function toast(s, control = document.activeElement) {
  $("toast").textContent = s;
  $("toast").style.display = "block";
  if (control instanceof HTMLElement && control !== document.body) {
    const overlap = control.getBoundingClientRect().bottom - $("toast").getBoundingClientRect().top + 12;
    if (overlap > 0) window.scrollBy({top: overlap, behavior: "instant"});
  }
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
async function api(p, data, method = "POST") {
  const r = await familyFetch(
    p,
    data === undefined
      ? {}
      : {
          method,
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
  actions.replaceChildren(...[
    familyCode && !kid ? button("Switch family", async () => { await api("/api/parent/lock", {}).catch(() => {}); await identity.init(); rememberFamily(""); kid = null; state.parent = false; history.replaceState({}, "", "/"); landing(); }, "quiet small") : null,
    kid && !parentPage ? button([icon("back"), "Switch kid"], () => { kid = null; render(); }, "quiet small") : null,
    button([icon("lock"), "Parent mode"], () => state.parent ? parentHome() : unlock(), "secondary small"),
    state.parent ? button("Lock", async () => { await api("/api/parent/lock", {}); await identity.init(); parentPage = false; await reload(); render(); }, "quiet small") : null,
  ].filter(Boolean));
}
const TONES = { Spelling: "spelling", "Bible Verses": "verses", Progress: "progress", Parent: "parent" };
// mode "practice" hides the app chrome so the child sees one task.
function shell(mode = "", tone = "") {
  viewVersion++;
  stopSpeaking();
  app.replaceChildren();
  document.body.classList.toggle("practicing", mode === "practice");
  app.dataset.tone = tone || TONES[tab] || "spelling";
  header();
  if (!kid) return false;
  if (mode === "practice") return true;
  app.append(el("div", { class: "band" },
    el("div", { class: "band-head" },
      el("h1", {}, kid.name),
      el("span", { class: "band-meta" }, kid.grade ? "Grade " + kid.grade : "")),
    el("nav", { class: "tabs", "aria-label": "Practice sections" },
      ["Spelling", "Bible Verses", "Progress"].map((t) =>
        button(t, () => { tab = t; render(); }, t === tab ? "active" : "")),
    ),
  ));
  app.querySelector(".tabs .active")?.setAttribute("aria-current", "page");
  return true;
}
// The band on every practice screen: way out, where you are, and one cell per word.
function practiceBand({ title, status, cells = [], exit }) {
  const chart = cells.length ? el("span", {class: "chart-cells" + (cells.length > 12 ? " compact" : ""), "aria-hidden": "true"}, cells.map(c => el("i", {class: c}))) : null;
  chart?.style.setProperty("--word-count", cells.length);
  return el("div", { class: "practice-band" },
    el("div", {},
      exit,
      el("span", { class: "title" }, title),
      el("span", { class: "status" }, status),
      chart,
    ));
}
const exitButton = (label, fn) => button([icon("close"), label], fn, "quiet");
const roundCells = (n, index, results = []) => Array.from({ length: n }, (_, i) => results[i] || (i === index ? "now" : ""));
function niceDate(iso) {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// Practice fields get the on-screen keyboard on touch devices; physical keys still work.
function practiceField(node) {
  node.dataset.practiceField = "";
  if (onScreenKeyboard()) node.setAttribute("inputmode", "none");
  return node;
}
function dockKeyboard(options) {
  if (!onScreenKeyboard()) return null;
  const keyboard = createKeyboard(options);
  app.append(keyboard);
  return keyboard;
}
async function selectKid(k) {
  kid = k;
  tab = "Spelling";
  await reload();
  render();
}
function render() {
  if (parentPage && state.parent) return parentHome();
  if (!shell()) {
    app.dataset.tone = "parent";
    app.append(el("div", { class: "band" },
      el("div", { class: "band-head" },
        el("h1", {}, "Who’s ready to grow?"),
        el("span", { class: "band-meta" }, state.family?.name || "")),
    ));
    if (state.kids.length)
      app.append(el("p", {}, "Pick your name for spelling, Bible verses, and your progress."),
        el("div", { class: "roster" }, state.kids.map((k, i) =>
          button([
            el("span", { class: "tile", "aria-hidden": "true" }, [...k.name][0]?.toUpperCase() || "?"),
            el("span", { class: "who" }, el("span", { class: "name" }, k.name), el("span", { class: "grade" }, k.grade ? "Grade " + k.grade : "No grade set")),
          ], () => selectKid(k), "kid tone-" + (i % 4)),
        )));
    else
      app.append(el("div", { class: "section" },
        el("div", { class: "section-title" }, el("h2", {}, "Add your first kid")),
        el("p", {}, state.parent ? "Add a first name or nickname. Then add this week’s spelling words and a Bible verse." : "Ask a parent to unlock Parent mode and add a profile."),
        state.parent ? button("+ Add your first kid", () => editKid()) : button("Unlock Parent mode", unlock),
      ));
    if (state.parent)
      app.append(el("div", { class: "row" }, button("Manage family & settings", () => parentHome(), "secondary"), identity.signedIn() ? button("Choose another family", () => landing(), "quiet") : null));
    return;
  }
  if (tab === "Spelling") spellingHome();
  else if (tab === "Bible Verses") verseHome();
  else if (tab === "Progress") progressHome();

}
function listActions(l, small = false) {
  const size = small ? " small" : "";
  return el("div", { class: "row" },
    button("Learn", () => startLearning(l.words, l), size.trim()),
    button("Test", () => startSpelling(l.words, l), "secondary" + size),
    button("View words", () => wordSheet(l), "quiet" + size),
    state.parent ? button("Edit", () => editList(l), "quiet small") : null,
    state.parent ? button("Share", () => sharing.shareList(l), "quiet small") : null,
    state.parent ? button(l.archived ? "Restore" : "Archive", () => archive("lists", l), "quiet small") : null,
  );
}
function listCard(l) {
  return el("section", { class: "packet", "data-tone": "spelling" },
    el("div", { class: "packet-strip" },
      el("h2", {}, l.title),
      el("span", { class: "band-meta" }, l.words.length + " words"),
    ),
    el("div", { class: "packet-body" },
      el("p", {}, `${niceDate(l.date)}${l.sample ? " · sample list" : ""}. New this week? Learn the words first, then take the test.`),
      sharing.sourceMeta(l),
      listActions(l),
    ),
  );
}
function listRow(l) {
  return el("article", { class: "item" },
    el("div", {}, el("h3", {}, l.title), el("span", { class: "meta" }, `${l.words.length} words · ${niceDate(l.date)}${l.archived ? " · archived" : ""}`)),
    sharing.sourceMeta(l),
    listActions(l, true),
  );
}
function spellingHome() {
  const active = state.lists.filter((l) => !l.archived);
  const updates = el("section", {class:"section sharing-updates", "aria-live":"polite"});
  app.append(updates);
  sharing.newWeeks(updates, kid.id);
  if (state.parent) app.append(el("div", { class: "row spread section" }, el("p", { class: "muted" }, "Parent mode: add or edit this week’s words."), button("+ Add spelling list", () => editList())));
  if (!active.length)
    app.append(el("div", { class: "section" }, el("div", { class: "section-title" }, el("h2", {}, "No spelling list yet")),
      el("p", {}, "A parent can add this week’s words in Parent mode. Paste one word per line, with an optional sentence.")));
  if (active[0]) app.append(listCard(active[0]));
  const review = el("section", {class: "section", "aria-label": "Spaced review"},
    el("div", {class: "section-title"}, el("h2", {}, "Review")), el("p", {}, "Checking your word bank…"));
  app.append(review);
  const view = viewVersion, id = kid.id;
  api("/api/review?kid=" + id).then(bank => {
    if (view !== viewVersion || kid?.id !== id) return;
    review.replaceChildren(el("div", {class: "section-title"}, el("h2", {}, "Review")),
      bank.due.length ? el("div", {class: "review-entry"},
        el("div", {}, el("h3", {}, `${bank.dueCount ?? bank.due.length} words due today`),
          el("p", {class: "muted"}, "A few familiar words, just when you need them. Up to 15 in a round.")),
        button("Start review", () => startSpelling(bank.due.map(w => ({...w, id: w.word_id})), null, "review"), "primary"))
        : el("p", {}, bank.nextDue ? "Nothing due — next review " + reviewDay(bank.nextDue) : "Nothing due — learn or test some words to begin."));
  }).catch(err => { if (view === viewVersion) review.replaceChildren(el("h2", {}, "Review"), el("p", {}, err.message), button("Try again", render, "secondary")); });
  if (active.length > 1)
    app.append(el("div", { class: "section" }, el("div", { class: "section-title" }, el("h2", {}, "Past weeks")), el("div", { class: "rows" }, active.slice(1).map(listRow))));
  if (state.parent && state.lists.some((l) => l.archived))
    app.append(el("details", {}, el("summary", {}, "Archived lists"), el("div", { class: "rows" }, state.lists.filter((l) => l.archived).map(listRow))));
}
function reviewDay(day) {
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {weekday: "long", timeZone: "UTC"});
}
function wordSheet(l) {
  shell();
  app.append(el("section", { class: "print-sheet section" },
    el("div", { class: "section-title" }, el("h2", {}, l.title), el("span", { class: "muted" }, kid.name + " · " + niceDate(l.date))),
    el("ol", {}, l.words.map((w) => el("li", {}, el("strong", {}, w.word), w.sentence ? el("div", { class: "muted" }, w.sentence) : null))),
    el("div", { class: "row form-actions" }, button("Print", () => window.print()), button("Back", render, "secondary")),
  ));
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
async function startLearning(ws, list) {
  const view = viewVersion;
  try {
    const session = await api("/api/sessions", {kid_id: kid.id, list_id: list.id, word_ids: ws.map(w => w.id), kind: "learn"});
    if (view !== viewVersion) return;
    const round = {ws: [...ws], list, session: session.id, index: 0, comparisons: 0};
    round.learning = newLearnWord(ws[0].word);
    learnStep(round);
  } catch (err) { toast(err.message); }
}
function renderCue(node, text) {
  // Size the letters so even a long word stays on one line.
  node.style.setProperty("--n", Math.max(6, text.split(" ").length));
  node.replaceChildren(...text.split(" ").map((c) => el("span", { class: c === "_" ? "blank" : "" }, c === "_" ? " " : c)));
}
function learnStageIndicator(learning, jump) {
  const labels = learning.steps.map(step => ({0: "Copy", 50: "Fade", 75: "Fade more", 100: "Recall"})[step.level]);
  return el("div", {class: "learn-stage-progress"},
    el("p", {class: "stage-caption"}, `Stage ${learning.index + 1} of ${labels.length} · ${labels[learning.index]}`),
    el("ol", {class: "learn-stages", "aria-label": "Stages for this word. Tap a stage to jump to it."}, labels.map((label, i) => {
      const state = i === learning.index ? "current" : learning.completed.includes(i) ? "complete" : "";
      const sr = i === learning.index ? " · you are here" : learning.completed.includes(i) ? " · complete" : i < learning.index ? " · skipped" : " · jump here";
      const body = [el("span", {class: "stage-number", "aria-hidden": "true"}, learning.completed.includes(i) ? "✓" : i + 1), el("span", {}, label), el("span", {class: "visually-hidden"}, sr)];
      return el("li", {class: state, "aria-current": i === learning.index ? "step" : null},
        i === learning.index ? el("span", {class: "stage-tab"}, ...body) : button(body, () => jump(i), "stage-tab"));
    })));
}
async function learnToTest(round) {
  const view = viewVersion;
  // Record every unlearned word we pass over, without turning it into a win.
  for (const w of round.ws.slice(round.index + (round.learning.learned ? 1 : 0))) {
    await api("/api/attempts", {session_id: round.session, word_id: w.id, typed: "", mode: "learn", step: "skip"});
    if (view !== viewVersion) return;
  }
  await api("/api/sessions/complete", {session_id: round.session, abandoned: true});
  if (view !== viewVersion) return;
  startSpelling(round.ws, round.list);
}
function learnStep(round) {
  shell("practice", "spelling");
  const view = viewVersion, w = round.ws[round.index], step = round.learning.steps[round.learning.index];
  const answer = practiceField(input("learn-answer", "", {class: "answer", autocomplete: "off", inputmode: "text", autocapitalize: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "done", "aria-label": "Type the full word"}));
  const cue = el("p", {class: "cue", "aria-label": step.level === 100 ? "No letter clues" : "Letter clues: " + step.cue.replaceAll("_", "blank")});
  renderCue(cue, step.cue);
  const feedback = el("p", {class: "feedback", role: "status", "aria-live": "polite"});
  let done = false, comparisonTimer;
  const check = el("button", {type: "submit", form: "practice-form", class: "primary"}, "Check word");
  const continueButton = button("Continue", async () => {
    clearTimeout(comparisonTimer);
    if (round.learning.learned) {
      if (round.index + 1 === round.ws.length) return finishLearning(round);
      round.index++;
      round.learning = newLearnWord(round.ws[round.index].word);
    }
    learnStep(round);
  }, "primary");
  continueButton.hidden = true;
  const form = el("form", {id: "practice-form", onsubmit: async e => {
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
        renderCue(cue, [...w.word].join(" "));
        cue.classList.add("reveal");
        feedback.textContent = "Compare: " + w.word + ". Then retry this stage.";
        feedback.className = "feedback retry";
        continueButton.disabled = true;
        comparisonTimer = setTimeout(() => {
          if (view !== viewVersion) return;
          renderCue(cue, round.learning.steps[round.learning.index].cue);
          cue.classList.remove("reveal");
          continueButton.disabled = false;
          focus(continueButton);
        }, 1800);
        say(w.word);
      }
    } catch (err) {toast(err.message); check.disabled = false;}
  }}, el("label", {for: "learn-answer", class: "visually-hidden"}, "Type the full word"), answer, feedback);
  const actions = el("span", {class: "key-actions"}, check, continueButton);
  const prompt = step.level === 0 ? "Listen, then copy the word" : step.level === 100 ? "Now spell it from memory" : "Type the whole word, hidden letters too";
  app.append(
    practiceBand({ title: round.list?.title || "Learn", status: `Learn · word ${round.index + 1} of ${round.ws.length}`,
      cells: roundCells(round.ws.length, round.index, round.ws.map((_, i) => i < round.index ? "done" : "")),
      exit: exitButton("End learning", () => {if (confirm("Leave learning? Your attempts will still be saved.")) render();}) }),
    el("section", {class: "desk"},
      el("h2", {}, prompt), learnStageIndicator(round.learning, async i => {
          clearTimeout(comparisonTimer);
          // Jumping ahead is a skip: logged, never credited as learning.
          if (i > round.learning.index) {
            await api("/api/attempts", {session_id: round.session, word_id: w.id, typed: "", mode: "learn", step: "skip"});
            if (view !== viewVersion) return;
          }
          round.learning = {...round.learning, index: i, learned: false};
          learnStep(round);
        }), cue,
      el("div", {class: "listen"}, button([icon("speaker"), "Say again"], () => say([w.word, w.sentence, w.word]), "secondary")),
      el("div", {class: "learn-shortcuts"},
        button("I know these — start the test", () => learnToTest(round), "quiet")),
      form));
  if (!dockKeyboard({target: () => answer, action: actions})) form.append(actions);
  focus(answer);
  say([w.word, w.sentence, w.word]);
  prefetchSpeech(round.ws.slice(round.index, round.index + 2).flatMap(word => [word.word, word.sentence]));
}
async function finishLearning(round) {
  const view = viewVersion;
  await api("/api/sessions/complete", {session_id: round.session});
  if (view !== viewVersion) return;
  shell("practice", "spelling");
  app.append(practiceBand({ title: round.list?.title || "Learn", status: "Learning complete", cells: roundCells(round.ws.length, -1, round.ws.map(() => "done")), exit: exitButton("Done", render) }),
    el("section", {class: "desk"},
      el("h1", {}, "Ready to try on your own!"),
      el("p", {}, `${round.ws.length} words learned · ${round.comparisons} compare-and-try-again moments.`),
      el("p", {class: "muted"}, "Learning is practice. Only first tries in Test count toward spelling accuracy."),
      el("div", {class: "row form-actions"}, button("Take the test now", () => startSpelling(round.ws, round.list), "primary"), button("Back to lists", render, "secondary"))));
}
async function startSpelling(ws, list = null, kind = "spelling") {
  shell("practice", "spelling");
  const shuffle = input("shuffle", "", { type: "checkbox", checked: true });
  const title = list?.title || (kind === "tricky" ? "Tricky words" : "Review round");
  app.append(practiceBand({ title, status: (kind === "review" ? "Review" : kind === "tricky" ? "Tricky words" : "Spelling test") + " · " + ws.length + " words", cells: roundCells(ws.length, -1), exit: exitButton("Back", render) }),
    el("section", { class: "desk intro" },
      el("h2", {}, kind === "review" ? "Review" : kind === "tricky" ? "Your tricky words" : "Spelling test"),
      el("p", {}, `${ws.length} words. You’ll hear the word, a sentence, then the word again. You get one retry.`),
      el("label", { class: "inline" }, shuffle, "Shuffle the words"),
      el("div", { class: "row form-actions" },
        button("Let’s begin", async () => {
          const view = viewVersion;
          const ordered = shuffle.checked ? shuffled(ws) : [...ws];
          const session = await api("/api/sessions", { kid_id: kid.id, list_id: list?.id, word_ids: ordered.map((w) => w.id), kind });
          if (view !== viewVersion) return;
          spellingStep({ ws: ordered, list, kind, session: session.id, index: 0, first: 0, misses: [], results: [] });
        }, "primary"),
      ),
    ),
  );
}
function spellingStep(round) {
  shell("practice", "spelling");
  const view = viewVersion;
  const w = round.ws[round.index];
  let retry = false,
    done = false;
  const answer = practiceField(input("answer", "", {
    class: "answer",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    inputmode: "text",
    enterkeyhint: "done",
    spellcheck: "false",
    "aria-label": "Type the spelling word",
  }));
  const feedback = el("p", { class: "feedback", role: "status", "aria-live": "polite" });
  const check = el("button", { type: "submit", form: "practice-form", class: "primary" }, "Check word");
  const replay = () => say([w.word, w.sentence, w.word]);
  const band = () => practiceBand({ title: round.list?.title || (round.kind === "tricky" ? "Tricky words" : "Review round"), status: `Word ${round.index + 1} of ${round.ws.length}`,
    cells: roundCells(round.ws.length, round.index, round.results), exit: exitButton("End practice", () => { if (confirm("Leave this round? Your attempts will still be saved.")) render(); }) });
  const form = el(
    "form",
    {
      id: "practice-form",
      onsubmit: async (e) => {
        e.preventDefault();
        if (check.disabled) return;
        if (done) {
          check.disabled = true;
          try {
            if (round.index + 1 === round.ws.length) await finishSpelling(round);
            else { round.index++; spellingStep(round); }
          } catch (err) {
            toast(err.message);
          } finally {
            check.disabled = false;
          }
          return;
        }
        check.disabled = true;
        try {
          const result = await api("/api/attempts", { session_id: round.session, word_id: w.id, typed: answer.value });
          if (view !== viewVersion) return;
          if (result.correct) {
            if (!retry) round.first++;
            feedback.textContent = retry ? "You got it. Nice persistence!" : "Yes! First-try success!";
            feedback.className = "feedback good";
            round.results[round.index] = retry ? "miss" : "done";
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
            round.results[round.index] = "miss";
            done = true;
            say(`${w.word}. ${[...w.word].join(", ")}. ${w.word}.`, 0.8);
          }
          if (done) {
            answer.disabled = true;
            app.querySelector(".practice-band").replaceWith(band());
            check.textContent = round.index === round.ws.length - 1 ? "See my results" : "Next word";
            focus(check);
          } else focus(answer);
        } catch (err) {
          toast(err.message);
        } finally {
          check.disabled = false;
        }
      },
    },
    el("label", { for: "answer", class: "visually-hidden" }, "Type the word you hear"),
    answer,
    feedback,
  );
  app.append(band(),
    el("section", { class: "desk" },
      el("h2", {}, "Listen, then spell"),
      el("div", { class: "listen" },
        button([icon("speaker"), "Say again"], replay, "secondary"),
        button([icon("sentence"), "Sentence"], () => w.sentence ? say(w.sentence) : toast("This word has no sentence."), "secondary"),
        button([icon("slow"), "Slowly"], () => say(w.word, 0.75), "secondary"),
      ),
      form,
    ),
  );
  if (!dockKeyboard({ target: () => answer, action: check })) form.append(check, el("span", { class: "enter-hint" }, "or press Enter"));
  focus(answer);
  replay();
  // Warm this word and the next word (including their sentences), then one ahead.
  prefetchSpeech(round.ws.slice(round.index, round.index + 2).flatMap(word => [word.word, word.sentence]));
}
async function finishSpelling(r) {
  const view = viewVersion;
  await api("/api/sessions/complete", { session_id: r.session });
  if (view !== viewVersion) return;
  shell("practice", "spelling");
  app.append(practiceBand({ title: r.list?.title || "Review round", status: "Round complete", cells: roundCells(r.ws.length, -1, r.results), exit: exitButton("Done", render) }),
    el("section", { class: "desk" },
      el("h1", {}, "Look at you grow!"),
      el("div", { class: "score" }, `${r.first} / ${r.ws.length}`),
      el("p", {}, "Words spelled correctly on the first try."),
      r.misses.length
        ? el("div", {},
            el("h3", {}, "A little more practice"),
            el("p", { class: "comparison" }, r.misses.map((w) => el("span", { class: "miss" }, w.word))),
            button("Practice missed words", () => startSpelling(r.misses, r.list, r.kind), "primary"))
        : el("p", {}, "Every word was a first-try win."),
      el("div", { class: "row form-actions" },
        button("Back to spelling", render, "secondary"),
        button("See progress", () => { tab = "Progress"; render(); }, "secondary"),
      ),
    ),
  );
}
function verseHome() {
  const active = state.verses.filter((v) => !v.archived);
  if (state.parent) app.append(el("div", { class: "row spread section" }, el("p", { class: "muted" }, "Parent mode: paste the wording your family uses."), button("+ Add Bible verse", () => editVerse())));
  if (!active.length)
    app.append(el("div", { class: "section" }, el("div", { class: "section-title" }, el("h2", {}, "No verse yet")),
      el("p", {}, "A parent can paste a verse in Parent mode to begin.")));
  app.append(el("div", {}, active.map(verseCard)));
  if (state.parent && state.verses.some((v) => v.archived))
    app.append(el("details", {}, el("summary", {}, "Archived verses"), state.verses.filter((v) => v.archived).map(verseCard)));
}
function verseCard(v) {
  return el("section", { class: "packet", "data-tone": "verses" },
    el("div", { class: "packet-strip" },
      el("h2", {}, v.reference),
      el("span", { class: "band-meta" }, [v.translation, v.sample ? "Sample" : ""].filter(Boolean).join(" · "))),
    el("div", { class: "packet-body" },
      el("p", { class: "verse" }, v.text),
      v.due_date ? el("p", { class: "muted" }, "Practice by " + niceDate(v.due_date)) : null,
      el("div", { class: "row" },
        button("Practice this verse", () => verseMenu(v)),
        state.parent ? button("Edit", () => editVerse(v), "quiet small") : null,
        state.parent ? button(v.archived ? "Restore" : "Archive", () => archive("verses", v), "quiet small") : null,
      ),
    ),
  );
}
const VERSE_MODES = [
  ["read", "Read & listen", "Hear the reference and the whole verse."],
  ["blanks", "Fill the blanks", "Start with a few missing words, then hide more."],
  ["first", "First-letter clues", "Type the verse with the first letter of each word."],
  ["memory", "From memory", "Type the whole verse with no clues."],
  ["reference", "Reference quiz", "Remember where the verse is found."],
];
function verseMenu(v) {
  shell();
  app.append(el("div", { class: "section" },
    el("div", { class: "section-title" }, el("h2", {}, v.reference), el("span", { class: "muted" }, v.translation || "")),
    el("p", {}, "Take one step at a time. Each step hides a little more."),
    el("ol", { class: "modes", "data-tone": "verses" }, VERSE_MODES.map(([mode, title, description], i) =>
      el("li", {}, button([el("span", { class: "step", "aria-hidden": "true" }, i + 1), el("span", { class: "what" }, el("strong", {}, title), el("span", {}, description))], () => versePractice(v, mode))))),
    button("Back to verses", render, "secondary"),
  ));
}
async function versePractice(v, mode, level = 25) {
  const previousView = viewVersion;
  const session = await api("/api/sessions", { kid_id: kid.id, kind: "verse" });
  if (previousView !== viewVersion) return;
  shell("practice", "verses");
  const modeName = Object.fromEntries(VERSE_MODES.map(([m, t]) => [m, t]))[mode];
  const desk = el("section", { class: "desk" }),
    ws = v.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  let indices = [],
    blankInputs = [],
    keyboard = null;
  app.append(practiceBand({ title: mode === "reference" ? "Reference quiz" : v.reference, status: modeName + (mode === "blanks" ? ` · ${level}% hidden` : ""), exit: exitButton("Back to modes", () => verseMenu(v)) }), desk);
  desk.append(el("h2", {}, mode === "reference" ? "Where is this verse found?" : mode === "read" ? "Read it, then say it" : "Type what’s missing"));
  const response = practiceField(textArea("verse-answer", "", {
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "none",
    spellcheck: "false",
    placeholder: mode === "reference" ? "Book chapter:verse" : "Type the verse here…",
    "aria-label": mode === "reference" ? "Bible reference" : "Your verse from memory",
  }));
  if (mode === "read") {
    desk.append(
      el("p", { class: "verse" }, v.text),
      el("div", { class: "listen" }, button([icon("speaker"), "Listen"], () => say([v.reference, v.text]), "secondary")),
      el("p", { class: "muted" }, "Read along, then try saying it without looking."),
      button("I practiced this verse", async () => {
        await api("/api/verse-attempts", { session_id: session.id, verse_id: v.id, mode, typed: "" });
        await api("/api/sessions/complete", { session_id: session.id });
        toast("Practice saved. Keep growing!");
        verseMenu(v);
      }, "primary"),
    );
    return;
  }
  const form = el("form", { id: "practice-form", class: "verse-form" });
  const submit = el("button", { type: "submit", form: "practice-form", class: "primary" }, "Check my work");
  if (mode === "blanks") {
    form.append(el("div", { class: "segments", role: "group", "aria-label": "How many words to hide" },
      [25, 50, 75, 100].map((n) => { const b = button(`${n}%`, () => versePractice(v, mode, n), n === level ? "active" : "secondary"); b.setAttribute("aria-pressed", String(n === level)); b.setAttribute("aria-label", `${n}% hidden`); return b; })));
    indices = shuffled(ws.map((_, i) => i)).slice(0, Math.ceil((ws.length * level) / 100)).sort((a, b) => a - b);
    const blanks = el("div", { class: "blanks" });
    ws.forEach((w, i) => {
      if (indices.includes(i)) {
        const n = practiceField(input("blank-" + i, "", { "aria-label": `Missing word ${i + 1}`, autocomplete: "off", autocorrect: "off", autocapitalize: "none", spellcheck: "false" }));
        blankInputs.push(n);
        blanks.append(n);
      } else blanks.append(el("span", {}, w));
    });
    form.append(el("p", { class: "muted" }, onScreenKeyboard() ? "Type one word in each blank. Next moves to the following blank." : "Type one word in each blank. Tab moves to the next one."), blanks);
  }
  if (mode === "first") form.append(el("p", { class: "verse" }, ws.map((w) => w[0] + "·").join(" ")));
  if (mode === "reference") form.append(el("p", { class: "verse" }, v.text));
  if (mode !== "blanks") form.append(field(mode === "reference" ? "Reference" : "Your verse", response));
  let current = blankInputs[0] || response;
  form.addEventListener("focusin", (e) => { if (e.target.matches("[data-practice-field]")) current = e.target; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const result = await api("/api/verse-attempts", {
        session_id: session.id, verse_id: v.id, mode, level, indices,
        typed: mode === "blanks" ? blankInputs.map((n) => n.value).join(" ") : response.value,
      });
      await api("/api/sessions/complete", { session_id: session.id });
      stopSpeaking();
      keyboard?.remove();
      desk.replaceChildren(
        el("h2", {}, result.accuracy === 100 ? "You remembered every word!" : "You’re building a strong memory."),
        el("div", { class: "score" }, result.accuracy + "%"),
        el("p", {}, "Green words matched. Underlined words are a gentle reminder for next time."),
        el("div", { class: "comparison" }, result.details.map((d) =>
          el("span", { class: d.correct ? "" : "miss", title: d.typed && !d.correct ? "You typed: " + d.typed : "" }, d.word || `+ ${d.typed}`))),
        el("div", { class: "row form-actions" },
          button("Try this again", () => versePractice(v, mode, level), "primary"),
          mode === "blanks" && level < 100 ? button("Next level", () => versePractice(v, mode, level + 25), "secondary") : null,
          button("Choose a mode", () => verseMenu(v), "secondary"),
        ),
      );
    } catch (err) {
      toast(err.message);
      submit.disabled = false;
    }
  });
  desk.append(form);
  keyboard = dockKeyboard({
    target: () => current,
    action: submit,
    symbols: mode !== "blanks",
    space: mode === "blanks" ? "next" : "type",
    next: () => { const i = blankInputs.indexOf(current); (blankInputs[i + 1] || blankInputs[0])?.focus(); },
  });
  if (!keyboard) form.append(submit);
  focus(current);
}
function wordBankView(bank) {
  if (!bank) return el("p", {}, "Take a test or learn a word to start your word bank.");
  const rows = (items, empty) => items.length ? el("ul", {class: "rows word-bank-rows"}, items.slice(0, 8).map(w =>
    el("li", {}, el("strong", {}, w.word || w.display_word),
      el("span", {class: "meta"}, state.parent ? `Box ${w.box} · due ${niceDate(w.due_date || w.due)} · ${w.misses} misses` : `${w.misses} ${w.misses === 1 ? "miss" : "misses"}`)))) : el("p", {class: "muted"}, empty);
  return el("div", {},
    el("dl", {class: "bank-counts"}, [["Learning", bank.counts.learning, "Boxes 1–2"], ["Getting it", bank.counts.gettingIt, "Boxes 3–4"], ["Mastered", bank.counts.mastered, "Boxes 5–6"]].map(([label, n, boxes]) =>
      el("div", {}, el("dt", {}, label), el("dd", {}, n), el("small", {}, boxes)))),
    el("p", {class: "muted bank-explainer"}, "Right on the first try? Your word moves up. More time between reviews as it grows: 1, 2, 4, 7, 14, then 30 days."),
    el("h3", {}, "A little extra practice"), rows(bank.struggling, "No struggling words right now."),
    el("h3", {}, "Due soon"), rows(bank.dueSoon, "Nothing coming up yet."),
    state.parent && bank.words.length ? el("details", {}, el("summary", {}, "Parent detail · all words"),
      table(["Word", "Box", "Due (UTC)"], bank.words.map(w => [w.word || w.display_word, w.box, w.due_date || w.due]))) : null);
}
async function progressHome() {
  const k = kid.id,
    view = viewVersion;
  app.append(el("p", { id: "progress-loading" }, "Gathering your growth…"));
  try {
    const p = await api("/api/progress?kid=" + k);
    if (kid?.id !== k || tab !== "Progress" || view !== viewVersion) return;
    $("progress-loading")?.remove();
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    app.append(el("p", { class: "summary-line" },
      `${plural(p.listsCompleted, "list", "lists")} completed · ${plural(p.streak, "day", "days")} in a row · ${plural(p.wordBank?.dueCount ?? p.wordBank?.due.length ?? 0, "word", "words")} ready for review.`,
      el("small", {}, "Practice days use UTC.")));
    app.append(el("div", { class: "section" },
      el("div", { class: "section-title" }, el("h2", {}, "First-try spelling accuracy")),
      p.charts.length ? drawChart(p.charts) : el("p", {}, "Take a spelling test and your first-try accuracy for each list shows up here."),
      p.learning ? el("p", { class: "muted" }, `Learn practice, kept separate from test scores: ${p.learning.wordsLearned} words learned · ${p.learning.attempts} fading-cue attempts · ${p.learning.skips || 0} skips · ${p.learning.sessionsCompleted} completed rounds.`) : null,
    ));
    if (state.parent && p.learnAttempts?.length) app.append(el("details", {},
      el("summary", {}, "Parent detail · recent Learn attempts"),
      table(["Word", "Letters hidden", "Typed", "Correct"], p.learnAttempts.slice(0, 100).map(a => [a.word, a.step === "skip" ? "Skipped" : a.step + "%", a.typed, a.correct ? "Yes" : "Compare"]))));
    app.append(el("div", { class: "two" },
      el("div", { class: "section" },
        el("div", { class: "section-title" }, el("h2", {}, "Word bank")),
        wordBankView(p.wordBank),
      ),
      el("div", { class: "section" },
        el("div", { class: "section-title" }, el("h2", {}, "Verse garden")),
        p.mastery.length ? el("ul", { class: "rows" }, p.mastery.map((v) => el("li", {},
          el("strong", {}, v.reference),
          el("span", { class: "stars", role: "img", "aria-label": `${v.stars} of 3 stars` }, [0, 1, 2].map((i) => icon("star", { filled: i < v.stars }))),
          el("span", { class: "meta" }, `Best ${v.best}% of the last 10 · ${v.attempts} ${v.attempts === 1 ? "practice" : "practices"}`)))) : el("p", {}, "Practice a verse to start growing stars."),
        el("small", {}, "One star: 70%+. Two: 95%+. Three: 95%+ from memory or with first-letter clues. Read & listen doesn’t earn stars."),
      ),
    ));
    app.append(el("div", { class: "section" },
      el("div", { class: "section-title" }, el("h2", {}, "Recent practice")),
      p.sessions.length
        ? el("ul", { class: "rows" }, p.sessions.slice(0, 12).map((s) => el("li", {},
            el("span", {}, s.kind === "verse" ? el("strong", {}, "Verse practice") : [el("strong", {}, s.kind === "learn" ? "Learn" : s.kind === "review" ? "Review" : "Test"), " · ", s.title || (s.kind === "review" ? "Word bank" : "Tricky words")]),
            el("span", { class: "meta" }, `${new Date(s.created_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${s.completed ? "Complete" : "In progress"}`))))
        : el("p", {}, "Your first practice can be today."),
    ));
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
                a.mode === "learn" ? a.step === "skip" ? "Learn · skipped" : `Learn · ${a.step}% hidden` : "Test",
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
  // Bar length is the exact accuracy; the figure is set beside it for reading.
  // CSSOM width, not a style attribute: the CSP has no 'unsafe-inline'.
  const fill = (pct) => { const n = el("span", { class: "fill" }); n.style.width = pct + "%"; return n; };
  return el("div", { class: "bars", role: "img", "aria-label": "First-try spelling accuracy by list" },
    charts.map((c) => el("div", { class: "bar", "aria-hidden": "true" },
      el("span", { class: "label" }, c.title),
      el("span", { class: "track" }, fill(c.total ? c.accuracy : 0)),
      el("span", { class: "value" }, c.total ? c.accuracy + "%" : "—"))));
}
function modal(title, content) {
  const d = el(
    "dialog",
    { "aria-label": title },
    el("div", { class: "row spread" }, el("h2", {}, title), button(icon("close", { label: "Close" }), () => d.close(), "quiet")),
    content,
  );
  if (content?.tagName === "FORM") {
    content.classList.add("sheet-form");
    let actions = content.querySelector(":scope > .form-actions");
    if (!actions) {
      const submit = content.querySelector(":scope > button[type=submit]");
      if (submit) { actions = el("div", { class: "row form-actions" }, submit); content.append(actions); }
    }
    if (!content.querySelector(":scope > .sheet-body")) {
      const body = el("div", { class: "sheet-body" });
      [...content.children].filter(n => n !== actions).forEach(n => body.append(n));
      content.prepend(body);
    }
  }
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
function unlock(onUnlocked) {
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
          if (typeof onUnlocked === "function") await onUnlocked();
          else parentHome();
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
    el("div", { class: "sheet-body" }, fields, error),
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
        rows: 8,
        placeholder:
          "journey | We began our journey at sunrise.\nbeautiful | The garden is beautiful.",
      },
    );
  formDialog(
    l ? "Edit spelling list" : "Add spelling list",
    [
      el("p", { class: "muted field-hint" }, "Each list is one week’s test. Add a new list for new words."),
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
      maxlength: 2000,
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
const PARENT_SECTIONS = ["Kids", "Spelling lists", "Bible verses", "This device", "Family", "Sign-in & email", "Connect an AI assistant", "Shared lists", "Class lists", "Following"];
function parentHome() {
  if (!state.parent) return unlock();
  parentPage = true;
  viewVersion++;
  stopSpeaking();
  app.replaceChildren();
  document.body.classList.remove("practicing");
  app.dataset.tone = "parent";
  header();
  app.append(el("div", { class: "band" }, el("div", { class: "band-head" },
    el("h1", {}, "Parent"), button("Done", () => { parentPage = false; render(); }, "secondary small"))));
  const primary = ["Kids", "Spelling lists", "Bible verses", "Family"];
  const navButton = name => {
    const control = button(({"Spelling lists": "Lists", "Bible verses": "Verses"})[name] || name, () => { parentSection = name; parentHome(); window.scrollTo(0, 0); }, name === parentSection ? "active" : "secondary");
    if (name === parentSection) control.setAttribute("aria-current", "page");
    return control;
  };
  app.append(el("nav", {class: "parent-nav", "aria-label": "Parent sections"},
    el("div", {class: "parent-primary"}, primary.map(navButton)),
    el("details", {class: "parent-more", open: !primary.includes(parentSection)}, el("summary", {}, "More"),
      el("div", {class: "parent-secondary"}, PARENT_SECTIONS.filter(name => !primary.includes(name)).map(navButton)))));
  if (["Shared lists", "Class lists", "Following"].includes(parentSection)) {
    const host = el("div", {}, el("p", {}, "Loading…")); app.append(host);
    sharing[parentSection === "Shared lists" ? "sharedAdmin" : parentSection === "Class lists" ? "classesAdmin" : "followsAdmin"](host).catch(err => host.replaceChildren(el("p", {role:"alert"}, err.message), button("Try again", parentHome, "secondary"))); return;
  }
  if (parentSection === "Sign-in & email") { const host = el("section", {class: "section"}); app.append(host); identity.manage(host); return; }
  if (parentSection === "Connect an AI assistant") { assistantControls(); return; }
  if (parentSection === "Spelling lists" || parentSection === "Bible verses") { parentPractice(); return; }
  const section = (title, ...children) => el("div", { class: "section" }, el("div", { class: "section-title" }, el("h2", {}, title)), ...children);
  if (parentSection === "Kids") { app.append(section("Kids",
    el("div", {}, state.kids.map((k) => el("div", { class: "profile-controls" },
      el("strong", {}, k.name),
      button("Rename / edit", () => editKid(k), "secondary small"),
      button("Remove", async () => {
        if (!confirm(`Remove ${k.name} and all their lists, verses, and practice history? This cannot be undone.`)) return;
        await api("/api/admin/remove-kid", { id: k.id });
        await reload();
        render();
        toast("Profile removed.");
      }, "danger small"),
    ))),
    el("div", { class: "form-actions" }, button("+ Add kid", () => editKid())),
  ));
  return; }
  if (parentSection === "Family") app.append(familyControls());
  if (parentSection === "This device") {
  app.append(deviceControls());
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
          await api("/api/admin/settings", { voice: voice.value, speed: Number(speed.value) });
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
    el("p", { class: "muted field-hint" }, "Cloud voice sends only the text being read to Cloudflare for speech. If it takes more than 4 seconds or is unavailable, this device’s English voice takes over. Device voice uses your browser and operating system."),
    el("div", { class: "row" },
      el("button", { type: "submit" }, "Save voice settings"),
      button([icon("speaker"), "Test voice"], () => say("A little practice helps us grow."), "secondary"),
    ),
  );
  app.append(section("Listen your way", form));
  return; }
  const upload = input("backup-file", "", { type: "file", accept: ".json,application/json" });
  app.append(section("Backups",
    el("p", {}, "Export includes all profiles, lists, verses, settings, sessions, and attempts. JSON can restore this app; CSV is a spreadsheet-friendly table with a table-name column and shared fields."),
    el("div", { class: "row" },
      button("Export JSON", () => downloadBackup("json"), "secondary"),
      button("Export CSV", () => downloadBackup("csv"), "secondary"),
    ),
    field("Restore a JSON backup", upload),
    el("p", { class: "notice" }, `Import replaces all current family data. Export a backup first. Files are limited to ${state.settings.serverTts === false ? 2 : 32} MB.`),
    button("Import backup", async () => {
      const f = upload.files[0];
      if (!f) throw Error("Choose a JSON backup first.");
      const limitMB = state.settings.serverTts === false ? 2 : 32;
      if (f.size > limitMB * 1024 * 1024) throw Error(`Backup is larger than ${limitMB} MB.`);
      let b;
      try { b = JSON.parse(await f.text()); } catch { throw Error("That file is not valid JSON."); }
      if (!confirm("Replace all current family data with this backup?")) return;
      await api("/api/admin/import", b);
      await reload();
      render();
      toast("Backup restored.");
    }, "danger"),
  ));
}

async function assistantControls() {
  const version = viewVersion;
  const host = el("section", { class: "section" }, el("div", { class: "section-title" }, el("h2", {}, "Connect an AI assistant")),
    el("p", {}, "Let an assistant prepare weekly lists and read practice summaries. No account needed."),
    el("p", { class: "notice" }, "Anyone with this link can add and read your family's lists. Revoke it if shared by mistake."),
    el("p", { class: "muted" }, "Read only connections cannot make changes. Changing your Parent PIN does not revoke connections. You can keep up to five connections."));
  app.append(host);
  const name = input("connection-name", "", { required: true, maxlength: 80, placeholder: "Claude on Dad’s laptop" });
  const scope = el("select", { id: "connection-scope" }, el("option", { value: "add-read" }, "Add & read"), el("option", { value: "read-only" }, "Read only"));
  const shown = el("div", { "aria-live": "polite" });
  const connections = el("div", { class: "rows" });
  const error = el("p", { role: "alert" });
  const refresh = async () => {
    const result = await api("/api/admin/connections");
    if (viewVersion !== version) return;
    connections.replaceChildren(...result.connections.map(c => el("div", { class: "section" },
      el("strong", {}, c.name), ...(c.format !== "fpc2" ? [el("p", { class: "meta" }, "Retired — create a new link")] : []), el("p", { class: "meta" }, `${c.scope === "read-only" ? "Read only" : "Add & read"} · Created ${niceDate(c.created_at)} · Last used: ${c.last_used_at ? new Date(c.last_used_at).toLocaleString() : "Not yet"}`),
      button("Revoke", async () => { if (!confirm(`Revoke ${c.name}? Its link will stop working.`)) return; await api("/api/admin/connections/revoke", { id: c.id }); shown.replaceChildren(); await refresh(); }, "secondary small"))));
    if (!result.connections.length) connections.append(el("p", { class: "muted" }, "No connections yet."));
  };
  const create = el("button", { type: "submit" }, "Create connection");
  host.append(el("form", { onsubmit: async e => {
    e.preventDefault(); create.disabled = true; error.textContent = "";
    try {
      const result = await api("/api/admin/connections", { name: name.value, scope: scope.value });
      if (viewVersion !== version) return;
      const url = location.origin + "/mcp/t/" + result.token;
      shown.replaceChildren(el("h3", {}, "Save this connection link now"), el("p", {}, "Shown only once. It cannot be retrieved after you leave this page."),
        el("p", { class: "connection-url" }, url), button("Copy connection URL", async () => { await navigator.clipboard.writeText(url); toast("Connection URL copied. Keep it private."); }, "secondary"),
        el("p", {}, "Claude Code command"), el("pre", { class: "connection-url" }, `claude mcp add --transport http family-practice ${url}`));
      name.value = ""; await refresh();
    } catch (err) { error.textContent = err.message; }
    finally { create.disabled = false; }
  } }, field("Name", name), field("Scope", scope), create, error), shown,
  el("h3", {}, "Your connections"), connections,
  button("Revoke all", async () => { if (!confirm("Revoke every assistant connection? All existing links will stop working.")) return; await api("/api/admin/connections/revoke-all", {}); shown.replaceChildren(); await refresh(); }, "secondary"),
  el("h3", {}, "Set up your assistant"),
  el("p", {}, "Claude: Settings → Connectors → Add custom connector → paste the connection URL."),
  el("p", {}, "Claude Code: run the command shown with your new connection link."),
  el("p", {}, "Any MCP client that supports Streamable HTTP: use the connection URL. For clients that support headers, use /mcp on this origin with Authorization: Bearer followed by your connection token."));
  try { await refresh(); } catch (err) { if (viewVersion === version) error.textContent = err.message; }
}

function parentPractice() {
  const isList = parentSection === "Spelling lists";
  const picker = el("select", { id: "parent-kid" }, state.kids.map(k => el("option", { value: k.id, selected: kid?.id === k.id }, k.name)));
  picker.addEventListener("change", async () => { kid = state.kids.find(k => k.id === Number(picker.value)); await reload(); parentHome(); });
  app.append(el("div", { class: "section" }, el("div", { class: "section-title" }, el("h2", {}, parentSection)),
    state.kids.length ? field("Kid", picker) : el("p", {}, "Add a kid in Kids first.")));
  if (!state.kids.length) return;
  if (!kid) { kid = state.kids[0]; reload().then(() => { if (parentPage) parentHome(); }).catch(e => toast(e.message)); return; }
  const items = isList ? state.lists : state.verses;
  app.append(el("p", { class: "muted" }, isList ? "Each list is one week’s test. Add a new list for new words. Editing keeps practice history." : "Paste the wording your family uses."),
    button(isList ? "+ Add spelling list" : "+ Add Bible verse", () => isList ? editList() : editVerse()),
    el("div", { class: "rows section" }, items.map(item => el("div", { class: "row spread" },
      el("div", {}, el("strong", {}, isList ? item.title : item.reference), el("p", { class: "meta" }, (item.archived ? "Archived · " : "") + (isList ? `${item.words.length} words · ${niceDate(item.date)}` : item.text))),
      el("div", { class: "row" }, isList ? sharing.sourceMeta(item) : null, button("Edit", () => isList ? editList(item) : editVerse(item), "secondary small"),
        isList ? button("Share", () => sharing.shareList(item), "secondary small") : null,
        button(item.archived ? "Restore" : "Archive", () => archive(isList ? "lists" : "verses", item), "quiet small"))))));
}

// Per-device feedback settings live in this browser only, never on the server.
function deviceControls() {
  const s = deviceSettings();
  const toggle = (id, label, hint, key, disabled = false) => {
    const box = input(id, "", { type: "checkbox", checked: s[key] && !disabled, disabled });
    box.addEventListener("change", () => { setDeviceSettings({ [key]: box.checked }); if (key === "keySounds" && box.checked) previewSound(); });
    return el("div", { class: "switch" }, el("label", { for: id }, label, el("small", {}, hint)), box);
  };
  const keyboard = el("select", { id: "device-keyboard" },
    [["auto", "Automatic (touch screens)"], ["on", "Always show"], ["off", "Never show"]].map(([v, t]) => el("option", { value: v, selected: s.keyboard === v }, t)));
  keyboard.addEventListener("change", () => setDeviceSettings({ keyboard: keyboard.value }));
  return el("div", { class: "section" },
    el("div", { class: "section-title" }, el("h2", {}, "This device")),
    toggle("device-sounds", "Key sounds", "A soft tick for keys and buttons. Plays only after a tap or key press.", "keySounds"),
    toggle("device-haptics", "Haptics", supportsHaptics() ? "A light tap on supported phones. On iPhone, needs iOS 18 and System Haptics on." : "This device can’t vibrate.", "haptics", !supportsHaptics()),
    el("div", { class: "switch" }, el("label", { for: "device-keyboard" }, "On-screen keyboard", el("small", {}, "Big letter keys for spelling and verses. Automatic shows them on phones and tablets.")), keyboard),
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
  document.body.classList.remove("practicing");
  $("header-actions").replaceChildren();
  $("voice-status").textContent = "";
}
function familyControls() {
  return el("div", { class: "section" },
    el("div", { class: "section-title" }, el("h2", {}, "Your family space"), el("span", { class: "muted" }, state.family?.name || "Family Practice")),
    el("p", {}, "Your family code opens practice on another device. The parent PIN protects settings and backups. Keep both safe. Optional Parent sign-in can recover a linked family’s code; it does not recover your PIN."),
    el("div", { class: "row" },
      button("Save your family code", codeCard, "secondary"),
      identity.available() || identity.signedIn() ? button("Recover family codes", identity.recoverCodes, "secondary") : null,
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
  app.dataset.tone = "parent";
  const joinURL = location.origin + "/f/" + encodeURIComponent(familyCode);
  app.append(el("section", { class: "print-sheet code-card section" },
    el("h1", {}, state.family?.name || "Your family practice space"),
    el("p", { class: "notice" }, "Save this code — it always opens your family’s practice. Write it down or copy it. Optional Parent sign-in can recover codes for linked families."),
    el("p", { class: "muted" }, "Family code"), el("strong", { class: "family-code" }, familyCode),
    el("p", { class: "join-url" }, joinURL),
    el("p", {}, "Open Family Practice on another device and enter this code, or use the link above. Anyone with the code can view and use your family’s practice. Share it only with trusted family members."),
    el("p", {}, "Your parent PIN is separate. It is not printed on this card. Keep the PIN safe: there is no email-based recovery."),
    el("p", { class: "muted no-print" }, "Keep this card somewhere private."),
    el("div", { class: "row" },
      button("Copy code", async () => { await navigator.clipboard.writeText(familyCode); toast("Family code copied."); }),
      button("Copy join link", async () => { await navigator.clipboard.writeText(joinURL); toast("Join link copied. Share privately."); }, "secondary"),
      button("Print code card", () => window.print(), "secondary"),
      button("Back to practice", render, "secondary")),
  ));
}
async function openFamily(code) {
  parentPage = false;
  const previous = familyCode;
  familyCode = code.trim();
  kid = null;
  try { await reload(); }
  catch (err) { familyCode = previous; throw err; }
  rememberFamily(familyCode);
  history.replaceState({}, "", "/");
  render();
}
// The Learn mechanism, shown rather than described: letters fade a few at a time.
function learnDemo() {
  const row = (label, word, hidden, fades = []) => el("div", {}, el("b", {}, label), el("span", { class: "cue" },
    [...word].map((c, i) => {
      const span = el("span", { class: hidden.includes(i) ? "blank" : fades.includes(i) ? "fades" : "" }, hidden.includes(i) ? " " : c);
      if (fades.includes(i)) span.style.setProperty("--i", fades.indexOf(i));
      return span;
    })));
  return el("figure", { class: "demo", "aria-label": "Example: in Learn mode, letters of “beautiful” fade until you spell it from memory." },
    el("div", { class: "demo-steps", "aria-hidden": "true" },
      row("Copy", "beautiful", []),
      row("Fade", "beautiful", [], [3, 7]),
      row("Recall", "beautiful", [1, 2, 3, 4, 5, 6, 7, 8])),
    el("small", {}, "Learn mode: hear it, copy it, then type it with fewer letters showing."));
}
function landing(prefill = "", message = "") {
  clearView();
  app.dataset.tone = "spelling";
  const resumeCode = familyCode;
  app.append(el("div", { class: "band hero" },
    el("div", { class: "hero-grid" },
      el("div", {},
        el("h1", {}, "A small daily habit. A family that grows."),
        el("p", { class: "hero-lede" }, "Spelling tests read aloud with helpful sentences, Bible verses learned a few words at a time, and progress worth celebrating."),
        el("div", { class: "row" },
          button("Create a family space", () => { name.focus(); name.scrollIntoView({behavior:"smooth",block:"center"}); }),
          button("I have a family code", () => { code.focus(); code.scrollIntoView({behavior:"smooth",block:"center"}); }, "secondary")),
      ),
      learnDemo(),
    ),
  ));
  if (message) app.append(el("p", { role: "alert", class: "notice" }, message));
  if (resumeCode && !prefill) app.append(el("div", { class: "row section" }, button("Return to saved family", () => openFamily(resumeCode), "secondary")));
  const identityEntry = el("section", {class: "section"}); app.append(identityEntry); identity.entry(identityEntry, prefill);
  app.append(el("div", { class: "offer" },
    el("div", {}, el("strong", {}, "Spelling, read aloud"), el("span", {}, "Word, sentence, word. One retry, then the letters spelled out.")),
    el("div", {}, el("strong", {}, "Bible verses"), el("span", {}, "Paste your family’s wording. Blanks, first letters, then from memory.")),
    el("div", {}, el("strong", {}, "Progress for parents"), el("span", {}, "First-try accuracy, tricky words, and verse stars.")),
    el("div", {}, el("strong", {}, "No account required"), el("span", {}, "No ads or tracking. Kids use first names and a family code. Parent sign-in is optional.")),
  ));
  const name = input("family-name", "", { maxlength: 80, autocomplete: "off", placeholder: "The Hill family" });
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
      if (identity.signedIn()) {
        try { await identity.linkNewFamily(); } catch (err) { toast("Family created, but sign-in linking failed: " + err.message); codeCard(); return; }
      }
      codeCard();
      toast("Family created! Save your code before you begin.");
    } catch (err) { createError.textContent = err.message; }
    finally { createButton.disabled = false; }
  } }, field("Family space name (optional)", name), field("Parent PIN (4–8 digits)", pin), field("Repeat parent PIN", repeat),
    el("p", { class: "muted field-hint" }, "Pick a PIN you’ll remember: there’s no email-based PIN recovery. You start with an empty space and add only what you need."), createError, createButton);
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
    el("p", { class: prefill ? "notice" : "muted field-hint" }, prefill ? "This link contains a family code. Join only if a trusted family member shared it with you. Joining saves this family on this browser and replaces its previously saved family." : "Ask a parent for your family’s code. Joining remembers this family on this browser. Use a trusted device."), joinError, joinButton);
  app.append(el("div", { class: "onboarding" },
    el("section", { class: "section" }, el("h2", {}, "Start your family"), create),
    el("section", { class: "section" }, el("h2", {}, "Already have a code?"), join)));
}
function privacy() {
  clearView();
  app.dataset.tone = "parent";
  app.append(el("section", { class: "section prose" },
    el("h1", {}, "Privacy & your family’s data"),
    el("p", {}, "Family Practice stores the profiles, spelling lists, Bible verses, practice answers, progress, and voice settings your family enters. Use first names or nicknames, not full names, school names, addresses, or other sensitive details."),
    el("h2", {}, "Your code is a key"),
    el("p", {}, "No tracking, no analytics, and no ads. You can delete your family anytime. Anyone with your family code can open your family’s practice and view its profiles and progress. It is not a public username. Share the code and join link privately with trusted family members only. Your parent PIN protects management actions, backups, and deletion; it does not hide practice from someone who knows your code."),
    el("h2", {}, "Shared lists and class links"),
    el("p", {}, "Parents can publish an unlisted, frozen copy of spelling words, sentences, an optional short note and a Bible verse. Anyone with that public link can read and import it. Never include personal details. Kids, family codes, PINs and practice history are not published. Stop a link in Parent mode; independent copies already imported by other families remain theirs. Following a class list keeps your chosen kids and verse preference private and only shows new weeks for a parent to add. Public links can be reported; reports are not automatic moderation."),
    el("h2", {}, "On this device"),
    el("p", {}, "This browser remembers your family code in local storage. Parent mode uses a cookie after you enter your PIN. Lock Parent mode when you finish on a shared device. Forgetting a family here removes its saved code, not its server data. Key sound, haptics, and on-screen keyboard choices are saved only in this browser."),
    el("h2", {}, "Speech & hosting"),
    el("p", {}, "Cloud voice is the default. Text being read aloud (spelling words, practice sentences, and Bible verses) is sent to Cloudflare Workers AI to generate speech; family profile names and typed answers are not included in speech requests. Already-heard audio is cached in bounded browser memory for replay, and Cloudflare caches generated clips for reuse. The app shell is saved on this device for faster loading; family data and answers are not saved in the offline cache. You can choose Device voice in family settings; it is also the automatic fallback when cloud speech is unavailable. Device voice availability and whether speech is processed locally depend on your browser and operating system. Practice data is stored with the app’s Cloudflare hosting services; normal hosting request logs may include technical information such as IP addresses."),
    el("h2", {}, "You stay in control"),
    el("p", {}, "In Parent mode you can export a backup, remove a child and their practice history, or permanently delete the whole family. Keep backups private. Optional Jesklabs sign-in, shared by Jesklabs apps; it stores your email and which Jesklabs apps you use. Linked families allow code recovery and parent access. Google sign-in navigates through Jesklabs Accounts to Google only when you choose it; email sign-in sends a one-time code. Email reminders are opt-in. Delete your sign-in or unlink a parent in Parent mode without deleting family data. Keep your code and PIN safe; PINs cannot be recovered."),
    el("h2", {}, "Credits"),
    el("p", {}, "Text face: Practice Reader, a Latin subset of Andika by SIL International. Headings: Barlow Condensed by The Barlow Project Authors. Both use the SIL Open Font License 1.1. Key sound: “click_002” from Kenney’s Interface Sounds (CC0). All are served from this site; nothing loads from a third party."),
    el("div", { class: "row" }, button("Back", () => { history.replaceState({}, "", "/"); if (familyCode && state.family) render(); else landing(); }, "secondary"),
      familyCode ? button("Forget family on this device", async () => {
        if (!confirm("Forget the saved family code on this device? Keep a copy first. Your family’s server data will not be deleted.")) return;
        await api("/api/parent/lock", {}).catch(() => {}); await identity.init();
        rememberFamily(""); kid = null; state.parent = false;
        history.replaceState({}, "", "/"); landing();
      }, "secondary") : null),
  ));
}
const identity = createIdentityUI({el, button, field, input, modal, toast, app,
  current: () => ({state, familyCode}), openFamily, landing,
  refresh: async () => {
    if (familyCode) { await api("/api/parent/lock", {}).catch(() => {}); await identity.init(); await reload(); parentPage = false; render(); }
    else landing();
  },
});
const sharing = createSharingUI({el, button, field, input, textArea, modal, toast, api, app,
  current: () => ({state, kid, familyCode}), reload, unlock, openFamily, rememberFamily, clearView,
  goPractice: () => {parentPage = false; history.replaceState({}, "", "/"); render();},
});
(async () => {
  await identity.init();
  const authReturn = new URLSearchParams(location.search).get("auth");
  const signedInReturn = new URLSearchParams(location.search).has("signedIn");
  if (signedInReturn || authReturn) { history.replaceState({}, "", "/"); landing(); await identity.finishSignIn(authReturn); return; }
  const publicMatch = location.pathname.match(/^\/(s|c)\/([A-Za-z0-9_-]+)\/?$/);
  if (publicMatch) { await sharing.publicPage(publicMatch[1], publicMatch[2]); return; }
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
