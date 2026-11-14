import {createSharing} from './sharing.js';
import {initConnections,createConnection,connectionFields,handleMcp} from './mcp.js';
// REST/SQL port of ../server.js; grading logic remains shared in lib/practice.js.
import {checkSpelling,compareVerse,trickyWords,words,normalize,scheduleWord,reviewBank} from "../lib/practice.js";
import {isParent,equalSecret,signSession,cookie,hashPin,validPin,sha256} from "./auth.js";
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const str = (v, max = 500, required = true) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    fail("Invalid or missing text");
  return v.trim();
};
const integer = (v) => {
  if ((typeof v !== "number" && (typeof v !== "string" || !/^\d+$/.test(v))) || !Number.isSafeInteger(Number(v)) || Number(v) < 1) fail("Invalid ID");
  return Number(v);
};
const date = (v) => {
  if (!v) return "";
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    (Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v)
  )
    fail("Invalid date");
  return v;
};
export function createHandler(ctx, env) {
  const sql = ctx.storage.sql;
  sql.exec("CREATE TABLE IF NOT EXISTS family(id INTEGER PRIMARY KEY,name TEXT NOT NULL,pin_salt TEXT NOT NULL,pin_hash TEXT NOT NULL,session_epoch TEXT NOT NULL)");
  sql.exec(`CREATE TABLE IF NOT EXISTS kids(id INTEGER PRIMARY KEY,name TEXT NOT NULL,grade TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS lists(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),title TEXT NOT NULL,date TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,sample INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS words(id INTEGER PRIMARY KEY,list_id INTEGER NOT NULL REFERENCES lists(id),word TEXT NOT NULL,sentence TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS verses(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),reference TEXT NOT NULL,text TEXT NOT NULL,translation TEXT NOT NULL DEFAULT '',due_date TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,sample INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),list_id INTEGER REFERENCES lists(id),kind TEXT NOT NULL,created_at TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),list_id INTEGER NOT NULL REFERENCES lists(id),word_id INTEGER NOT NULL REFERENCES words(id),word TEXT NOT NULL,typed TEXT NOT NULL,correct INTEGER NOT NULL,first_try INTEGER NOT NULL,created_at TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id));
 CREATE TABLE IF NOT EXISTS verse_attempts(id INTEGER PRIMARY KEY,kid_id INTEGER NOT NULL REFERENCES kids(id),verse_id INTEGER NOT NULL REFERENCES verses(id),mode TEXT NOT NULL,level INTEGER NOT NULL,typed TEXT NOT NULL,accuracy INTEGER NOT NULL,created_at TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS attempts_session ON attempts(session_id);
 CREATE INDEX IF NOT EXISTS verse_attempts_session ON verse_attempts(session_id);
 CREATE INDEX IF NOT EXISTS attempts_kid ON attempts(kid_id,created_at);
 CREATE INDEX IF NOT EXISTS verse_attempts_kid ON verse_attempts(kid_id,created_at);`);
  initConnections(sql);
  const all = (query, ...p) => [...sql.exec(query, ...p)];
  const get = (query, ...p) => all(query, ...p)[0];
  const run = (query, ...p) => {
    sql.exec(query, ...p);
    return { lastInsertRowid: get("SELECT last_insert_rowid() id").id };
  };
  // Small additive migrations preserve data from early local builds.
  for (const [table, column, definition] of [
    ["attempts", "mode", "TEXT NOT NULL DEFAULT 'test'"],
    ["attempts", "step", "INTEGER NOT NULL DEFAULT 0"],
    ["sessions", "word_ids", "TEXT NOT NULL DEFAULT '[]'"],
    ["sessions", "full_list", "INTEGER NOT NULL DEFAULT 0"],
    ["verse_attempts", "verse_text", "TEXT NOT NULL DEFAULT ''"],
    ["verse_attempts", "verse_reference", "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === column))
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  sql.exec('CREATE TABLE IF NOT EXISTS ops_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS ops_daily(day TEXT PRIMARY KEY,test INTEGER NOT NULL DEFAULT 0,learn INTEGER NOT NULL DEFAULT 0,verse INTEGER NOT NULL DEFAULT 0,pin_lockouts INTEGER NOT NULL DEFAULT 0)');
  const metric=column=>{const day=new Date().toISOString().slice(0,10);sql.exec(`INSERT INTO ops_daily(day,${column}) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET ${column}=${column}+1`,day);sql.exec('DELETE FROM ops_daily WHERE day<?',new Date(Date.now()-30*86400000).toISOString().slice(0,10));};
  let txDepth=0;
  const tx = fn => { if(txDepth)return fn();return ctx.storage.transactionSync(()=>{txDepth++;try{return fn();}finally{txDepth--;}}); };
  const setting = (k, fallback) =>
    get("SELECT value FROM settings WHERE key=?", k)?.value || fallback;
  const settings = () => ({
    voice: setting("voice", ""),
    speed: Number(setting("speed", "1")),
    voices: [],
    serverTts: true,
  });
  sql.exec(`CREATE TABLE IF NOT EXISTS word_bank(kid_id INTEGER NOT NULL REFERENCES kids(id),key TEXT NOT NULL,word TEXT NOT NULL,word_id INTEGER NOT NULL,list_id INTEGER NOT NULL,box INTEGER NOT NULL,misses INTEGER NOT NULL,tested INTEGER NOT NULL,last_practiced TEXT NOT NULL,due TEXT NOT NULL,PRIMARY KEY(kid_id,key));
    CREATE INDEX IF NOT EXISTS word_bank_due ON word_bank(kid_id,due)`);
  for (const [column, definition] of [['sentence', "TEXT NOT NULL DEFAULT ''"], ['seen', 'INTEGER NOT NULL DEFAULT 0'], ['first_try_correct', 'INTEGER NOT NULL DEFAULT 0'], ['last_result', "TEXT NOT NULL DEFAULT 'learning'"]]) {
    if (!all('PRAGMA table_info(word_bank)').some(c=>c.name===column)) sql.exec(`ALTER TABLE word_bank ADD COLUMN ${column} ${definition}`);
  }
  const bankColumns = ['kid_id','key','word','word_id','list_id','box','misses','tested','last_practiced','due','sentence','seen','first_try_correct','last_result'];
  function saveBank(entry) {
    const columns = bankColumns.join(',');
    run(`INSERT INTO word_bank(${columns}) VALUES(${bankColumns.map(()=>'?').join(',')}) ON CONFLICT(kid_id,key) DO UPDATE SET ${bankColumns.slice(2).map(c=>`${c}=excluded.${c}`).join(',')}`,
      ...bankColumns.map(c=>c==='tested' ? +entry[c] : entry[c]));
  }
  function updateWordBank(a) {
    const key=normalize(a.word), old=get("SELECT * FROM word_bank WHERE kid_id=? AND key=?",a.kid_id,key);
    const entry=scheduleWord(old,a);
    if (!entry || entry===old) return;
    saveBank({...entry,kid_id:a.kid_id,key});
  }
  function backfillWordBank() {
    if (get("SELECT value FROM settings WHERE key='srs_backfill_v1'")) return;
    tx(()=>{
      sql.exec('DELETE FROM word_bank');
      for (const a of all('SELECT a.*,w.sentence FROM attempts a LEFT JOIN words w ON w.id=a.word_id ORDER BY a.id')) updateWordBank(a);
      run("INSERT INTO settings(key,value) VALUES('srs_backfill_v1','1')");
    });
  }
  backfillWordBank();
  function wordBank(kid) {
    if (!get('SELECT id FROM kids WHERE id=? AND archived=0',kid)) fail('Kid not found',404);
    // Point old/duplicate spellings at the newest active word in this kid's lists.
    const refs=new Map();
    for (const w of all('SELECT w.*,l.kid_id FROM words w JOIN lists l ON l.id=w.list_id WHERE l.kid_id=? ORDER BY (l.archived=0 AND w.archived=0),w.id',kid)) refs.set(normalize(w.word),w);
    return reviewBank(all('SELECT * FROM word_bank WHERE kid_id=?',kid).filter(w=>refs.has(w.key)).map(w=>{
      const ref=refs.get(w.key);
      return {...w,tested:!!w.tested,id:ref.id,word_id:ref.id,list_id:ref.list_id,word:ref.word,sentence:ref.sentence};
    }));
  }
  function pruneAttempts() {
    const old=all("SELECT id,kind FROM (SELECT id,0 kind,created_at FROM attempts UNION ALL SELECT id,1 kind,created_at FROM verse_attempts) ORDER BY created_at DESC,kind DESC,id DESC LIMIT -1 OFFSET 50000");
    for(const row of old) run(`DELETE FROM ${row.kind ? 'verse_attempts' : 'attempts'} WHERE id=?`,row.id);
  }
  const now = () => new Date().toISOString();
  function addList(b, sample = 0) {
    const kid = integer(b.kid_id);
    if (!b.id && get("SELECT COUNT(*) n FROM lists").n >= 200) fail("Maximum 200 lists");
    if (!get("SELECT id FROM kids WHERE id=? AND archived=0", kid))
      fail("Kid not found", 404);
    const title = str(b.title, 120),
      day = date(b.date) || now().slice(0, 10);
    if (!Array.isArray(b.words) || !b.words.length || b.words.length > 100)
      fail("Use 1–100 words");
    const ws = b.words.map((w) => {
      if (!w || typeof w !== "object" || Array.isArray(w)) fail("Invalid word");
      return {word: str(w.word,100), sentence: str(w.sentence ?? "",500,false)};
    });
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
    if (!b.id && get("SELECT COUNT(*) n FROM verses").n >= 300) fail("Maximum 300 verses");
    if (!get("SELECT id FROM kids WHERE id=? AND archived=0", kid))
      fail("Kid not found", 404);
    const args = [
      str(b.reference, 120),
      str(b.text, 2000),
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
  const sharing=createSharing(ctx,env,{all,get,addList,addVerse,tx});
  const prewarmList = () => {};
  const prewarmVerse = () => {};
  async function body(req, maxBytes = 256 * 1024) {
    const reader = req.request.body?.getReader();
    const chunks = []; let n = 0;
    if (reader) {
      try {
        while (true) {
          const {done,value} = await reader.read(); if (done) break;
          n += value.length;
          if (n > maxBytes) { await reader.cancel(); fail("Body too large",413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const data = new Uint8Array(n); let offset=0;
    for (const c of chunks) { data.set(c,offset); offset+=c.length; }
    try {
      const parsed=JSON.parse(new TextDecoder().decode(data));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Expected a JSON object");
      return parsed;
    } catch { fail("Invalid JSON object"); }
  }
  function progress(kid) {
    const a = all(
      "SELECT a.*,w.sentence FROM attempts a JOIN words w ON w.id=a.word_id WHERE a.kid_id=? AND a.mode='test' ORDER BY a.id",
      kid,
    );
    const learning = all("SELECT * FROM attempts WHERE kid_id=? AND mode='learn' ORDER BY id", kid);
    const va = all(
      "SELECT * FROM verse_attempts WHERE kid_id=? ORDER BY id DESC",
      kid,
    );
    const ss = all(
      "SELECT s.*,l.title FROM sessions s LEFT JOIN lists l ON l.id=s.list_id WHERE s.kid_id=? ORDER BY s.created_at DESC",
      kid,
    );
    const days = new Set([...a, ...learning, ...va].map((x) => x.created_at.slice(0, 10)));
    let streak = 0,
      d = new Date();
    if (!days.has(d.toISOString().slice(0, 10)))
      d.setUTCDate(d.getUTCDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    const charts = all(
      "SELECT l.id,l.title,l.date,COUNT(a.id) total,SUM(a.correct) correct FROM lists l LEFT JOIN attempts a ON a.list_id=l.id AND a.first_try=1 AND a.mode='test' WHERE l.kid_id=? GROUP BY l.id ORDER BY l.date,l.id",
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
      wordBank: wordBank(kid),
      listsCompleted: new Set(
        ss
          .filter((s) => s.completed && s.list_id && s.full_list)
          .map((s) => s.list_id),
      ).size,
      streak,
      learning: {attempts: learning.filter(a=>a.step!=='skip').length, skips: learning.filter(a=>a.step==='skip').length, wordsLearned: new Set(learning.filter(a => a.correct && a.step === 100).map(a => a.session_id + ":" + a.word_id)).size, sessionsCompleted: ss.filter(s => s.kind === "learn" && s.completed).length},
      learnAttempts: learning.slice(-200).reverse(),
      charts,
      tricky: trickyWords(a),
      mastery,
      sessions: ss.slice(0, 30),
      attempts: all("SELECT a.*,w.sentence FROM attempts a JOIN words w ON w.id=a.word_id WHERE a.kid_id=? ORDER BY a.id DESC LIMIT 200",kid),
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
      wordBank: all("SELECT * FROM word_bank"),
    };
  }
  function importBackup(b) {
    if (b?.format !== "family-practice" || b.version !== 1)
      fail("Not a version 1 family-practice backup");
    if (b.wordBank !== undefined) {
      if (!Array.isArray(b.wordBank) || b.wordBank.length>200000) fail('Invalid word bank');
      const seen=new Set();
      for (const w of b.wordBank) {
        if (!w || typeof w!=='object' || !Number.isSafeInteger(w.kid_id) || !b.kids?.some(k=>k.id===w.kid_id) || typeof w.key!=='string' || w.key!==normalize(w.word) || w.key.length>100 || !w.key || !Number.isSafeInteger(w.box) || w.box<1 || w.box>6 || !Number.isSafeInteger(w.misses) || w.misses<0 || ![0,1].includes(w.tested) || !Number.isSafeInteger(w.word_id) || !Number.isSafeInteger(w.list_id)) fail('Invalid word bank entry');
        str(w.word,100);str(w.sentence ?? '',500,false);
        for (const field of ['seen','first_try_correct']) if (w[field] !== undefined && (!Number.isSafeInteger(w[field]) || w[field]<0)) fail('Invalid word bank counts');
        if (w.last_result !== undefined && !['learning','miss','first_try_correct','retry_correct'].includes(w.last_result)) fail('Invalid word bank result');
        date(w.due);date(w.last_practiced);
        if (!w.due || !w.last_practiced || seen.has(w.kid_id+':'+w.key)) fail('Invalid word bank entry');
        seen.add(w.kid_id+':'+w.key);
      }
    }
    const textLimits={kids:{name:60,grade:30},lists:{title:120,date:10,source_slug:151,source_week_id:36,source_kind:10,source_note:140,source_class_name:80},words:{word:100,sentence:500},verses:{reference:120,text:2000,translation:60,due_date:10,source_slug:151,source_week_id:36,source_kind:10,source_note:140,source_class_name:80},attempts:{word:100,typed:200},verse_attempts:{verse_text:2000,verse_reference:120},settings:{key:20,value:200}};
    const schemas = Object.fromEntries(
      tables.map((t) => [t, all(`PRAGMA table_info(${t})`)]),
    );
    for (const t of tables) {
      if (!Array.isArray(b[t]) || b[t].length > 200000)
        fail("Invalid backup table " + t);
      for (const row of b[t]) {
        if (!row || typeof row !== "object" || Array.isArray(row))
          fail("Invalid backup row");
        if(t === "lists" || t === "verses"){row.source_slug ??= "";row.source_week_id ??= "";row.source_kind ??= "";row.source_note ??= "";row.source_class_name ??= "";}
        if (t === "attempts") { row.mode ??= "test"; row.step ??= 0; if(!["test","learn"].includes(row.mode) || (row.mode==="test" ? row.step!==0 : ![0,25,50,75,100,"skip"].includes(row.step))) fail("Invalid attempt mode/step"); }
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
            if (!Number.isSafeInteger(val) && !(t === "attempts" && col.name === "step" && row.mode === "learn" && val === "skip")) fail("Invalid integer");
          } else if (typeof val !== "string" || val.length > (textLimits[t]?.[col.name] ?? 10000))
            fail("Invalid backup text");
        }
      }
    }
    if (b.kids.length > 10 || b.lists.length > 200 || b.verses.length > 300 || b.sessions.length > 50100) fail("Family limits exceeded");
    if (b.verses.some(v=>v.text.length>2000) || b.lists.some(l=>b.words.filter(w=>w.list_id===l.id && !w.archived).length>100)) fail("Content limits exceeded");
    if (b.attempts.length + b.verse_attempts.length > 50000) fail("Maximum 50000 attempts");
    const attemptedSessions=new Set([...b.attempts,...b.verse_attempts].map(a=>a.session_id));
    if(b.sessions.filter(s=>!attemptedSessions.has(s.id)).length>100) fail("Maximum 100 empty sessions");
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
    
    if (
      imported.speed &&
      (!Number.isFinite(Number(imported.speed)) ||
        +imported.speed < 0.5 ||
        +imported.speed > 1.5)
    )
      fail("Invalid speed");
    try {
      tx(() => {
        sql.exec("DELETE FROM shared_imports; DELETE FROM word_bank");
        sql.exec("UPDATE class_follows SET last_imported='{}'");
        for (const t of [...tables].reverse()) sql.exec(`DELETE FROM ${t}`);
        for (const t of tables) {
          const cols = schemas[t].map((c) => c.name);
          for (const row of b[t])
            run(
              `INSERT INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`,
              ...cols.map((c) => row[c]),
            );
        }
        run("DELETE FROM settings WHERE key='srs_backfill_v1'");
        if (b.wordBank) {
          for (const w of b.wordBank) saveBank({...w,sentence:w.sentence ?? '',seen:w.seen ?? 0,first_try_correct:w.first_try_correct ?? 0,last_result:w.last_result ?? 'learning'});
        } else for (const a of all('SELECT a.*,w.sentence FROM attempts a LEFT JOIN words w ON w.id=a.word_id ORDER BY a.id')) updateWordBank(a);
        run("INSERT INTO settings(key,value) VALUES('srs_backfill_v1','1')");
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
  sql.exec("CREATE TABLE IF NOT EXISTS pin_limit(id INTEGER PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL)");
  return async (request) => {
    if(new URL(request.url).pathname==='/mcp') {
      if(!get('SELECT id FROM family WHERE id=1'))return Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
      return handleMcp(request,sql,async(name,b)=>{
        if(name==='get_shared_list')return sharing.read(b.url_or_slug??b.slug,b.week_id);
        if(name==='import_shared_list')return sharing.importShared(b);
        const resolveKid=value=>{
          const matches=all('SELECT id,name FROM kids WHERE archived=0').filter(k=>typeof value==='number'?k.id===value:k.name.toLocaleLowerCase()===value.toLocaleLowerCase());
          if(matches.length!==1)fail(matches.length?'More than one kid has that name; use an id':'Kid not found',404);
          return matches[0].id;
        };
        const list=id=>{const l=get('SELECT l.* FROM lists l JOIN kids k ON k.id=l.kid_id WHERE l.id=? AND k.archived=0',id);if(!l)fail('List not found',404);return {...l,words:all('SELECT id,word,sentence FROM words WHERE list_id=? AND archived=0 ORDER BY id',id)};};
        if(name==='list_kids')return {kids:all('SELECT id,name,grade FROM kids WHERE archived=0 ORDER BY id')};
        if(name==='get_spelling_list')return {list:list(b.list_id)};
        if(name==='update_spelling_list'){
          const old=list(b.list_id);
          return {list:list(addList({id:old.id,kid_id:old.kid_id,title:b.title??old.title,date:b.date??old.date,words:b.words??old.words}))};
        }
        const kid=resolveKid(b.kid);
        if(name==='list_spelling_lists')return {lists:all('SELECT l.id,l.title,l.date,l.archived,COUNT(w.id) word_count FROM lists l LEFT JOIN words w ON w.list_id=l.id AND w.archived=0 WHERE l.kid_id=? GROUP BY l.id ORDER BY l.date DESC,l.id DESC',kid).map(l=>({...l,archived:!!l.archived}))};
        if(name==='add_spelling_list')return {list:list(addList({...b,kid_id:kid,title:b.title??'Week of '+(b.date||now().slice(0,10))}))};
        if(name==='add_verse')return {id:addVerse({...b,kid_id:kid})};
        const data=progress(kid);
        return {listsCompleted:data.listsCompleted,streak:data.streak,charts:data.charts,
          wordBank:{counts:data.wordBank.counts,dueCount:data.wordBank.dueCount,struggling:data.wordBank.struggling.map(w=>({word:w.word,misses:w.misses}))},
          mastery:data.mastery.map(v=>({id:v.id,reference:v.reference,stars:v.stars}))};
      });
    }
    const headers = new Headers(); let status=200; let response;
    const req={request,url:request.url,method:request.method,headers:Object.fromEntries(request.headers)};
    req.headers.host=new URL(request.url).host;
    const res={headersSent:false,setHeader:(k,v)=>headers.set(k,v),writeHead:(s,h)=>{status=s;for(const [k,v] of Object.entries(h)) headers.set(k,v);},end:(data)=>{res.headersSent=true;response=new Response(data,{status,headers});}};
    await (async () => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
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
      if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) fail("Method not allowed", 405);
      if (
        ["POST","PATCH","DELETE"].includes(method) &&
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        fail("Cross-origin write denied", 403);
      if (
        ["POST","PATCH"].includes(method) &&
        !String(req.headers["content-type"] || "").startsWith(
          "application/json",
        )
      )
        fail("Send JSON", 415);
      let family = get("SELECT * FROM family WHERE id=1");
      if (p === "/api/internal/create" && method === "POST") {
        if (family) fail("Family already exists",409);
        const b = await body(req,2048);
        if (!validPin(b.pin)) fail("Choose a 4–8 digit PIN");
        const name=str(b.name ?? "",80,false), salt=crypto.randomUUID();
        const pinHash=await hashPin(b.pin,salt), epoch=crypto.randomUUID();
        run("INSERT INTO family VALUES(1,?,?,?,?)",name,salt,pinHash,epoch);
        sql.exec("INSERT OR REPLACE INTO ops_meta VALUES('created',?)",Date.now());
        const familyIdHash=await sha256(env.familyIdHash+epoch);
        res.setHeader("Set-Cookie",cookie(await signSession(env.SESSION_SECRET,familyIdHash),43200));
        return json({name},201);
      }
      if (!family) fail("Family not found",404);
      const sessionEnv={...env,familyIdHash:await sha256(env.familyIdHash+family.session_epoch)};
      const parent = await isParent(req.request, sessionEnv);
      async function verifyPin(pin) {
        const bucket=get("SELECT * FROM pin_limit WHERE id=1"), timestamp=Date.now();
        if(bucket && bucket.until>timestamp && bucket.count>=10) fail("Try again in 15 minutes",429);
        const matches=validPin(pin) && await equalSecret(await hashPin(pin,family.pin_salt),family.pin_hash);
        if(!matches) {
          const active=bucket && bucket.until>timestamp;
          run("INSERT INTO pin_limit(id,count,until) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET count=excluded.count,until=excluded.until",active?bucket.count+1:1,active?bucket.until:timestamp+900000);
          if((active?bucket.count+1:1)===10) metric("pin_lockouts");
          fail("That PIN did not match",401);
        }
        run("DELETE FROM pin_limit");
      }
      if (p === "/api/parent/unlock" && method === "POST") {
        const b=await body(req,2048);
        if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32) fail("Session secret not configured",503);
        await verifyPin(b.pin);
        res.setHeader("Set-Cookie",cookie(await signSession(env.SESSION_SECRET,sessionEnv.familyIdHash),43200));
        return json({ok:true});
      }
      if (p === "/api/parent/lock" && method === "POST") {
        res.setHeader("Set-Cookie",cookie("",0));
        return json({ok:true});
      }
      if (p === "/api/config" && method === "GET") return json({serverTts:true});
      if (p.startsWith("/api/admin/") && !parent)
        fail("Unlock Parent mode first", 401);
      if(p==='/api/follows'||/^\/api\/admin\/(shares|classes|import-shared|follows)(?:\/|$)/.test(p)) {
        const data=['POST','PATCH'].includes(method)?await body(req):{};
        const result=await sharing.route(p,method,data,parent,url.searchParams.get('refresh')==='1');
        if(result!==undefined)return json(result,method==='POST'&&['/api/admin/shares','/api/admin/classes'].includes(p)?201:200);
      }
      if(p==='/api/admin/connections' && method==='GET')return json({connections:all(`SELECT ${connectionFields} FROM mcp_connections ORDER BY created_at,id`)});
      if(p==='/api/admin/connections' && method==='POST')return json(await createConnection(sql,env.familyIdHash,await body(req,2048)),201);
      if(p==='/api/admin/connections/revoke' && method==='POST') {
        const b=await body(req,2048);const id=str(b.id,64);
        if(!get('SELECT id FROM mcp_connections WHERE id=?',id))fail('Connection not found',404);
        sql.exec('DELETE FROM mcp_connections WHERE id=?',id);sql.exec('DELETE FROM mcp_limits WHERE key=?','token:'+id);return json({ok:true});
      }
      if(p==='/api/admin/connections/revoke-all' && method==='POST'){await body(req,2048);sql.exec('DELETE FROM mcp_connections');sql.exec("DELETE FROM mcp_limits WHERE key LIKE 'token:%'");return json({ok:true});}
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
        return json({ kids, lists, verses, parent, family:{name:family.name}, settings: settings() });
      }
      if (p === "/api/tts/status" && method === "GET") return json({reachable:Boolean(env.AI?.run),cached:0,queued:0,serverTts:true});
      if (p === "/api/tts") fail("Route not found",404);
      if (p === "/api/progress" && method === "GET") {
        const data = progress(integer(url.searchParams.get("kid")));
        if (!parent) {
          delete data.attempts;
          delete data.learnAttempts;
          delete data.verseAttempts;
        }
        return json(data);
      }
      if (p === "/api/review" && method === "GET")
        return json(wordBank(integer(url.searchParams.get("kid"))));
      if (p === "/api/tricky" && method === "GET")
        return json(progress(integer(url.searchParams.get("kid"))).tricky);
      if (p === "/api/sessions" && method === "POST") {
        const b = await body(req),
          kid = integer(b.kid_id);
        if (!get("SELECT id FROM kids WHERE id=? AND archived=0", kid))
          fail("Kid not found", 404);
        if (!["spelling", "tricky", "verse", "learn", "review"].includes(b.kind))
          fail("Invalid session type");
        const list = b.list_id ? integer(b.list_id) : null;
        if (b.kind==='review' && list) fail('Review rounds span lists; omit list_id');
        if (
          list &&
          !get("SELECT id FROM lists WHERE id=? AND kid_id=? AND archived=0", list, kid)
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
            "SELECT w.list_id,l.kid_id,w.archived,l.archived list_archived FROM words w JOIN lists l ON l.id=w.list_id WHERE w.id=?",
            wordId,
          );
          if (!w || ((w.archived || w.list_archived) && !["review","tricky"].includes(b.kind)) || w.kid_id !== kid || (list && w.list_id !== list))
            fail("Word not in kid's round");
        }
        const fullList =
          b.kind === "spelling" &&
          list &&
          activeIds.length === wordIds.length &&
          activeIds.every((id) => wordIds.includes(id));
        // Retain at most 100 sessions without retained attempts. Attempt-backed
        // sessions are independently bounded by the 50k combined attempt cap.
        sql.exec(`DELETE FROM sessions WHERE id IN (
          SELECT s.id FROM sessions s
          WHERE NOT EXISTS(SELECT 1 FROM attempts a WHERE a.session_id=s.id)
            AND NOT EXISTS(SELECT 1 FROM verse_attempts a WHERE a.session_id=s.id)
          ORDER BY s.created_at DESC,s.id DESC LIMIT -1 OFFSET 99)`);
        const id = crypto.randomUUID();
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
        const abandoned = s.kind === 'learn' && (b.abandoned === true || b.skip === true);
        if (!count && !abandoned) fail("Practice first");
        if (s.kind !== "verse" && !abandoned) {
          const intended = JSON.parse(s.word_ids);
          const finished = all(
            s.kind==='learn' ? "SELECT word_id FROM attempts WHERE session_id=? AND mode='learn' AND step=100 AND correct=1 GROUP BY word_id" : "SELECT word_id FROM attempts WHERE session_id=? AND mode='test' GROUP BY word_id HAVING SUM(correct)>0 OR COUNT(*)>=2",
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
        if (!s || s.completed || !["spelling", "tricky", "learn", "review"].includes(s.kind))
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
        const mode=b.mode ?? (s.kind==='learn'?'learn':'test'), step=b.step ?? b.level ?? 0;
        if(!['test','learn'].includes(mode) || (mode==='test' ? step!==0 : ![0,25,50,75,100,'skip'].includes(step))) fail('Invalid attempt mode/step');
        const previous = all(
          "SELECT * FROM attempts WHERE session_id=? AND word_id=? AND mode=? AND step=?",s.id,w.id,mode,step);
        if((s.kind==='learn') !== (mode==='learn')) fail('Attempt mode does not match session');
        if (mode==='test' && (previous.length >= 2 || previous.some((a) => a.correct)))
          fail("Word already finished");
        const typed = str(b.typed, 200, false),
          correct = step !== 'skip' && checkSpelling(w.word, typed),
          first = step !== 'skip' && previous.length === 0;
        const created = now();
        run(
          "INSERT INTO attempts(kid_id,list_id,word_id,word,typed,correct,first_try,created_at,session_id,mode,step) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          s.kid_id,
          w.list_id,
          w.id,
          w.word,
          typed,
          +correct,
          +first,
          created,
          s.id,
          mode,
          step,
        );
        updateWordBank({kid_id:s.kid_id,word:w.word,sentence:w.sentence,word_id:w.id,list_id:w.list_id,correct,first_try:first,mode,step,created_at:created});
        metric(mode==='learn'?'learn':'test');
        pruneAttempts();
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
          level = b.level ?? 0;
        if (!Number.isSafeInteger(level) || level < 0 || level > 100) fail("Invalid level");
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
        metric("verse");
        pruneAttempts();
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
        } else {
          if(get("SELECT COUNT(*) n FROM kids").n>=10) fail("Maximum 10 kids");
          run("INSERT INTO kids(name,grade) VALUES(?,?)", name, grade);
        }
        return json({ ok: true });
      }
      if (p === "/api/admin/pin" && method === "POST") {
        const b=await body(req,2048); await verifyPin(b.currentPin);
        if(!validPin(b.pin)) fail("Choose a 4–8 digit PIN");
        const salt=crypto.randomUUID(),epoch=crypto.randomUUID();
        run("UPDATE family SET pin_salt=?,pin_hash=?,session_epoch=? WHERE id=1",salt,await hashPin(b.pin,salt),epoch);
        res.setHeader("Set-Cookie",cookie(await signSession(env.SESSION_SECRET,await sha256(env.familyIdHash+epoch)),43200));
        return json({ok:true});
      }
      if (p === "/api/admin/delete-family" && method === "POST") {
        const b=await body(req,2048); await verifyPin(b.pin);
        if(!b.confirmation || (b.confirmation !== family.name && b.confirmation !== env.familyCode)) fail("Type the family name or code exactly");
        if(env.SHARES)await sharing.stopAll();
        tx(()=>{sql.exec("DELETE FROM class_follows; DELETE FROM shared_imports; DELETE FROM mcp_connections; DELETE FROM mcp_limits; DELETE FROM word_bank");for(const t of [...tables].reverse()) sql.exec(`DELETE FROM ${t}`); sql.exec("DELETE FROM pin_limit; DELETE FROM family; DELETE FROM ops_meta; DELETE FROM ops_daily");});
        res.setHeader("Set-Cookie",cookie("",0)); return json({ok:true});
      }
      if (p === "/api/admin/remove-kid" && method === "POST") {
        const b=await body(req), id=integer(b.id);
        tx(()=>{
          for(const t of ["shared_imports","word_bank","attempts","verse_attempts","sessions"]) run(`DELETE FROM ${t} WHERE kid_id=?`,id);
          run("DELETE FROM words WHERE list_id IN (SELECT id FROM lists WHERE kid_id=?)",id);
          for(const t of ["lists","verses","kids"]) run(`DELETE FROM ${t} WHERE ${t==='kids'?'id':'kid_id'}=?`,id);
        }); return json({ok:true});
      }
      if (p === "/api/admin/sample" && method === "POST") {
        const b=await body(req), k=b.kid_id || get("SELECT id FROM kids WHERE archived=0 ORDER BY id LIMIT 1")?.id;
        if(!k) fail("Add a kid first");
        addList({kid_id:k,title:"Sample week",words:[{word:"friend",sentence:"My friend is kind."},{word:"light",sentence:"Turn on the light."}]},1);
        addVerse({kid_id:k,reference:"Psalm 56:3",text:"What time I am afraid, I will trust in thee.",translation:"KJV"},1);
        return json({ok:true});
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
          (typeof b.voice !== "string" || b.voice.length > 200) ||
          typeof b.speed !== "number" || !Number.isFinite(b.speed) ||
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
        importBackup(await body(req, 2 * 1024 * 1024));
        return json({ ok: true });
      }
      if (p.startsWith("/api/")) fail("Route not found", 404);
      fail("Route not found",404);
    } catch (e) {
      if (!res.headersSent) json({error:e.status ? e.message : "Something went wrong. Please try again."},e.status || 500);
      else res.end();
      if (!e.status) console.error(e);
    }
    })();
    return response;
  };
}
