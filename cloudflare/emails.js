// Pure content/scheduling helpers. AccountStore owns opt-ins, delivery claims and retention.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = value => String(value ?? '').replace(/[\r\n]/g, ' ').slice(0, 200);
export const DEFAULT_EMAIL_FROM = 'Family Practice <spelling@jesklabs.com>';

// All mail shares the same email-safe, inline-styled shell; no remote assets or fonts.
const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const paragraph = text => `<p style="margin:0 0 16px;">${escape(text)}</p>`;
const optIn = {
  weekly: "You're receiving this because you turned on weekly summaries.",
  review: 'You’re receiving this because you opted in to review nudges in Family Practice.',
  classUpdates: 'You’re receiving this because you opted in to class-list updates in Family Practice.'
};
function frame({familyName, title, body, practiceUrl, unsubscribe, explanation}) {
  const cta = practiceUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td bgcolor="#2446A8" style="background-color:#2446A8;border-radius:8px;"><a href="${escape(safeLink(practiceUrl))}" style="display:inline-block;padding:14px 20px;color:#FFFFFF;font-weight:700;text-decoration:none;">Open Family Practice</a></td></tr></table>` : '';
  const footer = `${explanation ? paragraph(explanation) : ''}${unsubscribe ? `<p style="margin:0;"><a href="${escape(safeLink(practiceUrl || unsubscribe))}" style="color:#4A5563;">Manage email preferences</a> · <a href="${escape(safeLink(unsubscribe))}" style="color:#4A5563;">Unsubscribe</a></p>` : ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;padding:0;background-color:#F2F3EE;color:#18212C;font-family:${font};font-size:16px;line-height:1.6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#F2F3EE;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#FFFFFF;table-layout:fixed;"><tr><td bgcolor="#2446A8" style="padding:24px;background-color:#2446A8;color:#FFFFFF;overflow-wrap:anywhere;"><p style="margin:0;font-size:24px;font-weight:700;">Family Practice</p>${familyName ? `<p style="margin:4px 0 0;">${escape(clean(familyName))}</p>` : ''}</td></tr><tr><td style="padding:24px;overflow-wrap:anywhere;"><h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;">${escape(title)}</h1>${body}${cta}</td></tr>${footer ? `<tr><td style="padding:24px;border-top:1px solid #DFE2DA;color:#4A5563;font-size:13px;">${footer}</td></tr>` : ''}</table></td></tr></table></body></html>`;
}
function footerLines(kind, practiceUrl, unsubscribe) {
  return [practiceUrl ? `Open Family Practice: ${safeLink(practiceUrl)}` : '', optIn[kind], unsubscribe ? `Manage email preferences: ${safeLink(practiceUrl || unsubscribe)}\nUnsubscribe: ${safeLink(unsubscribe)}` : ''].filter(Boolean);
}
const count = value => Math.max(0, Math.floor(Number(value) || 0));

/** Only allowlisted summaries and up to five tricky words; never answers, codes or PINs. */
export function buildWeeklyDigest({ familyName = 'Your family', kids = [], practiceUrl = '', unsubscribe = '' } = {}) {
  const lines = [`Family Practice — ${clean(familyName)}`, '', 'Weekly practice', '', 'Here is your weekly Family Practice summary.'];
  let body = paragraph('Here is your weekly Family Practice summary.');
  for (const kid of kids.slice(0, 50)) {
    const name = clean(kid.name || kid.firstName || 'Your child');
    const attempts = count(kid.attempts ?? kid.practiceCount);
    const accuracy = kid.accuracy ?? kid.firstTryAccuracy;
    const accuracyText = accuracy != null && Number.isFinite(Number(accuracy)) ? `${Math.min(100, Math.max(0, Math.round(Number(accuracy))))}%` : 'Not available';
    const daysText = kid.practiceDays != null && Number.isFinite(Number(kid.practiceDays)) ? String(Math.min(7, count(kid.practiceDays))) : 'Not available';
    const summary = `${attempts} practice attempts, ${accuracyText === 'Not available' ? 'first-try accuracy: Not available' : accuracyText + ' first-try accuracy'}, ${count(kid.streak)}-day streak, ${count(kid.dueWords)} words due for review.`;
    lines.push('', `${name}:`, summary, `Practice days this week: ${daysText}.`);
    body += `<h2 style="margin:24px 0 12px;padding-top:16px;border-top:2px solid #18212C;font-size:21px;">${escape(name)}</h2>${paragraph(summary)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;table-layout:fixed;"><tr>${[['First-try accuracy',accuracyText],['Practice days',daysText],['Words due',count(kid.dueWords)]].map(([label,value])=>`<td valign="top" style="padding:8px 4px;border-top:1px solid #DFE2DA;"><strong style="font-size:20px;">${escape(value)}</strong><br><span style="font-size:12px;color:#4A5563;">${label}</span></td>`).join('')}</tr></table>`;
    if (Array.isArray(kid.lists) && kid.lists.length) {
      const lists = `Lists practiced: ${kid.lists.slice(0,20).map(clean).join(', ')}.`;
      lines.push(lists); body += paragraph(lists);
    }
    if (Array.isArray(kid.trickyWords) && kid.trickyWords.length) {
      const words = kid.trickyWords.slice(0,5).map(clean);
      lines.push(`Tricky words: ${words.join(', ')}.`);
      body += `<p style="margin:0 0 8px;">Tricky words</p><p style="margin:0 0 16px;">${words.map(word=>`<span style="display:inline-block;margin:0 4px 6px 0;padding:3px 10px;border:1px solid #DFE2DA;border-radius:16px;background-color:#F2F3EE;">${escape(word)}</span>`).join(' ')}</p>`;
    }
    if (Number.isFinite(kid.verseStarsChange)) {
      const stars = `★ Verse stars this week: ${kid.verseStarsChange >= 0 ? '+' : ''}${Math.trunc(kid.verseStarsChange)}.`;
      lines.push(stars); body += paragraph(stars);
    }
  }
  if (!kids.length) { const empty = 'A little practice together is a good place to start.'; lines.push(empty); body += paragraph(empty); }
  lines.push('', ...footerLines('weekly', practiceUrl, unsubscribe));
  return { subject: `${clean(familyName)}: your weekly practice summary`, text: lines.join('\n'), html: frame({familyName,title:'Weekly practice',body,practiceUrl,unsubscribe,explanation:optIn.weekly}), ...(unsubscribe ? {unsubscribe:safeLink(unsubscribe)} : {}) };
}

export function buildPracticeNotice({kind, familyName = 'Your family', dueWords = 0, practiceUrl = '', unsubscribe = ''} = {}) {
  if (!['review', 'classUpdates'].includes(kind)) throw new Error('Invalid notice kind');
  const subject = kind === 'review' ? `${count(dueWords)} words ready for review` : 'A new class practice list is ready';
  const paragraphs = kind === 'review' ? ['A little practice goes a long way.', `${count(dueWords)} words are ready for review.`] : ['A class you follow has a new week ready.', 'Open Family Practice to choose what to import.'];
  return {subject, text:[`Family Practice — ${clean(familyName)}`, '', subject, '', ...paragraphs, '', ...footerLines(kind,practiceUrl,unsubscribe)].join('\n'), html:frame({familyName,title:subject,body:paragraphs.map(paragraph).join(''),practiceUrl,unsubscribe,explanation:optIn[kind]}), ...(unsubscribe ? {unsubscribe:safeLink(unsubscribe)} : {})};
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
