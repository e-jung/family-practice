// Optional parent identity. Family codes remain sufficient for all kid practice.
export function createIdentityUI({el, button, field, input, modal, toast, current, openFamily, refresh, landing}) {
  let config = {google: false, email: false}, session = {signedIn: false, families: []};
  async function request(path, data) {
    const headers = {'X-Family-Code': current().familyCode};
    const options = {credentials: 'same-origin', cache: 'no-store', headers};
    if (data !== undefined) Object.assign(options, {method: 'POST', body: JSON.stringify(data), headers: {...headers, 'Content-Type': 'application/json'}});
    const response = await fetch('/api/auth/' + path, options);
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'Please try again.');
    return body;
  }
  async function load() { session = await request('session'); return session; }
  async function init() {
    // A deployment without identity configured must keep code-only access working.
    const results = await Promise.allSettled([request('config'), load()]);
    if (results[0].status === 'fulfilled') config = results[0].value;
  }
  const available = () => config.google || config.email;
  async function finishSignIn() { await load(); if(session.families?.length === 1) await open(session.families[0].hash); else landing(); }
  async function linkNewFamily() {
    if (!session.signedIn) return;
    await request('link', {familyCode: current().familyCode});
    await load();
  }
  async function signout() {
    await request('signout', {});
    session = {signedIn: false, families: []};
    await refresh();
    toast('Signed out. Your family space has not been deleted.');
  }
  function signIn(familyCode = '', done = finishSignIn) {
    // A join link is not proof of parent authority: only link from unlocked Parent mode.
    if (!current().state.parent || familyCode !== current().familyCode) familyCode = '';
    const content = el('div', {}, el('p', {}, 'For parents only. Sign in to reopen linked families and recover their codes. Kids still use a Family Code. No account is required.'));
    let dialog;
    if (config.google) content.append(button('Continue with Google', () => {
      location.assign('/auth/google/start' + (familyCode ? '?' + new URLSearchParams({familyCode}) : ''));
    }));
    if (config.email) {
      const email = input('signin-email', '', {type: 'email', required: true, maxlength: 254, autocomplete: 'email', autocapitalize: 'none'});
      const code = input('signin-code', '', {required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}'});
      const error = el('p', {role: 'alert'}), status = el('p', {role: 'status'});
      let sent = false;
      const codeField = field('Email code', code); codeField.hidden = true; code.disabled = true;
      const submit = el('button', {type: 'submit'}, 'Email me a code');
      const form = el('form', {onsubmit: async event => {
        event.preventDefault(); submit.disabled = true; error.textContent = '';
        try {
          if (!sent) {
            await request('code/send', {email: email.value.trim(), ...(familyCode ? {familyCode} : {})});
            sent = true; email.readOnly = true; code.disabled = false; codeField.hidden = false;
            submit.textContent = 'Verify & sign in'; status.textContent = 'Check your inbox for a sign-in code.'; code.focus();
          } else {
            await request('code/verify', {email: email.value.trim(), code: code.value.trim()});
            await load();
            if (familyCode && current().state.parent) {
              try { await linkNewFamily(); } catch (err) { toast('Signed in, but this family was not linked: ' + err.message); }
            }
            dialog.close(); await done();
          }
        } catch (err) { error.textContent = err.message; }
        finally { submit.disabled = false; }
      }}, field('Parent email', email), codeField, status, error, el('div', {class: 'row form-actions'}, submit,
        button('Use another email', () => { sent = false; email.readOnly = false; code.disabled = true; codeField.hidden = true; code.value = ''; status.textContent = ''; submit.textContent = 'Email me a code'; email.focus(); }, 'quiet')));
      content.append(form);
    }
    if (!available()) content.append(el('p', {}, 'Parent sign-in is not configured here. You can still use a Family Code.'));
    content.append(el('p', {class: 'muted'}, 'Use a trusted device. Reminder emails are optional and off until you choose them.'));
    dialog = modal('Parent sign-in', content);
  }
  async function open(hash) {
    const result = await request('open', {hash});
    await openFamily(result.code);
  }
  function picker() {
    return el('div', {class: 'rows'}, (session.families || []).map(family => el('div', {class: 'item'},
      el('h3', {}, family.name || 'Family space'), button('Open ' + (family.name || 'family'), () => open(family.hash), 'secondary'))));
  }
  function entry(host, familyCode = '') {
    if (session.signedIn) {
      host.append(el('h2', {}, 'Your parent sign-in'), el('p', {}, session.email || 'Signed in'), picker(),
        button('Recover family codes', recover, 'secondary'), button('Sign out', signout, 'quiet'));
      if (!(session.families || []).length) host.append(el('p', {}, 'No linked families yet. Create a space below, or open your family with its code and link it in Parent mode.'));
    } else if (available()) host.append(el('h2', {}, 'Parent sign-in (optional)'),
      el('p', {}, 'Already linked your family? Sign in to find it again. You can always continue with a Family Code instead.'),
      ...(config.google ? [button('Sign in with Google', () => location.assign('/auth/google/start'), 'secondary')] : []),
      ...(config.email ? [button('Email me a code', () => signIn(familyCode), 'secondary')] : []),
      button('Forgot your family code?', () => signIn(familyCode), 'quiet'));
  }
  async function recover() {
    const result = await request('recover');
    modal('Recover family codes', el('div', {}, el('p', {}, 'These codes open your family’s practice. Save them privately.'),
      ...(result.families || []).map(family => el('section', {class: 'section'}, el('h3', {}, family.name || 'Family space'),
        el('strong', {class: 'family-code'}, family.code), button('Print card', () => window.print(), 'secondary'), button('Open family', () => { document.querySelectorAll('dialog').forEach(d => d.close()); return open(family.hash); }, 'secondary'))),
      !(result.families || []).length ? el('p', {}, 'No linked families to recover.') : null));
  }
  function preferences() {
    const prefs = session.prefs || {};
    const weekly = input('identity-weekly', '', {type: 'checkbox', checked: !!prefs.weekly});
    const classUpdates = input('identity-classes', '', {type: 'checkbox', checked: !!prefs.classUpdates});
    const review = input('identity-review', '', {type: 'checkbox', checked: !!prefs.review});
    const timezone = input('identity-timezone', prefs.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', {required: true, maxlength: 100});
    const error = el('p', {role: 'alert'}), submit = el('button', {type: 'submit'}, 'Save email preferences');
    return el('form', {onsubmit: async event => {
      event.preventDefault(); submit.disabled = true; error.textContent = '';
      try {
        await request('prefs', {weekly: weekly.checked, classUpdates: classUpdates.checked, review: review.checked, timezone: timezone.value.trim()});
        await load(); toast('Email preferences saved.');
      } catch (err) { error.textContent = err.message; }
      finally { submit.disabled = false; }
    }}, el('h3', {}, 'Optional email reminders'), el('p', {class: 'muted'}, 'Choose only the emails you want. All reminders are optional.'),
      el('label', {class: 'inline'}, weekly, 'Weekly practice summary'),
      el('label', {class: 'inline'}, classUpdates, 'Class-list updates'),
      el('label', {class: 'inline'}, review, 'Review reminders'), field('Time zone', timezone), error,
      el('div', {class: 'row form-actions'}, submit));
  }
  async function manage(host) {
    host.replaceChildren(el('p', {role: 'status'}, 'Loading parent sign-in…'));
    try {
      await load();
      host.replaceChildren(el('div', {class: 'section-title'}, el('h2', {}, 'Sign-in & email')),
        el('p', {}, 'Link an email so you can never lose your family. Optional for parents; never needed for kid practice. Linking lets this parent sign-in reopen the family without its code or PIN. Keep using your PIN for code-only access.'));
      if (!session.signedIn) {
        if(config.google) host.append(button('Link Google', () => location.assign('/auth/google/start?' + new URLSearchParams({familyCode:current().familyCode})), 'secondary'));
        if(config.email) host.append(button('Link an email', () => signIn(current().familyCode, () => manage(host)), 'secondary'));
        if(!available()) host.append(el('p', {}, 'Optional sign-in is not configured here. Family Code and PIN access always work.'));
      } else {
        host.append(el('p', {}, session.email || 'Signed in'), picker(),
          button('Link this family to my sign-in', async () => {await linkNewFamily(); toast('Family linked.'); await manage(host);}, 'secondary'),
          button('Recover family codes', recover, 'secondary'), config.email ? preferences() : null,
          button('Sign out', signout, 'secondary'),
          el('details', {}, el('summary', {}, 'Delete parent sign-in'),
            el('p', {}, 'Removes this parent identity, linked access and email preferences. It does not delete family practice data. Save your Family Codes and PINs first.'),
            button('Delete my parent sign-in…', async () => {
              if (!confirm('Delete your parent sign-in and all its family links? Family data stays, but you will need your saved Family Codes and PINs.')) return;
              await request('delete', {}); session = {signedIn: false, families: []}; await refresh(); toast('Parent sign-in deleted. Family data kept.');
            }, 'danger')));
      }
      const result = await request('parents');
      host.append(el('h3', {}, 'Parents linked to this family'),
        el('p', {class: 'muted'}, 'Removing a link removes sign-in access, not a saved Family Code or family data.'),
        ...(result.parents || []).map(parent => el('div', {class: 'profile-controls'}, el('span', {}, parent.masked),
          button('Unlink parent', async () => {
            if (!confirm('Unlink ' + parent.masked + ' from this family? Keep a copy of the Family Code first.')) return;
            await request('unlink', {familyCode: current().familyCode, parentHash: parent.hash});
            await manage(host);
          }, 'danger small'))),
        !(result.parents || []).length ? el('p', {}, 'No parent sign-ins linked yet.') : null);
    } catch (err) {
      host.append(el('p', {role: 'alert'}, err.message), button('Try again', () => manage(host), 'secondary'));
    }
  }
  return {init, finishSignIn, entry, manage, linkNewFamily, signedIn: () => !!session.signedIn, signIn};
}
