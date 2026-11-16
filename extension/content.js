(async () => {
  let boot = await chrome.runtime.sendMessage({type:'bootstrap'});
  const t = (key, substitutions) => QuickfillCore.formatMessage(boot.messages, key, substitutions);
  const core = globalThis.QuickfillCore;
  let data = boot.data, target = null, visible = false, mode = 'registry', query = '';
  let host, shadow, main, status, search, header, registryTools, taskTools, destination;
  let draft=null, filtersOpen=false;
  const fields = QuickfillFields, editable = fields.editable;
  let undoBatch = [], undoButton, showAll = false, languageRequest = 0;
  const power=QuickfillPower;
  const prefs=()=>QuickfillRegistry.settings(data.preferences?.[location.origin]);
  const scopeFor=entry=>JSON.stringify([location.origin,location.pathname,entry.id]);
  const excluded=el=>!!el && prefs().excluded.includes(fields.describe(el).signature);
  let tagFilter='',collectionFilter='',demoEntry;
  const surface=QuickfillSurface({t,node,button,prefs,undo,canUndo:()=>undoBatch.length>0,
    matches:el=>suggestions(el),
    choose:(match,el)=>{target=el;chooseValue(match.entry,match.key,el);},
    commands:()=>[
      ...data.entries.flatMap(entry=>Object.entries(entry.values).map(([key,value])=>({group:'values',label:value,detail:entry.name+' · '+key,color:entry.color,run:()=>chooseValue(entry,key)}))),
      ...core.ordered(data.entries,location.origin).map(entry=>({label:t('fillWith',entry.name)+' '+(entry.tags||[]).join(' ')+' '+(entry.collection||''),color:entry.color,run:()=>{toggle(true);previewForm(entry);}})),
      {label:t('keepField'),run:saveField},{label:t('undo'),run:undo},
      {label:t('newEntry'),run:()=>{toggle(true);editor();}},
      {label:t('settings'),run:()=>{toggle(true);settings();}},
      {label:t('walkthrough'),run:()=>{toggle(true);walkthrough();}}
    ]
  });
  function suggestions(el){
    const field=fields.describe(el,data.associations);
    if(excluded(el))return [];
    // Resolve fixed transformations for compatibility; dynamic templates require a review before writing.
    const entries=relevantEntries().map(entry=>({...entry,values:Object.fromEntries(Object.entries(entry.values).map(([key,value])=>[key,power.dynamic(value)?value:power.resolve(value,{},entry.transforms?.[key])]))}));
    const matches=core.suggestions(entries,{...field,type:'text',options:undefined});
    return matches.filter(match=>power.dynamic(match.value)||core.compatible(field,match.value)).map(match=>({...match,entry:data.entries.find(e=>e.id===match.entry.id)}));
  }
  async function contextFor(entry){
    if(Object.values(entry.values).some(value=>value.includes('{{counter}}'))){const next=await mutate({action:'reserve',id:entry.id});return power.context(next.counters[entry.id]);}
    return power.context();
  }
  function transformControl(parent,current={type:'none'}){
    const select=labeled(parent,t('transformation'),node('select',{'data-transform':''}));
    power.transforms.forEach(type=>select.append(node('option',{value:type},t('transform_'+type))));select.value=current.type||'none';
    const format=labeled(parent,t('formatPattern'),node('input',{'data-format':'',placeholder:'{value} / +# (###) ###-####'}));format.value=current.format||'';
    const update=()=>{format.hidden=select.value!=='format';format.previousSibling.hidden=format.hidden;};select.addEventListener('change',update);update();
    return {select,format,get:()=>({type:select.value,format:format.value})};
  }
  async function chooseValue(entry,key,el=target){
    target=el;
    try{
      const raw=entry.values[key];
      if(!power.dynamic(raw)){fill(power.resolve(raw,{},entry.transforms?.[key]));return;}
      toggle(true);screen('resolving',t('resolving'));
      const context=await contextFor(entry);if(!visible||mode!=='resolving')return;
      const value=power.resolve(raw,context,entry.transforms?.[key]);screen('generated',t('reviewGenerated'));
      main.append(node('p',{class:'hint'},`${entry.name} · ${key}`),node('p',{class:'resolved'},value));
      const actions=node('div',{class:'actions sticky-actions'});actions.append(button(t('applyValue'),()=>{target=el;if(fill(value))back();},'primary'),button(t('cancel'),back));main.append(actions);
    }catch(e){back();notify(t(e.message));}
  }
  function duplicate(entry){toggle(true);editor({...structuredClone(entry),id:crypto.randomUUID(),name:t('copyName',entry.name).slice(0,100),pinned:false});}
  function filters(){
    const box=node('div',{class:'filter-row'});
    const collection=labeled(box,t('collection'),node('select',{'data-collection-filter':''}));
    collection.append(node('option',{value:''},t('allCollections')));
    [...new Set(data.entries.map(e=>e.collection).filter(Boolean))].sort().forEach(value=>collection.append(node('option',{value},value)));collection.value=collectionFilter;
    const tag=labeled(box,t('tag'),node('select',{'data-tag-filter':''}));tag.append(node('option',{value:''},t('allTags')));
    [...new Set(data.entries.flatMap(e=>e.tags||[]))].sort().forEach(value=>tag.append(node('option',{value},value)));tag.value=tagFilter;
    collection.addEventListener('change',()=>{collectionFilter=collection.value;render();});tag.addEventListener('change',()=>{tagFilter=tag.value;render();});return box;
  }
  function websiteSettings(){
    const section=node('section',{class:'pair'});section.append(node('h2',{},t('websiteSettings')),node('p',{class:'hint'},location.origin));
    const current=prefs(),form=node('form');
    const preferred=labeled(form,t('preferredEntry'),node('select'));preferred.append(node('option',{value:''},t('noPreference')));
    data.entries.forEach(entry=>preferred.append(node('option',{value:entry.id},entry.name)));preferred.value=current.preferredEntry;
    const appearance=node('fieldset');appearance.append(node('legend',{},t('appearance')));const width=labeled(appearance,t('sidebarWidth'),node('input',{type:'number',min:'320',max:'640',step:'20',required:''}));width.value=current.width;
    const behavior=labeled(form,t('suggestionBehavior'),node('select'));
    ['off','button'].forEach(value=>behavior.append(node('option',{value},t('suggestions_'+value))));behavior.value=current.suggestions;
    const exclusions=new Set(current.excluded);
    const choices=new Map(current.excluded.map(signature=>{let label=t('unavailableField');try{const parts=JSON.parse(signature);label=parts[3]||label;}catch{}return [signature,label];}));
    fields.collect().forEach(el=>{const field=fields.describe(el);choices.set(field.signature,fieldLabel(el));});
    const details=node('details');details.append(node('summary',{},t('excludedFields')));
    for(const [signature,label] of choices){const row=node('label',{class:'check'}),check=node('input',{type:'checkbox'});check.checked=exclusions.has(signature);check.addEventListener('change',()=>check.checked?exclusions.add(signature):exclusions.delete(signature));row.append(check,document.createTextNode(label));details.append(row);}
    form.append(node('p',{class:'hint'},t('autofillCoexistence')),details,appearance,node('button',{type:'submit',class:'primary'},t('savePreferences')));
    form.addEventListener('submit',async event=>{event.preventDefault();try{await mutate({action:'preferences',origin:location.origin,preferences:{preferredEntry:preferred.value,width:Number(width.value),suggestions:behavior.value,excluded:[...exclusions]}});updatePreferences();notify(t('preferencesSaved'));}catch(e){notify(t(e.message));}});
    section.append(form);return section;
  }
  function updatePreferences(){if(shadow)shadow.querySelector('.panel').style.width=`min(${prefs().width}px,100vw)`;if(excluded(target))surface.hide();else surface.refresh();}
  function walkthrough(){
    screen('walkthrough',t('walkthrough'));main.append(node('p',{},t('welcomeText')));
    const create=button(t('createExample'),async()=>{
      try{
        const entry={id:crypto.randomUUID(),name:t('exampleProfile'),color:'#a05dff',values:{name:'Alex Example',email:'alex@example.com'},tags:['demo'],collection:'',sites:[]};
        await mutate({action:'upsert',entry});demoEntry=entry;practice();
      }catch(e){notify(e.message);}
    },'primary');main.append(create,button(t('skipWalkthrough'),finishWalkthrough,'quiet'));
  }
  function practice(){
    screen('walkthrough',t('practiceTitle'));main.append(node('p',{},t('practiceText')));
    const sample=labeled(main,t('practiceEmail'),node('input',{type:'email','data-practice':''}));
    main.append(button(t('fillSample'),()=>{target=sample;fill(demoEntry.values.email);},'primary'),button(t('finishWalkthrough'),finishWalkthrough));
  }
  async function finishWalkthrough(){try{await mutate({action:'onboarding'});back();}catch(e){notify(e.message);}}

  function node(tag, attrs = {}, text) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value);
    }
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, handler, className = '') {return node('button', {type:'button', class:className, onclick:handler}, text);}
  const describe = () => target ? fields.describe(target, data.associations) : null;
  function notify(text, details=[]) {
    if(status){status.replaceChildren();if(text)status.append(node('span',{},text));if(details.length){const more=node('details');more.append(node('summary',{},t('details')));details.forEach(message=>more.append(node('p',{class:'hint'},message)));status.append(more);}}
    surface.announce(text);
  }
  function iconButton(label,icon,handler){const b=button('',handler,'quiet icon-button');b.append(QuickfillIcon(icon));b.setAttribute('aria-label',label);b.title=label;return b;}
  function menu(items){
    const wrap=node('div',{class:'menu-wrap'}),trigger=iconButton(t('moreActions'),'more',()=>{const open=list.hidden;shadow.querySelectorAll('.menu-list').forEach(el=>{el.hidden=true;el.previousSibling.setAttribute('aria-expanded','false');});list.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open)list.querySelector('button')?.focus();});
    const list=node('div',{class:'menu-list',hidden:''});trigger.setAttribute('aria-expanded','false');
    items.forEach(([label,run,danger])=>list.append(button(label,()=>{list.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});run();},danger?'danger':'')));
    wrap.append(trigger,list);return wrap;
  }
  function captureDraft(){if(mode==='editor'&&main?.querySelector('form'))draft={nodes:[...main.childNodes]};}
  function syncHeader(){
    if(!header)return;const registry=['registry','fill'].includes(mode);registryTools.hidden=!registry;taskTools.hidden=registry;
    taskTools.querySelector('strong').tabIndex=-1;taskTools.querySelector('strong').textContent=main.querySelector('h2')?.textContent||'';updateDestination();
  }
  function fieldLabel(el){return el?.getAttribute('aria-label')||el?.labels?.[0]?.textContent?.trim()||el?.getAttribute('placeholder')||fields.describe(el).hints[0]||el?.type||t('value');}
  function updateDestination(){if(destination){destination.textContent=target?.isConnected?t('destination',fieldLabel(target)):t('selectField');destination.title=destination.textContent;}}
  function screen(next,title){captureDraft();mode=next;main.replaceChildren(node('h2',{},title));main.scrollTop=0;syncHeader();taskTools.querySelector('strong').focus({preventScroll:true});}
  function highlighted(text){const fragment=document.createDocumentFragment();const q=query.toLocaleLowerCase();let rest=String(text);if(!q){fragment.append(rest);return fragment;}let at;while((at=rest.toLocaleLowerCase().indexOf(q))>=0){fragment.append(rest.slice(0,at),node('mark',{},rest.slice(at,at+q.length)));rest=rest.slice(at+q.length);}fragment.append(rest);return fragment;}
  function validation(input,message){input.setCustomValidity(message);input.setAttribute('aria-invalid','true');let error=input.nextElementSibling;if(!error?.classList.contains('field-error')){error=node('p',{class:'field-error',id:input.id+'-error'});input.after(error);}error.textContent=message;input.setAttribute('aria-describedby',error.id);input.closest('details')?.setAttribute('open','');input.focus();input.addEventListener('input',()=>{input.setCustomValidity('');input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');error.remove();},{once:true});}

  async function mutate(payload) {
    const response = await chrome.runtime.sendMessage({type:'mutate', ...payload});
    if (response.error) throw new Error(response.error);
    data = response.data; return data;
  }
  function mount() {
    if (host) return;
    host = document.createElement('quickfill-sidebar');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0 0 auto auto!important;z-index:2147483646!important;';
    shadow = host.attachShadow({mode:'open'});
    shadow.append(node('style', {}, globalThis.QuickfillStyles));
    const panel = node('aside', {class:'panel', lang:boot.locale, 'aria-label':t('registryLabel')});
    header = node('header');
    const top=node('div',{class:'top'}),brand=node('div',{class:'brand'});brand.append(QuickfillIcon('magic'),node('h1',{},'Quickfill'));
    const controls=node('div',{class:'row'});controls.append(iconButton(t('settings'),'settings',settings),menu([[t('importData'),importData],[t('exportData'),exportData],[t('palette'),()=>surface.palette()]]),iconButton(t('closeSidebar'),'close',()=>toggle(false)));top.append(brand,controls);
    registryTools=node('div');const searchRow=node('div',{class:'search-row'});
    search=node('input',{class:'search',type:'search',placeholder:t('searchPlaceholder'),'aria-label':t('searchLabel'),oninput:()=>{query=search.value;mode='registry';render();}});
    searchRow.append(search,button(t('newEntryButton'),()=>editor(),'primary'));registryTools.append(searchRow);
    taskTools=node('div',{class:'task-heading',hidden:''});taskTools.append(iconButton(t('back'),'back',back),node('strong'));
    header.append(top,registryTools,taskTools);
    main=node('main');
    const footer=node('footer');destination=node('div',{class:'destination'});
    status=node('div',{class:'status',role:'status','aria-live':'polite'});
    undoButton=button(t('undo'),undo,'quiet');undoButton.disabled=!undoBatch.length;
    const feedback=node('div',{class:'feedback'});feedback.append(status,undoButton,iconButton(t('dismiss'),'close',()=>notify('')));
    footer.append(destination,feedback);panel.append(header,main,footer);shadow.append(panel);
    shadow.addEventListener('pointerdown',event=>{if(!event.target.closest('.menu-wrap'))shadow.querySelectorAll('.menu-list').forEach(el=>{el.hidden=true;el.previousSibling.setAttribute('aria-expanded','false');});});
    shadow.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=shadow.querySelector('.menu-list:not([hidden])');if(open){event.preventDefault();event.stopPropagation();open.hidden=true;open.previousSibling.setAttribute('aria-expanded','false');open.previousSibling.focus();}}});
    document.documentElement.append(host); updatePreferences();
  }
  function toggle(force) {
    mount(); visible = force ?? !visible; host.style.setProperty('display', visible ? 'block' : 'none', 'important');
    if (!visible) {
      captureDraft();
      mode = 'registry';
      query = '';
      search.value = '';
      main.replaceChildren();
      notify('');
    }
    if (visible) {surface.hide(true);render();if(['registry','fill'].includes(mode))search.focus();} else if(target?.isConnected)target.focus();
  }
  function remember(states) {undoBatch = states; if (undoButton) undoButton.disabled = !states.length;}
  function fill(value) {
    if (!target?.isConnected) {notify(t('selectField'));return false;}
    if(excluded(target)){notify(t('fieldExcluded'));return false;}
    const before = fields.snapshot(target);
    const result=fields.writeResult(target,value);
    if (!result.ok) {notify(t(result.code)); return false;}
    before.after = fields.snapshot(target); remember([before]);
    // Keep focus on the initiating control; refocusing the field can reopen native autofill.
    notify(t('filledField',fieldLabel(target))); return true;
  }
  function undo() {
    let restored = 0;
    for (const state of undoBatch) if (fields.restore(state)) restored++;
    const skipped=undoBatch.length-restored;remember([]);notify(t('undoResult',[String(restored),String(skipped)]));
  }
  async function flags(entry, patch) {
    try {await mutate({action:'flags',id:entry.id,...patch}); render();} catch(e) {notify(e.message === 'invalidImport' ? t('invalidImport') : e.message);}
  }
  const relevantEntries = () => core.ordered(data.entries.filter(e => (showAll || core.relevant(e,location.origin)) && (!tagFilter || e.tags?.includes(tagFilter)) && (!collectionFilter || e.collection===collectionFilter)),location.origin).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||Number(b.id===prefs().preferredEntry)-Number(a.id===prefs().preferredEntry));
  function reason(match) {return match.reason === 'association' ? t('savedAssociation') : t('matchedHint',match.hint);}
  function valueButton(entry, key, value) {
    const b = button('', () => chooseValue(entry,key), 'value');
    b.draggable = true; b.setAttribute('aria-label', `${key}: ${value}`);
    const label=node('small'),text=node('span');label.append(highlighted(key));text.append(highlighted(value||t('emptyValue')));b.append(label,text,QuickfillMagicParticles());b.title=value;b.style.setProperty('--entry-color',entry.color);
    if(value.length>100||value.includes('\n')){b.classList.add('long-value');b.setAttribute('aria-label',key+': '+value);}
    b.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', value);
      event.dataTransfer.setData('application/x-quickfill', JSON.stringify({entryId:entry.id,key}));
      event.dataTransfer.effectAllowed = 'copy';
    });
    return b;
  }
  function card(entry, pairs = Object.entries(entry.values), edit = true) {
    const article = node('article'); article.style.setProperty('--entry-color', /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : '#a05dff');
    const row=node('div',{class:'row card-heading'}),title=node('h2');title.append(highlighted(entry.name));row.append(title);
    if(edit){const pin=iconButton(t(entry.pinned?'unpin':'pin'),'pin',()=>flags(entry,{pinned:!entry.pinned}));pin.setAttribute('aria-pressed',String(!!entry.pinned));row.append(pin);
      const expand=iconButton(t(entry.collapsed?'expand':'collapse'),entry.collapsed?'down':'up',()=>flags(entry,{collapsed:!entry.collapsed}));expand.setAttribute('aria-expanded',String(!entry.collapsed));row.append(expand,menu([[t('edit'),()=>editor(entry)],[t('duplicate'),()=>duplicate(entry)],[t('deleteEntry'),()=>deleteEntry(entry),true]]));}
    article.append(row);
    if(entry.collection||entry.tags?.length){const meta=node('p',{class:'hint metadata'});meta.append(highlighted([entry.collection,...(entry.tags||[]).map(tag=>'#'+tag)].filter(Boolean).join(' · ')));article.append(meta);}
    if(edit){const actions=node('div',{class:'card-actions'});actions.append(node('span',{class:'hint'},t('valueCount',String(Object.keys(entry.values).length))),button(t('fillForm'),()=>previewForm(entry),'quiet'));article.append(actions);}
    if(!edit||!entry.collapsed||query)for(const [key,value] of pairs){article.append(valueButton(entry,key,value));if(value.length>100||value.includes('\n')){const full=node('details',{class:'full-value'});full.append(node('summary',{},t('showFullValue')),node('p',{class:'resolved'},value));article.append(full);}}
    if (!pairs.length) article.append(node('p', {class:'hint'}, t('noValues')));
    return article;
  }
  function render() {
    if (!visible || !['registry','fill'].includes(mode)) return;
    main.replaceChildren();
    syncHeader();
    const toolbar=node('div',{class:'row registry-toolbar'}),scope=node('select',{'aria-label':t('entryScope')});
    scope.append(node('option',{value:'site'},t('websiteSettings')),node('option',{value:'all'},t('allEntries')));scope.value=showAll?'all':'site';scope.addEventListener('change',()=>{showAll=scope.value==='all';render();});
    const filterButton=button(t('filters'),()=>{filtersOpen=!filtersOpen;render();});filterButton.setAttribute('aria-expanded',String(filtersOpen));toolbar.append(scope,filterButton);main.append(toolbar);
    const filterBox=filters();filterBox.hidden=!filtersOpen;main.append(filterBox);
    const chips=node('div',{class:'chips'});if(collectionFilter)chips.append(button(collectionFilter+' ×',()=>{collectionFilter='';render();},'chip'));if(tagFilter)chips.append(button('#'+tagFilter+' ×',()=>{tagFilter='';render();},'chip'));main.append(chips);
    if(draft){const resume=node('div',{class:'resume'});resume.append(button(t('resumeDraft'),()=>{mode='editor';main.replaceChildren(...draft.nodes);syncHeader();main.querySelector('input')?.focus();},'quiet'),button(t('discardDraft'),()=>{draft=null;render();},'quiet'));main.append(resume);}
    if(!data.onboardingDone){const welcome=node('div',{class:'pair welcome'});welcome.append(node('p',{},t('welcomeText')),button(t('walkthrough'),walkthrough),button(t('skipWalkthrough'),finishWalkthrough,'quiet'));main.append(welcome);}
    const count=node('span',{class:'count',role:'status'});main.append(count);
    if (mode === 'fill' && target) {
      main.append(node('h2', {class:'section'}, t('suggestedValues')));
      const matches = suggestions(target);
      main.append(button(t('editAssociation'),associationEditor,'quiet'));
      for (const match of matches) {const item = card(match.entry, [[match.key, match.value]], false); item.append(node('p',{class:'hint'},reason(match))); main.append(item);} 
      if (!matches.length) main.append(node('p', {}, t('noMatchingKeys')));
      main.append(node('h2', {class:'section'}, t('allEntries')));
    }
    const q = query.toLowerCase();
    const entries = relevantEntries().filter(entry => [entry.name,entry.collection||'',...(entry.tags||[]), ...Object.entries(entry.values).flat()].some(v => v.toLowerCase().includes(q)));
    count.textContent=entries.length===data.entries.length?t('entryCount',String(entries.length)):t('matchingEntries',[String(entries.length),String(data.entries.length)]);
    let group;
    entries.forEach(entry => {
      const next=entry.pinned?'pinnedEntries':'savedEntries';if(group!==next){const title=next==='pinnedEntries'?t('pinnedEntries'):t('savedEntries');main.append(node('h2',{class:'group-title'},title));group=next;}
      const pairs = Object.entries(entry.values).filter(([key,value]) => !q || entry.name.toLowerCase().includes(q) || entry.collection?.toLowerCase().includes(q) || entry.tags?.some(tag=>tag.toLowerCase().includes(q)) || key.toLowerCase().includes(q) || value.toLowerCase().includes(q));
      main.append(card(entry, pairs));
    });
    if (!entries.length) {
      const empty = node('div', {class:'empty'});
      empty.append(node('strong', {}, q||tagFilter||collectionFilter||data.entries.length ? t('noMatchingEntries') : t('emptyTitle')), node('p', {}, q||tagFilter||collectionFilter||data.entries.length ? t('tryAnotherSearch') : t('emptyDescription')));
      if(q||tagFilter||collectionFilter||data.entries.length)empty.append(button(t('clearFilters'),()=>{query='';search.value='';tagFilter='';collectionFilter='';showAll=true;render();},'quiet'));else empty.append(button(t('newEntry'),()=>editor(),'primary'));
      main.append(empty);
    }
  }
  function labeled(form, title, input) {
    const id = `qf-${crypto.randomUUID()}`; input.id = id;
    form.append(node('label', {for:id}, title), input); return input;
  }
  function editor(existing) {
    screen('editor',existing?.id&&data.entries.some(e=>e.id===existing.id)?t('editEntry'):t('newEntry'));draft=null;
    const form = node('form');
    const name = labeled(form, t('entryName'), node('input', {required:'', placeholder:t('entryNamePlaceholder'), maxlength:'100'})); name.value = existing?.name || '';
    if(!existing?.id){const template=labeled(form,t('entryTemplate'),node('select',{'data-template':''}));template.append(node('option',{value:''},t('blankTemplate')));Object.keys(power.templates).forEach(key=>template.append(node('option',{value:key},t('template_'+key))));template.addEventListener('change',()=>{if(template.value)editor({...existing,name:name.value||t('template_'+template.value),values:{...power.templates[template.value]}});});}
    const color = labeled(form, t('entryColor'), node('input', {type:'color'})); color.value = existing?.color || '#a05dff';
    const organization=node('details',{class:'organization'});organization.append(node('summary',{},t('organization')));
    const sites = labeled(organization,t('sites'),node('textarea',{placeholder:'https://example.com'})); sites.value = (existing?.sites || []).join('\n');
    organization.append(node('p',{class:'hint'},t('sitesHint')),button(t('currentSite'),()=>{sites.value=location.origin;},'quiet'));
    const tags=labeled(organization,t('tags'),node('input',{'data-tags':'',placeholder:t('tagsHint')}));tags.value=(existing?.tags||[]).join(', ');
    const collection=labeled(organization,t('collection'),node('input',{'data-collection':'',maxlength:'100'}));collection.value=existing?.collection||'';
    const swatches=node('div',{class:'swatches',role:'group','aria-label':t('entryColor')});
    for(const hex of ['#a05dff','#315de4','#16866b','#ce4774','#b56b16','#65748b']){const swatch=button('',()=>{color.value=hex;updateSwatches();},'swatch');swatch.style.setProperty('--swatch',hex);swatch.title=hex;swatch.setAttribute('aria-label',hex);swatch.dataset.color=hex;swatches.append(swatch);}
    function updateSwatches(){swatches.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===color.value)));}color.addEventListener('input',updateSwatches);updateSwatches();color.after(swatches);
    const pairs = node('div'); form.append(pairs);
    function addPair(key = '', value = '') {
      const pair = node('div', {class:'pair'});
      const k = labeled(pair, t('key'), node('input', {required:'', placeholder:'email'})); k.value = key;
      const v = labeled(pair, t('value'), node('textarea', {placeholder:'alex@example.com'})); v.value = value;
      const advanced=node('details');advanced.append(node('summary',{},t('valueOptions')));transformControl(advanced,existing?.transforms?.[key]);advanced.append(node('p',{class:'hint'},t('variablesHint')));pair.append(advanced);
      pair.append(button(t('removeValue'), () => pair.remove(), 'quiet danger')); pairs.append(pair);
    }
    if (existing) Object.entries(existing.values).forEach(([k,v]) => addPair(k,v)); else addPair();
    form.append(button(t('addValue'), () => {addPair();pairs.lastChild.querySelector('input').focus();}, 'quiet'),organization);
    const actions = node('div', {class:'actions'});
    actions.classList.add('sticky-actions');actions.append(node('button', {type:'submit', class:'primary'}, t('saveEntry')),button(t('cancel'),()=>{draft=null;mode='registry';render();search.focus();}));
    if(existing?.id&&data.entries.some(e=>e.id===existing.id))organization.append(button(t('deleteEntry'),()=>deleteEntry(existing),'danger'));
    form.append(actions); main.append(form); name.focus();
    form.addEventListener('submit', async event => {
      event.preventDefault(); const values = Object.create(null),transforms=Object.create(null);
      for (const pair of pairs.children) {
        const key = pair.querySelector('input').value.trim();
        if(!key||Object.hasOwn(values,key)){validation(pair.querySelector('input'),t('uniqueKeyRequired'));return;}
        values[key] = pair.querySelector('textarea').value;
        transforms[key]={type:pair.querySelector('[data-transform]').value,format:pair.querySelector('[data-format]').value};
      }
      if(!name.value.trim()){validation(name,t('entryNameRequired'));return;}
      let allowedSites;try{allowedSites=QuickfillRegistry.sites(sites.value.split(/[,\n]/).map(x=>x.trim()).filter(Boolean));}catch{validation(sites,t('sitesHint'));return;}
      try {await mutate({action:'upsert', entry:{...existing, id:existing?.id || crypto.randomUUID(), name:name.value.trim(), color:color.value, values,transforms,tags:tags.value.split(',').map(tag=>tag.trim()).filter(Boolean),collection:collection.value.trim(), sites:allowedSites}});draft=null;mode='registry';back(); notify(t('entrySaved'));} catch(e) {notify(e.message === 'invalidImport' ? t('invalidImport') : e.message);}
    });
  }
  function back() {captureDraft();mode='registry';render();search.focus();}
  function deleteEntry(entry){
    screen('delete',t('deleteEntry'));main.append(node('p',{},t('confirmDelete',entry.name)));
    const actions=node('div',{class:'actions'});actions.append(button(t('deleteEntry'),async()=>{try{await mutate({action:'delete',id:entry.id});draft=null;back();notify(t('entryDeleted'));}catch(e){notify(t(e.message));}},'danger'),button(t('cancel'),back));main.append(actions);
  }
  function saveField() {
    toggle(true);
    if (!target || !editable(target)) {notify(t('chooseInput')); return;}
    screen('save',t('keepField'));
    const field=describe(),form=node('form');
    const select=labeled(form,t('saveToEntry'),node('select'));
    data.entries.forEach(entry=>select.append(node('option',{value:entry.id},entry.name)));select.append(node('option',{value:'__new'},t('newEntry')));
    const name=labeled(form,t('entryName'),node('input',{maxlength:'100',placeholder:t('entryNamePlaceholder')}));
    const key=labeled(form,t('associatedKey'),node('input',{required:''}));key.value=field.associatedKey||core.canonical(field.hints[0])||'value';
    const value=labeled(form,t('value'),node('textarea'));value.value=fields.value(target);
    const replacement=node('div',{class:'replacement'});let reviewed='';
    const review=()=>{const isNew=select.value==='__new';name.hidden=!isNew;name.previousSibling.hidden=!isNew;name.required=isNew;const entry=data.entries.find(e=>e.id===select.value),old=entry?.values[key.value.trim()];replacement.replaceChildren();if(old!==undefined){replacement.append(node('strong',{},t('replaceValue')),node('small',{},t('beforeValue')),node('p',{class:'resolved'},old),node('small',{},t('afterValue')),node('p',{class:'resolved'},value.value));}return JSON.stringify([select.value,key.value.trim(),value.value,old]);};
    for(const input of [select,key,value]){input.addEventListener('input',()=>{reviewed=review();});input.addEventListener('change',()=>{reviewed=review();});}reviewed=review();
    const actions=node('div',{class:'actions sticky-actions'});actions.append(node('button',{class:'primary',type:'submit'},t('saveValue')),button(t('cancel'),back));form.append(replacement,node('p',{class:'hint'},t('saveFieldHint')),actions);main.append(form);
    form.addEventListener('submit',async event=>{event.preventDefault();if(!key.value.trim()){validation(key,t('keyRequired'));return;}try{const next=review();if(next!==reviewed){reviewed=next;if(replacement.children.length){notify(t('reviewReplacement'));return;}}
      let id=select.value;if(id==='__new'){if(!name.value.trim()){validation(name,t('entryNameRequired'));return;}id=crypto.randomUUID();await mutate({action:'upsert',entry:{id,name:name.value.trim(),color:'#a05dff',values:{}}});}
      await mutate({action:'save-field',id,key:key.value.trim(),value:value.value,signature:field.signature});back();notify(t('fieldSaved'));
    }catch(e){notify(t(e.message));}});
  }
  async function previewForm(entry) {
    const selectedForm=target?.form;
    screen('resolving',t('resolving'));
    let context;try{context=await contextFor(entry);}catch(e){back();notify(t(e.message));return;}
    if(!visible||mode!=='resolving')return;
    screen('preview',t('formPreview'));main.append(node('p',{},entry.name),node('p',{class:'hint'},t('previewHint')));
    const emptyLabel=node('label',{class:'check'}),emptyOnly=node('input',{type:'checkbox','data-empty-only':''});emptyOnly.checked=true;
    emptyLabel.append(emptyOnly,document.createTextNode(t('emptyOnly')));main.append(emptyLabel);
    const rules=data.mappings?.[scopeFor(entry)]||[];
    const candidates=fields.collect().filter(el=>(!selectedForm||el.form===selectedForm||selectedForm.contains(el))&&el.type!=='password'&&!excluded(el));
    const matchedRules=new Map(),broken=[];
    for(const rule of rules){const el=fields.locate(rule.locator);if(!el||fields.describe(el).signature!==rule.signature||!Object.hasOwn(entry.values,rule.key)){broken.push(rule);continue;}matchedRules.set(el,rule);}
    if(broken.length){const warning=node('div',{class:'ambiguous pair',role:'status'});warning.append(node('strong',{},t('brokenMappings',String(broken.length))),node('p',{class:'hint'},t('repairMappings')));for(const rule of broken){const detail=node('details');detail.append(node('summary',{},rule.key),node('p',{class:'hint'},rule.locator.join(' / ')));warning.append(detail);}main.append(warning);}
    const summary=node('div',{class:'preview-summary',role:'status'}),attentionLabel=node('label',{class:'check'}),attention=node('input',{type:'checkbox'});attentionLabel.append(attention,document.createTextNode(t('needsAttention')));main.append(summary,attentionLabel);
    const rows=node('div',{class:'preview-rows'});main.append(rows);
    const plan=[];let apply;
    function summarize(){let ready=0,issues=0,skipped=0;for(const item of plan){const skip=emptyOnly.checked&&fields.value(item.el)!=='';item.attention=!skip&&(!!item.error||(item.select.value===''&&item.ambiguous&&!item.touched));if(item.attention)issues++;else if(skip||item.select.value==='')skipped++;else ready++;item.row.hidden=attention.checked&&!item.attention;item.row.style.order=item.attention?'0':'1';item.row.classList.toggle('ambiguous',item.attention);const hint=item.row.querySelector('.ambiguity-hint');if(hint)hint.hidden=!(item.select.value===''&&item.ambiguous&&!item.touched);}
      summary.replaceChildren(...t('previewSummary',[String(ready),String(issues),String(skipped)]).split(' · ').map(text=>node('span',{},text)));if(apply){apply.textContent=ready===1?t('fillOneField'):t('fillFields',String(ready));apply.disabled=!ready;}}
    attention.addEventListener('change',summarize);
    for(const el of candidates){
      const field=fields.describe(el,data.associations),rule=matchedRules.get(el);
      const matches=core.suggestions([{...entry,values:Object.fromEntries(Object.entries(entry.values).map(([key,value])=>[key,value]))}],{...field,type:'text',options:undefined});
      const keys=[...matches.map(m=>m.key),...Object.keys(entry.values).filter(key=>!matches.some(m=>m.key===key))];
      const row=node('div',{class:'pair'}),select=labeled(row,fieldLabel(el),node('select',{'data-field-key':'','aria-label':field.hints[0]||field.type}));
      select.append(node('option',{value:''},t('skipField')));
      keys.forEach((key,index)=>select.append(node('option',{value:String(index)},key)));
      if(rule)select.value=String(keys.indexOf(rule.key));else if(matches.length===1)select.value='0';
      if(matches.length>1&&!rule){row.classList.add('ambiguous');row.append(node('p',{class:'hint ambiguity-hint'},t('ambiguousMatch')));}
      row.append(node('p',{class:'hint'},t('currentValue',fields.value(el)||t('emptyValue'))));
      const options=node('details');options.append(node('summary',{},t('valueOptions')));const transform=transformControl(options,rule?.transform||entry.transforms?.[keys[Number(select.value)]]);row.append(options);
      const resolved=node('p',{class:'resolved'}),explanation=node('p',{class:'hint'});row.append(resolved,explanation);
      const item={el,row,select,keys,transform,resolved,explanation,value:null,error:null,ambiguous:matches.length>1&&!rule,touched:false,before:fields.snapshot(el)};
      const update=()=>{
        item.error=null;item.value=null;row.classList.remove('will-skip');
        if(select.value===''){resolved.textContent=t('skipField');explanation.textContent=item.ambiguous&&!item.touched?t('ambiguousMatch'):'';summarize();return;}
        const key=keys[Number(select.value)];
        try{item.value=power.resolve(entry.values[key],context,transform.get());if(!core.compatible(field,item.value))item.error='incompatibleValue';}catch(e){item.error=e.message;}
        resolved.textContent=item.value??'';
        if(emptyOnly.checked&&fields.value(el)!==''){row.classList.add('will-skip');explanation.textContent=t('nonemptySkipped');}
        else explanation.textContent=item.error?t(item.error):rule?t('savedMapping'):matches.find(m=>m.key===key)?reason(matches.find(m=>m.key===key)):t('manualMapping');summarize();
      };
      select.addEventListener('change',()=>{item.touched=true;const key=keys[Number(select.value)];const choice=entry.transforms?.[key]||{type:'none',format:''};transform.select.value=choice.type;transform.format.value=choice.format||'';transform.select.dispatchEvent(new Event('change'));update();});
      transform.select.addEventListener('change',update);transform.format.addEventListener('input',update);emptyOnly.addEventListener('change',update);plan.push(item);update();rows.append(row);
    }
    if(!plan.length)main.append(node('p',{},t('noFields')));
    const saveMapping=button(t('saveMapping'),async()=>{
      const mapping=plan.filter(item=>item.select.value!=='').map(item=>({signature:fields.describe(item.el).signature,locator:fields.locator(item.el),key:item.keys[Number(item.select.value)],transform:item.transform.get()}));
      try{await mutate({action:'mapping',scope:scopeFor(entry),rules:mapping});notify(t('mappingSaved'));}catch(e){notify(t(e.message));}
    });
    apply=button(t('applyForm'),()=>{
      const states=[],failures=[];let skipped=0;
      for(const item of plan){
        if(item.select.value===''){skipped++;continue;}
        if(emptyOnly.checked&&fields.value(item.el)!==''){skipped++;continue;}
        if(item.error){failures.push(t(item.error));skipped++;continue;}
        const current=fields.snapshot(item.el);
        if(!item.el.isConnected||current.value!==item.before.value||current.html!==item.before.html||JSON.stringify(current.selected)!==JSON.stringify(item.before.selected)){failures.push(t(item.el.isConnected?'fieldChanged':'fieldRemoved'));skipped++;continue;}
        if(excluded(item.el)){failures.push(t('fieldExcluded'));skipped++;continue;}
        const result=fields.writeResult(item.el,item.value);
        if(result.ok){current.after=fields.snapshot(item.el);states.push(current);}else{skipped++;failures.push(t(result.code));}
      }
      if(states.length)remember(states);back();notify(t('formResult',[String(states.length),String(skipped)]),[...new Set(failures)]);
    },'primary');apply.dataset.action='applyForm';summarize();
    const actions=node('div',{class:'actions sticky-actions preview-actions'});actions.append(apply,saveMapping,button(t('cancel'),back));main.append(actions);
  }
  function associationEditor() {
    if (!target?.isConnected) {notify(t('selectField'));return;}
    const field=describe();screen('association',t('editAssociation'));
    const form=node('form');
    const key=labeled(form,t('associatedKey'),node('input',{list:'quickfill-keys'}));key.value=field.associatedKey || '';
    const list=node('datalist',{id:'quickfill-keys'});
    [...new Set(data.entries.flatMap(e=>Object.keys(e.values)))].forEach(k=>list.append(node('option',{value:k})));form.append(list);
    form.append(node('p',{class:'hint'},t('associationHint')));
    const actions=node('div',{class:'actions'});actions.append(node('button',{type:'submit',class:'primary'},t('saveValue')),button(t('cancel'),back));form.append(actions);main.append(form);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      try {await mutate({action:'associate',signature:field.signature,key:key.value.trim()});mode='fill';render();notify(t('fieldSaved'));}catch(e){notify(e.message);}
    });
  }
  async function reloadLanguage() {
    const request=++languageRequest;
    const next=await chrome.runtime.sendMessage({type:'bootstrap'});
    if(request!==languageRequest)return;
    boot=next; data=boot.data;surface.escape();surface.hide(true);
    const wasVisible=visible; host?.remove();host=null;mode='registry';query='';
    if(wasVisible) toggle(true);
  }
  function settings() {
    screen('settings',t('settings'));
    const general=node('section',{class:'settings-section'});general.append(node('h2',{},t('general')));
    const select=labeled(general,t('language'),node('select'));[['auto',t('automatic')],['en','English'],['ru','Русский']].forEach(([value,label])=>select.append(node('option',{value},label)));select.value=data.language||'auto';
    general.append(node('p',{class:'hint'},t('languageHint')),button(t('walkthrough'),walkthrough,'quiet'));
    const storage=node('section',{class:'settings-section'});storage.append(node('h2',{},t('dataSettings')),button(t('importData'),importData),button(t('exportData'),exportData),node('p',{class:'hint'},t('backupHint')));
    main.append(general,websiteSettings(),storage);
    select.addEventListener('change',async()=>{try{await mutate({action:'language',language:select.value});await reloadLanguage();}catch(e){notify(t(e.message));}});
  }
  function exportData() {
    const bundle={version:1,entries:data.entries,associations:data.associations,mappings:data.mappings||{},preferences:data.preferences||{}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));
    const link=node('a',{href:url,download:'quickfill-backup.json'});shadow.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);notify(t('exported'));
  }
  function importData() {
    screen('import',t('importData'));
    const file=labeled(main,t('chooseFile'),node('input',{type:'file',accept:'.json,application/json'}));
    const alternate=node('details');alternate.append(node('summary',{},t('pasteJson')));const input=labeled(alternate,t('pasteJson'),node('textarea'));main.append(alternate);
    let currentRead=0;
    file.addEventListener('change',async()=>{
      const token=++currentRead;
      try {const selected=file.files[0];if(!selected)return;if(selected.size>2000000)throw new Error(t('invalidImport')); const text=await selected.text();if(token===currentRead)input.value=text;}catch(e){notify(e.message);}
    });
    main.append(node('p',{class:'hint'},t('backupHint')));
    const actions=node('div',{class:'actions'});actions.append(button(t('previewImport'),()=>{
      try {
        if(new TextEncoder().encode(input.value).length>2000000)throw new Error('invalidImport');
        importPreview(QuickfillRegistry.bundle(JSON.parse(input.value)));
      }catch{notify(t('invalidImport'));}
    },'primary'),button(t('cancel'),back)); main.append(actions);
  }
  function importPreview(bundle) {
    screen('importPreview',t('previewImport'));
    const duplicate=bundle.entries.filter(e=>data.entries.some(old=>old.id===e.id)).length;
    main.append(node('p',{},t('importSummary',[String(bundle.entries.length-duplicate),String(duplicate),String(Object.keys(bundle.associations).length)])));
    const importStats=node('p',{class:'preview-summary',role:'status'});main.append(importStats);
    for(const entry of bundle.entries) {
      const item=node('article');item.style.setProperty('--entry-color',entry.color);
      item.append(node('h2',{},entry.name),node('p',{class:'hint'},data.entries.some(e=>e.id===entry.id)?t('duplicateEntry'):t('newEntry')));
      const details=node('details');details.append(node('summary',{},t('valueCount',String(Object.keys(entry.values).length))));for(const [key,value] of Object.entries(entry.values))details.append(node('p',{class:'hint'},`${key}: ${value}`));item.append(details);main.append(item);
    }
    const strategy=labeled(main,t('duplicates'),node('select'));
    [['merge',t('mergeDuplicates')],['replace',t('replaceDuplicates')],['skip',t('skipDuplicates')]].forEach(([value,label])=>strategy.append(node('option',{value},label)));
    const updateStats=()=>{importStats.textContent=t('importChanges',[String(bundle.entries.length-duplicate),String(strategy.value==='skip'?0:duplicate),String(strategy.value==='skip'?duplicate:0)]);};strategy.addEventListener('change',updateStats);updateStats();main.append(node('p',{class:'hint'},t('importPolicy')));
    const apply=button(t('applyImport'),async()=>{
      apply.disabled=true;
      try{await mutate({action:'import',bundle,strategy:strategy.value});back();notify(t('imported'));}catch(e){notify(e.message);apply.disabled=false;}
    },'primary');
    const actions=node('div',{class:'actions sticky-actions'});actions.append(apply,button(t('cancel'),back));main.append(actions);
  }

  const pageField = event => event.composedPath().find(editable);
  document.addEventListener('focusin', event => {if (event.composedPath().includes(host)||surface.inside(event)) return; const field = pageField(event); if (field) {target = field;updateDestination();surface.track(excluded(field)?null:field);} else surface.hide();}, true);
  document.addEventListener('contextmenu', event => {if (!event.composedPath().includes(host)&&!surface.inside(event)) target = event.composedPath().find(fields.supported) || null;}, true);
  document.addEventListener('dragover', event => {
    if (pageField(event) && event.dataTransfer.types.includes('application/x-quickfill')) {event.preventDefault(); event.dataTransfer.dropEffect = 'copy';}
  }, true);
  document.addEventListener('drop', event => {
    const field = pageField(event);
    if (!field || !event.dataTransfer.types.includes('application/x-quickfill')) return;
    event.preventDefault(); event.stopPropagation(); target = field;
    const raw=event.dataTransfer.getData('application/x-quickfill');
    try{const item=JSON.parse(raw),entry=data.entries.find(e=>e.id===item.entryId);if(entry&&Object.hasOwn(entry.values,item.key)){chooseValue(entry,item.key,field);return;}}catch{}
    fill(raw);
  }, true);
  document.addEventListener('keydown', event => {
    // Commands API owns Ctrl+B; avoid a second toggle from a page key handler.
    if(surface.inside(event))return;
    if(event.composedPath().includes(host)){
      const open=shadow.querySelector('.menu-list:not([hidden])');if(open){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();open.hidden=true;open.previousSibling.setAttribute('aria-expanded','false');open.previousSibling.focus();return;}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const options=[...open.querySelectorAll('button')],at=options.indexOf(shadow.activeElement);options[(at+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();return;}}
    }
    if (event.key === 'Escape') {surface.escape();if(visible)toggle(false);return;}
    if (!visible || !event.composedPath().includes(host) || !['registry','fill'].includes(mode)) return;
    const active = shadow.activeElement;
    const values = Array.from(main.querySelectorAll('.value'));
    if (['ArrowDown','ArrowUp'].includes(event.key) && (active === search || values.includes(active)) && values.length) {
      event.preventDefault(); const index = values.indexOf(active);
      values[index<0?(event.key==='ArrowDown'?0:values.length-1):(index+(event.key==='ArrowDown'?1:-1)+values.length)%values.length].focus();
    } else if (event.key === 'Enter' && values.length && (active === search || values.includes(active))) {event.preventDefault(); (active === search ? values[0] : active).click();}
  }, true);
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'palette') surface.palette();
    if (message.type === 'toggle') toggle();
    if (message.type === 'fill') {mode = 'fill'; query = ''; if (search) search.value = ''; toggle(true);}
    if (message.type === 'save') saveField();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.registry) return;
    const next = changes.registry.newValue || {entries:[],associations:{},language:'auto'};
    const changedLanguage = (boot.data.language || 'auto') !== (next.language || 'auto'); data = next;
    if (changedLanguage) reloadLanguage(); else {updatePreferences();render();}
  });
})();
