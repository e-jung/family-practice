import {openVerseLadder} from './verse-ladder-ui.js';
// DOM edge: the shell supplies live app state and cross-feature actions.
export function createVerseUI(ctx) {
  function verseHome() {
    const active = ctx.state.verses.filter((v) => !v.archived);
    if (ctx.state.parent)
      ctx.app.append(
        ctx.el(
          "div",
          { class: "row spread section" },
          ctx.el("p", { class: "muted" }, "Parent mode: paste the wording your family uses."),
          ctx.button("+ Add Bible verse", () => ctx.editVerse()),
        ),
      );
    if (!active.length)
      ctx.app.append(
        ctx.el(
          "div",
          { class: "section" },
          ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "No verse yet")),
          ctx.el("p", {}, "A parent can paste a verse in Parent mode to begin."),
        ),
      );
    ctx.app.append(ctx.el("div", {}, active.map(verseCard)));
    if (ctx.state.parent && ctx.state.verses.some((v) => v.archived))
      ctx.app.append(
        ctx.el(
          "details",
          {},
          ctx.el("summary", {}, "Archived verses"),
          ctx.state.verses.filter((v) => v.archived).map(verseCard),
        ),
      );
  }
  function verseCard(v) {
    return ctx.el(
      "section",
      { class: "packet", "data-tone": "verses" },
      ctx.el(
        "div",
        { class: "packet-strip" },
        ctx.el("h2", {}, v.reference),
        ctx.el(
          "span",
          { class: "band-meta" },
          [v.translation, v.sample ? "Sample" : ""].filter(Boolean).join(" · "),
        ),
      ),
      ctx.el(
        "div",
        { class: "packet-body" },
        ctx.el("p", { class: "verse" }, v.text),
        v.due_date ? ctx.el("p", { class: "muted" }, "Practice by " + ctx.niceDate(v.due_date)) : null,
        ctx.el(
          "div",
          { class: "row" },
          ctx.button("Practice this verse", () => verseMenu(v)),
          ctx.state.parent ? ctx.button("Edit", () => ctx.editVerse(v), "quiet small") : null,
          ctx.state.parent
            ? ctx.button(v.archived ? "Restore" : "Archive", () => ctx.archive("verses", v), "quiet small")
            : null,
        ),
      ),
    );
  }
  const VERSE_MODES = [
    ["read", "Read & listen", "Hear the reference and the whole verse."],
    ["ladder", "Learn it", "Tap first letters. Hide a little more each step."],
    ["reference", "Reference quiz", "Remember where the verse is found."],
  ];
  function verseMenu(v) {
    ctx.shell();
    ctx.app.append(
      ctx.el(
        "div",
        { class: "section" },
        ctx.el(
          "div",
          { class: "section-title" },
          ctx.el("h2", {}, v.reference),
          ctx.el("span", { class: "muted" }, v.translation || ""),
        ),
        ctx.el("p", {}, "Take one step at a time. Each step hides a little more."),
        ctx.el(
          "ol",
          { class: "modes", "data-tone": "verses" },
          VERSE_MODES.map(([mode, title, description], i) =>
            ctx.el(
              "li",
              {},
              ctx.button(
                [
                  ctx.el("span", { class: "step", "aria-hidden": "true" }, i + 1),
                  ctx.el(
                    "span",
                    { class: "what" },
                    ctx.el("strong", {}, title),
                    ctx.el("span", {}, description),
                  ),
                ],
                () => versePractice(v, mode),
              ),
            ),
          ),
        ),
        ctx.button("Back to verses", ctx.render, "secondary"),
      ),
    );
  }
  async function versePractice(v, mode) {
    if (mode === "ladder") return openVerseLadder(ctx, v, () => verseMenu(v));
    const previousView = ctx.viewVersion;
    const session = await ctx.api("/api/sessions", { kid_id: ctx.kid.id, kind: "verse" });
    if (previousView !== ctx.viewVersion) return;
    ctx.shell("practice", "verses");
    const modeName = Object.fromEntries(VERSE_MODES.map(([m, t]) => [m, t]))[mode];
    const desk = ctx.el("section", { class: "desk" });
    let keyboard = null;
    ctx.app.append(
      ctx.practiceBand({
        title: mode === "reference" ? "Reference quiz" : v.reference,
        status: modeName,
        exit: ctx.exitButton("Back to modes", () => verseMenu(v)),
      }),
      desk,
    );
    desk.append(
      ctx.el(
        "h2",
        {},
        mode === "reference"
          ? "Where is this verse found?"
          : mode === "read"
            ? "Read it, then say it"
            : "Type what’s missing",
      ),
    );
    const response = ctx.practiceField(
      ctx.textArea("verse-answer", "", {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "none",
        spellcheck: "false",
        placeholder: mode === "reference" ? "Book chapter:verse" : "Type the verse here…",
        "aria-label": mode === "reference" ? "Bible reference" : "Your verse from memory",
      }),
    );
    if (mode === "read") {
      desk.append(
        ctx.el("p", { class: "verse" }, v.text),
        ctx.el(
          "div",
          { class: "listen" },
          ctx.button([ctx.icon("speaker"), "Listen"], () => ctx.say([v.reference, v.text]), "secondary"),
        ),
        ctx.el("p", { class: "muted" }, "Read along, then try saying it without looking."),
        ctx.button(
          "I practiced this verse",
          async () => {
            await ctx.api("/api/verse-attempts", { session_id: session.id, verse_id: v.id, mode, typed: "" });
            await ctx.api("/api/sessions/complete", { session_id: session.id });
            ctx.toast("Practice saved. Keep growing!");
            verseMenu(v);
          },
          "primary",
        ),
      );
      return;
    }
    const form = ctx.el("form", { id: "practice-form", class: "verse-form" });
    const submit = ctx.el(
      "button",
      { type: "submit", form: "practice-form", class: "primary" },
      "Check my work",
    );
    form.append(ctx.el("p", { class: "verse" }, v.text), ctx.field("Reference", response));
    let current = response;
    form.addEventListener("focusin", (e) => {
      if (e.target.matches("[data-practice-field]")) current = e.target;
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const result = await ctx.api("/api/verse-attempts", {
          session_id: session.id,
          verse_id: v.id,
          mode,
          typed: response.value,
        });
        await ctx.api("/api/sessions/complete", { session_id: session.id });
        ctx.stopSpeaking();
        keyboard?.remove();
        desk.replaceChildren(
          ctx.el(
            "h2",
            {},
            result.accuracy === 100 ? "You remembered every word!" : "You’re building a strong memory.",
          ),
          ctx.el("div", { class: "score" }, result.accuracy + "%"),
          ctx.el("p", {}, "Green words matched. Underlined words are a gentle reminder for next time."),
          ctx.el(
            "div",
            { class: "comparison" },
            result.details.map((d) =>
              ctx.el(
                "span",
                {
                  class: d.correct ? "" : "miss",
                  title: d.typed && !d.correct ? "You typed: " + d.typed : "",
                },
                d.word || `+ ${d.typed}`,
              ),
            ),
          ),
          ctx.el(
            "div",
            { class: "row form-actions" },
            ctx.button("Try this again", () => versePractice(v, mode), "primary"),
            ctx.button("Choose a mode", () => verseMenu(v), "secondary"),
          ),
        );
      } catch (err) {
        ctx.toast(err.message);
        submit.disabled = false;
      }
    });
    desk.append(form);
    keyboard = ctx.dockKeyboard({
      target: () => current,
      action: submit,
      symbols: true,
    });
    if (!keyboard) form.append(submit);
    ctx.focus(current);
  }

  return { verseHome, verseCard, verseMenu, versePractice };
}
