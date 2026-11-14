import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server.js";
async function fixture(t) {
  const dir = await mkdtemp(path.resolve("test/.tmp-api-"));
  const warmed = [];
  const audio = {
    prewarm: (clips, voice) => warmed.push({ clips, voice }),
    probe: async () => {},
    status: async () => ({ reachable: false, cached: 0, retryAfter: 60 }),
    get: async () => {
      throw Error("offline");
    },
  };
  const app = createApp({ dataDir: dir, audio, pin: "5678" });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + app.server.address().port;
  let cookie = "";
  async function req(p, data, headers = {}) {
    return new Promise((resolve, reject) => {
      const payload = data === undefined ? null : JSON.stringify(data);
      const r = http.request(
        base + p,
        {
          method: payload ? "POST" : "GET",
          headers: {
            ...(payload
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
            Cookie: cookie,
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            if (res.headers["set-cookie"])
              cookie = res.headers["set-cookie"][0].split(";")[0];
            const text = Buffer.concat(chunks).toString();
            resolve({
              status: res.statusCode,
              body: (res.headers["content-type"] || "").includes("json")
                ? JSON.parse(text)
                : text,
            });
          });
        },
      );
      r.on("error", reject);
      r.end(payload);
    });
  }
  return { req, app, warmed, base };
}
test("API seeds kids, protects parent data, writes lists, records attempts and progress", async (t) => {
  const { req, warmed } = await fixture(t);
  const initial = await req("/api/state?kid=1");
  assert.equal(initial.body.kids.length, 2);
  assert.equal(initial.body.lists[0].words.length, 6);
  assert.equal(
    (await req("/api/admin/lists", { kid_id: 1, title: "test", words: [] }))
      .status,
    401,
  );
  assert.equal((await req("/api/admin/export")).status, 401);
  assert.equal((await req("/api/parent/unlock", { pin: "wrong" })).status, 401);
  assert.equal((await req("/api/parent/unlock", { pin: "5678" })).status, 200);
  const created = await req("/api/admin/lists", {
    kid_id: 1,
    title: "Week test",
    date: "2026-11-13",
    words: [{ word: "neighbor", sentence: "Our neighbor is kind." }],
  });
  assert.equal(created.status, 201);
  assert.equal(warmed.at(-1).clips.length, 2);
  const state = (await req("/api/state?kid=1")).body;
  const list = state.lists.find((l) => l.id === created.body.id);
  const session = (
    await req("/api/sessions", {
      kid_id: 1,
      list_id: list.id,
      kind: "spelling",
    })
  ).body;
  const attempt = await req("/api/attempts", {
    session_id: session.id,
    word_id: list.words[0].id,
    typed: "neighbr",
  });
  assert.equal(attempt.body.correct, false);
  assert.equal(attempt.body.first_try, true);
  const retry = await req("/api/attempts", {
    session_id: session.id,
    word_id: list.words[0].id,
    typed: " Neighbor ",
  });
  assert.equal(retry.body.correct, true);
  assert.equal(retry.body.first_try, false);
  assert.equal(
    (
      await req("/api/attempts", {
        session_id: session.id,
        word_id: list.words[0].id,
        typed: "neighbor",
      })
    ).status,
    400,
  );
  await req("/api/sessions/complete", { session_id: session.id });
  const p = (await req("/api/progress?kid=1")).body;
  assert.equal(p.listsCompleted, 1);
  assert.equal(p.charts.find((l) => l.id === list.id).accuracy, 0);
  assert.equal(p.tricky[0].word, "neighbor");
  assert.equal(p.attempts.length, 2);
  assert.equal((await req("/api/progress?kid=2")).body.attempts.length, 0);
  assert.equal((await req("/api/tts/status")).body.reachable, false);
  assert.equal((await req("/api/tts?text=hello")).status, 503);
  assert.equal((await req("/api/parent/lock", {})).status, 200);
  assert.equal((await req("/api/admin/export")).status, 401);
});
test("API verse checking, kid management, settings and transactional backup restore", async (t) => {
  const { req, warmed } = await fixture(t);
  await req("/api/parent/unlock", { pin: "5678" });
  await req("/api/admin/kids", { name: "Casey", grade: "K" });
  assert.equal((await req("/api/state")).body.kids.length, 3);
  await req("/api/admin/kids", { id: 3, name: "Riley", grade: "1" });
  assert.equal((await req("/api/state")).body.kids[2].name, "Riley");
  const created = await req("/api/admin/verses", {
    kid_id: 3,
    reference: "John 11:35",
    text: "Jesus wept.",
    translation: "KJV",
  });
  assert.equal(warmed.at(-1).clips.length, 2);
  const session = (await req("/api/sessions", { kid_id: 3, kind: "verse" }))
    .body;
  const result = await req("/api/verse-attempts", {
    session_id: session.id,
    verse_id: created.body.id,
    mode: "memory",
    typed: "JESUS WEPT!",
  });
  assert.equal(result.body.accuracy, 100);
  await req("/api/sessions/complete", { session_id: session.id });
  assert.equal((await req("/api/progress?kid=3")).body.mastery[0].stars, 3);
  const settings = await req("/api/admin/settings", {
    voice: "en_US-ryan-high",
    speed: 0.8,
  });
  assert.equal(settings.status, 200);
  assert.equal((await req("/api/state")).body.settings.speed, 0.8);
  const backup = (await req("/api/admin/export")).body;
  assert.equal(backup.format, "family-practice");
  const bad = structuredClone(backup);
  bad.words[0].list_id = 9999;
  assert.equal((await req("/api/admin/import", bad)).status, 400);
  assert.equal((await req("/api/state")).body.kids.length, 3);
  await req("/api/admin/kids", { name: "Temporary" });
  assert.equal((await req("/api/admin/import", backup)).status, 200);
  assert.equal((await req("/api/state")).body.kids.length, 3);
  assert.match(
    (await req("/api/admin/export?format=csv")).body,
    /"table","id","name"/,
  );
});
test("API rejects cross-origin writes, invalid words and cross-kid attempts; archive preserves history", async (t) => {
  const { req } = await fixture(t);
  assert.equal(
    (
      await req(
        "/api/sessions",
        { kid_id: 1, kind: "spelling" },
        { Origin: "http://evil.example" },
      )
    ).status,
    403,
  );
  await req("/api/parent/unlock", { pin: "5678" });
  assert.equal(
    (await req("/api/admin/lists", { kid_id: 1, title: "Empty", words: [] }))
      .status,
    400,
  );
  const s = (await req("/api/state?kid=1")).body;
  const sess = (
    await req("/api/sessions", {
      kid_id: 2,
      kind: "tricky",
      word_ids: [(await req("/api/state?kid=2")).body.lists[0].words[0].id],
    })
  ).body;
  assert.equal(
    (
      await req("/api/attempts", {
        session_id: sess.id,
        word_id: s.lists[0].words[0].id,
        typed: "x",
      })
    ).status,
    400,
  );
  await req("/api/admin/archive", { type: "lists", id: s.lists[0].id });
  await req("/api/parent/lock", {});
  assert.equal((await req("/api/state?kid=1")).body.lists.length, 0);
  assert.equal((await req("/../../server.js")).status, 404);
});

