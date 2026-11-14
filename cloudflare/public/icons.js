// One authored icon set: 24px grid, 2px round strokes, currentColor.
const PATHS = {
  speaker: ["M4 9.5h3.5L12 5.5v13l-4.5-4H4z", "M15.5 9a4.2 4.2 0 0 1 0 6", "M18.5 6.5a8 8 0 0 1 0 11"],
  slow: ["M4 9.5h3.5L12 5.5v13l-4.5-4H4z", "M16 10.5a2.4 2.4 0 0 1 0 3"],
  sentence: ["M4 7h16", "M4 12h16", "M4 17h9"],
  backspace: ["M9 5h11v14H9l-6-7z", "M12.5 9.5l5 5", "M17.5 9.5l-5 5"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  back: ["M15 5l-7 7 7 7"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  lock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  unlock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2"],
  play: ["M8 5.5v13l10-6.5z"],
  star: ["M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"],
};
export function icon(name, {filled = false, label = ""} = {}) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon icon-" + name + (filled ? " filled" : ""));
  if (label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); }
  else svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
