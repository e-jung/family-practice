import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudioCache, VOICES } from "./lib/tts.js";
import {
  checkSpelling,
  compareVerse,
  trickyWords,
  words,
} from "./lib/practice.js";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const str = (v, max = 500, required = true) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    fail("Invalid or missing text");
  return v.trim();
};
const integer = (v) => {
  if (!Number.isSafeInteger(Number(v)) || Number(v) < 1) fail("Invalid ID");
  return Number(v);
};
const date = (v) => {
  if (!v) return "";
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(Date.parse(v))
  )
    fail("Invalid date");
  return v;
};
export function createApp({
  dataDir = process.env.DATA_DIR || path.join(ROOT, "data"),
  pin = process.env.PARENT_PIN || "1234",
  audio,
  seed = true,
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "app.db"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(`CREATE TABLE IF NOT EXISTS kids(id INTEGER PRIMARY KEY,name TEXT NOT NULL,grade TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS lists(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),title TEXT NOT NULL,date TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,sample INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS words(id INTEGER PRIMARY KEY,list_id INTEGER NOT NULL REFERENCES lists(id),word TEXT NOT NULL,sentence TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS verses(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),reference TEXT NOT NULL,text TEXT NOT NULL,translation TEXT NOT NULL DEFAULT '',due_date TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,sample INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),list_id INTEGER REFERENCES lists(id),kind TEXT NOT NULL,created_at TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),list_id INTEGER NOT NULL REFERENCES lists(id),word_id INTEGER NOT NULL REFERENCES words(id),word TEXT NOT NULL,typed TEXT NOT NULL,correct INTEGER NOT NULL,first_try INTEGER NOT NULL,created_at TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id));
 CREATE TABLE IF NOT EXISTS verse_attempts(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),verse_id INTEGER NOT NULL REFERENCES verses(id),mode TEXT NOT NULL,level INTEGER NOT NULL,typed TEXT NOT NULL,accuracy INTEGER NOT NULL,created_at TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS attempts_kid ON attempts(kid_id,created_at);
 CREATE INDEX IF NOT EXISTS verse_attempts_kid ON verse_attempts(kid_id,created_at);`);
  const all = (sql, ...p) => db.prepare(sql).all(...p),
    get = (sql, ...p) => db.prepare(sql).get(...p),
    run = (sql, ...p) => db.prepare(sql).run(...p);
  // Small additive migrations preserve data from early local builds.
  for (const [table, column, definition] of [
    ["sessions", "word_ids", "TEXT NOT NULL DEFAULT '[]'"],
    ["sessions", "full_list", "INTEGER NOT NULL DEFAULT 0"],
    ["verse_attempts", "verse_text", "TEXT NOT NULL DEFAULT ''"],
    ["verse_attempts", "verse_reference", "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      db.exec("COMMIT");
      return v;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const setting = (k, fallback) =>
    get("SELECT value FROM settings WHERE key=?", k)?.value || fallback;
  const settings = () => ({
    voice: setting("voice", process.env.PIPER_VOICE || VOICES[0]),
    speed: Number(setting("speed", "1")),
    voices: VOICES,
  });
  const now = () => new Date().toISOString();
  function addList(b, sample = 0) {
    const kid = integer(b.kid_id);
    if (!get("SELECT id FROM kids WHERE id=? AND archived=0", kid))
      fail("Kid not found", 404);
    const title = str(b.title, 120),
      day = date(b.date) || now().slice(0, 10);
    if (!Array.isArray(b.words) || !b.words.length || b.words.length > 100)
      fail("Use 1–100 words");
    const ws = b.words.map((w) => ({
      word: str(w.word, 100),
      sentence: str(w.sentence ?? "", 500, false),
    }));
    return tx(() => {
      let id = b.id ? integer(b.id) : null;
      if (id) {
        if (!get("SELECT id FROM lists WHERE id=? AND kid_id=?", id, kid))
          fail("List not found", 404);
        run("UPDATE lists SET title=?,date=? WHERE id=?", title, day, id);
        run("UPDATE words SET archived=1 WHERE list_id=?", id);
      } else
        id = Number(
          run(
            "INSERT INTO lists(kid_id,title,date,sample) VALUES(?,?,?,?)",
            kid,
            title,
            day,
            sample,
          ).lastInsertRowid,
        );
      for (const w of ws)
        run(
          "INSERT INTO words(list_id,word,sentence) VALUES(?,?,?)",
          id,
          w.word,
          w.sentence,
        );
      return id;
    });
  }
  function addVerse(b, sample = 0) {
    const kid = integer(b.kid_id);
    if (!get("SELECT id FROM kids WHERE id=? AND archived=0", kid))
      fail("Kid not found", 404);
    const args = [
      str(b.reference, 120),
      str(b.text, 6000),
      str(b.translation ?? "", 60, false),
      date(b.due_date),
    ];
    if (b.id) {
      const id = integer(b.id);
      if (!get("SELECT id FROM verses WHERE id=? AND kid_id=?", id, kid))
        fail("Verse not found", 404);
      run(
        "UPDATE verses SET reference=?,text=?,translation=?,due_date=? WHERE id=?",
        ...args,
        id,
      );
      return id;
    }
    return Number(
      run(
        "INSERT INTO verses(reference,text,translation,due_date,kid_id,sample) VALUES(?,?,?,?,?,?)",
        ...args,
        kid,
        sample,
      ).lastInsertRowid,
    );
  }
  const seededNow = seed && !get("SELECT id FROM kids LIMIT 1");
  if (seededNow) {
    tx(() => {
      run("INSERT INTO kids(name,grade) VALUES(?,?)", "Sam", "");
      run("INSERT INTO kids(name,grade) VALUES(?,?)", "Alex", "");
    });
    const samples = [
      [
        "journey",
        "We began our journey at sunrise.",
        "beautiful",
        "The garden is beautiful.",
        "because",
        "I smiled because you came.",
        "neighbor",
        "Our neighbor has a friendly dog.",
        "enough",
        "We have enough time to play.",
        "surprise",
        "The gift was a surprise.",
      ],
      [
        "friend",
        "My friend is kind.",
        "light",
        "Turn on the light.",
        "green",
        "The grass is green.",
        "happy",
        "I feel happy today.",
        "little",
        "The little bird can sing.",
        "school",
        "We walk to school.",
      ],
    ];
    for (let k = 1; k <= 2; k++) {
      const ws = [];
      for (let i = 0; i < samples[k - 1].length; i += 2)
        ws.push({ word: samples[k - 1][i], sentence: samples[k - 1][i + 1] });
      addList({ kid_id: k, title: "Sample week", words: ws }, 1);
    }
    addVerse(
      {
        kid_id: 1,
        reference: "Psalm 119:105",
        text: "Thy word is a lamp unto my feet, and a light unto my path.",
        translation: "KJV",
      },
      1,
    );
    addVerse(
      {
        kid_id: 2,
        reference: "Psalm 56:3",
        text: "What time I am afraid, I will trust in thee.",
        translation: "KJV",
      },
      1,
    );
  }
  audio ||= new AudioCache({ dir: path.join(dataDir, "tts") });
  const prewarmList = (id) =>
    audio.prewarm(
      all(
        "SELECT word,sentence FROM words WHERE list_id=? AND archived=0",
        id,
      ).flatMap((w) => [w.word, w.sentence]),
      settings().voice,
    );
  const prewarmVerse = (id) => {
    const v = get("SELECT * FROM verses WHERE id=?", id);
    audio.prewarm([v.reference, v.text], settings().voice);
  };
  if (seededNow) {
    for (const list of all("SELECT id FROM lists")) prewarmList(list.id);
    for (const verse of all("SELECT id FROM verses")) prewarmVerse(verse.id);
  }
  const tokens = new Map(),
    pinLimits = new Map();
  const pinHash = createHash("sha256").update(pin).digest();
  const isParent = (req) => {
    const token = (req.headers.cookie || "").match(
      /(?:^|;\s*)parent=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const expiry = tokens.get(token);
    if (expiry > Date.now()) return true;
    if (token) tokens.delete(token);
    return false;
  };
  async function body(req, maxBytes = 2 * 1024 * 1024) {
    let chunks = [],
      n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > maxBytes) fail("Body too large", 413);
      chunks.push(c);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        fail("Expected a JSON object");
      return parsed;
    } catch {
      fail("Invalid JSON object");
    }
  }
  function progress(kid) {
    const a = all(
      "SELECT a.*,w.sentence FROM attempts a JOIN words w ON w.id=a.word_id WHERE a.kid_id=? ORDER BY a.id",
      kid,
    );
    const va = all(
      "SELECT * FROM verse_attempts WHERE kid_id=? ORDER BY id DESC",
      kid,
    );
    const ss = all(
      "SELECT s.*,l.title FROM sessions s LEFT JOIN lists l ON l.id=s.list_id WHERE s.kid_id=? ORDER BY s.created_at DESC",
      kid,
    );
    const days = new Set([...a, ...va].map((x) => x.created_at.slice(0, 10)));
    let streak = 0,
      d = new Date();
    if (!days.has(d.toISOString().slice(0, 10)))
      d.setUTCDate(d.getUTCDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    const charts = all(
      "SELECT l.id,l.title,l.date,COUNT(a.id) total,SUM(a.correct) correct FROM lists l LEFT JOIN attempts a ON a.list_id=l.id AND a.first_try=1 WHERE l.kid_id=? GROUP BY l.id ORDER BY l.date,l.id",
      kid,
    ).map((x) => ({
      ...x,
      accuracy: x.total ? Math.round((100 * x.correct) / x.total) : 0,
    }));
    const mastery = all("SELECT * FROM verses WHERE kid_id=?", kid).map((v) => {
      const recent = va
        .filter(
          (a) =>
            a.verse_id === v.id &&
            a.verse_text === v.text &&
            a.verse_reference === v.reference,
        )
        .slice(0, 10);
      const best = Math.max(
        0,
        ...recent.filter((a) => a.mode !== "read").map((a) => a.accuracy),
      );
      const advanced = recent.some(
        (a) => ["memory", "first"].includes(a.mode) && a.accuracy >= 95,
      );
      return {
        id: v.id,
        reference: v.reference,
        best,
        stars: best >= 95 ? (advanced ? 3 : 2) : best >= 70 ? 1 : 0,
        attempts: recent.length,
      };
    });
    return {
      listsCompleted: new Set(
        ss
          .filter((s) => s.completed && s.list_id && s.full_list)
          .map((s) => s.list_id),
      ).size,
      streak,
      charts,
      tricky: trickyWords(a),
      mastery,
      sessions: ss.slice(0, 30),
      attempts: a.slice(-200).reverse(),
      verseAttempts: va.slice(0, 100),
    };
  }
  const tables = [
    "kids",
    "lists",
    "words",
    "verses",
    "sessions",
    "attempts",
    "verse_attempts",
    "settings",
  ];
  function backup() {
    return {
      format: "family-practice",
      version: 1,
      exported_at: now(),
      ...Object.fromEntries(tables.map((t) => [t, all(`SELECT * FROM ${t}`)])),
    };
  }
  function importBackup(b) {
    if (b?.format !== "family-practice" || b.version !== 1)
      fail("Not a version 1 family-practice backup");
    const schemas = Object.fromEntries(
      tables.map((t) => [t, all(`PRAGMA table_info(${t})`)]),
    );
    for (const t of tables) {
      if (!Array.isArray(b[t]) || b[t].length > 200000)
        fail("Invalid backup table " + t);
      for (const row of b[t]) {
        if (!row || typeof row !== "object" || Array.isArray(row))
          fail("Invalid backup row");
        if (t === "sessions") {
          row.word_ids ??= "[]";
          row.full_list ??= 0;
        }
        if (t === "verse_attempts") {
          row.verse_text ??= "";
          row.verse_reference ??= "";
        }
        for (const col of schemas[t]) {
          const val = row[col.name];
          if (val === undefined) fail("Missing backup field " + col.name);
          if (val === null) {
            if (col.notnull) fail("Null backup field");
          } else if (col.type === "INTEGER") {
            if (!Number.isSafeInteger(val)) fail("Invalid integer");
          } else if (typeof val !== "string" || val.length > 10000)
            fail("Invalid backup text");
        }
      }
    }
    if (!b.kids.some((k) => !k.archived)) fail("Backup needs an active kid");
    const ids = Object.fromEntries(
      tables
        .filter((t) => t !== "settings")
        .map((t) => [t, new Set(b[t].map((r) => r.id))]),
    );
    for (const t of tables.filter((t) => t !== "settings"))
      if (ids[t].size !== b[t].length) fail("Duplicate backup IDs");
    for (const t of [
      "lists",
      "verses",
      "sessions",
      "attempts",
      "verse_attempts",
    ])
      for (const row of b[t])
        if (!ids.kids.has(row.kid_id)) fail("Broken kid reference");
    for (const row of b.words)
      if (!ids.lists.has(row.list_id)) fail("Broken list reference");
    for (const row of b.sessions)
      if (row.list_id !== null && !ids.lists.has(row.list_id))
        fail("Broken session list reference");
    for (const row of b.attempts)
      if (
        !ids.words.has(row.word_id) ||
        !ids.lists.has(row.list_id) ||
        !ids.sessions.has(row.session_id)
      )
        fail("Broken attempt reference");
    for (const row of b.verse_attempts)
      if (!ids.verses.has(row.verse_id) || !ids.sessions.has(row.session_id))
        fail("Broken verse attempt reference");
    const imported = Object.fromEntries(
      b.settings.map((s) => [s.key, s.value]),
    );
    if (imported.voice && !VOICES.includes(imported.voice))
      fail("Unknown voice in backup");
    if (
      imported.speed &&
      (!Number.isFinite(Number(imported.speed)) ||
        +imported.speed < 0.5 ||
        +imported.speed > 1.5)
    )
      fail("Invalid speed");
    try {
      tx(() => {
        for (const t of [...tables].reverse()) db.exec(`DELETE FROM ${t}`);
        for (const t of tables) {
          const cols = schemas[t].map((c) => c.name);
          for (const row of b[t])
            run(
              `INSERT INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`,
              ...cols.map((c) => row[c]),
            );
        }
        if (all("PRAGMA foreign_key_check").length)
          fail("Broken backup references");
      });
    } catch (e) {
      fail("Invalid backup: " + e.message);
    }
    for (const l of all("SELECT id FROM lists WHERE archived=0"))
      prewarmList(l.id);
    for (const v of all("SELECT id FROM verses WHERE archived=0"))
      prewarmVerse(v.id);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const json = (data, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost"),
        p = url.pathname,
        method = req.method;
      if (!["GET", "POST"].includes(method)) fail("Method not allowed", 405);
      if (
        method === "POST" &&
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        fail("Cross-origin write denied", 403);
      if (
        method === "POST" &&
        !String(req.headers["content-type"] || "").startsWith(
          "application/json",
        )
      )
        fail("Send JSON", 415);
      const parent = isParent(req);
      if (p === "/api/parent/unlock" && method === "POST") {
        const b = await body(req),
          ip = req.socket.remoteAddress,
          limit = pinLimits.get(ip) || { count: 0, until: Date.now() + 60000 };
        if (Date.now() > limit.until) {
          limit.count = 0;
          limit.until = Date.now() + 60000;
        }
        pinLimits.set(ip, limit);
        if (limit.count >= 10) fail("Try again in a minute", 429);
        const given =
          typeof b.pin === "string" && b.pin.length <= 1000 ? b.pin : "";
        if (
          !timingSafeEqual(pinHash, createHash("sha256").update(given).digest())
        ) {
          limit.count++;
          fail("That PIN did not match", 401);
        }
        limit.count = 0;
        for (const [t, e] of tokens) if (e < Date.now()) tokens.delete(t);
        const token = randomBytes(32).toString("hex");
        tokens.set(token, Date.now() + 8 * 3600000);
        res.setHeader(
          "Set-Cookie",
          `parent=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return json({ ok: true });
      }
      if (p === "/api/parent/lock" && method === "POST") {
        const token = (req.headers.cookie || "").match(
          /parent=([a-f0-9]{64})/,
        )?.[1];
        tokens.delete(token);
        res.setHeader(
          "Set-Cookie",
          "parent=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json({ ok: true });
      }
      if (p.startsWith("/api/admin/") && !parent)
        fail("Unlock Parent mode first", 401);
      if (p === "/api/state" && method === "GET") {
        const kids = all("SELECT * FROM kids WHERE archived=0 ORDER BY id");
        const kid = url.searchParams.has("kid")
          ? integer(url.searchParams.get("kid"))
          : null;
        const lists = kid
          ? all(
              "SELECT * FROM lists WHERE kid_id=? ORDER BY date DESC,id DESC",
              kid,
            )
              .filter((l) => parent || !l.archived)
              .map((l) => ({
                ...l,
                words: all(
                  "SELECT * FROM words WHERE list_id=? AND archived=0 ORDER BY id",
                  l.id,
                ),
              }))
          : [];
        const verses = kid
          ? all(
              "SELECT * FROM verses WHERE kid_id=? ORDER BY id DESC",
              kid,
            ).filter((v) => parent || !v.archived)
          : [];
        return json({ kids, lists, verses, parent, settings: settings() });
      }
      if (p === "/api/tts/status" && method === "GET") {
        await audio.probe();
        return json(await audio.status());
      }
      if (p === "/api/tts" && method === "GET") {
        const text = str(url.searchParams.get("text"), 6000),
          voice = url.searchParams.get("voice") || settings().voice;
        if (!VOICES.includes(voice)) fail("Unknown voice");
        try {
          const b = await audio.get(text, voice);
          res.writeHead(200, {
            "Content-Type": "audio/wav",
            "Cache-Control": "private, max-age=31536000, immutable",
          });
          return res.end(b);
        } catch {
          return json(
            {
              error: "Piper unavailable. Please use browser speech.",
              fallback: true,
            },
            503,
          );
        }
      }
      if (p === "/api/progress" && method === "GET") {
        const data = progress(integer(url.searchParams.get("kid")));
        if (!parent) {
          delete data.attempts;
          delete data.verseAttempts;
        }
        return json(data);
      }
      if (p === "/api/tricky" && method === "GET")
        return json(progress(integer(url.searchParams.get("kid"))).tricky);
      if (p === "/api/sessions" && method === "POST") {
        const b = await body(req),
          kid = integer(b.kid_id);
        if (!get("SELECT id FROM kids WHERE id=? AND archived=0", kid))
          fail("Kid not found", 404);
        if (!["spelling", "tricky", "verse"].includes(b.kind))
          fail("Invalid session type");
        const list = b.list_id ? integer(b.list_id) : null;
        if (
          list &&
          !get("SELECT id FROM lists WHERE id=? AND kid_id=?", list, kid)
        )
          fail("List not found", 404);
        const activeIds = list
          ? all(
              "SELECT id FROM words WHERE list_id=? AND archived=0",
              list,
            ).map((w) => w.id)
          : [];
        let wordIds = b.kind === "verse" ? [] : (b.word_ids ?? activeIds);
        if (
          !Array.isArray(wordIds) ||
          wordIds.length > 500 ||
          new Set(wordIds).size !== wordIds.length ||
          wordIds.some((id) => !Number.isSafeInteger(id))
        )
          fail("Invalid round words");
        if (b.kind !== "verse" && !wordIds.length)
          fail("Choose words for this round");
        for (const wordId of wordIds) {
          const w = get(
            "SELECT w.list_id,l.kid_id FROM words w JOIN lists l ON l.id=w.list_id WHERE w.id=?",
            wordId,
          );
          if (!w || w.kid_id !== kid || (list && w.list_id !== list))
            fail("Word not in kid's round");
        }
        const fullList =
          b.kind === "spelling" &&
          list &&
          activeIds.length === wordIds.length &&
          activeIds.every((id) => wordIds.includes(id));
        const id = randomBytes(16).toString("hex");
        run(
          "INSERT INTO sessions(id,kid_id,list_id,kind,created_at,word_ids,full_list) VALUES(?,?,?,?,?,?,?)",
          id,
          kid,
          list,
          b.kind,
          now(),
          JSON.stringify(wordIds),
          +!!fullList,
        );
        return json({ id }, 201);
      }
      if (p === "/api/sessions/complete" && method === "POST") {
        const b = await body(req);
        const s = get(
          "SELECT * FROM sessions WHERE id=?",
          str(b.session_id, 64),
        );
        if (!s) fail("Session not found", 404);
        const count =
          s.kind === "verse"
            ? get(
                "SELECT COUNT(*) n FROM verse_attempts WHERE session_id=?",
                s.id,
              ).n
            : get("SELECT COUNT(*) n FROM attempts WHERE session_id=?", s.id).n;
        if (!count) fail("Practice first");
        if (s.kind !== "verse") {
          const intended = JSON.parse(s.word_ids);
          const finished = all(
            "SELECT word_id FROM attempts WHERE session_id=? GROUP BY word_id HAVING SUM(correct)>0 OR COUNT(*)>=2",
            s.id,
          ).map((a) => a.word_id);
          if (intended.some((id) => !finished.includes(id)))
            fail("Finish every word in this round first");
        }
        run("UPDATE sessions SET completed=1 WHERE id=?", s.id);
        return json({ ok: true });
      }
      if (p === "/api/attempts" && method === "POST") {
        const b = await body(req),
          s = get("SELECT * FROM sessions WHERE id=?", str(b.session_id, 64));
        if (!s || s.completed || !["spelling", "tricky"].includes(s.kind))
          fail("Invalid or finished session");
        const w = get(
          "SELECT w.*,l.kid_id FROM words w JOIN lists l ON l.id=w.list_id WHERE w.id=?",
          integer(b.word_id),
        );
        if (
          !w ||
          w.kid_id !== s.kid_id ||
          (s.list_id && s.list_id !== w.list_id) ||
          !JSON.parse(s.word_ids).includes(w.id)
        )
          fail("Word not in session");
        const previous = all(
          "SELECT * FROM attempts WHERE session_id=? AND word_id=?",
          s.id,
          w.id,
        );
        if (previous.length >= 2 || previous.some((a) => a.correct))
          fail("Word already finished");
        const typed = str(b.typed, 200, false),
          correct = checkSpelling(w.word, typed),
          first = previous.length === 0;
        run(
          "INSERT INTO attempts(kid_id,list_id,word_id,word,typed,correct,first_try,created_at,session_id) VALUES(?,?,?,?,?,?,?,?,?)",
          s.kid_id,
          w.list_id,
          w.id,
          w.word,
          typed,
          +correct,
          +first,
          now(),
          s.id,
        );
        return json({
          correct,
          first_try: first,
          reveal: !correct && !first,
          word: !correct && !first ? w.word : undefined,
        });
      }
      if (p === "/api/verse-attempts" && method === "POST") {
        const b = await body(req),
          s = get("SELECT * FROM sessions WHERE id=?", str(b.session_id, 64)),
          v = get("SELECT * FROM verses WHERE id=?", integer(b.verse_id));
        if (
          !s ||
          s.completed ||
          s.kind !== "verse" ||
          !v ||
          s.kid_id !== v.kid_id
        )
          fail("Invalid verse session");
        if (
          !["read", "blanks", "first", "memory", "reference"].includes(b.mode)
        )
          fail("Invalid verse mode");
        const typed = str(b.typed ?? "", 10000, false);
        let expected = b.mode === "reference" ? v.reference : v.text,
          level = Number(b.level) || 0;
        if (b.mode === "blanks") {
          const ws = words(v.text);
          if (
            ![25, 50, 75, 100].includes(level) ||
            !Array.isArray(b.indices) ||
            b.indices.length !== Math.ceil((ws.length * level) / 100) ||
            new Set(b.indices).size !== b.indices.length ||
            b.indices.some(
              (i) => !Number.isInteger(i) || i < 0 || i >= ws.length,
            )
          )
            fail("Invalid blank selection");
          expected = b.indices.map((i) => ws[i]).join(" ");
        }
        const result =
          b.mode === "read"
            ? { accuracy: 0, details: [] }
            : compareVerse(expected, typed);
        run(
          "INSERT INTO verse_attempts(kid_id,verse_id,mode,level,typed,accuracy,created_at,session_id,verse_text,verse_reference) VALUES(?,?,?,?,?,?,?,?,?,?)",
          s.kid_id,
          v.id,
          b.mode,
          level,
          typed,
          result.accuracy,
          now(),
          s.id,
          v.text,
          v.reference,
        );
        return json(result);
      }
      if (p === "/api/admin/kids" && method === "POST") {
        const b = await body(req);
        const name = str(b.name, 60),
          grade = str(b.grade ?? "", 30, false);
        if (b.id) {
          const id = integer(b.id);
          if (!get("SELECT id FROM kids WHERE id=?", id))
            fail("Kid not found", 404);
          run("UPDATE kids SET name=?,grade=? WHERE id=?", name, grade, id);
        } else run("INSERT INTO kids(name,grade) VALUES(?,?)", name, grade);
        return json({ ok: true });
      }
      if (p === "/api/admin/lists" && method === "POST") {
        const id = addList(await body(req));
        prewarmList(id);
        return json({ id }, 201);
      }
      if (p === "/api/admin/verses" && method === "POST") {
        const id = addVerse(await body(req));
        prewarmVerse(id);
        return json({ id }, 201);
      }
      if (p === "/api/admin/archive" && method === "POST") {
        const b = await body(req);
        if (!["lists", "verses"].includes(b.type)) fail("Invalid archive type");
        run(
          `UPDATE ${b.type} SET archived=? WHERE id=?`,
          b.archived === false ? 0 : 1,
          integer(b.id),
        );
        return json({ ok: true });
      }
      if (p === "/api/admin/settings" && method === "POST") {
        const b = await body(req);
        if (
          !VOICES.includes(b.voice) ||
          typeof b.speed !== "number" ||
          b.speed < 0.5 ||
          b.speed > 1.5
        )
          fail("Invalid settings");
        tx(() => {
          for (const [k, v] of Object.entries({
            voice: b.voice,
            speed: b.speed,
          }))
            run(
              "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              k,
              String(v),
            );
        });
        for (const l of all("SELECT id FROM lists WHERE archived=0"))
          prewarmList(l.id);
        for (const v of all("SELECT id FROM verses WHERE archived=0"))
          prewarmVerse(v.id);
        return json({ ok: true });
      }
      if (p === "/api/admin/export" && method === "GET") {
        const b = backup();
        if (url.searchParams.get("format") === "csv") {
          const cols = [
            ...new Set(
              tables.flatMap((t) =>
                all(`PRAGMA table_info(${t})`).map((c) => c.name),
              ),
            ),
          ];
          const rows = [
            ["table", ...cols],
            ...tables.flatMap((t) =>
              b[t].map((r) => [t, ...cols.map((c) => r[c] ?? "")]),
            ),
          ];
          const cell = (x) => '"' + String(x).replaceAll('"', '""') + '"';
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="family-practice.csv"',
            "Cache-Control": "no-store",
          });
          return res.end(rows.map((r) => r.map(cell).join(",")).join("\r\n"));
        }
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="family-practice.json"',
        );
        return json(b);
      }
      if (p === "/api/admin/import" && method === "POST") {
        importBackup(await body(req, 32 * 1024 * 1024));
        return json({ ok: true });
      }
      if (p.startsWith("/api/")) fail("Route not found", 404);
      const assets = {
          "/": ["index.html", "text/html"],
          "/app.js": ["app.js", "text/javascript"],
          "/style.css": ["style.css", "text/css"],
        },
        asset = assets[p];
      if (!asset) fail("Not found", 404);
      res.writeHead(200, {
        "Content-Type": asset[1] + "; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(readFileSync(path.join(ROOT, "public", asset[0])));
    } catch (e) {
      if (!res.headersSent)
        json(
          {
            error: e.status
              ? e.message
              : "Something went wrong. Please try again.",
          },
          e.status || 500,
        );
      else res.end();
      if (!e.status) console.error(e);
    }
  });
  return {
    server,
    db,
    audio,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        }),
      ),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApp();
  const port = Number(process.env.PORT || 8088);
  app.server.listen(port, process.env.HOST || "0.0.0.0", () =>
    console.log(`Spellami listening on port ${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => app.close().then(() => process.exit(0)));
}
