import {qrSvg} from '/qr.js';

// Public previews never send a family code. Family writes use the parent-only API.
export function createSharingUI(ctx) {
  const {el, button, field, input, textArea, modal, toast, api, app} = ctx;
  const get = () => ctx.current();
  const section = (name, ...body) => el('section', {class:'section'}, el('div', {class:'section-title'}, el('h2', {}, name)), ...body);
  const date = value => value ? new Date(String(value).slice(0,10) + 'T12:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : '';
  const endpoint = (kind, slug) => `/api/${kind === 'c' ? 'class' : 'share'}/${encodeURIComponent(slug)}`;
  async function publicApi(path, body) {
    const response = await fetch(path, body === undefined ? {credentials:'omit',cache:'no-store'} : {method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'This link is not available.');
    return result;
  }
  function sheet(title, fields, label, save) {
    let dialog;
    const error = el('p', {role:'alert'});
    const submit = el('button', {type:'submit'}, label);
    const form = el('form', {onsubmit:async e => {e.preventDefault(); submit.disabled = true; error.textContent=''; try {await save(() => dialog.close());} catch(err) {error.textContent=err.message;} finally {submit.disabled=false;}}}, el('div',{class:'sheet-body'}, fields, error), el('div',{class:'row form-actions'},submit,button('Cancel',()=>dialog.close(),'secondary')));
    dialog = modal(title, form);
    return dialog;
  }
  function versePicker(verses = get().state.verses) {
    return el('select', {id:'share-verse'}, el('option',{value:''},'No Bible verse'), verses.filter(v=>!v.archived).map(v=>el('option',{value:v.id},v.reference)));
  }
  function linkPanel(kind, item) {
    const url = new URL(`/${kind}/${item.slug}`, location.origin).href;
    const link = input('sharing-link',url,{readonly:true,'aria-label':'Public sharing link'});
    // QR module generates fixed SVG geometry only; never inject user-provided markup.
    const qr = el('div',{class:'sharing-qr','aria-label':'QR code for this link',role:'img'});
    qr.innerHTML = qrSvg(url);
    return el('div',{class:'sharing-link'},el('p',{},'Anyone with this link can view the published words and optional verse. Your family code, kids, and practice history stay private.'),link,el('div',{class:'row'},button('Copy link',async()=>{await navigator.clipboard.writeText(url);toast('Link copied.');}),button('Print QR',()=>{document.body.classList.add('printing-share');try {window.print();} finally {document.body.classList.remove('printing-share');}},'secondary')),qr);
  }
  function shareList(list) {
    const note = textArea('share-note','',{maxlength:140,rows:3,placeholder:'Optional note for other parents'});
    const count = el('p',{class:'muted field-hint'},'0 / 140');
    note.addEventListener('input',()=>{count.textContent=`${note.value.length} / 140`;});
    const verse = versePicker(get().state.verses.filter(v=>v.kid_id === list.kid_id));
    sheet('Share spelling list',[el('p',{},'Share a frozen copy. Later edits to your list will not change this link. Do not include names, school details, or other private information.'),field('Note (optional, 140 characters)',note),count,field('Include a Bible verse (optional)',verse)],'Create share link',async close=>{
      const result = await api('/api/admin/shares',{list_id:list.id,note:note.value.trim(),verse_id:verse.value ? Number(verse.value) : null});
      close(); modal('Your list is ready to share',linkPanel('s',result.share || result));
    });
  }
  function sourceMeta(list) {
    const source = list.source || list.source_meta;
    if (!source && !list.source_title && !list.source_class_name && !list.source_share_slug && !list.source_class_slug && !list.source_slug) return null;
    return el('p',{class:'meta source-meta'},list.source_kind === 'class' || list.source_week_id ? 'From class list' : 'From shared list', (source?.class_name || list.source_class_name) ? ` · ${source?.class_name || list.source_class_name}` : '', (list.source_note || source?.note) ? ` · ${list.source_note || source?.note}` : '', ' · Changes here stay in your family.');
  }
  async function sharedAdmin(host) {
    const data = await api('/api/admin/shares');
    const shares = data.shares || [];
    if (!host.isConnected) return;
    host.replaceChildren(section('Shared lists',el('p',{},'Published copies stay unchanged. Stop a link at any time; copies already imported into another family stay theirs.'),shares.length ? el('div',{class:'rows'},shares.map(s=>el('article',{class:'item'},el('div',{},el('h3',{},s.title || s.snapshot?.title || 'Spelling list'),el('p',{class:'meta'},`${date(s.created_at)} · ${s.import_count ?? s.imports ?? 0} imports${s.stopped_at || s.stopped ? ' · stopped' : ''}`)),el('div',{class:'row'},!s.stopped_at && !s.stopped ? button('Link & QR',()=>modal('Shared list',linkPanel('s',s)),'secondary small'):null,!s.stopped_at && !s.stopped ? button('Stop sharing',async()=>{if(!confirm('Stop this public link? Imported copies will not be removed.'))return;await api('/api/admin/shares/'+encodeURIComponent(s.slug)+'/stop',{});await sharedAdmin(host);},'quiet small'):null)))) : el('p',{},'No shared lists yet. Choose Share beside a spelling list.')));
  }
  async function classesAdmin(host) {
    const data = await api('/api/admin/classes');
    if (!host.isConnected) return;
    const classes = data.classes || [];
    const canCreate = classes.filter(c=>!c.stopped && !c.stopped_at).length < 5;
    host.replaceChildren(section('Class lists',el('p',{},'A parent-managed publishing link for weekly practice. Followers choose their own kids; no student roster, names, or progress are shared.'),button('+ Create class list',()=>{
      if(!canCreate) throw Error('You can have up to five active class lists. Stop one before creating another.');
      const name=input('class-name','',{required:true,maxlength:80});
      sheet('Create class list',[field('Class list name',name),el('p',{class:'muted'},'Use a general label, not a school name or personal details. Up to five active class lists.')],'Create',async close=>{await api('/api/admin/classes',{name:name.value.trim()});close();await classesAdmin(host);});
    },'secondary'),el('div',{class:'rows'},classes.map(c=>el('article',{class:'item'},el('div',{},el('h3',{},c.name),el('p',{class:'meta'},`${c.week_count ?? c.weeks_count ?? c.weeks?.length ?? (c.latest ? 1 : 0)} published weeks · ${c.follower_count ?? c.followers ?? 0} followers${c.stopped_at || c.stopped ? ' · stopped' : ''}`)),el('div',{class:'row'},!c.stopped_at && !c.stopped ? [button('Publish week',()=>publishWeek(c,host),'small'),button('Published weeks',async()=>{const r=await publicApi(endpoint('c',c.slug));modal('Published weeks',el('div',{},(r.weeks||[]).length? (r.weeks||[]).map(w=>el('article',{class:'shared-week'},el('p',{class:'meta'},date(w.published_at)),showWords(w))):el('p',{},'No weeks published yet.')));},'secondary small'),button('Link & QR',()=>modal(c.name,linkPanel('c',c)),'secondary small'),button('Rename',()=>{const name=input('rename-class',c.name,{required:true,maxlength:80});sheet('Rename class list',field('Name',name),'Save',async close=>{await api('/api/admin/classes/'+encodeURIComponent(c.slug)+'/rename',{name:name.value.trim()});close();await classesAdmin(host);});},'quiet small'),button('Stop',async()=>{if(!confirm('Stop this class link? Families keep weeks they already imported.'))return;await api('/api/admin/classes/'+encodeURIComponent(c.slug)+'/stop',{});await classesAdmin(host);},'quiet small')]:null))))));
  }
  async function publishWeek(c,host) {
    const {state}=get();
    if(!state.kids.length)throw Error('Add a kid and a spelling list first.');
    const family=el('select',{id:'publish-kid'},state.kids.map(k=>el('option',{value:k.id,selected:k.id===get().kid?.id},k.name)));
    const picker=el('select',{id:'publish-list',required:true});
    const verse=versePicker([]);
    const update=async()=>{
      const data=await api('/api/state?kid='+Number(family.value));
      picker.replaceChildren(el('option',{value:''},'Choose a spelling list'),...data.lists.filter(l=>!l.archived).map(l=>el('option',{value:l.id},l.title)));
      verse.replaceChildren(...versePicker(data.verses).children);
    };
    family.addEventListener('change',()=>update().catch(err=>toast(err.message)));
    await update();
    const note=textArea('week-note','',{maxlength:140,rows:3});
    sheet('Publish a week',[field('Kid’s practice lists',family),field('Spelling list',picker),field('Optional Bible verse',verse),field('Note (optional, 140 characters)',note),el('p',{},'This publishes a frozen copy. Family names, kids, and progress stay private.')],'Publish week',async close=>{await api('/api/admin/classes/'+encodeURIComponent(c.slug)+'/publish',{list_id:Number(picker.value),verse_id:verse.value?Number(verse.value):null,note:note.value.trim()});close();await classesAdmin(host);toast('Week published.');});
  }
  async function followsAdmin(host) {
    const data=await api('/api/follows?refresh=1');
    if(!host.isConnected)return;
    host.replaceChildren(section('Following',button('Refresh followed lists',()=>followsAdmin(host),'secondary small'),el('p',{},'Following does not add weeks automatically. New weeks appear on each selected kid’s spelling page for a parent to add.'),el('div',{class:'rows'},(data.follows||[]).map(f=>el('article',{class:'item'},el('div',{},el('h3',{},f.name || f.class_name || 'Class list'),el('p',{class:'meta'},(f.available ? '' : 'Link stopped or unavailable · ') + (f.include_verse ? 'Includes Bible verses' : 'Words only'))),el('div',{class:'row'},button('Change kids / verse',()=>chooseKids('Follow class list',f,async payload=>{await api('/api/admin/follows/'+encodeURIComponent(f.slug),payload,'PATCH');await followsAdmin(host);},true),'secondary small'),button('Unfollow',async()=>{if(!confirm('Stop following? Imported weeks stay in your family.'))return;await api('/api/admin/follows/'+encodeURIComponent(f.slug),{},'DELETE');await followsAdmin(host);},'quiet small'))))),!(data.follows||[]).length?el('p',{},'No class lists followed yet. Open a class link to begin.'):null));
  }
  function chooseKids(title, content, save, following=false) {
    const {state}=get();
    const selected=content.kids || content.kid_ids || [];
    const checks=state.kids.map(k=>({k,node:input(`sharing-kid-${k.id}`,'',{type:'checkbox',checked:selected.includes(k.id)})}));
    const verse=input('import-verse','',{type:'checkbox',checked:!!content.include_verse});
    const first=input('sharing-new-kid','',{maxlength:40,required:!checks.length,placeholder:'First name or nickname'});
    sheet(title,[el('p',{},following ? 'Choose who should see new weeks. You can change this later.' : 'Make a private copy for the kids you choose. Your family’s edits and progress are never shared back.'),checks.length?el('fieldset',{},el('legend',{},'Add for'),checks.map(({k,node})=>el('label',{class:'sharing-check'},node,k.name))):field('Add your first kid',first),content.verse || following ? el('label',{class:'sharing-check'},verse,'Include Bible verse when available'):null],following?'Save following':'Add to family',async close=>{
      let ids=checks.filter(c=>c.node.checked).map(c=>c.k.id);
      if(!checks.length){const k=await api('/api/admin/kids',{name:first.value.trim(),grade:''});await ctx.reload();ids=[k.id || k.kid?.id || get().state.kids[0]?.id];}
      if(!ids.length)throw Error('Choose at least one kid.');
      await save({kids:ids,include_verse:verse.checked});close();
    });
  }
  async function requireParent(next) {
    if(!get().familyCode) return familyGate(next);
    await ctx.reload();
    if(!get().state.parent) return ctx.unlock(next);
    return next();
  }
  function familyGate(next) {
    const code=input('share-family-code','',{required:true,maxlength:128,autocomplete:'off',autocapitalize:'none',spellcheck:false});
    const start=button('Create a new family',()=>{
      dialog.close();
      const name=input('share-family-name','',{maxlength:80});
      const pin=input('share-create-pin','',{type:'password',required:true,minlength:4,maxlength:8,pattern:'[0-9]{4,8}',inputmode:'numeric',autocomplete:'new-password'});
      const repeat=input('share-repeat-pin','',{type:'password',required:true,inputmode:'numeric',autocomplete:'new-password'});
      sheet('Create your family',[field('Family name (optional)',name),field('Parent PIN (4–8 digits)',pin),field('Repeat PIN',repeat),el('p',{},'No accounts or email. Save your family code and PIN; there is no recovery service.')],'Create & continue',async close=>{
        if(pin.value!==repeat.value)throw Error('The PINs do not match.');
        const result=await api('/api/families',{name:name.value.trim(),pin:pin.value});ctx.rememberFamily(result.code);await ctx.reload();close();
        const codeDialog=modal('Keep your family code',el('div',{},el('p',{},'Keep this code somewhere safe. It opens your private family space.'),el('strong',{class:'sharing-code'},result.code),button('Copy family code',async()=>{await navigator.clipboard.writeText(result.code);toast('Code copied.');},'secondary'),button('Continue to add the list',async()=>{codeDialog.close();await next();})));

      });
    },'secondary');
    const dialog=sheet('Add to your family',[el('p',{},'A parent needs a family space and Parent PIN to add shared practice.'),field('Your existing family code',code),start],'Continue',async close=>{await ctx.openFamily(code.value);close();await requireParent(next);});
  }
  function importContent(kind,slug,content) {
    return requireParent(()=>chooseKids('Add spelling list',content,async payload=>{
      await api('/api/admin/import-shared',{slug,week_id:content.week_id,...payload});await ctx.reload();ctx.goPractice();toast('Added to your family.');
    }));
  }
  function showWords(content) {
    const list=content.list || content.snapshot || content;
    return el('div',{},el('h2',{},list.title || 'Spelling list'),list.date?el('p',{class:'meta'},date(list.date)):null,content.note?el('p',{class:'notice'},content.note):null,el('ol',{class:'shared-words'},(list.words||[]).map(w=>el('li',{},el('strong',{},typeof w==='string'?w:w.word),w.sentence?el('p',{},w.sentence):null))),content.verse?el('section',{class:'shared-verse'},el('h3',{},content.verse.reference),content.verse.translation?el('p',{class:'meta'},content.verse.translation):null,el('p',{},content.verse.text)):null);
  }
  function report(kind,slug) {
    const reason=el('select',{id:'report-reason'},el('option',{value:'personal-information'},'Contains personal information'),el('option',{value:'inappropriate'},'Inappropriate content'),el('option',{value:'spam'},'Spam or misleading content'),el('option',{value:'other'},'Other'));
    sheet('Report this link',[el('p',{},'Report only the shared content. Do not include private family details.'),field('Reason',reason)],'Send report',async close=>{await publicApi('/api/report/'+encodeURIComponent(slug),{reason:reason.value});close();toast('Report received. Thank you.');});
  }
  async function publicPage(kind,slug) {
    ctx.clearView();app.dataset.tone='spelling';document.getElementById('header-actions').replaceChildren();
    app.append(el('div',{class:'band'},el('div',{class:'band-head'},el('h1',{},kind==='c'?'Class list':'A shared spelling list'))));
    const body=section('Getting the words ready…');app.append(body);
    try{
      const result=await publicApi(endpoint(kind,slug));
      const content=result.share || result.class || result;
      document.title=(content.name || content.title || 'Shared practice')+' · Family Practice';
      if(kind==='s')body.replaceChildren(showWords(content),el('div',{class:'row'},button('Add to my family',()=>importContent(kind,slug,content)),button('Report this link',()=>report(kind,slug),'quiet')));
      else {
        body.replaceChildren(...[el('h2',{},content.name),el('p',{},'Weekly practice, shared by a parent. Follow to see new weeks; a parent chooses what to add.'),el('div',{class:'row'},button('Follow class list',()=>requireParent(()=>chooseKids('Follow class list',content,async payload=>{await api('/api/admin/follows',{slug,...payload});toast('Following this class list.');},true)))),el('div',{class:'rows'},(content.weeks||result.weeks||[]).map(w=>el('article',{class:'shared-week'},showWords(w),button('Add this week',()=>importContent('c',slug,w),'secondary')))),!(content.weeks||result.weeks||[]).length?el('p',{},'No weeks published yet.'):null,button('Report this link',()=>report(kind,slug),'quiet')].filter(Boolean));
      }
      body.append(el('p',{class:'muted'},'No accounts, ads, or tracking. Shared links never expose kids or family progress.'),el('a',{href:'/'},'Go to Family Practice'));
    }catch(err){body.replaceChildren(el('h2',{},'This link is not available'),el('p',{role:'alert'},err.message),el('a',{href:'/'},'Go to Family Practice'));}
  }
  async function newWeeks(host,kidId) {
    try {
      const data=await api('/api/follows');
      if(!host.isConnected)return;
      const follows=(data.follows || []).filter(f=>f.available && f.latest && (f.kids || []).includes(kidId) && String(f.last_imported?.[kidId] || '') !== String(f.latest.week_id));
      if(!follows.length){host.remove();return;}
      host.replaceChildren(el('div',{class:'section-title'},el('h2',{},'New week from your class')),el('p',{class:'muted'},'Ask a parent to add the new words.'),...follows.map(f=>el('article',{class:'item'},el('div',{},el('h3',{},'New: '+(f.latest.title || f.latest.list?.title)+' is ready'),el('p',{class:'meta'},f.name+' · '+f.latest.words.length+' words'+(f.include_verse && f.latest.verse ? ' + verse' : ''))),button('Add for '+get().kid.name,()=>requireParent(()=>chooseKids('Add this week',{...f.latest,kid_ids:[kidId],include_verse:f.include_verse},async payload=>{await api('/api/admin/import-shared',{slug:f.slug,week_id:f.latest.week_id,...payload});await ctx.reload();ctx.goPractice();toast('New week added.');})),'secondary'))));
    }catch(err){host.replaceChildren(el('p',{class:'muted'},'Could not check followed lists.'),button('Try again',()=>newWeeks(host,kidId),'quiet small'));}
  }
  return {shareList,sourceMeta,sharedAdmin,classesAdmin,followsAdmin,publicPage,newWeeks};
}
