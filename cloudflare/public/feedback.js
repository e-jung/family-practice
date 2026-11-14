// Key sounds, haptics, and the on-screen keyboard preference, per device.
// Ported from Incord (src/keyboard-feedback.ts, src/haptic-overlay.ts; MIT,
// same author). No family data here; preferences stay in this browser only.
const STORAGE = "family-practice-device";
const DEFAULTS = { keySounds: true, haptics: true, keyboard: "auto" };
const SAMPLE = "/audio/interface-click-002.mp3"; // Kenney "Fine tick", CC0.
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE) || "{}") }; } catch {}
const listeners = new Set();
export const deviceSettings = () => ({ ...settings });
export function setDeviceSettings(next) {
  settings = { ...settings, ...next };
  try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch {}
  if (!settings.keySounds) stopSounds();
  for (const fn of listeners) fn(settings);
}
export const onDeviceSettings = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const supportsHaptics = () => typeof navigator.vibrate === "function" || ios();
// iOS ticks only from the user's own tap on a native switch; scripts cannot vibrate.
const usesOverlay = () => settings.haptics && typeof navigator.vibrate !== "function" && ios();
export function onScreenKeyboard() {
  if (settings.keyboard === "on") return true;
  if (settings.keyboard === "off") return false;
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

// Sound: one AudioContext and one decoded sample, created only inside a gesture.
let audio, sample, loading, latest = 0, pending;
const active = new Set();
function stopSounds() { pending = undefined; for (const stop of active) stop(); }
function context() {
  if (audio) return audio;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    // Ambient respects the hardware silent switch and does not interrupt speech.
    if (navigator.audioSession) try { navigator.audioSession.type = "ambient"; } catch {}
    audio = new Audio();
  } catch { return; }
  return audio;
}
function load(ctx) {
  return loading ??= fetch(SAMPLE).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(b => ctx.decodeAudioData(b)).then(buffer => (sample = buffer)).catch(() => undefined);
}
function flush(ctx) {
  if (ctx.state !== "running") return;
  const tick = pending; pending = undefined;
  // A suspended context must not replay a backlog when iOS finally unlocks it.
  if (tick && Date.now() - tick.at <= 100) tick.play();
}
function whenRunning(ctx, play) {
  if (play) pending = { play, at: Date.now() };
  if (ctx.state === "running") return flush(ctx);
  if (ctx.state === "closed") { pending = undefined; return; }
  // Never coalesce resumes: a later touchend/click may carry the activation WebKit needs.
  try { ctx.resume().then(() => flush(ctx), () => {}); } catch {}
}
/** Wire to gesture starts; inert while sounds are off. */
export function unlockSound() {
  if (!settings.keySounds) return;
  const ctx = context();
  if (!ctx) return;
  whenRunning(ctx);
  load(ctx);
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination); source.onended = () => source.disconnect(); source.start();
  } catch {}
}
function sound(slip, preview) {
  if (!preview && !settings.keySounds) return;
  const ctx = context();
  if (!ctx) return;
  const tick = ++latest, at = Date.now();
  const play = (buffer) => {
    if (!buffer || tick !== latest || (!preview && !settings.keySounds) || ctx.state !== "running" || (!preview && Date.now() - at > 100)) return;
    try {
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = slip ? 0.85 : 1;
      gain.gain.setValueAtTime(slip ? 0.26 : 0.34, ctx.currentTime);
      source.connect(gain); gain.connect(ctx.destination);
      const cleanup = () => { active.delete(stop); source.disconnect(); gain.disconnect(); };
      const stop = () => { try { source.stop(); } catch {} cleanup(); };
      source.onended = cleanup; active.add(stop);
      source.start(ctx.currentTime);
    } catch {}
  };
  whenRunning(ctx, () => sample ? play(sample) : load(ctx).then(play));
}
function vibrate() {
  if (!settings.haptics || typeof navigator.vibrate !== "function") return;
  try { navigator.vibrate(8); } catch {}
}
/** One tick for a key or button press. Never call outside a user gesture. */
export function tick(slip = false) { vibrate(); sound(slip); }
export const previewSound = () => { const ctx = context(); if (ctx) { whenRunning(ctx); load(ctx); } sound(false, true); };

