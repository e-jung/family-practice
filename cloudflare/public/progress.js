// DOM edge: the shell supplies live app state and cross-feature actions.
export function createProgressUI(ctx) {
  const practiceDate = date => new Date(date).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  function wordBankView(bank) {
    if (!bank) return ctx.el("p", {}, "Take a test or learn a word to start your word bank.");
    const rows = (items, empty) =>
      items.length
        ? ctx.el(
            "ul",
            { class: "rows word-bank-rows" },
            items
              .slice(0, 8)
              .map((w) =>
                ctx.el(
                  "li",
                  {},
                  ctx.el("strong", {}, w.word || w.display_word),
                  ctx.el(
                    "span",
                    { class: "meta" },
                    ctx.state.parent
                      ? `Box ${w.box} · due ${ctx.niceDate(w.due_date || w.due)} · ${w.misses} misses`
                      : `${w.misses} ${w.misses === 1 ? "miss" : "misses"}`,
                  ),
                ),
              ),
          )
        : ctx.el("p", { class: "muted" }, empty);
    return ctx.el(
      "div",
      {},
      ctx.el(
        "dl",
        { class: "bank-counts" },
        [
          ["Learning", bank.counts.learning, "Boxes 1–2"],
          ["Getting it", bank.counts.gettingIt, "Boxes 3–4"],
          ["Mastered", bank.counts.mastered, "Boxes 5–6"],
        ].map(([label, n, boxes]) =>
          ctx.el("div", {}, ctx.el("dt", {}, label), ctx.el("dd", {}, n), ctx.el("small", {}, boxes)),
        ),
      ),
      ctx.el(
        "p",
        { class: "muted bank-explainer" },
        "Right on the first try? Your word moves up. More time between reviews as it grows: 1, 2, 4, 7, 14, then 30 days.",
      ),
      ctx.el("h3", {}, "A little extra practice"),
      rows(bank.struggling, "No struggling words right now."),
      ctx.el("h3", {}, "Due soon"),
      rows(bank.dueSoon, "Nothing coming up yet."),
      ctx.state.parent && bank.words.length
        ? ctx.el(
            "details",
            {},
            ctx.el("summary", {}, "Parent detail · all words"),
            table(
              ["Word", "Box", "Due (UTC)"],
              bank.words.map((w) => [w.word || w.display_word, w.box, w.due_date || w.due]),
            ),
          )
        : null,
    );
  }
  async function progressHome() {
    const k = ctx.kid.id,
      view = ctx.viewVersion;
    ctx.app.append(ctx.el("p", { id: "progress-loading" }, "Gathering your growth…"));
    try {
      const p = await ctx.api("/api/progress?kid=" + k);
      if (ctx.kid?.id !== k || ctx.tab !== "Progress" || view !== ctx.viewVersion) return;
      ctx.$("progress-loading")?.remove();
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      ctx.app.append(
        ctx.el(
          "p",
          { class: "summary-line" },
          `${plural(p.listsCompleted, "list", "lists")}` +
            ` completed · ${plural(p.streak, "day", "days")}` +
            ` in a row · ${plural(p.wordBank?.dueCount ?? p.wordBank?.due.length ?? 0, "word", "words")}` +
            ` ready for review.`,
          ctx.el("small", {}, "Practice days use UTC."),
        ),
      );
      ctx.app.append(
        ctx.el(
          "div",
          { class: "section" },
          ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "First-try spelling accuracy")),
          p.charts.length
            ? drawChart(p.charts)
            : ctx.el(
                "p",
                {},
                "Take a spelling test and your first-try accuracy for each list shows up here.",
              ),
          p.learning
            ? ctx.el(
                "p",
                { class: "muted" },
                `Learn practice, kept separate from test scores: ${p.learning.wordsLearned}` +
                  ` words learned · ${p.learning.attempts}` +
                  ` fading-cue attempts · ${p.learning.skips || 0}` +
                  ` skips · ${p.learning.sessionsCompleted}` +
                  ` completed rounds.`,
              )
            : null,
        ),
      );
      if (ctx.state.parent && p.learnAttempts?.length)
        ctx.app.append(
          ctx.el(
            "details",
            {},
            ctx.el("summary", {}, "Parent detail · recent Learn attempts"),
            table(
              ["Word", "Letters hidden", "Typed", "Correct"],
              p.learnAttempts
                .slice(0, 100)
                .map((a) => [
                  a.word,
                  a.step === "skip" ? "Skipped" : a.step + "%",
                  a.typed,
                  a.correct ? "Yes" : "Compare",
                ]),
            ),
          ),
        );
      ctx.app.append(
        ctx.el(
          "div",
          { class: "two" },
          ctx.el(
            "div",
            { class: "section" },
            ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "Word bank")),
            wordBankView(p.wordBank),
          ),
          ctx.el(
            "div",
            { class: "section" },
            ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "Verse garden")),
            p.mastery.length
              ? ctx.el(
                  "ul",
                  { class: "rows" },
                  p.mastery.map((v) =>
                    ctx.el(
                      "li",
                      {},
                      ctx.el("strong", {}, v.reference),
                      ctx.el(
                        "span",
                        { class: "stars", role: "img", "aria-label": `${v.stars} of 3 stars` },
                        [0, 1, 2].map((i) => ctx.icon("star", { filled: i < v.stars })),
                      ),
                      ctx.el(
                        "span",
                        { class: "meta" },
                        `Best ${v.best}% of the last 10 · ${v.attempts} ${v.attempts === 1 ? "practice" : "practices"}`,
                      ),
                    ),
                  ),
                )
              : ctx.el("p", {}, "Practice a verse to start growing stars."),
            ctx.el("small", {}, ctx.verseMasteryCopy()),
          ),
        ),
      );
      ctx.app.append(
        ctx.el(
          "div",
          { class: "section" },
          ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "Recent practice")),
          p.sessions.length
            ? ctx.el(
                "ul",
                { class: "rows" },
                p.sessions
                  .slice(0, 12)
                  .map((s) =>
                    ctx.el(
                      "li",
                      {},
                      ctx.el(
                        "span",
                        {},
                        s.kind === "verse"
                          ? ctx.el("strong", {}, "Verse practice")
                          : [
                              ctx.el(
                                "strong",
                                {},
                                s.kind === "learn" ? "Learn" : s.kind === "review" ? "Review" : "Test",
                              ),
                              " · ",
                              s.title || (s.kind === "review" ? "Word bank" : "Tricky words"),
                            ],
                      ),
                      ctx.el(
                        "span",
                        { class: "meta" },
                        `${practiceDate(s.created_at)}` +
                          ` · ${s.completed ? "Complete" : "In progress"}` +
                          ``,
                      ),
                    ),
                  ),
              )
            : ctx.el("p", {}, "Your first practice can be today."),
        ),
      );
      if (ctx.state.parent) {
        ctx.app.append(
          ctx.el(
            "details",
            {},
            ctx.el("summary", {}, "Parent detail · recent spelling attempts"),
            table(
              ["When", "Mode", "Word", "Typed", "Correct", "First try"],
              p.attempts
                .slice(0, 100)
                .map((a) => [
                  new Date(a.created_at).toLocaleString(),
                  a.mode === "learn"
                    ? a.step === "skip"
                      ? "Learn · skipped"
                      : `Learn · ${a.step}% hidden`
                    : "Test",
                  a.word,
                  a.typed,
                  a.correct ? "Yes" : "Not yet",
                  a.first_try ? "Yes" : "Retry",
                ]),
            ),
          ),
          ctx.el(
            "details",
            {},
            ctx.el("summary", {}, "Parent detail · verse attempts"),
            table(
              ["When", "Verse", "Mode", "Accuracy"],
              p.verseAttempts.map((a) => [
                new Date(a.created_at).toLocaleString(),
                a.verse_reference ||
                  ctx.state.verses.find((v) => v.id === a.verse_id)?.reference ||
                  a.verse_id,
                a.mode,
                a.accuracy + "%",
              ]),
            ),
          ),
        );
      }
    } catch (e) {
      ctx.toast(e.message);
    }
  }
  function table(head, rows) {
    return ctx.el(
      "div",
      { class: "scroll" },
      ctx.el(
        "table",
        {},
        ctx.el(
          "thead",
          {},
          ctx.el(
            "tr",
            {},
            head.map((h) => ctx.el("th", { scope: "col" }, h)),
          ),
        ),
        ctx.el(
          "tbody",
          {},
          rows.map((r) =>
            ctx.el(
              "tr",
              {},
              r.map((c) => ctx.el("td", {}, c)),
            ),
          ),
        ),
      ),
    );
  }
  function drawChart(charts) {
    // Bar length is the exact accuracy; the figure is set beside it for reading.
    // CSSOM width, not a style attribute: the CSP has no 'unsafe-inline'.
    const fill = (pct) => {
      const n = ctx.el("span", { class: "fill" });
      n.style.width = pct + "%";
      return n;
    };
    return ctx.el(
      "div",
      { class: "bars", role: "img", "aria-label": "First-try spelling accuracy by list" },
      charts.map((c) =>
        ctx.el(
          "div",
          { class: "bar", "aria-hidden": "true" },
          ctx.el("span", { class: "label" }, c.title),
          ctx.el("span", { class: "track" }, fill(c.total ? c.accuracy : 0)),
          ctx.el("span", { class: "value" }, c.total ? c.accuracy + "%" : "—"),
        ),
      ),
    );
  }

  return { wordBankView, progressHome, table, drawChart };
}
