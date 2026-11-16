// DOM edge: the shell supplies live app state and cross-feature actions.
export function createWelcomeUI(ctx) {
  // The Learn mechanism, shown rather than described: letters fade a few at a time.
  function learnDemo() {
    const row = (label, word, hidden, fades = []) =>
      ctx.el(
        "div",
        {},
        ctx.el("b", {}, label),
        ctx.el(
          "span",
          { class: "cue" },
          [...word].map((c, i) => {
            const span = ctx.el(
              "span",
              { class: hidden.includes(i) ? "blank" : fades.includes(i) ? "fades" : "" },
              hidden.includes(i) ? " " : c,
            );
            if (fades.includes(i)) span.style.setProperty("--i", fades.indexOf(i));
            return span;
          }),
        ),
      );
    return ctx.el(
      "figure",
      {
        class: "demo",
        "aria-label": "Example: in Learn mode, letters of “beautiful” fade until you spell it from memory.",
      },
      ctx.el(
        "div",
        { class: "demo-steps", "aria-hidden": "true" },
        row("Copy", "beautiful", []),
        row("Fade", "beautiful", [], [3, 7]),
        row("Recall", "beautiful", [1, 2, 3, 4, 5, 6, 7, 8]),
      ),
      ctx.el("small", {}, "Learn mode: hear it, copy it, then type it with fewer letters showing."),
    );
  }
  function landing(prefill = "", message = "") {
    ctx.clearView();
    ctx.app.dataset.tone = "spelling";
    const resumeCode = ctx.familyCode;
    ctx.app.append(
      ctx.el(
        "div",
        { class: "band hero" },
        ctx.el(
          "div",
          { class: "hero-grid" },
          ctx.el(
            "div",
            {},
            ctx.el("h1", {}, "A small daily habit. A family that grows."),
            ctx.el(
              "p",
              { class: "hero-lede" },
              "Spelling tests read aloud with helpful sentences, Bible verses learned a few words at a time, and progress worth celebrating.",
            ),
            ctx.el(
              "div",
              { class: "row" },
              ctx.button("Create a family space", () => {
                name.focus();
                name.scrollIntoView({ behavior: "smooth", block: "center" });
              }),
              ctx.button(
                "I have a family code",
                () => {
                  code.focus();
                  code.scrollIntoView({ behavior: "smooth", block: "center" });
                },
                "secondary",
              ),
            ),
          ),
          learnDemo(),
        ),
      ),
    );
    if (message) ctx.app.append(ctx.el("p", { role: "alert", class: "notice" }, message));
    if (resumeCode && !prefill)
      ctx.app.append(
        ctx.el(
          "div",
          { class: "row section" },
          ctx.button("Return to saved family", () => ctx.openFamily(resumeCode), "secondary"),
        ),
      );
    const identityEntry = ctx.el("section", { class: "section" });
    ctx.app.append(identityEntry);
    ctx.identity.entry(identityEntry, prefill);
    ctx.app.append(
      ctx.el(
        "div",
        { class: "offer" },
        ctx.el(
          "div",
          {},
          ctx.el("strong", {}, "Spelling, read aloud"),
          ctx.el("span", {}, "Word, sentence, word. One retry, then the letters spelled out."),
        ),
        ctx.el(
          "div",
          {},
          ctx.el("strong", {}, "Bible verses"),
          ctx.el("span", {}, "Paste your family’s wording. Blanks, first letters, then from memory."),
        ),
        ctx.el(
          "div",
          {},
          ctx.el("strong", {}, "Progress for parents"),
          ctx.el("span", {}, "First-try accuracy, tricky words, and verse stars."),
        ),
        ctx.el(
          "div",
          {},
          ctx.el("strong", {}, "No account required"),
          ctx.el(
            "span",
            {},
            "No ads or tracking. Kids use first names and a family code. Parent sign-in is optional.",
          ),
        ),
      ),
    );
    const name = ctx.input("family-name", "", {
      maxlength: 80,
      autocomplete: "off",
      placeholder: "The Hill family",
    });
    const pin = ctx.input("create-pin", "", {
      type: "password",
      required: true,
      minlength: 4,
      maxlength: 8,
      pattern: "[0-9]{4,8}",
      inputmode: "numeric",
      autocomplete: "new-password",
    });
    const repeat = ctx.input("create-pin-repeat", "", {
      type: "password",
      required: true,
      autocomplete: "new-password",
    });
    const createError = ctx.el("p", { role: "alert" });
    const createButton = ctx.el("button", { type: "submit" }, "Create family space");
    const create = ctx.el(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          if (pin.value !== repeat.value) {
            createError.textContent = "The PINs do not match.";
            return;
          }
          createButton.disabled = true;
          createError.textContent = "";
          try {
            const family = await ctx.api("/api/families", { name: name.value.trim(), pin: pin.value });
            ctx.rememberFamily(family.code);
            ctx.kid = null;
            await ctx.reload();
            history.replaceState({}, "", "/");
            if (ctx.identity.signedIn()) {
              try {
                await ctx.identity.linkNewFamily();
              } catch (err) {
                ctx.toast("Family created, but sign-in linking failed: " + err.message);
                ctx.codeCard();
                return;
              }
            }
            ctx.codeCard();
            ctx.toast("Family created! Save your code before you begin.");
          } catch (err) {
            createError.textContent = err.message;
          } finally {
            createButton.disabled = false;
          }
        },
      },
      ctx.field("Family space name (optional)", name),
      ctx.field("Parent PIN (4–8 digits)", pin),
      ctx.field("Repeat parent PIN", repeat),
      ctx.el(
        "p",
        { class: "muted field-hint" },
        "Pick a PIN you’ll remember: there’s no email-based PIN recovery. You start with an empty space and add only what you need.",
      ),
      createError,
      createButton,
    );
    const code = ctx.input("join-code", prefill, {
      required: true,
      maxlength: 128,
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: "false",
    });
    const joinError = ctx.el("p", { role: "alert" });
    const joinButton = ctx.el("button", { type: "submit" }, "Join family");
    const join = ctx.el(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          joinButton.disabled = true;
          joinError.textContent = "";
          try {
            await ctx.openFamily(code.value);
          } catch (err) {
            joinError.textContent = err.message;
          } finally {
            joinButton.disabled = false;
          }
        },
      },
      ctx.field("Family code", code),
      ctx.el(
        "p",
        { class: prefill ? "notice" : "muted field-hint" },
        prefill
          ? "This link contains a family code. Join only if a trusted family member shared it with you. Joining " +
              "saves this family on this browser and replaces its previously saved family."
          : "Ask a parent for your family’s code. Joining remembers this family on this browser. Use a trusted device.",
      ),
      joinError,
      joinButton,
    );
    ctx.app.append(
      ctx.el(
        "div",
        { class: "onboarding" },
        ctx.el("section", { class: "section" }, ctx.el("h2", {}, "Start your family"), create),
        ctx.el("section", { class: "section" }, ctx.el("h2", {}, "Already have a code?"), join),
      ),
    );
  }
  function privacy() {
    ctx.clearView();
    ctx.app.dataset.tone = "parent";
    ctx.app.append(
      ctx.el(
        "section",
        { class: "section prose" },
        ctx.el("h1", {}, "Privacy & your family’s data"),
        ctx.el(
          "p",
          {},
          "Spellami stores the profiles, spelling lists, Bible verses, practice answers, progress, and voice " +
            "settings your family enters. Use first names or nicknames, not full names, school names, addresses, " +
            "or other sensitive details.",
        ),
        ctx.el("h2", {}, "Your code is a key"),
        ctx.el(
          "p",
          {},
          "No tracking, no analytics, and no ads. You can delete your family anytime. Anyone with your family " +
            "code can open your family’s practice and view its profiles and progress. It is not a public " +
            "username. Share the code and join link privately with trusted family members only. Your parent PIN " +
            "protects management actions, backups, and deletion; it does not hide practice from someone who knows " +
            "your code.",
        ),
        ctx.el("h2", {}, "Shared lists and class links"),
        ctx.el(
          "p",
          {},
          "Parents can publish an unlisted, frozen copy of spelling words, sentences, an optional short note " +
            "and a Bible verse. Anyone with that public link can read and import it. Never include personal " +
            "details. Kids, family codes, PINs and practice history are not published. Stop a link in Parent " +
            "mode; independent copies already imported by other families remain theirs. Following a class list " +
            "keeps your chosen kids and verse preference private and only shows new weeks for a parent to add. " +
            "Public links can be reported; reports are not automatic moderation.",
        ),
        ctx.el("h2", {}, "On this device"),
        ctx.el(
          "p",
          {},
          "This browser remembers your family code in local storage. Parent mode uses a cookie after you enter " +
            "your PIN. Lock Parent mode when you finish on a shared device. Forgetting a family here removes its " +
            "saved code, not its server data. Key sound, haptics, and on-screen keyboard choices are saved only " +
            "in this browser.",
        ),
        ctx.el("h2", {}, "Speech & hosting"),
        ctx.el(
          "p",
          {},
          "Cloud voice is the default. Text being read aloud (spelling words, practice sentences, and Bible " +
            "verses) is sent to Cloudflare Workers AI to generate speech; family profile names and typed answers " +
            "are not included in speech requests. Already-heard audio is cached in bounded browser memory for " +
            "replay, and Cloudflare caches generated clips for reuse. The app shell is saved on this device for " +
            "faster loading; family data and answers are not saved in the offline cache. You can choose Device " +
            "voice in family settings; it is also the automatic fallback when cloud speech is unavailable. Device " +
            "voice availability and whether speech is processed locally depend on your browser and operating " +
            "system. Practice data is stored with the app’s Cloudflare hosting services; normal hosting request " +
            "logs may include technical information such as IP addresses.",
        ),
        ctx.el("h2", {}, "You stay in control"),
        ctx.el(
          "p",
          {},
          "In Parent mode you can export a backup, remove a child and their practice history, or permanently " +
            "delete the whole family. Keep backups private. Optional Jesklabs sign-in, shared by Jesklabs apps; " +
            "it stores your email and which Jesklabs apps you use. Linked families allow code recovery and parent " +
            "access. Google sign-in navigates through Jesklabs Accounts to Google only when you choose it; email " +
            "sign-in sends a one-time code. Email reminders are opt-in. Delete your sign-in or unlink a parent in " +
            "Parent mode without deleting family data. Keep your code and PIN safe; PINs cannot be recovered.",
        ),
        ctx.el("h2", {}, "Credits"),
        ctx.el(
          "p",
          {},
          "Text face: Practice Reader, a Latin subset of Andika by SIL International. Headings: Barlow " +
            "Condensed by The Barlow Project Authors. Both use the SIL Open Font License 1.1. Key sound: " +
            "“click_002” from Kenney’s Interface Sounds (CC0). All are served from this site; nothing loads from " +
            "a third party.",
        ),
        ctx.el(
          "div",
          { class: "row" },
          ctx.button(
            "Back",
            () => {
              history.replaceState({}, "", "/");
              if (ctx.familyCode && ctx.state.family) ctx.render();
              else landing();
            },
            "secondary",
          ),
          ctx.familyCode
            ? ctx.button(
                "Forget family on this device",
                async () => {
                  if (
                    !confirm(
                      "Forget the saved family code on this device? Keep a copy first. Your family’s server data will not be deleted.",
                    )
                  )
                    return;
                  await ctx.api("/api/parent/lock", {}).catch(() => {});
                  await ctx.identity.init();
                  ctx.rememberFamily("");
                  ctx.kid = null;
                  ctx.state.parent = false;
                  history.replaceState({}, "", "/");
                  landing();
                },
                "secondary",
              )
            : null,
        ),
      ),
    );
  }

  return { learnDemo, landing, privacy };
}
