// DOM edge: the shell supplies live app state and cross-feature actions.
export function createSpellingUI(ctx) {
  function listActions(l, small = false) {
    const size = small ? " small" : "";
    return ctx.el(
      "div",
      { class: "row" },
      ctx.button("Learn", () => startLearning(l.words, l), size.trim()),
      ctx.button("Test", () => startSpelling(l.words, l), "secondary" + size),
      ctx.button("View words", () => wordSheet(l), "quiet" + size),
      ctx.state.parent ? ctx.button("Edit", () => ctx.editList(l), "quiet small") : null,
      ctx.state.parent ? ctx.button("Share", () => ctx.sharing.shareList(l), "quiet small") : null,
      ctx.state.parent
        ? ctx.button(l.archived ? "Restore" : "Archive", () => ctx.archive("lists", l), "quiet small")
        : null,
    );
  }
  function listCard(l) {
    return ctx.el(
      "section",
      { class: "packet", "data-tone": "spelling" },
      ctx.el(
        "div",
        { class: "packet-strip" },
        ctx.el("h2", {}, l.title),
        ctx.el("span", { class: "band-meta" }, l.words.length + " words"),
      ),
      ctx.el(
        "div",
        { class: "packet-body" },
        ctx.el(
          "p",
          {},
          `${ctx.niceDate(l.date)}${l.sample ? " · sample list" : ""}. New this week? Learn the words first, then take the test.`,
        ),
        ctx.sharing.sourceMeta(l),
        listActions(l),
      ),
    );
  }
  function listRow(l) {
    return ctx.el(
      "article",
      { class: "item" },
      ctx.el(
        "div",
        {},
        ctx.el("h3", {}, l.title),
        ctx.el(
          "span",
          { class: "meta" },
          `${l.words.length} words · ${ctx.niceDate(l.date)}${l.archived ? " · archived" : ""}`,
        ),
      ),
      ctx.sharing.sourceMeta(l),
      listActions(l, true),
    );
  }
  function spellingHome() {
    const active = ctx.state.lists.filter((l) => !l.archived);
    const updates = ctx.el("section", { class: "section sharing-updates", "aria-live": "polite" });
    ctx.app.append(updates);
    ctx.sharing.newWeeks(updates, ctx.kid.id);
    if (ctx.state.parent)
      ctx.app.append(
        ctx.el(
          "div",
          { class: "row spread section" },
          ctx.el("p", { class: "muted" }, "Parent mode: add or edit this week’s words."),
          ctx.button("+ Add spelling list", () => ctx.editList()),
        ),
      );
    if (!active.length)
      ctx.app.append(
        ctx.el(
          "div",
          { class: "section" },
          ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "No spelling list yet")),
          ctx.el(
            "p",
            {},
            "A parent can add this week’s words in Parent mode. Paste one word per line, with an optional sentence.",
          ),
        ),
      );
    if (active[0]) ctx.app.append(listCard(active[0]));
    const review = ctx.el(
      "section",
      { class: "section", "aria-label": "Spaced review" },
      ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "Review")),
      ctx.el("p", {}, "Checking your word bank…"),
    );
    ctx.app.append(review);
    const view = ctx.viewVersion,
      id = ctx.kid.id;
    ctx
      .api("/api/review?kid=" + id)
      .then((bank) => {
        if (view !== ctx.viewVersion || ctx.kid?.id !== id) return;
        review.replaceChildren(
          ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "Review")),
          bank.due.length
            ? ctx.el(
                "div",
                { class: "review-entry" },
                ctx.el(
                  "div",
                  {},
                  ctx.el("h3", {}, `${bank.dueCount ?? bank.due.length} words due today`),
                  ctx.el(
                    "p",
                    { class: "muted" },
                    "A few familiar words, just when you need them. Up to 15 in a round.",
                  ),
                ),
                ctx.button(
                  "Start review",
                  () =>
                    startSpelling(
                      bank.due.map((w) => ({ ...w, id: w.word_id })),
                      null,
                      "review",
                    ),
                  "primary",
                ),
              )
            : ctx.el(
                "p",
                {},
                bank.nextDue
                  ? "Nothing due — next review " + reviewDay(bank.nextDue)
                  : "Nothing due — learn or test some words to begin.",
              ),
        );
      })
      .catch((err) => {
        if (view === ctx.viewVersion)
          review.replaceChildren(
            ctx.el("h2", {}, "Review"),
            ctx.el("p", {}, err.message),
            ctx.button("Try again", ctx.render, "secondary"),
          );
      });
    if (active.length > 1)
      ctx.app.append(
        ctx.el(
          "div",
          { class: "section" },
          ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "Past weeks")),
          ctx.el("div", { class: "rows" }, active.slice(1).map(listRow)),
        ),
      );
    if (ctx.state.parent && ctx.state.lists.some((l) => l.archived))
      ctx.app.append(
        ctx.el(
          "details",
          {},
          ctx.el("summary", {}, "Archived lists"),
          ctx.el("div", { class: "rows" }, ctx.state.lists.filter((l) => l.archived).map(listRow)),
        ),
      );
  }
  function reviewDay(day) {
    return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  }
  function wordSheet(l) {
    ctx.shell();
    ctx.app.append(
      ctx.el(
        "section",
        { class: "print-sheet section" },
        ctx.el(
          "div",
          { class: "section-title" },
          ctx.el("h2", {}, l.title),
          ctx.el("span", { class: "muted" }, ctx.kid.name + " · " + ctx.niceDate(l.date)),
        ),
        ctx.el(
          "ol",
          {},
          l.words.map((w) =>
            ctx.el(
              "li",
              {},
              ctx.el("strong", {}, w.word),
              w.sentence ? ctx.el("div", { class: "muted" }, w.sentence) : null,
            ),
          ),
        ),
        ctx.el(
          "div",
          { class: "row form-actions" },
          ctx.button("Print", () => window.print()),
          ctx.button("Back", ctx.render, "secondary"),
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
  async function startLearning(ws, list) {
    const view = ctx.viewVersion;
    try {
      const session = await ctx.api("/api/sessions", {
        kid_id: ctx.kid.id,
        list_id: list.id,
        word_ids: ws.map((w) => w.id),
        kind: "learn",
      });
      if (view !== ctx.viewVersion) return;
      const round = { ws: [...ws], list, session: session.id, index: 0, comparisons: 0 };
      round.learning = ctx.newLearnWord(ws[0].word);
      learnStep(round);
    } catch (err) {
      ctx.toast(err.message);
    }
  }
  function renderCue(node, text) {
    // Size the letters so even a long word stays on one line.
    node.style.setProperty("--n", Math.max(6, text.split(" ").length));
    node.replaceChildren(
      ...text.split(" ").map((c) => ctx.el("span", { class: c === "_" ? "blank" : "" }, c === "_" ? " " : c)),
    );
  }
  function learnStageIndicator(learning, jump) {
    const labels = learning.steps.map(
      (step) => ({ 0: "Copy", 50: "Fade", 75: "Fade more", 100: "Recall" })[step.level],
    );
    return ctx.el(
      "div",
      { class: "learn-stage-progress" },
      ctx.el(
        "p",
        { class: "stage-caption" },
        `Stage ${learning.index + 1} of ${labels.length} · ${labels[learning.index]}`,
      ),
      ctx.el(
        "ol",
        { class: "learn-stages", "aria-label": "Stages for this word. Tap a stage to jump to it." },
        labels.map((label, i) => {
          const stageState =
            i === learning.index ? "current" : learning.completed.includes(i) ? "complete" : "";
          const sr =
            i === learning.index
              ? " · you are here"
              : learning.completed.includes(i)
                ? " · complete"
                : i < learning.index
                  ? " · skipped"
                  : " · jump here";
          const body = [
            ctx.el(
              "span",
              { class: "stage-number", "aria-hidden": "true" },
              learning.completed.includes(i) ? "✓" : i + 1,
            ),
            ctx.el("span", {}, label),
            ctx.el("span", { class: "visually-hidden" }, sr),
          ];
          return ctx.el(
            "li",
            { class: stageState, "aria-current": i === learning.index ? "step" : null },
            i === learning.index
              ? ctx.el("span", { class: "stage-tab" }, ...body)
              : ctx.button(body, () => jump(i), "stage-tab"),
          );
        }),
      ),
    );
  }
  async function learnToTest(round) {
    const view = ctx.viewVersion;
    // Record every unlearned word we pass over, without turning it into a win.
    for (const w of round.ws.slice(round.index + (round.learning.learned ? 1 : 0))) {
      await ctx.api("/api/attempts", {
        session_id: round.session,
        word_id: w.id,
        typed: "",
        mode: "learn",
        step: "skip",
      });
      if (view !== ctx.viewVersion) return;
    }
    await ctx.api("/api/sessions/complete", { session_id: round.session, abandoned: true });
    if (view !== ctx.viewVersion) return;
    startSpelling(round.ws, round.list);
  }
  function learnStep(round) {
    ctx.shell("practice", "spelling");
    const view = ctx.viewVersion,
      w = round.ws[round.index],
      step = round.learning.steps[round.learning.index];
    const answer = ctx.practiceField(
      ctx.input("learn-answer", "", {
        class: "answer",
        autocomplete: "off",
        inputmode: "text",
        autocapitalize: "off",
        autocorrect: "off",
        spellcheck: "false",
        enterkeyhint: "done",
        "aria-label": "Type the full word",
      }),
    );
    const cue = ctx.el("p", {
      class: "cue",
      "aria-label":
        step.level === 100 ? "No letter clues" : "Letter clues: " + step.cue.replaceAll("_", "blank"),
    });
    renderCue(cue, step.cue);
    const feedback = ctx.el("p", { class: "feedback", role: "status", "aria-live": "polite" });
    let done = false,
      comparisonTimer;
    const check = ctx.el("button", { type: "submit", form: "practice-form", class: "primary" }, "Check word");
    const continueButton = ctx.button(
      "Continue",
      async () => {
        clearTimeout(comparisonTimer);
        if (round.learning.learned) {
          if (round.index + 1 === round.ws.length) return finishLearning(round);
          round.index++;
          round.learning = ctx.newLearnWord(round.ws[round.index].word);
        }
        learnStep(round);
      },
      "primary",
    );
    continueButton.hidden = true;
    const form = ctx.el(
      "form",
      {
        id: "practice-form",
        onsubmit: async (e) => {
          e.preventDefault();
          if (done || check.disabled) return;
          check.disabled = true;
          try {
            const result = await ctx.api("/api/attempts", {
              session_id: round.session,
              word_id: w.id,
              typed: answer.value,
              mode: "learn",
              level: step.level,
            });
            if (view !== ctx.viewVersion) return;
            round.learning = ctx.advanceLearn(round.learning, result.correct);
            done = true;
            answer.disabled = true;
            check.hidden = true;
            continueButton.hidden = false;
            if (result.correct) {
              feedback.textContent = round.learning.learned
                ? "Learned! You spelled it with no clues."
                : "Yes! Let’s try with fewer clues.";
              feedback.className = "feedback good";
              ctx.focus(continueButton);
            } else {
              round.comparisons++;
              renderCue(cue, [...w.word].join(" "));
              cue.classList.add("reveal");
              feedback.textContent = "Compare: " + w.word + ". Then retry this stage.";
              feedback.className = "feedback retry";
              continueButton.disabled = true;
              comparisonTimer = setTimeout(() => {
                if (view !== ctx.viewVersion) return;
                renderCue(cue, round.learning.steps[round.learning.index].cue);
                cue.classList.remove("reveal");
                continueButton.disabled = false;
                ctx.focus(continueButton);
              }, 1800);
              ctx.say(w.word);
            }
          } catch (err) {
            ctx.toast(err.message);
            check.disabled = false;
          }
        },
      },
      ctx.el("label", { for: "learn-answer", class: "visually-hidden" }, "Type the full word"),
      answer,
      feedback,
    );
    const actions = ctx.el("span", { class: "key-actions" }, check, continueButton);
    const prompt =
      step.level === 0
        ? "Listen, then copy the word"
        : step.level === 100
          ? "Now spell it from memory"
          : "Type the whole word, hidden letters too";
    ctx.app.append(
      ctx.practiceBand({
        title: round.list?.title || "Learn",
        status: `Learn · word ${round.index + 1} of ${round.ws.length}`,
        cells: ctx.roundCells(
          round.ws.length,
          round.index,
          round.ws.map((_, i) => (i < round.index ? "done" : "")),
        ),
        exit: ctx.exitButton("End learning", () => {
          if (confirm("Leave learning? Your attempts will still be saved.")) ctx.render();
        }),
      }),
      ctx.el(
        "section",
        { class: "desk" },
        ctx.el("h2", {}, prompt),
        learnStageIndicator(round.learning, async (i) => {
          clearTimeout(comparisonTimer);
          // Jumping ahead is a skip: logged, never credited as learning.
          if (i > round.learning.index) {
            await ctx.api("/api/attempts", {
              session_id: round.session,
              word_id: w.id,
              typed: "",
              mode: "learn",
              step: "skip",
            });
            if (view !== ctx.viewVersion) return;
          }
          round.learning = { ...round.learning, index: i, learned: false };
          learnStep(round);
        }),
        cue,
        ctx.el(
          "div",
          { class: "listen" },
          ctx.button(
            [ctx.icon("speaker"), "Say again"],
            () => ctx.say([w.word, w.sentence, w.word]),
            "secondary",
          ),
        ),
        ctx.el(
          "div",
          { class: "learn-shortcuts" },
          ctx.button("I know these — start the test", () => learnToTest(round), "quiet"),
        ),
        form,
      ),
    );
    if (!ctx.dockKeyboard({ target: () => answer, action: actions })) form.append(actions);
    ctx.focus(answer);
    ctx.say([w.word, w.sentence, w.word]);
    ctx.prefetchSpeech(
      round.ws.slice(round.index, round.index + 2).flatMap((word) => [word.word, word.sentence]),
    );
  }
  async function finishLearning(round) {
    const view = ctx.viewVersion;
    await ctx.api("/api/sessions/complete", { session_id: round.session });
    if (view !== ctx.viewVersion) return;
    ctx.shell("practice", "spelling");
    ctx.app.append(
      ctx.practiceBand({
        title: round.list?.title || "Learn",
        status: "Learning complete",
        cells: ctx.roundCells(
          round.ws.length,
          -1,
          round.ws.map(() => "done"),
        ),
        exit: ctx.exitButton("Done", ctx.render),
      }),
      ctx.el(
        "section",
        { class: "desk" },
        ctx.el("h1", {}, "Ready to try on your own!"),
        ctx.el(
          "p",
          {},
          `${round.ws.length} words learned · ${round.comparisons} compare-and-try-again moments.`,
        ),
        ctx.el(
          "p",
          { class: "muted" },
          "Learning is practice. Only first tries in Test count toward spelling accuracy.",
        ),
        ctx.el(
          "div",
          { class: "row form-actions" },
          ctx.button("Take the test now", () => startSpelling(round.ws, round.list), "primary"),
          ctx.button("Back to lists", ctx.render, "secondary"),
        ),
      ),
    );
  }
  async function startSpelling(ws, list = null, kind = "spelling") {
    ctx.shell("practice", "spelling");
    const shuffle = ctx.input("shuffle", "", { type: "checkbox", checked: true });
    const title = list?.title || (kind === "tricky" ? "Tricky words" : "Review round");
    ctx.app.append(
      ctx.practiceBand({
        title,
        status:
          (kind === "review" ? "Review" : kind === "tricky" ? "Tricky words" : "Spelling test") +
          " · " +
          ws.length +
          " words",
        cells: ctx.roundCells(ws.length, -1),
        exit: ctx.exitButton("Back", ctx.render),
      }),
      ctx.el(
        "section",
        { class: "desk intro" },
        ctx.el(
          "h2",
          {},
          kind === "review" ? "Review" : kind === "tricky" ? "Your tricky words" : "Spelling test",
        ),
        ctx.el(
          "p",
          {},
          `${ws.length} words. You’ll hear the word, a sentence, then the word again. You get one retry.`,
        ),
        ctx.el("label", { class: "inline" }, shuffle, "Shuffle the words"),
        ctx.el(
          "div",
          { class: "row form-actions" },
          ctx.button(
            "Let’s begin",
            async () => {
              const view = ctx.viewVersion;
              const ordered = shuffle.checked ? shuffled(ws) : [...ws];
              const session = await ctx.api("/api/sessions", {
                kid_id: ctx.kid.id,
                list_id: list?.id,
                word_ids: ordered.map((w) => w.id),
                kind,
              });
              if (view !== ctx.viewVersion) return;
              spellingStep(ctx.newRound(ordered, { list, kind, session: session.id }));
            },
            "primary",
          ),
        ),
      ),
    );
  }
  function spellingStep(round) {
    ctx.shell("practice", "spelling");
    const view = ctx.viewVersion;
    const w = round.ws[round.index];

    const answer = ctx.practiceField(
      ctx.input("answer", "", {
        class: "answer",
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        inputmode: "text",
        enterkeyhint: "done",
        spellcheck: "false",
        "aria-label": "Type the spelling word",
      }),
    );
    const feedback = ctx.el("p", { class: "feedback", role: "status", "aria-live": "polite" });
    const check = ctx.el("button", { type: "submit", form: "practice-form", class: "primary" }, "Check word");
    const replay = () => ctx.say([w.word, w.sentence, w.word]);
    const band = () =>
      ctx.practiceBand({
        title: round.list?.title || (round.kind === "tricky" ? "Tricky words" : "Review round"),
        status: `Word ${round.index + 1} of ${round.ws.length}`,
        cells: ctx.roundCells(round.ws.length, round.index, round.results),
        exit: ctx.exitButton("End practice", () => {
          if (confirm("Leave this round? Your attempts will still be saved.")) {
            round = ctx.reduce(round, { type: "QUIT" });
            ctx.render();
          }
        }),
      });
    const form = ctx.el(
      "form",
      {
        id: "practice-form",
        onsubmit: async (e) => {
          e.preventDefault();
          if (check.disabled || ctx.roundBusy(round)) return;
          if (ctx.roundDone(round)) {
            check.disabled = true;
            try {
              if (round.index + 1 === round.ws.length) await finishSpelling(round);
              else {
                round = ctx.reduce(round, { type: "NEXT" });
                spellingStep(round);
              }
            } catch (err) {
              ctx.toast(err.message);
            } finally {
              check.disabled = false;
            }
            return;
          }
          round = ctx.reduce(round, { type: "SUBMIT" });
          check.disabled = ctx.roundBusy(round);
          try {
            const result = await ctx.api("/api/attempts", {
              session_id: round.session,
              word_id: w.id,
              typed: answer.value,
            });
            if (view !== ctx.viewVersion) return;
            const retry = round.phase === "checking-retry";
            round = ctx.reduce(round, { type: "RESULT", correct: result.correct });
            if (result.correct) {
              feedback.textContent = retry ? "You got it. Nice persistence!" : "Yes! First-try success!";
              feedback.className = "feedback good";
            } else if (!retry) {
              feedback.textContent = "Almost. Listen once more and try again.";
              feedback.className = "feedback retry";
              answer.select();
              ctx.say(w.word);
            } else {
              feedback.textContent = "Let’s learn it: " + w.word;
              feedback.className = "feedback retry";

              ctx.say(`${w.word}. ${[...w.word].join(", ")}. ${w.word}.`, 0.8);
            }
            if (ctx.roundDone(round)) {
              answer.disabled = ctx.roundDone(round);
              ctx.app.querySelector(".practice-band").replaceWith(band());
              check.textContent = round.index === round.ws.length - 1 ? "See my results" : "Next word";
              ctx.focus(check);
            } else ctx.focus(answer);
          } catch (err) {
            round = ctx.reduce(round, { type: "ERROR" });
            ctx.toast(err.message);
          } finally {
            check.disabled = ctx.roundBusy(round);
          }
        },
      },
      ctx.el("label", { for: "answer", class: "visually-hidden" }, "Type the word you hear"),
      answer,
      feedback,
    );
    ctx.app.append(
      band(),
      ctx.el(
        "section",
        { class: "desk" },
        ctx.el("h2", {}, "Listen, then spell"),
        ctx.el(
          "div",
          { class: "listen" },
          ctx.button([ctx.icon("speaker"), "Say again"], replay, "secondary"),
          ctx.button(
            [ctx.icon("sentence"), "Sentence"],
            () => (w.sentence ? ctx.say(w.sentence) : ctx.toast("This word has no sentence.")),
            "secondary",
          ),
          ctx.button([ctx.icon("slow"), "Slowly"], () => ctx.say(w.word, 0.75), "secondary"),
        ),
        form,
      ),
    );
    if (!ctx.dockKeyboard({ target: () => answer, action: check }))
      form.append(check, ctx.el("span", { class: "enter-hint" }, "or press Enter"));
    ctx.focus(answer);
    replay();
    // Warm this word and the next word (including their sentences), then one ahead.
    ctx.prefetchSpeech(
      round.ws.slice(round.index, round.index + 2).flatMap((word) => [word.word, word.sentence]),
    );
  }
  async function finishSpelling(r) {
    const view = ctx.viewVersion;
    await ctx.api("/api/sessions/complete", { session_id: r.session });
    if (view !== ctx.viewVersion) return;
    r = ctx.reduce(r, { type: "NEXT" });
    ctx.shell("practice", "spelling");
    ctx.app.append(
      ctx.practiceBand({
        title: r.list?.title || "Review round",
        status: "Round complete",
        cells: ctx.roundCells(r.ws.length, -1, r.results),
        exit: ctx.exitButton("Done", ctx.render),
      }),
      ctx.el(
        "section",
        { class: "desk" },
        ctx.el("h1", {}, "Look at you grow!"),
        ctx.el("div", { class: "score" }, `${r.first} / ${r.ws.length}`),
        ctx.el("p", {}, "Words spelled correctly on the first try."),
        r.misses.length
          ? ctx.el(
              "div",
              {},
              ctx.el("h3", {}, "A little more practice"),
              ctx.el(
                "p",
                { class: "comparison" },
                r.misses.map((w) => ctx.el("span", { class: "miss" }, w.word)),
              ),
              ctx.button("Practice missed words", () => startSpelling(r.misses, r.list, r.kind), "primary"),
            )
          : ctx.el("p", {}, "Every word was a first-try win."),
        ctx.el(
          "div",
          { class: "row form-actions" },
          ctx.button("Back to spelling", ctx.render, "secondary"),
          ctx.button(
            "See progress",
            () => {
              ctx.tab = "Progress";
              ctx.render();
            },
            "secondary",
          ),
        ),
      ),
    );
  }

  return {
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
  };
}
