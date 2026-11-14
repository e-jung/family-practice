// On-screen letter keyboard for practice on touch devices. Adapted from Incord's
// Keyboard.svelte (MIT, same author). Keys write into the current practice field,
// so the field stays a real, labelled text box for assistive tech and physical keys.
import {tick} from "/feedback.js";
import {icon} from "/icons.js";
const LETTERS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const SYMBOLS = ["1234567890", "-:;,.?!'\"", "()&/"];
function key(label, action, cls = "key", name = label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.tabIndex = -1; // Keyboard users already have a physical keyboard.
  b.setAttribute("aria-label", name);
  b.append(label);
  // Keep the caret in the practice field: pressing a key must not move focus.
  b.addEventListener("pointerdown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    if (e.isTrusted) tick(); // Overlay clicks (iOS haptics) already ticked.
    b.classList.add("pressed");
    setTimeout(() => b.classList.remove("pressed"), 120);
    action();
  });
  return b;
}
/**
 * target(): the field to type into. action: optional primary button docked at
 * the bottom right (moved, not copied, so it keeps one accessible name).
 * space: "type" inserts a space; "next" moves to the next field (verse blanks).
 */
export function createKeyboard({target, action = null, space = "type", symbols = false, next = null}) {
  let layer = "letters";
  const root = document.createElement("div");
  root.className = "keyboard";
  root.dataset.keyboard = "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "On-screen keyboard");
  const field = () => target();
  const fire = (f) => f.dispatchEvent(new Event("input", {bubbles: true}));
  function insert(text) {
    const f = field();
    if (!f || f.disabled || f.readOnly) return;
    const start = f.selectionStart ?? f.value.length, end = f.selectionEnd ?? f.value.length;
    f.setRangeText(text, start, end, "end");
    fire(f);
  }
  function backspace() {
    const f = field();
    if (!f || f.disabled) return;
    let start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? f.value.length;
    if (start === end) { if (!start) return; start--; }
    f.setRangeText("", start, end, "end");
    fire(f);
  }
  function draw() {
    const rows = layer === "letters" ? LETTERS : SYMBOLS;
    root.replaceChildren();
    rows.forEach((row, i) => {
      const line = document.createElement("div");
      line.className = "keyrow";
      for (const ch of row) line.append(key(ch, () => insert(ch)));
      if (i === rows.length - 1) line.append(key(icon("backspace"), backspace, "key wide", "Delete"));
      root.append(line);
    });
    const bottom = document.createElement("div");
    bottom.className = "keyrow bottom";
    if (symbols) bottom.append(key(layer === "letters" ? "123" : "abc", () => { layer = layer === "letters" ? "symbols" : "letters"; draw(); }, "key mode", layer === "letters" ? "Numbers and punctuation" : "Letters"));
    // ASCII apostrophe: answer checking compares characters exactly.
    if (layer === "letters") bottom.append(key("’", () => insert("'"), "key", "Apostrophe"));
    bottom.append(space === "next" ? key("next", () => next?.(), "key space", "Next blank") : key("space", () => insert(" "), "key space", "Space"));
    if (action) bottom.append(action);
    root.append(bottom);
  }
  draw();
  return root;
}
