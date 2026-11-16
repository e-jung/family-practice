import {load} from './settings.js';
let previous, current, warned = false;
// A deployment supplies one immutable SETTINGS binding per isolate. Cache that load.
export function settingsFor(env = {}) {
  if (!current || previous !== env.SETTINGS) {
    previous = env.SETTINGS;
    const result = load(previous);
    current = result.value;
    if (result.errors.length && !warned) {
      console.error('Invalid or missing SETTINGS; using defaults:', result.errors.join('; '));
      warned = true;
    }
  }
  return current;
}
