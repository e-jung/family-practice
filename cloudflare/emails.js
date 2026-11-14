// Pure content/scheduling helpers. AccountStore owns opt-ins, delivery claims and retention.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = value => String(value ?? '').replace(/[\r\n]/g, ' ').slice(0, 200);
export const DEFAULT_EMAIL_FROM = 'Family Practice <spelling@jesklabs.com>';

/** Only allowlisted summaries and up to five tricky words; never answers, codes or PINs. */
export function buildWeeklyDigest({ familyName = 'Your family', kids = [], practiceUrl = '', unsubscribe = '' } = {}) {
  const lines = [`${clean(familyName)} — weekly practice`, '', 'Here is your weekly Family Practice summary.'];
  for (const kid of kids.slice(0, 50)) {
    const name = clean(kid.name || kid.firstName || 'Your child');
    const count = value => Math.max(0, Math.floor(Number(value) || 0));
    const attempts = count(kid.attempts ?? kid.practiceCount);
    const accuracy = Number(kid.accuracy ?? kid.firstTryAccuracy);
    const accuracyText = Number.isFinite(accuracy) ? `, ${Math.min(100, Math.max(0, Math.round(accuracy)))}% first-try accuracy` : '';
    lines.push(`${name}: ${attempts} practice attempts${accuracyText}, ${count(kid.streak)}-day streak, ${count(kid.dueWords)} words due for review.`);
    if (Array.isArray(kid.lists) && kid.lists.length) lines.push(`Lists practiced: ${kid.lists.slice(0,20).map(clean).join(', ')}.`);
    if (Array.isArray(kid.trickyWords) && kid.trickyWords.length) lines.push(`Tricky words: ${kid.trickyWords.slice(0,5).map(clean).join(', ')}.`);
    if (Number.isFinite(kid.verseStarsChange)) lines.push(`Verse stars this week: ${kid.verseStarsChange >= 0 ? '+' : ''}${Math.trunc(kid.verseStarsChange)}.`);
  }
  if (!kids.length) lines.push('A little practice together is a good place to start.');
  if (practiceUrl) lines.push('', `Open Family Practice: ${safeLink(practiceUrl)}`);
  if (unsubscribe) lines.push('', `Manage or stop these emails: ${safeLink(unsubscribe)}`);
  const subject = `${clean(familyName)}: your weekly practice summary`;
  const text = lines.join('\n');
  return { subject, text, html: `<div>${lines.map(line => `<p>${escape(line) || '&nbsp;'}</p>`).join('')}</div>`, ...(unsubscribe ? { unsubscribe: safeLink(unsubscribe) } : {}) };
}

function safeLink(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[\r\n<>]/.test(String(value))) throw new Error('Invalid email URL');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Email URL must use HTTPS');
  return url.href;
}

/** Returns a boolean for this local hour; caller must persist a delivery claim to deduplicate.
 * prefs: { timezone, digest: {enabled, day: 0..6, hour: 0..23}, reminder: {enabled, days: [0..6], hour} }
 * Flat schedules {enabled,timezone,day/hour} are also accepted. Sunday = 0.
 */
export function selectForHour(prefs, now, kind) {
  if (!prefs || !['digest', 'reminder', 'weeklyDigest', 'practiceReminder'].includes(kind)) return false;
  const digest = kind === 'digest' || kind === 'weeklyDigest';
  const schedule = prefs[kind] ?? prefs[digest ? 'digest' : 'reminder'] ?? prefs[digest ? 'weeklyDigest' : 'practiceReminder'] ?? prefs;
  if (schedule.enabled !== true || !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23) return false;
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: prefs.timezone || prefs.timeZone || 'UTC', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
    const hour = Number(parts.find(p => p.type === 'hour').value);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(p => p.type === 'weekday').value);
    if (hour !== schedule.hour) return false;
    return digest ? day === (schedule.day ?? schedule.dayOfWeek ?? 0) : (schedule.days ?? [0,1,2,3,4,5,6]).includes(day);
  } catch { return false; } // Invalid IANA timezone fails closed.
}

/** One provider request only; never retry. Sink is returned, not stored or logged here.
 * Sink requires EMAIL_TEST_SINK=1 and APP_ORIGIN pointing at loopback.
 */
export async function sendEmail(env, { to, subject, text, html, unsubscribe }, fetchImpl = fetch) {
  const address = String(to ?? '');
  if (address.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) throw new Error('Invalid recipient');
  if (!subject || /[\r\n]/.test(subject) || String(subject).length > 300) throw new Error('Invalid email subject');
  const from = env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
  if (/[\r\n]/.test(from)) throw new Error('Invalid sender');
  const headers = unsubscribe ? { 'List-Unsubscribe': `<${safeLink(unsubscribe)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
  const message = { from, to: [address], subject: String(subject), text: String(text ?? ''), html: String(html ?? ''), ...(headers ? { headers } : {}) };
  if (env.EMAIL_TEST_SINK) {
    let local = false;
    try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.APP_ORIGIN).hostname); } catch {}
    if (env.EMAIL_TEST_SINK !== '1' || !local) throw new Error('Email test sink is local-only');
    return { sent: true, test: true, message };
  }
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'email_unconfigured' };
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(message), redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch { return { sent: false, reason: 'email_unavailable' }; }
  if (!response.ok) return { sent: false, reason: 'email_rejected', status: response.status };
  return { sent: true };
}
