// Optional parent identity. Family codes remain sufficient for all kid practice.
export function createIdentityUI({el, button, field, input, modal, toast, current, openFamily, refresh, landing}) {
  let config = {google: false, email: false, sso: false}, session = {signedIn: false, families: []};
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
  const available = () => config.google || config.email || config.sso;
  const disclosure = 'Optional Jesklabs sign-in, shared by Jesklabs apps; it stores your email and which Jesklabs apps you use.';
  function rememberIntent(done) {
    if (done === recover) sessionStorage.setItem('family-practice-recover', '1');
    else sessionStorage.removeItem('family-practice-recover');
  }
  async function start(mode, familyCode = '', done = finishSignIn) {
    if (done === recover) rememberIntent(done);
    const result = await request('start', {mode, ...(familyCode ? {familyCode} : {})});
    location.assign(result.url);
  }
  async function confirmSSO() {
    const pending = await request('pending');
    if (!pending?.email) { normalSignIn(); return; }
    const error = el('p', {role: 'alert'});
    let dialog;
    const accept = button('Continue as ' + pending.email, async () => {
      accept.disabled = decline.disabled = true; error.textContent = '';
      try { await request('confirm', {}); dialog.close(); await completeSignIn(); }
      catch (err) { error.textContent = err.message; }
      finally { accept.disabled = decline.disabled = false; }
    });
    const decline = button('Use a different account', async () => {
      accept.disabled = decline.disabled = true; error.textContent = '';
      try { await request('decline', {}); dialog.close(); normalSignIn(); }
      catch (err) { error.textContent = err.message; }
      finally { accept.disabled = decline.disabled = false; }
    }, 'secondary');
    dialog = modal('Continue with Jesklabs?', el('div', {}, el('p', {}, disclosure),
      el('p', {}, 'You are signed in to Jesklabs as ' + pending.email + '. Continue to Spellami on this device?'),
      el('p', {class: 'muted'}, 'No account is required. You can close this and use your Family Code instead.'),
      error, el('div', {class: 'identity-actions'}, accept, decline)));
  }
  // app.js passes the callback marker before removing it from the address bar.
  async function finishSignIn(auth = new URLSearchParams(location.search).get('auth')) {
    if (auth === 'confirm') { await confirmSSO(); return; }
    if (auth === 'signin' || auth === 'error') {
      if (auth === 'error') toast('Sign-in could not be completed. Please try again.');
      normalSignIn(); return;
    }
    await completeSignIn();
  }
  async function completeSignIn() { sessionStorage.removeItem('family-practice-auth-family'); await load(); if (sessionStorage.getItem('family-practice-recover') === '1') { sessionStorage.removeItem('family-practice-recover'); landing(); await recover(); return; } if(session.families?.length === 1) await open(session.families[0].hash); else landing(); }
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
  async function signoutAll() { await request('signout', {}); location.assign('https://accounts.jesklabs.com/sso/logout?client=spelling&return=/'); }
  async function signIn(familyCode = '', done = finishSignIn) {
    // A join link is not proof of parent authority: only link from unlocked Parent mode.
    if (!current().state.parent || familyCode !== current().familyCode) familyCode = '';
    rememberIntent(done);
    if (familyCode) sessionStorage.setItem('family-practice-auth-family', familyCode);
    else sessionStorage.removeItem('family-practice-auth-family');
    if (config.sso) {
      try { await start('sso', familyCode, done); }
      catch (err) { toast(err.message); }
      return;
    }
    normalSignIn(familyCode, done);
  }
  function normalSignIn(familyCode = '', done = finishSignIn) {
    // Preserve the original unlocked-parent intent across the code-free SSO return.
    // This is only a hint: every new start/send still checks the live PIN cookie server-side.
    const savedFamily = sessionStorage.getItem('family-practice-auth-family');
    if (!familyCode && savedFamily === current().familyCode) familyCode = savedFamily;
    if (familyCode !== current().familyCode || (!current().state.parent && familyCode !== savedFamily)) familyCode = '';
    const content = el('div', {}, el('p', {}, disclosure), el('p', {}, 'For parents only. Sign in to reopen linked families and recover their codes. Kids still use a Family Code. No account is required.'));
    let dialog;
    if (config.google) content.append(button('Continue with Google', async () => {
      try { await start('google', familyCode, done); }
      catch (err) { toast(err.message); }
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
            if (done === recover) rememberIntent(done);
            const result = await request('code/verify', {email: email.value.trim(), code: code.value.trim()});
            location.assign(result.attachUrl);
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
        button('Recover family codes', recover, 'secondary'), button('Sign out', signout, 'quiet'), button('Sign out of all Jesklabs apps on this device', signoutAll, 'quiet'));
      if (!(session.families || []).length) host.append(el('p', {}, 'No linked families yet. Create a space below, or open your family with its code and link it in Parent mode.'));
    } else if (available()) host.append(el('h2', {}, 'Parent sign-in (optional)'),
      el('p', {}, 'Already linked your family? Sign in to find it again. You can always continue with a Family Code instead.'),
      el('p', {class: 'muted'}, disclosure),
      button('Sign in with Jesklabs', () => signIn(familyCode), 'secondary'),
      button('Forgot your family code?', () => signIn(familyCode), 'quiet'));
  }
  async function recover() {
    const result = await request('recover');
    modal('Recover family codes', el('div', {}, el('p', {}, 'These codes open your family’s practice. Save them privately.'),
      ...(result.families || []).map(family => el('section', {class: 'section'}, el('h3', {}, family.name || 'Family space'),
        el('strong', {class: 'family-code recovery-code'}, ...family.code.split('-').flatMap((word, i) => i ? ['-', el('wbr'), word] : [word])), el('div', {class: 'identity-actions'}, button('Print card', () => window.print(), 'secondary'), button('Open family', () => { document.querySelectorAll('dialog').forEach(d => d.close()); return open(family.hash); }, 'secondary')))),
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
        await load(); toast('Email preferences saved.', submit);
      } catch (err) { error.textContent = err.message; }
      finally { submit.disabled = false; }
    }}, el('p', {class: 'muted'}, 'Choose only the emails you want. All reminders are optional.'),
      el('label', {class: 'inline'}, weekly, 'Weekly practice summary'),
      el('label', {class: 'inline'}, classUpdates, 'Class-list updates'),
      el('label', {class: 'inline'}, review, 'Review reminders'), field('Time zone', timezone), error,
      el('div', {class: 'row form-actions'}, submit));
  }
  async function manage(host) {
    host.replaceChildren(el('p', {role: 'status'}, 'Loading parent sign-in…'));
    try {
      await load();
      const block = (title, ...children) => el('section', {class: 'identity-block'}, el('div', {class: 'section-title'}, el('h2', {}, title)), ...children);
      const actions = (...children) => el('div', {class: 'identity-actions'}, ...children);
      const own = block('Your sign-in', el('p', {}, 'Optional for parents; never needed for kid practice. Linking lets your sign-in reopen this family without its code or PIN. Keep your code and PIN safe.'));
      host.replaceChildren(own);
      if (!session.signedIn) {
        if (available()) own.append(el('p', {class: 'muted'}, disclosure), actions(
          button('Link Jesklabs sign-in', () => signIn(current().familyCode, () => manage(host)), 'secondary')));
        if (!available()) own.append(el('p', {}, 'Optional sign-in is not configured here. Family Code and PIN access always work.'));
      } else {
        own.append(el('p', {}, session.email || 'Signed in'), actions(
          button('Sign out', signout, 'secondary'),
          button('Sign out of all Jesklabs apps on this device', signoutAll, 'quiet'),
          button('Delete my sign-in', async () => {
            if (!confirm('Remove this app’s sign-in and family links? Family data stays. Your other Jesklabs app links stay; if none remain, the shared account is removed. Keep your saved Family Codes and PINs.')) return;
            await request('delete', {}); session = {signedIn: false, families: []}; await refresh(); toast('Parent sign-in deleted. Family data kept.');
          }, 'danger')),
          el('p', {class: 'muted'}, 'Deleting this app’s sign-in removes its linked access and email preferences, not your shared Jesklabs account or family practice data. Save your Family Codes and PINs first.'));
      }
      const result = await request('parents');
      host.append(block('Parents linked to this family',
        el('p', {class: 'muted'}, 'Removing a link removes sign-in access, not a saved Family Code or family data.'),
        ...(result.parents || []).map(parent => el('div', {class: 'identity-parent'}, el('span', {}, parent.masked),
          button('Unlink parent', async () => {
            if (!confirm('Unlink ' + parent.masked + ' from this family? Keep a copy of the Family Code first.')) return;
            await request('unlink', {familyCode: current().familyCode, parentHash: parent.hash});
            await manage(host);
          }, 'danger'))),
        ...(!(result.parents || []).length ? [el('p', {}, 'No parent sign-ins linked yet.')] : []),
        ...(session.signedIn ? [actions(button('Link this family to my sign-in', async () => {await linkNewFamily(); toast('Family linked.'); await manage(host);}, 'secondary'))] : [])));
      host.append(block('Email reminders', session.signedIn ? preferences() : el('p', {class: 'muted'}, session.signedIn ? 'Email reminders are not available here.' : 'Sign in to choose optional reminders.')));
    } catch (err) {
      host.append(el('p', {role: 'alert'}, err.message), button('Try again', () => manage(host), 'secondary'));
    }
  }
  return {init, finishSignIn, entry, manage, linkNewFamily, signedIn: () => !!session.signedIn, signIn, recover, available, recoverCodes: () => session.signedIn ? recover() : signIn('', recover)};
}
