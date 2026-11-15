// Independent DOM hooks: no application state, family data, or credentials here.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
let installPrompt = null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; updateInstallHint();
});
window.addEventListener('appinstalled', () => { installPrompt = null; document.getElementById('install-hint')?.remove(); });
function updateInstallHint() {
  const app = document.getElementById('app');
  // Voice settings exist only in unlocked parent settings, on the Parent page.
  if (!app?.querySelector('#voice') || standalone()) { document.getElementById('install-hint')?.remove(); return; }
  let section = document.getElementById('install-hint');
  if (!section) {
    section = document.createElement('section'); section.id = 'install-hint'; section.className = 'card no-print';
    const heading = document.createElement('h2'); heading.textContent = 'Add to your home screen';
    section.append(heading); app.append(section);
  }
  const signature = `${ios}:${Boolean(installPrompt)}`;
  if (section.dataset.mode === signature) return;
  section.dataset.mode = signature;
  while (section.children.length > 1) section.lastElementChild.remove();
  const hint = document.createElement('p');
  hint.textContent = ios
    ? 'On iPhone or iPad, open this page in Safari. Tap Share, then Add to Home Screen (you may need to choose More first).'
    : 'Install Spellami for a home-screen shortcut. If no install button appears, use your browser menu and choose Install app or Add to Home screen.';
  section.append(hint);
  const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'An internet connection is still needed to load family data and save practice. Save your family code before changing devices or browsers.'; section.append(note);
  if (installPrompt) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Install Spellami';
    button.addEventListener('click', async () => {
      const prompt = installPrompt; if (!prompt) return;
      button.disabled = true;
      try { await prompt.prompt(); await prompt.userChoice; } catch {} finally { installPrompt = null; updateInstallHint(); }
    });
    section.append(button);
  }
}
new MutationObserver(updateInstallHint).observe(document.getElementById('app'), { childList: true, subtree: true });
updateInstallHint();
const offline = document.createElement('p'); offline.id = 'connection-status'; offline.className = 'notice no-print'; offline.setAttribute('role', 'status');
function updateConnection() { offline.hidden = navigator.onLine; offline.textContent = 'You’re offline. Connect to the internet to load family data and save practice.'; }
document.querySelector('header').after(offline);
window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection); updateConnection();
// Keep the active answer visible when the mobile keyboard changes the visual viewport.
let keyboardFrame = 0;
function revealInput() {
  cancelAnimationFrame(keyboardFrame);
  keyboardFrame = requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active?.matches('input:not([type="checkbox"]), textarea, select')) return;
    const viewport = window.visualViewport;
    const rect = active.getBoundingClientRect();
    if (rect.bottom > (viewport?.height || innerHeight) + (viewport?.offsetTop || 0) - 16 || rect.top < (viewport?.offsetTop || 0)) active.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
}
window.visualViewport?.addEventListener('resize', revealInput);
document.addEventListener('focusin', revealInput);
// Best-effort Web Audio gesture unlock. New HTMLAudioElement playback still depends
// on the browser's autoplay policy; the app's device-speech fallback remains intact.
let audioContext;
function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const source = audioContext.createBufferSource(); source.buffer = audioContext.createBuffer(1, 1, 22050); source.connect(audioContext.destination); source.start();
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

// Avoid accidental zoom while a child taps the practice keyboard. Single-finger
// scrolling remains native; iOS Safari may ignore the viewport zoom constraint.
if (ios) {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, event => event.preventDefault(), {passive: false});
  }
  document.addEventListener('touchmove', event => {
    if (event.touches.length > 1 || (typeof event.scale === 'number' && event.scale !== 1)) event.preventDefault();
  }, {passive: false});
}
