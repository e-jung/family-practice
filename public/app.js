const $ = (id) => document.getElementById(id);
const app = $("app");
let state = {
    kids: [],
    lists: [],
    verses: [],
    settings: { voice: "en_US-lessac-high", speed: 1 },
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
  const r = await fetch(
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
function stopSpeaking() {
  speechGeneration++;
  if (audio) {
    audio.pause();
    audio = null;
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
      voices.find((v) => v.name === state.settings.voice) ||
      voices.find((v) => v.lang === "en-US" && /Chrome OS US English|Samantha|Ava/i.test(v.name)) ||
      voices.find((v) => v.lang === "en-US" && v.localService) ||
      voices.find((v) => v.lang === "en-US") ||
      null;
    u.lang = "en-US";
    u.rate = Math.max(0.5, Math.min(1.5, state.settings.speed * rate));
    u.onend = u.onerror = resolve;
    cancelPending = resolve;
    speechSynthesis.speak(u);
  });
}
async function clip(text, rate, generation) {
  if (generation !== speechGeneration) return;
  if (state.settings.serverTts === false || Date.now() < cooldown) return browserSay(text, rate, generation);
  const ctrl = new AbortController(),
    timer = setTimeout(() => ctrl.abort(), 3000);
  let objectURL;
  try {
    const r = await fetch(
      "/api/tts?" + new URLSearchParams({ text, voice: state.settings.voice }),
      { signal: ctrl.signal },
    );
    if (!r.ok) throw Error("Piper unavailable");
    const blob = await r.blob();
    clearTimeout(timer);
    if (generation !== speechGeneration) return;
    objectURL = URL.createObjectURL(blob);
    const player = new Audio(objectURL);
    audio = player;
    player.playbackRate = state.settings.speed * rate;
    await new Promise((resolve, reject) => {
      cancelPending = resolve;
      player.onended = resolve;
      player.onerror = reject;
      player.play().catch(reject);
    });
  } catch {
    if (generation === speechGeneration) {
      cooldown = Date.now() + 60000;
      $("voice-status").textContent = "Browser voice active";
      await browserSay(text, rate, generation);
    }
  } finally {
    clearTimeout(timer);
    if (objectURL) URL.revokeObjectURL(objectURL);
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
        el("span", { class: "badge" }, "Welcome home"),
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
    el(
      "div",
      { class: "row" },
      button("Practice", () => startSpelling(l.words, l), ""),
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
    autocapitalize: "none",
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
            stopSpeaking();
            browserSay(`${w.word}. ${[...w.word].join(", ")}. ${w.word}.`, 0.8);
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
                    `${new Date(s.created_at).toLocaleString()} · ${s.title || s.kind} · ${s.completed ? "Complete" : "In progress"}`,
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
            ["When", "Word", "Typed", "Correct", "First try"],
            p.attempts
              .slice(0, 100)
              .map((a) => [
                new Date(a.created_at).toLocaleString(),
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
    [field("Name", name), field("Grade", grade)],
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
        state.kids.map((k) =>
          button("Edit " + k.name, () => editKid(k), "secondary"),
        ),
        button("+ Add kid", () => editKid()),
      ),
    ),
  );
  const browserOnly = state.settings.serverTts === false;
  const voiceNames = () => browserOnly
    ? [...new Set((window.speechSynthesis?.getVoices() || []).filter(v => /^en(?:-|$)/i.test(v.lang)).map(v => v.name))]
    : state.settings.voices;
  const voice = el(
      "select",
      { id: "voice" },
      ["", ...voiceNames()].filter((v,i) => browserOnly || i > 0).map((v) =>
        el("option", { value: v, selected: v === state.settings.voice }, v || "Automatic · best US English"),
      ),
    ),
    speed = input("speed", state.settings.speed, {
      type: "number",
      min: 0.5,
      max: 1.5,
      step: 0.05,
      required: true,
    });
  if (browserOnly && window.speechSynthesis) {
    const refreshVoices = () => {
      const selected = voice.value || state.settings.voice;
      voice.replaceChildren(...["", ...voiceNames()].map(v => el("option", {value:v, selected:v===selected}, v || "Automatic · best US English")));
    };
    speechSynthesis.addEventListener("voiceschanged", refreshVoices, {once:true});
  }
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
          await reload();
          toast(browserOnly ? "Browser voice saved." : "Voice saved. Clips are warming up.");
        } catch (err) {
          toast(err.message);
        }
      },
    },
    field(browserOnly ? "Browser voice" : "Piper voice", voice),
    field("Speech speed · 0.5 slow to 1.5 fast", speed),
    el(
      "p",
      { class: "muted" },
      browserOnly ? "Uses this device’s English voices. Automatic prefers Chrome OS US English, Samantha, or Ava." : "Piper audio uses playback speed. If Piper takes more than 3 seconds, your browser’s English voice takes over.",
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
      button(
        browserOnly ? "Refresh browser voices" : "Check Piper",
        async () => {
          if (browserOnly) {
            const selected = voice.value;
            voice.replaceChildren(...["", ...voiceNames()].map(v => el("option", {value:v, selected:v===selected}, v || "Automatic · best US English")));
            return;
          }
          const s = await api("/api/tts/status");
          toast(
            `${s.reachable ? "Piper reachable" : "Piper unavailable"} · ${s.cached} cached clips · ${s.queued} queued`,
          );
        },
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
        el(
          "a",
          { class: "link-button secondary", href: "/api/admin/export" },
          "Export JSON",
        ),
        el(
          "a",
          {
            class: "link-button secondary",
            href: "/api/admin/export?format=csv",
          },
          "Export CSV",
        ),
      ),
      field("Restore a JSON backup", upload),
      el(
        "p",
        { class: "notice" },
        `Import replaces all current family data. Export a backup first. Files are limited to ${state.settings.serverTts === false ? 8 : 32} MB.`,
      ),
      button(
        "Import backup",
        async () => {
          const f = upload.files[0];
          if (!f) throw Error("Choose a JSON backup first.");
          const limitMB = state.settings.serverTts === false ? 8 : 32;
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
(async () => {
  try {
    await reload();
    render();
    api("/api/tts/status")
      .then((s) => {
        if (s.reachable === false) {
          cooldown = Date.now() + Math.max(1, s.retryAfter) * 1000;
          $("voice-status").textContent = "Browser voice active";
        } else $("voice-status").textContent = `${s.cached} audio clips ready`;
      })
      .catch(() => {});
  } catch (e) {
    app.replaceChildren(
      el("h1", {}, "We couldn’t load practice."),
      el("p", {}, e.message),
      button("Try again", () => location.reload()),
    );
  }
})();
window.addEventListener("pagehide", stopSpeaking);