test("mastery follows practiced wording; unfinished/subset rounds do not complete full lists", async (t) => {
  const { req } = await fixture(t);
  await req("/api/parent/unlock", { pin: "5678" });
  const state = (await req("/api/state?kid=1")).body;
  const v = state.verses[0];
  const verseSession = (
    await req("/api/sessions", { kid_id: 1, kind: "verse" })
  ).body;
  await req("/api/verse-attempts", {
    session_id: verseSession.id,
    verse_id: v.id,
    mode: "memory",
    typed: v.text,
  });
  assert.equal((await req("/api/progress?kid=1")).body.mastery[0].stars, 3);
  await req("/api/admin/verses", { ...v, text: "Jesus wept." });
  const p = (await req("/api/progress?kid=1")).body;
  assert.equal(p.mastery[0].stars, 0);
  assert.equal(p.verseAttempts[0].verse_text, v.text);
  const list = state.lists[0];
  const full = (
    await req("/api/sessions", {
      kid_id: 1,
      list_id: list.id,
      kind: "spelling",
    })
  ).body;
  await req("/api/attempts", {
    session_id: full.id,
    word_id: list.words[0].id,
    typed: list.words[0].word,
  });
  assert.equal(
    (await req("/api/sessions/complete", { session_id: full.id })).status,
    400,
  );
  const subset = (
    await req("/api/sessions", {
      kid_id: 1,
      list_id: list.id,
      kind: "spelling",
      word_ids: [list.words[0].id],
    })
  ).body;
  await req("/api/attempts", {
    session_id: subset.id,
    word_id: list.words[0].id,
    typed: list.words[0].word,
  });
  assert.equal(
    (await req("/api/sessions/complete", { session_id: subset.id })).status,
    200,
  );
  assert.equal((await req("/api/progress?kid=1")).body.listsCompleted, 0);
  for (const word of list.words.slice(1))
    await req("/api/attempts", {
      session_id: full.id,
      word_id: word.id,
      typed: word.word,
    });
  assert.equal(
    (await req("/api/sessions/complete", { session_id: full.id })).status,
    200,
  );
  assert.equal((await req("/api/progress?kid=1")).body.listsCompleted, 1);
});