// App-wide: every button press ticks; physical typing in practice fields ticks.
document.addEventListener("pointerdown", unlockSound, { capture: true, passive: true });
document.addEventListener("keydown", unlockSound, { capture: true });
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("button");
  // Keys tick on pointerdown for immediacy; scripted overlay clicks were already felt.
  if (!button || button.disabled || button.closest("[data-keyboard]") || !event.isTrusted) return;
  sound(false); vibrate();
}, true);
document.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!event.target.matches?.("[data-practice-field]")) return;
  if (event.key.length === 1 || event.key === "Backspace" || event.key === "Enter") sound(false);
}, true);

// iOS haptic overlay: a transparent native <input switch> over each button. The
// user's own tap toggles it (WebKit ticks), then we click the button once.
const overlays = new Map();
let guardPending = 0, frame = 0;
const queued = new Set();
const mutate = (fn) => (guardPending ? queued.add(fn) : fn());
function attach(button) {
  let input, activating = false, focus = null, pressedTimer;
  const remember = () => { focus = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const tap = (event) => {
    // Never preventDefault: WebKit must toggle the switch to produce the tick.
    event.stopPropagation();
    if (!input || button.disabled || activating) return;
    const switchInput = input, previous = focus;
    focus = null; activating = true; guardPending++;
    setTimeout(() => {
      try {
        if (button.isConnected && !button.disabled) button.click(); // Exactly once, including form submit.
        if (previous?.isConnected && (document.activeElement === switchInput || document.activeElement === document.body)) previous.focus({ preventScroll: true });
        if (document.activeElement === switchInput) switchInput.blur();
      } finally {
        requestAnimationFrame(() => {
          activating = false;
          if (--guardPending === 0) { const fns = [...queued]; queued.clear(); fns.forEach(mutate); }
        });
      }
    }, 0);
    sound(false);
    button.classList.add("haptic-pressed");
    clearTimeout(pressedTimer);
    pressedTimer = setTimeout(() => button.classList.remove("haptic-pressed"), 150);
  };
  function remove() {
    input?.remove(); input = undefined;
    button.classList.remove("haptic-button", "haptic-pressed");
  }
  function position() {
    if (!input) return;
    const box = button.getBoundingClientRect(), parent = input.offsetParent, origin = parent?.getBoundingClientRect();
    input.style.left = `${origin ? box.left - origin.left + parent.scrollLeft - parent.clientLeft : box.left + scrollX}px`;
    input.style.top = `${origin ? box.top - origin.top + parent.scrollTop - parent.clientTop : box.top + scrollY}px`;
    input.style.width = `${box.width}px`; input.style.height = `${box.height}px`;
    input.style.borderRadius = getComputedStyle(button).borderRadius;
    input.style.display = button.offsetWidth && button.offsetHeight ? "block" : "none";
    if (input.disabled !== button.disabled) input.disabled = button.disabled;
  }
  function refresh() {
    if (!usesOverlay()) { if (input) remove(); return; }
    if (!input && button.parentNode) {
      if (!button.classList.contains("haptic-button")) button.classList.add("haptic-button");
      input = document.createElement("input");
      input.type = "checkbox"; input.setAttribute("switch", ""); input.setAttribute("aria-hidden", "true");
      input.tabIndex = -1; input.className = "haptic-overlay";
      input.addEventListener("pointerdown", remember); input.addEventListener("click", tap);
    }
    if (input && button.nextElementSibling !== input) button.after(input);
    position();
  }
  return { refresh, destroy: remove };
}
function scan() {
  if (!usesOverlay() && !overlays.size) return;
  mutate(() => {
    for (const [button, control] of overlays) if (!button.isConnected) { control.destroy(); overlays.delete(button); }
    for (const button of document.querySelectorAll("button")) {
      if (!overlays.has(button)) overlays.set(button, attach(button));
      overlays.get(button).refresh();
    }
  });
}
function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; scan(); }); }
const ours = (node) => node.classList?.contains("haptic-overlay");
new MutationObserver((records) => {
  // Ignore our own overlay insertions and attribute updates to avoid a scan loop.
  if (records.every(r => r.type === "childList" ? [...r.addedNodes, ...r.removedNodes].every(ours) : ours(r.target))) return;
  schedule();
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "class", "hidden"] });
addEventListener("resize", schedule);
document.addEventListener("scroll", schedule, true);
onDeviceSettings(schedule);
schedule();
