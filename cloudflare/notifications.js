import { settingsFor } from "./runtime-settings.js";
import { accountRequest, signedValue } from "./accounts.js";
import { buildWeeklyDigest, buildPracticeNotice, selectForHour, sendEmail } from "./emails.js";
import { shareRequest } from "./sharing.js";
const familyData = async (env, hash, kind) => {
  const r = await env.FAMILY.get(env.FAMILY.idFromName("fam:" + hash)).fetch(
    new Request("https://internal/api/internal/account/" + kind, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  return r.ok ? r.json() : null;
};
const localDay = (now, timezone) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
// Hourly batched scan, one identity at a time; no per-child data leaves the app except requested mail.
// Claim BEFORE provider submission: provider failures aren't retried endlessly or sent twice on cron replay.
export async function scheduledEmails(env, now = new Date(), fetchImpl = fetch) {
  if (!env.ACCOUNTS || (!env.RESEND_API_KEY && !env.EMAIL_TEST_SINK)) return;
  if (!env.EMAIL_FROM || !env.APP_ORIGIN) return;
  const origin = env.APP_ORIGIN,
    settings = settingsFor(env);
  const familyCache = new Map(),
    followCache = new Map();
  const get = async (f, kind) => {
    const c = kind === "digest" ? familyCache : followCache;
    if (!c.has(f.hash)) c.set(f.hash, await familyData(env, f.hash, kind));
    return c.get(f.hash);
  };
  for (let offset = 0; ; offset += 100) {
    const { accounts } = await accountRequest(env, "/list", { offset });
    if (!accounts.length) break;
    for (const a of accounts) {
      if (!a.email) continue;
      try {
        const prefs = a.email_prefs,
          tz = prefs.timezone || "America/Los_Angeles",
          day = localDay(now, tz);
        const unsubscribe =
          origin +
          "/auth/unsubscribe?token=" +
          (await signedValue(env.SESSION_SECRET, "unsubscribe", {
            hash: a.hash,
            exp: now.getTime() + 366 * 86400000,
          }));
        const deliver = async (key, value, message) => {
          const { claimed } = await accountRequest(env, "/claim", {
            hash: a.hash,
            key,
            value,
            familyHashes: a.families.map((f) => f.hash),
          });
          if (!claimed) return;
          await accountRequest(env, "/mail-reserve");
          let result;
          try {
            result = await sendEmail(env, { to: a.email, ...message, unsubscribe }, fetchImpl);
          } catch {
            await accountRequest(env, "/mail-failed");
            return;
          }
          if (result.test)
            await accountRequest(env, "/sink", { email: a.email, message: result.message });
          if (!result.sent) await accountRequest(env, "/mail-failed");
        };
        const familyName =
          a.families
            .map((f) => f.name)
            .filter(Boolean)
            .join(", ") || "Your family";
        const weekly = selectForHour(
          { timezone: tz, enabled: prefs.weekly, ...settings.notifications.weekly },
          now,
          "digest",
        );
        const review = selectForHour(
          { timezone: tz, enabled: prefs.review, ...settings.notifications.review },
          now,
          "reminder",
        );
        if ((weekly || review) && a.families.length) {
          const families = [];
          for (const f of a.families) {
            const d = await get(f, "digest");
            if (d) families.push(d);
          }
          if (weekly) {
            const kids = families.flatMap((f) =>
              f.kids.map((k) => {
                const first = k.attempts.filter((a) => a.first_try);
                return {
                  ...k,
                  attempts: k.attempts.length,
                  accuracy: first.length
                    ? Math.round((100 * first.filter((a) => a.correct).length) / first.length)
                    : undefined,
                  dueWords: k.reviewDue,
                  lists: k.lists,
                  trickyWords: [
                    ...new Set(k.attempts.filter((a) => !a.correct).map((a) => a.word)),
                  ].slice(0, 5),
                  verseStarsChange: k.verseStarsChange || 0,
                };
              }),
            );
            await deliver(
              "weekly",
              day,
              buildWeeklyDigest({
                familyName:
                  families
                    .map((f) => f.name)
                    .filter(Boolean)
                    .join(", ") || "Your family",
                kids,
                practiceUrl: origin,
                unsubscribe,
              }),
            );
          }
          if (review) {
            const n = families.reduce(
              (sum, f) => sum + f.kids.reduce((s, k) => s + k.reviewDue, 0),
              0,
            );
            if (n)
              await deliver(
                "review",
                day,
                buildPracticeNotice({
                  kind: "review",
                  familyName,
                  dueWords: n,
                  practiceUrl: origin,
                  unsubscribe,
                }),
              );
          }
        }
        if (prefs.classUpdates) {
          const slugs = new Set();
          for (const f of a.families) {
            const d = await get(f, "follows");
            for (const item of d?.follows || []) slugs.add(item.slug);
          }
          const list = [...slugs];
          for (let i = 0; i < list.length; i += 50) {
            const batch = await shareRequest(env, "/latest", { slugs: list.slice(i, i + 50) });
            for (const c of batch.classes || []) {
              if (c.available && c.latest?.week_id)
                await deliver(
                  "class:" + c.slug,
                  c.latest.week_id,
                  buildPracticeNotice({
                    kind: "classUpdates",
                    familyName,
                    practiceUrl: origin,
                    unsubscribe,
                  }),
                );
            }
          }
        }
      } catch {
        /* One failed recipient never blocks others; claims prevent retry loops. */
      }
    }
    if (accounts.length < 100) break;
  }
}
