// DOM edge: the shell supplies live app state and cross-feature actions.
export function createParentUI(ctx) {
  function unlock(onUnlocked) {
    const pin = ctx.input("parent-pin", "", {
      type: "password",
      inputmode: "numeric",
      autocomplete: "current-password",
      required: true,
      maxlength: 1000,
    });
    const error = ctx.el("p", { role: "alert" });
    let d;
    const form = ctx.el(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await ctx.api("/api/parent/unlock", { pin: pin.value });
            d.close();
            await ctx.reload();
            if (typeof onUnlocked === "function") await onUnlocked();
            else parentHome();
            ctx.toast("Parent mode is unlocked.");
          } catch (err) {
            error.textContent = err.message;
            pin.select();
          }
        },
      },
      ctx.field("Parent PIN", pin),
      error,
      ctx.el("button", { type: "submit" }, "Unlock"),
    );
    d = ctx.modal("Parent mode", form);
    ctx.focus(pin);
  }
  function formDialog(title, fields, onSave) {
    const error = ctx.el("p", { role: "alert" });
    let d;
    const save = ctx.el("button", { type: "submit" }, "Save");
    const form = ctx.el(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          save.disabled = true;
          try {
            await onSave();
            d.close();
            await ctx.reload();
            ctx.render();
            ctx.toast("Saved. Audio is warming up in the background.");
          } catch (err) {
            error.textContent = err.message;
          } finally {
            save.disabled = false;
          }
        },
      },
      ctx.el("div", { class: "sheet-body" }, fields, error),
      ctx.el(
        "div",
        { class: "row form-actions" },
        save,
        ctx.button("Cancel", () => d.close(), "secondary"),
      ),
    );
    d = ctx.modal(title, form);
    return d;
  }
  function editList(l) {
    const title = ctx.input("list-title", l?.title || ctx.titleDate(), {
        required: true,
        maxlength: 120,
      }),
      day = ctx.input("list-date", l?.date || ctx.today(), {
        type: "date",
        required: true,
      }),
      ws = ctx.textArea(
        "list-words",
        l?.words.map((w) => w.word + (w.sentence ? " | " + w.sentence : "")).join("\n") || "",
        {
          required: true,
          rows: 8,
          placeholder: "journey | We began our journey at sunrise.\nbeautiful | The garden is beautiful.",
        },
      );
    formDialog(
      l ? "Edit spelling list" : "Add spelling list",
      [
        ctx.el(
          "p",
          { class: "muted field-hint" },
          "Each list is one week’s test. Add a new list for new words.",
        ),
        ctx.field("Week title", title),
        ctx.field("Date", day),
        ctx.field("One word per line · word | optional sentence", ws),
        ctx.el("small", {}, "1–100 words. Editing preserves history and replaces the current word set."),
      ],
      () =>
        ctx.api("/api/admin/lists", {
          id: l?.id,
          kid_id: ctx.kid.id,
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
    const ref = ctx.input("reference", v?.reference || "", {
        required: true,
        maxlength: 120,
      }),
      text = ctx.textArea("verse-text", v?.text || "", {
        required: true,
        maxlength: 2000,
      }),
      translation = ctx.input("translation", v?.translation || "", { maxlength: 60 }),
      due = ctx.input("due", v?.due_date || "", { type: "date" });
    formDialog(
      v ? "Edit Bible verse" : "Add Bible verse",
      [
        ctx.field("Reference (for example Psalm 23:1)", ref),
        ctx.field("Verse text · paste your chosen wording", text),
        ctx.field("Translation label (optional)", translation),
        ctx.field("Due date (optional)", due),
      ],
      () =>
        ctx.api("/api/admin/verses", {
          id: v?.id,
          kid_id: ctx.kid.id,
          reference: ref.value,
          text: text.value,
          translation: translation.value,
          due_date: due.value,
        }),
    );
  }
  async function archive(type, item) {
    if (!item.archived && !confirm("Archive this item? Practice history will be kept.")) return;
    await ctx.api("/api/admin/archive", {
      type,
      id: item.id,
      archived: !item.archived,
    });
    await ctx.reload();
    ctx.render();
  }
  function editKid(k) {
    const name = ctx.input("kid-name", k?.name || "", {
        required: true,
        maxlength: 60,
      }),
      grade = ctx.input("kid-grade", k?.grade || "", { maxlength: 30 });
    formDialog(
      k ? "Rename profile" : "Add a kid",
      [
        ctx.field("First name or nickname", name),
        ctx.el("small", {}, "No last names needed. Use a first name or nickname."),
        ctx.field("Grade (optional)", grade),
      ],
      () =>
        ctx.api("/api/admin/kids", {
          id: k?.id,
          name: name.value,
          grade: grade.value,
        }),
    );
  }
  const PARENT_SECTIONS = [
    "Kids",
    "Spelling lists",
    "Bible verses",
    "This device",
    "Family",
    "Sign-in & email",
    "Connect an AI assistant",
    "Shared lists",
    "Class lists",
    "Following",
  ];
  function parentHome() {
    if (!ctx.state.parent) return unlock();
    ctx.parentPage = true;
    ctx.viewVersion++;
    ctx.stopSpeaking();
    ctx.app.replaceChildren();
    document.body.classList.remove("practicing");
    ctx.app.dataset.tone = "parent";
    ctx.header();
    ctx.app.append(
      ctx.el(
        "div",
        { class: "band" },
        ctx.el(
          "div",
          { class: "band-head" },
          ctx.el("h1", {}, "Parent"),
          ctx.button(
            "Done",
            () => {
              ctx.parentPage = false;
              ctx.render();
            },
            "secondary small",
          ),
        ),
      ),
    );
    const primary = ["Kids", "Spelling lists", "Bible verses", "Family"];
    const navButton = (name) => {
      const control = ctx.button(
        { "Spelling lists": "Lists", "Bible verses": "Verses" }[name] || name,
        () => {
          ctx.parentSection = name;
          parentHome();
          window.scrollTo(0, 0);
        },
        name === ctx.parentSection ? "active" : "secondary",
      );
      if (name === ctx.parentSection) control.setAttribute("aria-current", "page");
      return control;
    };
    ctx.app.append(
      ctx.el(
        "nav",
        { class: "parent-nav", "aria-label": "Parent sections" },
        ctx.el("div", { class: "parent-primary" }, primary.map(navButton)),
        ctx.el(
          "details",
          { class: "parent-more", open: !primary.includes(ctx.parentSection) },
          ctx.el("summary", {}, "More"),
          ctx.el(
            "div",
            { class: "parent-secondary" },
            PARENT_SECTIONS.filter((name) => !primary.includes(name)).map(navButton),
          ),
        ),
      ),
    );
    if (["Shared lists", "Class lists", "Following"].includes(ctx.parentSection)) {
      const host = ctx.el("div", {}, ctx.el("p", {}, "Loading…"));
      ctx.app.append(host);
      ctx.sharing[
        ctx.parentSection === "Shared lists"
          ? "sharedAdmin"
          : ctx.parentSection === "Class lists"
            ? "classesAdmin"
            : "followsAdmin"
      ](host).catch((err) =>
        host.replaceChildren(
          ctx.el("p", { role: "alert" }, err.message),
          ctx.button("Try again", parentHome, "secondary"),
        ),
      );
      return;
    }
    if (ctx.parentSection === "Sign-in & email") {
      const host = ctx.el("section", { class: "section" });
      ctx.app.append(host);
      ctx.identity.manage(host);
      return;
    }
    if (ctx.parentSection === "Connect an AI assistant") {
      assistantControls();
      return;
    }
    if (ctx.parentSection === "Spelling lists" || ctx.parentSection === "Bible verses") {
      parentPractice();
      return;
    }
    const section = (title, ...children) =>
      ctx.el(
        "div",
        { class: "section" },
        ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, title)),
        ...children,
      );
    if (ctx.parentSection === "Kids") {
      ctx.app.append(
        section(
          "Kids",
          ctx.el(
            "div",
            {},
            ctx.state.kids.map((k) =>
              ctx.el(
                "div",
                { class: "profile-controls" },
                ctx.el("strong", {}, k.name),
                ctx.button("Rename / edit", () => editKid(k), "secondary small"),
                ctx.button(
                  "Remove",
                  async () => {
                    if (
                      !confirm(
                        `Remove ${k.name} and all their lists, verses, and practice history? This cannot be undone.`,
                      )
                    )
                      return;
                    await ctx.api("/api/admin/remove-kid", { id: k.id });
                    await ctx.reload();
                    ctx.render();
                    ctx.toast("Profile removed.");
                  },
                  "danger small",
                ),
              ),
            ),
          ),
          ctx.el(
            "div",
            { class: "form-actions" },
            ctx.button("+ Add kid", () => editKid()),
          ),
        ),
      );
      return;
    }
    if (ctx.parentSection === "Family") ctx.app.append(familyControls());
    if (ctx.parentSection === "This device") {
      ctx.app.append(deviceControls());
      const voice = ctx.el(
          "select",
          { id: "voice" },
          ctx.el("option", { value: "cloud", selected: ctx.cloudVoice() }, "Cloud voice (recommended)"),
          ctx.el("option", { value: "device", selected: !ctx.cloudVoice() }, "This device’s voice"),
        ),
        speed = ctx.input("speed", ctx.state.settings.speed, {
          type: "number",
          min: 0.5,
          max: 1.5,
          step: 0.05,
          required: true,
        });
      const form = ctx.el(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await ctx.api("/api/admin/settings", { voice: voice.value, speed: Number(speed.value) });
              ctx.stopSpeaking();
              ctx.resetSpeechCooldown();
              await ctx.reload();
              ctx.toast("Voice settings saved.");
            } catch (err) {
              ctx.toast(err.message);
            }
          },
        },
        ctx.field("Reading voice", voice),
        ctx.field("Speech speed · 0.5 slow to 1.5 fast", speed),
        ctx.el(
          "p",
          { class: "muted field-hint" },
          "Cloud voice sends only the text being read to Cloudflare for speech. If it takes more than 4 seconds " +
            "or is unavailable, this device’s English voice takes over. Device voice uses your browser and " +
            "operating system.",
        ),
        ctx.el(
          "div",
          { class: "row" },
          ctx.el("button", { type: "submit" }, "Save voice settings"),
          ctx.button(
            [ctx.icon("speaker"), "Test voice"],
            () => ctx.say("A little practice helps us grow."),
            "secondary",
          ),
        ),
      );
      ctx.app.append(section("Listen your way", form));
      return;
    }
    const upload = ctx.input("backup-file", "", { type: "file", accept: ".json,application/json" });
    ctx.app.append(
      section(
        "Backups",
        ctx.el(
          "p",
          {},
          "Export includes all profiles, lists, verses, settings, sessions, and attempts. JSON can restore this " +
            "app; CSV is a spreadsheet-friendly table with a table-name column and shared fields.",
        ),
        ctx.el(
          "div",
          { class: "row" },
          ctx.button("Export JSON", () => downloadBackup("json"), "secondary"),
          ctx.button("Export CSV", () => downloadBackup("csv"), "secondary"),
        ),
        ctx.field("Restore a JSON backup", upload),
        ctx.el(
          "p",
          { class: "notice" },
          `Import replaces all current family data. Export a backup first. Files are limited to ${ctx.state.settings.serverTts === false ? 2 : 32} MB.`,
        ),
        ctx.button(
          "Import backup",
          async () => {
            const f = upload.files[0];
            if (!f) throw Error("Choose a JSON backup first.");
            const limitMB = ctx.state.settings.serverTts === false ? 2 : 32;
            if (f.size > limitMB * 1024 * 1024) throw Error(`Backup is larger than ${limitMB} MB.`);
            let b;
            try {
              b = JSON.parse(await f.text());
            } catch {
              throw Error("That file is not valid JSON.");
            }
            if (!confirm("Replace all current family data with this backup?")) return;
            await ctx.api("/api/admin/import", b);
            await ctx.reload();
            ctx.render();
            ctx.toast("Backup restored.");
          },
          "danger",
        ),
      ),
    );
  }

  async function assistantControls() {
    const version = ctx.viewVersion;
    const host = ctx.el(
      "section",
      { class: "section" },
      ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "Connect an AI assistant")),
      ctx.el(
        "p",
        {},
        "Let an assistant prepare weekly lists and read practice summaries. No account needed.",
      ),
      ctx.el(
        "p",
        { class: "notice" },
        "Anyone with this link can add and read your family's lists. Revoke it if shared by mistake.",
      ),
      ctx.el(
        "p",
        { class: "muted" },
        "Read only connections cannot make changes. Changing your Parent PIN does not revoke connections. You " +
          "can keep up to five connections.",
      ),
    );
    ctx.app.append(host);
    const name = ctx.input("connection-name", "", {
      required: true,
      maxlength: 80,
      placeholder: "Claude on Dad’s laptop",
    });
    const scope = ctx.el(
      "select",
      { id: "connection-scope" },
      ctx.el("option", { value: "add-read" }, "Add & read"),
      ctx.el("option", { value: "read-only" }, "Read only"),
    );
    const shown = ctx.el("div", { "aria-live": "polite" });
    const connections = ctx.el("div", { class: "rows" });
    const error = ctx.el("p", { role: "alert" });
    const refresh = async () => {
      const result = await ctx.api("/api/admin/connections");
      if (ctx.viewVersion !== version) return;
      connections.replaceChildren(
        ...result.connections.map((c) =>
          ctx.el(
            "div",
            { class: "section" },
            ctx.el("strong", {}, c.name),
            ...(c.format !== "fpc2" ? [ctx.el("p", { class: "meta" }, "Retired — create a new link")] : []),
            ctx.el(
              "p",
              { class: "meta" },
              `${c.scope === "read-only" ? "Read only" : "Add & read"}` +
                ` · Created ${ctx.niceDate(c.created_at)}` +
                ` · Last used: ${c.last_used_at ? new Date(c.last_used_at).toLocaleString() : "Not yet"}` +
                ``,
            ),
            ctx.button(
              "Revoke",
              async () => {
                if (!confirm(`Revoke ${c.name}? Its link will stop working.`)) return;
                await ctx.api("/api/admin/connections/revoke", { id: c.id });
                shown.replaceChildren();
                await refresh();
              },
              "secondary small",
            ),
          ),
        ),
      );
      if (!result.connections.length)
        connections.append(ctx.el("p", { class: "muted" }, "No connections yet."));
    };
    const create = ctx.el("button", { type: "submit" }, "Create connection");
    host.append(
      ctx.el(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            create.disabled = true;
            error.textContent = "";
            try {
              const result = await ctx.api("/api/admin/connections", {
                name: name.value,
                scope: scope.value,
              });
              if (ctx.viewVersion !== version) return;
              const url = location.origin + "/mcp/t/" + result.token;
              shown.replaceChildren(
                ctx.el("h3", {}, "Save this connection link now"),
                ctx.el("p", {}, "Shown only once. It cannot be retrieved after you leave this page."),
                ctx.el("p", { class: "connection-url" }, url),
                ctx.button(
                  "Copy connection URL",
                  async () => {
                    await navigator.clipboard.writeText(url);
                    ctx.toast("Connection URL copied. Keep it private.");
                  },
                  "secondary",
                ),
                ctx.el("p", {}, "Claude Code command"),
                ctx.el("pre", { class: "connection-url" }, `claude mcp add --transport http spellami ${url}`),
              );
              name.value = "";
              await refresh();
            } catch (err) {
              error.textContent = err.message;
            } finally {
              create.disabled = false;
            }
          },
        },
        ctx.field("Name", name),
        ctx.field("Scope", scope),
        create,
        error,
      ),
      shown,
      ctx.el("h3", {}, "Your connections"),
      connections,
      ctx.button(
        "Revoke all",
        async () => {
          if (!confirm("Revoke every assistant connection? All existing links will stop working.")) return;
          await ctx.api("/api/admin/connections/revoke-all", {});
          shown.replaceChildren();
          await refresh();
        },
        "secondary",
      ),
      ctx.el("h3", {}, "Set up your assistant"),
      ctx.el("p", {}, "Claude: Settings → Connectors → Add custom connector → paste the connection URL."),
      ctx.el("p", {}, "Claude Code: run the command shown with your new connection link."),
      ctx.el(
        "p",
        {},
        "Any MCP client that supports Streamable HTTP: use the connection URL. For clients that support " +
          "headers, use /mcp on this origin with Authorization: Bearer followed by your connection token.",
      ),
    );
    try {
      await refresh();
    } catch (err) {
      if (ctx.viewVersion === version) error.textContent = err.message;
    }
  }

  function parentPractice() {
    const isList = ctx.parentSection === "Spelling lists";
    const picker = ctx.el(
      "select",
      { id: "parent-kid" },
      ctx.state.kids.map((k) => ctx.el("option", { value: k.id, selected: ctx.kid?.id === k.id }, k.name)),
    );
    picker.addEventListener("change", async () => {
      ctx.kid = ctx.state.kids.find((k) => k.id === Number(picker.value));
      await ctx.reload();
      parentHome();
    });
    ctx.app.append(
      ctx.el(
        "div",
        { class: "section" },
        ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, ctx.parentSection)),
        ctx.state.kids.length ? ctx.field("Kid", picker) : ctx.el("p", {}, "Add a kid in Kids first."),
      ),
    );
    if (!ctx.state.kids.length) return;
    if (!ctx.kid) {
      ctx.kid = ctx.state.kids[0];
      ctx
        .reload()
        .then(() => {
          if (ctx.parentPage) parentHome();
        })
        .catch((e) => ctx.toast(e.message));
      return;
    }
    const items = isList ? ctx.state.lists : ctx.state.verses;
    ctx.app.append(
      ctx.el(
        "p",
        { class: "muted" },
        isList
          ? "Each list is one week’s test. Add a new list for new words. Editing keeps practice history."
          : "Paste the wording your family uses.",
      ),
      ctx.button(isList ? "+ Add spelling list" : "+ Add Bible verse", () =>
        isList ? editList() : editVerse(),
      ),
      ctx.el(
        "div",
        { class: "rows section" },
        items.map((item) =>
          ctx.el(
            "div",
            { class: "row spread" },
            ctx.el(
              "div",
              {},
              ctx.el("strong", {}, isList ? item.title : item.reference),
              ctx.el(
                "p",
                { class: "meta" },
                (item.archived ? "Archived · " : "") +
                  (isList ? `${item.words.length} words · ${ctx.niceDate(item.date)}` : item.text),
              ),
            ),
            ctx.el(
              "div",
              { class: "row" },
              isList ? ctx.sharing.sourceMeta(item) : null,
              ctx.button("Edit", () => (isList ? editList(item) : editVerse(item)), "secondary small"),
              isList ? ctx.button("Share", () => ctx.sharing.shareList(item), "secondary small") : null,
              ctx.button(
                item.archived ? "Restore" : "Archive",
                () => archive(isList ? "lists" : "verses", item),
                "quiet small",
              ),
            ),
          ),
        ),
      ),
    );
  }

  // Per-device feedback settings live in this browser only, never on the server.
  function deviceControls() {
    const s = ctx.deviceSettings();
    const toggle = (id, label, hint, key, disabled = false) => {
      const box = ctx.input(id, "", { type: "checkbox", checked: s[key] && !disabled, disabled });
      box.addEventListener("change", () => {
        ctx.setDeviceSettings({ [key]: box.checked });
        if (key === "keySounds" && box.checked) ctx.previewSound();
      });
      return ctx.el(
        "div",
        { class: "switch" },
        ctx.el("label", { for: id }, label, ctx.el("small", {}, hint)),
        box,
      );
    };
    const keyboard = ctx.el(
      "select",
      { id: "device-keyboard" },
      [
        ["auto", "Automatic (touch screens)"],
        ["on", "Always show"],
        ["off", "Never show"],
      ].map(([v, t]) => ctx.el("option", { value: v, selected: s.keyboard === v }, t)),
    );
    keyboard.addEventListener("change", () => ctx.setDeviceSettings({ keyboard: keyboard.value }));
    return ctx.el(
      "div",
      { class: "section" },
      ctx.el("div", { class: "section-title" }, ctx.el("h2", {}, "This device")),
      toggle(
        "device-sounds",
        "Key sounds",
        "A soft tick for keys and buttons. Plays only after a tap or key press.",
        "keySounds",
      ),
      toggle(
        "device-haptics",
        "Haptics",
        ctx.supportsHaptics()
          ? "A light tap on supported phones. On iPhone, needs iOS 18 and System Haptics on."
          : "This device can’t vibrate.",
        "haptics",
        !ctx.supportsHaptics(),
      ),
      ctx.el(
        "div",
        { class: "switch" },
        ctx.el(
          "label",
          { for: "device-keyboard" },
          "On-screen keyboard",
          ctx.el(
            "small",
            {},
            "Big letter keys for spelling and verses. Automatic shows them on phones and tablets.",
          ),
        ),
        keyboard,
      ),
    );
  }
  async function downloadBackup(format) {
    const r = await ctx.familyFetch("/api/admin/export?format=" + format);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw Error(body.error || "Could not download backup.");
    }
    const url = URL.createObjectURL(await r.blob());
    const a = ctx.el("a", { href: url, download: "spellami." + format });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function clearView() {
    ctx.viewVersion++;
    ctx.stopSpeaking();
    ctx.app.replaceChildren();
    document.body.classList.remove("practicing");
    ctx.$("header-actions").replaceChildren();
    ctx.$("voice-status").textContent = "";
  }
  function familyControls() {
    return ctx.el(
      "div",
      { class: "section" },
      ctx.el(
        "div",
        { class: "section-title" },
        ctx.el("h2", {}, "Your family space"),
        ctx.el("span", { class: "muted" }, ctx.state.family?.name || "Spellami"),
      ),
      ctx.el(
        "p",
        {},
        "Your family code opens practice on another device. The parent PIN protects settings and backups. " +
          "Keep both safe. Optional Parent sign-in can recover a linked family’s code; it does not recover your " +
          "PIN.",
      ),
      ctx.el(
        "div",
        { class: "row" },
        ctx.button("Save your family code", codeCard, "secondary"),
        ctx.identity.available() || ctx.identity.signedIn()
          ? ctx.button("Recover family codes", ctx.identity.recoverCodes, "secondary")
          : null,
        ctx.button(
          "Add sample practice",
          async () => {
            const target = ctx.kid || ctx.state.kids[0];
            if (!target) {
              ctx.toast("Add a kid first, then add sample practice.");
              return;
            }
            if (
              !confirm(
                `Add a sample spelling list and Bible verse for ${target.name}? Existing practice will be kept.`,
              )
            )
              return;
            await ctx.api("/api/admin/sample", { kid_id: target.id });
            await ctx.reload();
            ctx.render();
            ctx.toast("Sample practice added.");
          },
          "secondary",
        ),
        ctx.button("Change parent PIN", changePin, "secondary"),
      ),
      ctx.el(
        "details",
        {},
        ctx.el("summary", {}, "Delete this family"),
        ctx.el(
          "p",
          {},
          "Permanently remove every profile and all practice data. Export a backup first. This cannot be undone.",
        ),
        ctx.button("Delete family…", deleteFamily, "danger"),
      ),
    );
  }
  function changePin() {
    const current = ctx.input("current-pin", "", {
      type: "password",
      required: true,
      autocomplete: "current-password",
    });
    const pin = ctx.input("new-pin", "", {
      type: "password",
      required: true,
      minlength: 4,
      maxlength: 8,
      pattern: "[0-9]{4,8}",
      inputmode: "numeric",
      autocomplete: "new-password",
    });
    const repeat = ctx.input("repeat-pin", "", {
      type: "password",
      required: true,
      autocomplete: "new-password",
    });
    formDialog(
      "Change parent PIN",
      [
        ctx.field("Current PIN", current),
        ctx.field("New PIN (4–8 digits)", pin),
        ctx.field("Repeat new PIN", repeat),
      ],
      async () => {
        if (pin.value !== repeat.value) throw Error("The new PINs do not match.");
        await ctx.api("/api/admin/pin", { currentPin: current.value, pin: pin.value });
      },
    );
  }
  function deleteFamily() {
    const expected = ctx.state.family?.name || ctx.familyCode;
    const pin = ctx.input("delete-pin", "", {
      type: "password",
      required: true,
      autocomplete: "current-password",
    });
    const confirmation = ctx.input("delete-confirmation", "", { required: true, autocomplete: "off" });
    const error = ctx.el("p", { role: "alert" });
    let d;
    const submit = ctx.el("button", { type: "submit", class: "danger" }, "Permanently delete family");
    d = ctx.modal(
      "Delete family permanently",
      ctx.el(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            if (confirmation.value !== expected) {
              error.textContent = "Type your family name exactly to confirm.";
              return;
            }
            submit.disabled = true;
            try {
              await ctx.api("/api/admin/delete-family", { pin: pin.value, confirmation: confirmation.value });
              d.close();
              ctx.rememberFamily("");
              ctx.kid = null;
              history.replaceState({}, "", "/");
              ctx.landing();
              ctx.toast("Family deleted.");
            } catch (err) {
              error.textContent = err.message;
            } finally {
              submit.disabled = false;
            }
          },
        },
        ctx.el(
          "p",
          { class: "notice" },
          "This deletes all family data and cannot be undone. Download a backup before continuing.",
        ),
        ctx.field("Parent PIN", pin),
        ctx.field(`Type ${expected} to confirm`, confirmation),
        error,
        ctx.el(
          "div",
          { class: "row form-actions" },
          submit,
          ctx.button("Cancel", () => d.close(), "secondary"),
        ),
      ),
    );
  }
  function codeCard() {
    clearView();
    ctx.header();
    ctx.app.dataset.tone = "parent";
    const joinURL = location.origin + "/f/" + encodeURIComponent(ctx.familyCode);
    ctx.app.append(
      ctx.el(
        "section",
        { class: "print-sheet code-card section" },
        ctx.el("h1", {}, ctx.state.family?.name || "Your family practice space"),
        ctx.el(
          "p",
          { class: "notice" },
          "Save this code — it always opens your family’s practice. Write it down or copy it. Optional Parent " +
            "sign-in can recover codes for linked families.",
        ),
        ctx.el("p", { class: "muted" }, "Family code"),
        ctx.el("strong", { class: "family-code" }, ctx.familyCode),
        ctx.el("p", { class: "join-url" }, joinURL),
        ctx.el(
          "p",
          {},
          "Open Spellami on another device and enter this code, or use the link above. Anyone with the code can " +
            "view and use your family’s practice. Share it only with trusted family members.",
        ),
        ctx.el(
          "p",
          {},
          "Your parent PIN is separate. It is not printed on this card. Keep the PIN safe: there is no email-based recovery.",
        ),
        ctx.el("p", { class: "muted no-print" }, "Keep this card somewhere private."),
        ctx.el(
          "div",
          { class: "row" },
          ctx.button("Copy code", async () => {
            await navigator.clipboard.writeText(ctx.familyCode);
            ctx.toast("Family code copied.");
          }),
          ctx.button(
            "Copy join link",
            async () => {
              await navigator.clipboard.writeText(joinURL);
              ctx.toast("Join link copied. Share privately.");
            },
            "secondary",
          ),
          ctx.button("Print code card", () => window.print(), "secondary"),
          ctx.button("Back to practice", ctx.render, "secondary"),
        ),
      ),
    );
  }

  return {
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
  };
}
