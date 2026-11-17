import { createSpeech } from "/speech.js";
import { createSpellingUI } from "/spelling.js";
import { createVerseUI } from "/verses.js";
import { createProgressUI } from "/progress.js";
import { createWelcomeUI } from "/welcome.js";
import { createParentUI } from "/parent.js";
import { verseMasteryCopy } from "/verse-mastery.js";
import { newRound, reduce, roundDone, roundBusy } from "/practice-round.js";
import { createIdentityUI } from "/identity.js";
import { createSharingUI } from "/sharing-ui.js";
import { newLearnWord, advanceLearn } from "/learn.js";
import { icon } from "/icons.js";
import { createKeyboard } from "/keyboard.js";
import {
  deviceSettings,
  setDeviceSettings,
  supportsHaptics,
  onScreenKeyboard,
  previewSound,
} from "/feedback.js";
const $ = (id) => document.getElementById(id);
const app = $("app");
const FAMILY_STORAGE = "family-practice-code";
let familyCode = "";
try {
  familyCode = localStorage.getItem(FAMILY_STORAGE) || "";
} catch {}
function rememberFamily(code) {
  if (code !== familyCode) {
    stopSpeaking();
    clearSpeechCache();
    resetSpeechCooldown();
  }
  familyCode = code;
  try {
    if (code) localStorage.setItem(FAMILY_STORAGE, code);
    else localStorage.removeItem(FAMILY_STORAGE);
  } catch {
    toast("This browser cannot remember your family. Keep your code handy.");
  }
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
let parentPage = false,
  parentSection = "Kids";
let viewVersion = 0;
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of children.flat(Infinity))
    if (child != null) n.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return n;
}
function toast(s, control = document.activeElement) {
  $("toast").textContent = s;
  $("toast").style.display = "block";
  if (control instanceof HTMLElement && control !== document.body) {
    const overlap = control.getBoundingClientRect().bottom - $("toast").getBoundingClientRect().top + 12;
    if (overlap > 0) window.scrollBy({ top: overlap, behavior: "instant" });
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
  if (!r.ok) throw Object.assign(Error(b.error || "Please try again"), {status: r.status});
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
async function reload() {
  state = await api("/api/state" + (kid ? "?kid=" + kid.id : ""));
  if (kid) kid = state.kids.find((k) => k.id === kid.id) || null;
  header();
}
function header() {
  const actions = $("header-actions");
  actions.replaceChildren(
    ...[
      familyCode && !kid
        ? button(
            "Switch family",
            async () => {
              await api("/api/parent/lock", {}).catch(() => {});
              await identity.init();
              rememberFamily("");
              kid = null;
              state.parent = false;
              history.replaceState({}, "", "/");
              landing();
            },
            "quiet small",
          )
        : null,
      kid && !parentPage
        ? button(
            [icon("back"), "Switch kid"],
            () => {
              kid = null;
              render();
            },
            "quiet small",
          )
        : null,
      button(
        [icon("lock"), "Parent mode"],
        () => (state.parent ? parentHome() : unlock()),
        "secondary small",
      ),
      state.parent
        ? button(
            "Lock",
            async () => {
              await api("/api/parent/lock", {});
              await identity.init();
              parentPage = false;
              await reload();
              render();
            },
            "quiet small",
          )
        : null,
    ].filter(Boolean),
  );
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
  app.append(
    el(
      "div",
      { class: "band" },
      el(
        "div",
        { class: "band-head" },
        el("h1", {}, kid.name),
        el("span", { class: "band-meta" }, kid.grade ? "Grade " + kid.grade : ""),
      ),
      el(
        "nav",
        { class: "tabs", "aria-label": "Practice sections" },
        ["Spelling", "Bible Verses", "Progress"].map((t) =>
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
    ),
  );
  app.querySelector(".tabs .active")?.setAttribute("aria-current", "page");
  return true;
}
// The band on every practice screen: way out, where you are, and one cell per word.
function practiceBand({ title, status, cells = [], exit }) {
  const chart = cells.length
    ? el(
        "span",
        { class: "chart-cells" + (cells.length > 12 ? " compact" : ""), "aria-hidden": "true" },
        cells.map((c) => el("i", { class: c })),
      )
    : null;
  chart?.style.setProperty("--word-count", cells.length);
  return el(
    "div",
    { class: "practice-band" },
    el(
      "div",
      {},
      exit,
      el("span", { class: "title" }, title),
      el("span", { class: "status" }, status),
      chart,
    ),
  );
}
const exitButton = (label, fn) => button([icon("close"), label], fn, "quiet");
const roundCells = (n, index, results = []) =>
  Array.from({ length: n }, (_, i) => results[i] || (i === index ? "now" : ""));
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
  if (!options.force && !onScreenKeyboard()) return null;
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
    app.append(
      el(
        "div",
        { class: "band" },
        el(
          "div",
          { class: "band-head" },
          el("h1", {}, "Who’s ready to grow?"),
          el("span", { class: "band-meta" }, state.family?.name || ""),
        ),
      ),
    );
    if (state.kids.length)
      app.append(
        el("p", {}, "Pick your name for spelling, Bible verses, and your progress."),
        el(
          "div",
          { class: "roster" },
          state.kids.map((k, i) =>
            button(
              [
                el("span", { class: "tile", "aria-hidden": "true" }, [...k.name][0]?.toUpperCase() || "?"),
                el(
                  "span",
                  { class: "who" },
                  el("span", { class: "name" }, k.name),
                  el("span", { class: "grade" }, k.grade ? "Grade " + k.grade : "No grade set"),
                ),
              ],
              () => selectKid(k),
              "kid tone-" + (i % 4),
            ),
          ),
        ),
      );
    else
      app.append(
        el(
          "div",
          { class: "section" },
          el("div", { class: "section-title" }, el("h2", {}, "Add your first kid")),
          el(
            "p",
            {},
            state.parent
              ? "Add a first name or nickname. Then add this week’s spelling words and a Bible verse."
              : "Ask a parent to unlock Parent mode and add a profile.",
          ),
          state.parent
            ? button("+ Add your first kid", () => editKid())
            : button("Unlock Parent mode", unlock),
        ),
      );
    if (state.parent)
      app.append(
        el(
          "div",
          { class: "row" },
          button("Manage family & settings", () => parentHome(), "secondary"),
          identity.signedIn() ? button("Choose another family", () => landing(), "quiet") : null,
        ),
      );
    return;
  }
  if (tab === "Spelling") spellingHome();
  else if (tab === "Bible Verses") verseHome();
  else if (tab === "Progress") progressHome();
}
function modal(title, content) {
  const d = el(
    "dialog",
    { "aria-label": title },
    el(
      "div",
      { class: "row spread" },
      el("h2", {}, title),
      button(icon("close", { label: "Close" }), () => d.close(), "quiet"),
    ),
    content,
  );
  if (content?.tagName === "FORM") {
    content.classList.add("sheet-form");
    let actions = content.querySelector(":scope > .form-actions");
    if (!actions) {
      const submit = content.querySelector(":scope > button[type=submit]");
      if (submit) {
        actions = el("div", { class: "row form-actions" }, submit);
        content.append(actions);
      }
    }
    if (!content.querySelector(":scope > .sheet-body")) {
      const body = el("div", { class: "sheet-body" });
      [...content.children].filter((n) => n !== actions).forEach((n) => body.append(n));
      content.prepend(body);
    }
  }
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
async function openFamily(code) {
  parentPage = false;
  const previous = familyCode;
  familyCode = code.trim();
  kid = null;
  try {
    await reload();
  } catch (err) {
    familyCode = previous;
    throw err;
  }
  rememberFamily(familyCode);
  history.replaceState({}, "", "/");
  render();
}
// Live state stays in the shell; features receive explicit shared edges.
const context = {
  verseMasteryCopy,
  newRound,
  reduce,
  roundDone,
  roundBusy,
  newLearnWord,
  advanceLearn,
  icon,
  deviceSettings,
  setDeviceSettings,
  supportsHaptics,
  onScreenKeyboard,
  previewSound,
  $,
  app,
  get familyCode() {
    return familyCode;
  },
  set familyCode(value) {
    familyCode = value;
  },
  rememberFamily,
  familyFetch,
  get state() {
    return state;
  },
  set state(value) {
    state = value;
  },
  get kid() {
    return kid;
  },
  set kid(value) {
    kid = value;
  },
  get tab() {
    return tab;
  },
  set tab(value) {
    tab = value;
  },
  get parentPage() {
    return parentPage;
  },
  set parentPage(value) {
    parentPage = value;
  },
  get parentSection() {
    return parentSection;
  },
  set parentSection(value) {
    parentSection = value;
  },
  get viewVersion() {
    return viewVersion;
  },
  set viewVersion(value) {
    viewVersion = value;
  },
  el,
  toast,
  button,
  api,
  focus,
  titleDate,
  today,
  field,
  input,
  textArea,
  reload,
  header,
  shell,
  practiceBand,
  exitButton,
  roundCells,
  niceDate,
  practiceField,
  dockKeyboard,
  render,
  modal,
  openFamily,
  get cloudVoice() { return cloudVoice; },
  get resetSpeechCooldown() { return resetSpeechCooldown; },
  get stopSpeaking() {
    return stopSpeaking;
  },
  get prefetchSpeech() {
    return prefetchSpeech;
  },
  get say() {
    return say;
  },
  get shuffled() {
    return shuffled;
  },
  get landing() {
    return landing;
  },
  get editList() {
    return editList;
  },
  get editVerse() {
    return editVerse;
  },
  get archive() {
    return archive;
  },
  get clearView() {
    return clearView;
  },
  get codeCard() {
    return codeCard;
  },
  get identity() {
    return identity;
  },
  get sharing() {
    return sharing;
  },
};
const {
  unlockSpeechPlayer,
  cloudVoice,
  clearSpeechCache,
  stopSpeaking,
  browserSay,
  cloudClip,
  prefetchSpeech,
  clip,
  say,
  resetSpeechCooldown,
} = createSpeech(context);
const {
  listActions,
  listCard,
  listRow,
  spellingHome,
  reviewDay,
  wordSheet,
  shuffled,
  startLearning,
  renderCue,
  learnStageIndicator,
  learnToTest,
  learnStep,
  finishLearning,
  startSpelling,
  spellingStep,
  finishSpelling,
} = createSpellingUI(context);
const { verseHome, verseCard, verseMenu, versePractice } = createVerseUI(context);
const { wordBankView, progressHome, table, drawChart } = createProgressUI(context);
const { learnDemo, landing, privacy } = createWelcomeUI(context);
const {
  unlock,
  formDialog,
  editList,
  editVerse,
  archive,
  editKid,
  parentHome,
  assistantControls,
  parentPractice,
  deviceControls,
  downloadBackup,
  clearView,
  familyControls,
  changePin,
  deleteFamily,
  codeCard,
} = createParentUI(context);
const identity = createIdentityUI({
  el,
  button,
  field,
  input,
  modal,
  toast,
  app,
  current: () => ({ state, familyCode }),
  openFamily,
  landing,
  refresh: async () => {
    if (familyCode) {
      await api("/api/parent/lock", {}).catch(() => {});
      await identity.init();
      await reload();
      parentPage = false;
      render();
    } else landing();
  },
});
const sharing = createSharingUI({
  el,
  button,
  field,
  input,
  textArea,
  modal,
  toast,
  api,
  app,
  current: () => ({ state, kid, familyCode }),
  reload,
  unlock,
  openFamily,
  rememberFamily,
  clearView,
  goPractice: () => {
    parentPage = false;
    history.replaceState({}, "", "/");
    render();
  },
});
(async () => {
  await identity.init();
  const authReturn = new URLSearchParams(location.search).get("auth");
  const signedInReturn = new URLSearchParams(location.search).has("signedIn");
  if (signedInReturn || authReturn) {
    history.replaceState({}, "", "/");
    landing();
    await identity.finishSignIn(authReturn);
    return;
  }
  const publicMatch = location.pathname.match(/^\/(s|c)\/([A-Za-z0-9_-]+)\/?$/);
  if (publicMatch) {
    await sharing.publicPage(publicMatch[1], publicMatch[2]);
    return;
  }
  if (location.pathname === "/privacy" || location.pathname === "/privacy/") {
    privacy();
    return;
  }
  const match = location.pathname.match(/^\/f\/([^/]+)\/?$/);
  if (match) {
    let code;
    try {
      code = decodeURIComponent(match[1]);
    } catch {
      landing("", "That join link is invalid. Ask your family for a fresh code.");
      return;
    }
    landing(code);
    return;
  }
  if (!familyCode) {
    landing();
    return;
  }
  try {
    await reload();
    render();
  } catch (e) {
    landing("", e.message + " You can retry your saved family or enter another code.");
  }
})();
window.addEventListener("pagehide", stopSpeaking);
