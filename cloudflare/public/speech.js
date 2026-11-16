// DOM edge: the shell supplies live app state and cross-feature actions.
export function createSpeech(ctx) {
  let cooldown = 0,
    audio = null,
    speechGeneration = 0,
    cancelPending = null;
  const speechCache = new Map();
  const SPEECH_CACHE_LIMIT = 24;
  // Reuse one media element: iOS unlocks media per element, not per AudioContext.
  const speechPlayer = new Audio();
  speechPlayer.preload = "auto";
  let mediaUnlocked = false;
  function unlockSpeechPlayer() {
    if (mediaUnlocked) return;
    const bytes = new Uint8Array(46),
      data = new DataView(bytes.buffer);
    const label = (offset, text) =>
      [...text].forEach((c, i) => {
        bytes[offset + i] = c.charCodeAt(0);
      });
    label(0, "RIFF");
    data.setUint32(4, 38, true);
    label(8, "WAVEfmt ");
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, 1, true);
    data.setUint32(24, 22050, true);
    data.setUint32(28, 44100, true);
    data.setUint16(32, 2, true);
    data.setUint16(34, 16, true);
    label(36, "data");
    data.setUint32(40, 2, true);
    const silentURL = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    delete speechPlayer.dataset.voiceClip;
    speechPlayer.src = silentURL;
    // play() is invoked synchronously inside the gesture, before any session fetch.
    const playing = speechPlayer.play();
    mediaUnlocked = true;
    playing
      .then(() => {
        if (speechPlayer.src === silentURL) speechPlayer.pause();
      })
      .catch(() => {
        if (speechPlayer.src === silentURL) mediaUnlocked = false;
      })
      .finally(() => URL.revokeObjectURL(silentURL));
  }
  document.addEventListener("pointerdown", unlockSpeechPlayer, { capture: true, passive: true });
  document.addEventListener("keydown", unlockSpeechPlayer, { capture: true });
  const cloudVoice = () => ctx.state.settings.voice !== "device";
  function clearSpeechCache() {
    for (const entry of speechCache.values()) {
      entry.controller?.abort();
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    speechCache.clear();
  }
  function stopSpeaking() {
    speechGeneration++;
    if (audio) {
      audio.pause();
      audio = null;
    }
    // Cancel pending downloads as well as the active playback/utterance.
    for (const [key, entry] of speechCache) {
      if (entry.controller) {
        entry.controller.abort();
        speechCache.delete(key);
      }
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
        voices.find((v) => v.lang === "en-US" && /Chrome OS US English|Samantha|Ava/i.test(v.name)) ||
        voices.find((v) => v.lang === "en-US" && v.localService) ||
        voices.find((v) => v.lang === "en-US") ||
        null;
      u.lang = "en-US";
      u.rate = Math.max(0.5, Math.min(1.5, ctx.state.settings.speed * rate));
      u.onend = u.onerror = resolve;
      cancelPending = resolve;
      speechSynthesis.speak(u);
    });
  }
  function cloudClip(text) {
    const key = JSON.stringify([ctx.familyCode, text]);
    let entry = speechCache.get(key);
    if (entry) {
      speechCache.delete(key);
      speechCache.set(key, entry);
      return entry.promise;
    }
    const controller = new AbortController();
    entry = { controller, url: null, promise: null };
    const timer = setTimeout(() => controller.abort(), 4000);
    entry.promise = (async () => {
      try {
        const r = await ctx.familyFetch("/api/tts?" + new URLSearchParams({ text, lang: "en" }), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!r.ok) throw Error("Cloud voice unavailable");
        const blob = await r.blob();
        if (!blob.size || controller.signal.aborted) throw Error("Empty or canceled audio");
        entry.url = URL.createObjectURL(blob);
        entry.controller = null;
        return entry.url;
      } catch (err) {
        if (speechCache.get(key) === entry) speechCache.delete(key);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    })();
    speechCache.set(key, entry);
    while (speechCache.size > SPEECH_CACHE_LIMIT) {
      const [oldKey, old] = speechCache.entries().next().value;
      speechCache.delete(oldKey);
      old.controller?.abort();
      if (old.url) URL.revokeObjectURL(old.url);
    }
    return entry.promise;
  }
  function prefetchSpeech(texts) {
    if (!cloudVoice() || Date.now() < cooldown) return;
    for (const text of texts.filter(Boolean)) cloudClip(text).catch(() => {});
  }
  async function clip(text, rate, generation) {
    if (generation !== speechGeneration) return;
    if (!cloudVoice()) {
      ctx.$("voice-status").textContent = "Device voice active";
      return browserSay(text, rate, generation);
    }
    if (Date.now() < cooldown) return browserSay(text, rate, generation);
    let player;
    try {
      const url = await cloudClip(text);
      if (generation !== speechGeneration) return;
      player = speechPlayer;
      player.src = url;
      player.dataset.voiceClip = "true";
      audio = player;
      player.preservesPitch = true;
      player.playbackRate = Math.max(0.5, Math.min(1.5, ctx.state.settings.speed * rate));
      await new Promise((resolve, reject) => {
        cancelPending = resolve;
        player.onended = resolve;
        player.onerror = reject;
        player.play().catch(reject);
      });
      if (generation === speechGeneration) ctx.$("voice-status").textContent = "Cloud voice active";
    } catch {
      if (generation === speechGeneration) {
        player?.pause();
        cooldown = Date.now() + 60000;
        ctx.$("voice-status").textContent = "Device voice active · cloud voice temporarily unavailable";
        await browserSay(text, rate, generation);
      }
    } finally {
      if (audio === player) audio = null;
      if (generation === speechGeneration) cancelPending = null;
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

  function resetSpeechCooldown() {
    cooldown = 0;
  }

  return {
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
  };
}
