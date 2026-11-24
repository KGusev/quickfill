if (!globalThis.QuickfillReady) {
globalThis.QuickfillReady = (async () => {
  async function bootstrap(){
    let timeout;
    try{return await Promise.race([chrome.runtime.sendMessage({type:'bootstrap'}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Quickfill startup timed out')),4500);})]);}
    finally{clearTimeout(timeout);}
  }
  let boot = await bootstrap();
  const standalone=location.href.split(/[?#]/)[0]===chrome.runtime.getURL('options.html');
  const managerTabId=standalone?(await chrome.tabs.getCurrent())?.id:null;
  const isCurrent=()=>!!chrome.runtime?.id;
  // Reloaded extensions leave their old DOM behind. Legacy observers may restore
  // removed hosts, so keep those hosts inert even if they are reattached.
  document.querySelectorAll('quickfill-sidebar,quickfill-tools').forEach(old=>{
    old.dataset.quickfillRetired='';old.inert=true;
    old.style.setProperty('opacity','0','important');old.style.setProperty('pointer-events','none','important');
    old.style.setProperty('visibility','hidden','important');old.remove();
  });
  const t = (key, substitutions) => QuickfillCore.formatMessage(boot.messages, key, substitutions);
  const core = globalThis.QuickfillCore;
  let data = boot.data, target = null, visible = false, mode = 'registry', query = '';
  let host, shadow, main, status, search, header, registryTools, taskTools, destination;
  let draft=null, filtersOpen=false, fullscreen=standalone, fullscreenButton, sidebarSideButton, movingSidebar=false, screenVersion=0;
  let resizeHandle, resizeSession=null, pendingWidth=null, widthRequest=0;
  const fields = QuickfillFields, editable = fields.editable;
  let undoBatch = [], undoButton, showAll = standalone, languageRequest = 0;
  const power=QuickfillPower;
  const types=QuickfillTypes;
  const typeFor=(entry,key)=>Object.hasOwn(entry.types||{},key)?entry.types[key]:'string';
  const prefs=()=>QuickfillRegistry.effectiveSettings(standalone?undefined:data.preferences?.[location.origin],data.globalPreferences);
  const globalSuggestions=()=>QuickfillRegistry.globalSettings(data.globalPreferences).suggestions;
  const sidebarSide=()=>QuickfillRegistry.globalSettings(data.globalPreferences).sidebarSide;
  const inheritedSuggestionsLabel=()=>t('suggestions_inherit',t('suggestions_'+globalSuggestions()));
  const scopeFor=entry=>JSON.stringify([location.origin,location.pathname,entry.id]);
  const excluded=el=>!!el && prefs().excluded.includes(fields.describe(el).signature);
  let tagFilter='',collectionFilter='',demoEntry;
  const surface=QuickfillSurface({t,node,button,prefs,undo,active:isCurrent,renderValue:typedValue,canUndo:()=>undoBatch.length>0,
    matches:el=>suggestions(el),
    choose:(match,el)=>{target=el;chooseValue(match.entry,match.key,el);},
    launcherActions:field=>[
      {label:t('keepField'),run:()=>{target=field;saveField();}},
      {label:t('editAssociation'),run:()=>{target=field;toggle(true);associationEditor();}},
      {label:t('openSidebar'),run:()=>{target=field;toggle(true);}},
      {label:t('settings'),run:()=>{target=field;toggle(true);settings();}}
    ],
    commands:()=>standalone?[
      ...data.entries.map(entry=>({label:entry.name,detail:t('editEntry'),color:entry.color,icon:'edit',run:()=>editor(entry)})),
      {label:t('newEntry'),icon:'add',run:()=>editor()},
      {label:t('settings'),icon:'settings',run:settings},
      {label:t('importData'),icon:'import',run:importData},{label:t('exportData'),icon:'export',run:exportData}
    ]:[
      ...data.entries.flatMap(entry=>Object.entries(entry.values).map(([key,value])=>({group:'values',label:value,type:typeFor(entry,key),detail:entry.name+' · '+key,color:entry.color,run:()=>chooseValue(entry,key)}))),
      ...core.ordered(data.entries,location.origin).map(entry=>({label:t('fillWith',entry.name)+' '+(entry.tags||[]).join(' ')+' '+(entry.collection||''),color:entry.color,run:()=>{toggle(true);previewForm(entry);}})),
      {label:t('keepField'),icon:'save',run:saveField},{label:t('saveAllFields'),icon:'save',run:saveAllFields},{label:t('undo'),icon:'undo',run:undo},
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
    return matches.filter(match=>power.dynamic(match.value)||core.compatible(field,match.value)).map(match=>({...match,type:typeFor(match.entry,match.key),entry:data.entries.find(e=>e.id===match.entry.id)}));
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
    let request;
    try{
      const raw=entry.values[key];
      if(!power.dynamic(raw)){const value=power.resolve(raw,{},entry.transforms?.[key]),error=types.validate(value,typeFor(entry,key),{allowVariables:false});if(error){notify(t(error));return;}fill(value);return;}
      toggle(true);request=screen('resolving',t('resolving'));
      const context=await contextFor(entry);if(!visible||request!==screenVersion)return;
      const value=power.resolve(raw,context,entry.transforms?.[key]),error=types.validate(value,typeFor(entry,key),{allowVariables:false});if(error)throw new Error(error);screen('generated',t('reviewGenerated'));
      main.append(node('p',{class:'hint'},`${entry.name} · ${key}`),typedBlock(value,typeFor(entry,key)));
      const actions=node('div',{class:'actions sticky-actions'});actions.append(button(t('applyValue'),()=>{target=el;if(fill(value))back();},'primary'),button(t('cancel'),back));main.append(actions);
    }catch(e){if(request===undefined||request===screenVersion){back();notify(t(e.message));}}
  }
  function duplicate(entry){toggle(true);editor({...structuredClone(entry),id:core.uuid(),name:t('copyName',entry.name).slice(0,100),pinned:false});}
  function filters(){
    const box=node('div',{class:'filter-row'});
    const collection=labeled(box,t('collection'),node('select',{'data-collection-filter':''}));
    collection.append(node('option',{value:''},t('allCollections')));
    [...new Set(data.entries.map(e=>e.collection).filter(Boolean))].sort().forEach(value=>collection.append(node('option',{value},value)));collection.value=collectionFilter;
    const tag=labeled(box,t('tag'),node('select',{'data-tag-filter':''}));tag.append(node('option',{value:''},t('allTags')));
    [...new Set(data.entries.flatMap(e=>e.tags||[]))].sort().forEach(value=>tag.append(node('option',{value},value)));tag.value=tagFilter;
    collection.addEventListener('change',()=>{collectionFilter=collection.value;render();});tag.addEventListener('change',()=>{tagFilter=tag.value;render();});return box;
  }
  function websiteSettings(origin=location.origin){
    const section=node('section',{class:'pair'});if(!standalone)section.append(node('h2',{},t('websiteSettings')),node('p',{class:'hint'},origin));
    const current=QuickfillRegistry.effectiveSettings(data.preferences?.[origin],data.globalPreferences),form=node('form',standalone?{'aria-label':origin}:{});
    const preferred=labeled(form,t('preferredEntry'),node('select'));preferred.append(node('option',{value:''},t('noPreference')));
    data.entries.forEach(entry=>preferred.append(node('option',{value:entry.id},entry.name)));preferred.value=current.preferredEntry;
    const appearance=node('fieldset');appearance.append(node('legend',{},t('appearance')));const width=labeled(appearance,t('sidebarWidth'),node('input',{type:'number',min:'320',max:'640',step:'1',required:'','data-sidebar-width':'','data-origin':origin}));width.value=current.width;width.dataset.savedWidth=String(current.width);
    const behavior=labeled(form,t('websiteSuggestionBehavior'),node('select',{'data-site-suggestions':''}));
    behavior.append(node('option',{value:'inherit'},inheritedSuggestionsLabel()));
    ['off','button'].forEach(value=>behavior.append(node('option',{value},t('suggestions_'+value))));behavior.value=QuickfillRegistry.settings(data.preferences?.[origin]).suggestions;
    const exclusions=new Set(current.excluded);
    const choices=new Map(current.excluded.map(signature=>{let label=t('unavailableField');try{const parts=JSON.parse(signature);label=parts[3]||label;}catch{}return [signature,label];}));
    if(!standalone)fields.collect().forEach(el=>{const field=fields.describe(el);choices.set(field.signature,fieldLabel(el));});
    const details=node('details');details.append(node('summary',{},t('excludedFields')));
    for(const [signature,label] of choices){const row=node('label',{class:'check'}),check=node('input',{type:'checkbox'});check.checked=exclusions.has(signature);check.addEventListener('change',()=>check.checked?exclusions.add(signature):exclusions.delete(signature));row.append(check,document.createTextNode(label));details.append(row);}
    form.append(node('p',{class:'hint'},t('autofillCoexistence')),details,appearance,node('button',{type:'submit',class:'primary'},t('savePreferences')));
    form.addEventListener('submit',async event=>{event.preventDefault();try{await mutate({action:'preferences',origin,preferences:{preferredEntry:preferred.value,width:Number(width.value),suggestions:behavior.value,excluded:[...exclusions]}});updatePreferences();notify(t('preferencesSaved'));}catch(e){notify(t(e.message));}});
    section.append(form);return section;
  }
  function savedWebsiteSettings(){
    const section=node('section',{class:'settings-section saved-websites'});section.append(node('h2',{},t('savedWebsites')));
    const origins=Object.keys(data.preferences||{}).sort();
    if(!origins.length){section.append(node('p',{class:'hint'},t('savedWebsitesHint')));return section;}
    const select=labeled(section,t('websiteSettings'),node('select',{'data-saved-website':''}));
    origins.forEach(origin=>select.append(node('option',{value:origin},origin)));
    const body=node('div');const update=()=>body.replaceChildren(websiteSettings(select.value));select.addEventListener('change',update);update();section.append(body);return section;
  }
  function updatePreferences(){
    if(shadow){
      const panel=shadow.querySelector('.panel'),side=standalone?'right':sidebarSide();
      if(resizeSession&&(resizeSession.side!==side||fullscreen||!visible))finishResize(false);
      applySidebarWidth();
      if(panel.dataset.side!==side){QuickfillControls.close();panel.dataset.side=side;}
      host.style.setProperty('inset',side==='left'?'0 auto auto 0':'0 0 auto auto','important');
      if(sidebarSideButton){
        const next=side==='right'?'left':'right',label=t(next==='left'?'moveSidebarLeft':'moveSidebarRight');
        sidebarSideButton.replaceChildren(QuickfillIcon(next==='left'?'sidebarLeft':'sidebarRight'));
        sidebarSideButton.title=label;sidebarSideButton.setAttribute('aria-label',label);sidebarSideButton.hidden=fullscreen;
      }
      const global=shadow.querySelector('[data-global-suggestions]'),inherit=shadow.querySelector('[data-site-suggestions] option[value=inherit]');
      if(global&&!global.disabled&&global.value!==globalSuggestions()){global.value=globalSuggestions();global.dispatchEvent(new Event('input'));}
      if(inherit&&inherit.textContent!==inheritedSuggestionsLabel())inherit.textContent=inheritedSuggestionsLabel();
      shadow.querySelectorAll('[data-sidebar-width]').forEach(input=>{
        const width=String(QuickfillRegistry.settings(data.preferences?.[input.dataset.origin]).width);
        if(input.value===input.dataset.savedWidth)input.value=width;
        input.dataset.savedWidth=width;
      });
    }
    if(standalone||excluded(target)||prefs().suggestions==='off')surface.hide();
    else{
      surface.refresh();
      if(!visible){let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;if(editable(active)&&!excluded(active))surface.track(active);}
    }
  }
  function setFullscreen(value){
    finishResize(false);
    fullscreen=standalone||value;const panel=shadow.querySelector('.panel');panel.classList.toggle('fullscreen',fullscreen);
    if(fullscreen&&!standalone){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');}else{panel.removeAttribute('role');panel.removeAttribute('aria-modal');}
    if(fullscreenButton){const label=t(fullscreen?'exitFullscreen':'enterFullscreen');fullscreenButton.replaceChildren(QuickfillIcon(fullscreen?'shrink':'fullscreen'));fullscreenButton.title=label;fullscreenButton.setAttribute('aria-label',label);fullscreenButton.setAttribute('aria-pressed',String(fullscreen));}updatePreferences();
  }
  async function openInTab(){try{const result=await chrome.runtime.sendMessage({type:'open-options'});if(result?.error)throw new Error(result.error);}catch(error){notify(error.message);}}
  async function moveSidebar(){
    finishResize(false);
    if(movingSidebar)return;movingSidebar=true;
    const control=sidebarSideButton;control.setAttribute('aria-busy','true');
    try{await mutate({action:'global-preferences',preferences:{sidebarSide:sidebarSide()==='right'?'left':'right'}});updatePreferences();}
    catch(error){notify(t(error.message));}
    finally{movingSidebar=false;control.removeAttribute('aria-busy');}
  }
  function resizeMaximum(){return Math.max(320,Math.min(640,document.documentElement.clientWidth));}
  function clampResizeWidth(width){return Math.round(Math.max(320,Math.min(resizeMaximum(),width)));}
  function applySidebarWidth(){
    if(!shadow)return;
    const width=resizeSession?.width??pendingWidth??prefs().width;
    shadow.querySelector('.panel').style.width=fullscreen?'100%':`min(${width}px,100%)`;
    if(resizeHandle){
      resizeHandle.hidden=fullscreen||document.documentElement.clientWidth<=320;
      resizeHandle.setAttribute('aria-valuemax',String(resizeMaximum()));
      resizeHandle.setAttribute('aria-valuenow',String(clampResizeWidth(width)));
    }
  }
  async function saveSidebarWidth(width){
    const request=++widthRequest;pendingWidth=width;applySidebarWidth();
    // A deliberate resize updates this field while leaving the other form edits intact.
    shadow.querySelectorAll('[data-sidebar-width]').forEach(input=>{if(input.dataset.origin===location.origin){input.value=String(width);input.dataset.savedWidth=String(width);}});
    try{await mutate({action:'sidebar-width',origin:location.origin,width});}
    catch(error){if(request===widthRequest)notify(t(error.message));}
    finally{if(request===widthRequest){pendingWidth=null;updatePreferences();}}
  }
  function finishResize(commit){
    const session=resizeSession;if(!session)return;
    resizeSession=null;shadow.querySelector('.panel').classList.remove('resizing');
    if(session.handle.hasPointerCapture(session.pointerId))session.handle.releasePointerCapture(session.pointerId);
    if(commit&&session.width!==session.startWidth)void saveSidebarWidth(session.width);else applySidebarWidth();
  }
  function makeResizeHandle(){
    const handle=node('div',{class:'resize-handle','data-action':'resizeSidebar',role:'separator',tabindex:'0','aria-orientation':'vertical','aria-label':t('resizeSidebar'),'aria-controls':'quickfill-panel','aria-valuemin':'320',title:t('resizeSidebarHint')});
    handle.addEventListener('pointerdown',event=>{
      if(!isCurrent()||fullscreen||event.button!==0||!event.isPrimary||handle.hidden||resizeSession)return;
      event.preventDefault();event.stopPropagation();QuickfillControls.close();handle.focus({preventScroll:true});
      const width=Math.round(shadow.querySelector('.panel').getBoundingClientRect().width);
      resizeSession={handle,pointerId:event.pointerId,startX:event.clientX,startWidth:width,width,side:sidebarSide()};
      handle.setPointerCapture(event.pointerId);shadow.querySelector('.panel').classList.add('resizing');
    });
    const move=event=>{
      const session=resizeSession;if(!session||session.pointerId!==event.pointerId)return;
      if(!isCurrent()){finishResize(false);return;}
      event.preventDefault();event.stopPropagation();
      session.width=clampResizeWidth(session.startWidth+(event.clientX-session.startX)*(session.side==='left'?1:-1));applySidebarWidth();
    };
    handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',event=>{if(resizeSession?.pointerId===event.pointerId){move(event);finishResize(true);}});
    for(const type of ['pointercancel','lostpointercapture'])handle.addEventListener(type,event=>{if(resizeSession?.pointerId===event.pointerId)finishResize(false);});
    handle.addEventListener('dblclick',event=>{if(!isCurrent()||handle.hidden)return;event.preventDefault();finishResize(false);void saveSidebarWidth(380);});
    return handle;
  }
  function resizeKeydown(event){
    if(resizeSession&&event.key==='Escape'){event.preventDefault();event.stopPropagation();finishResize(false);return true;}
    if(!resizeHandle||resizeHandle.hidden||!event.composedPath().includes(resizeHandle)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return false;
    event.preventDefault();event.stopPropagation();
    if(!resizeSession){
      const current=shadow.querySelector('.panel').getBoundingClientRect().width;
      const delta=(event.key==='ArrowRight'?1:-1)*(sidebarSide()==='left'?1:-1)*(event.shiftKey?50:10);
      const width=event.key==='Home'?320:event.key==='End'?resizeMaximum():clampResizeWidth(current+delta);
      if(width!==current)void saveSidebarWidth(width);
    }
    return true;
  }
  function walkthrough(){
    screen('walkthrough',t('walkthrough'));main.append(node('p',{},t('welcomeText')));
    const create=button(t('createExample'),async()=>{
      try{
        const entry={id:core.uuid(),name:t('exampleProfile'),color:'#a05dff',values:{name:'Alex Example',email:'alex@example.com'},tags:['demo'],collection:'',sites:[]};
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
    if(tag==='button'&&text)addButtonIcon(el,text);
    return el;
  }
  const destructiveLabel=label=>['removeValue','deleteEntry','deleteTemplate','discardDraft','clearValue'].some(key=>t(key)===label);
  function addButtonIcon(el,label){
    if(destructiveLabel(label))el.classList.add('danger');
    const actions={newEntry:'add',newEntryButton:'add',addValue:'add',saveEntry:'save',saveValue:'save',savePreferences:'save',saveMapping:'save',saveAllFields:'save',saveSelectedFields:'save',edit:'edit',editAssociation:'edit',duplicate:'copy',deleteEntry:'delete',removeValue:'delete',importData:'import',exportData:'export',filters:'filter',clearFilters:'filter',undo:'undo',cancel:'cancel',back:'back',fillForm:'play',applyForm:'play',applyValue:'play',previewImport:'import',applyImport:'import',resumeDraft:'edit',discardDraft:'delete',keepField:'save',settings:'settings',openSidebar:'list',walkthrough:'magic',currentSite:'link',finishWalkthrough:'check',skipWalkthrough:'forward',createExample:'add',fillSample:'play',close:'close',suggestedValues:'list',clearValue:'delete',today:'calendar'};
    const icon=Object.entries(actions).find(([key])=>t(key)===label)?.[1];if(icon){const svg=QuickfillIcon(icon);svg.classList.add('button-icon');el.prepend(svg);}
  }
  function button(text, handler, className = '') {return node('button', {type:'button', class:className, onclick:handler}, text);}
  const describe = () => target ? fields.describe(target, data.associations) : null;
  function notify(text, details=[]) {
    if(status){status.replaceChildren();if(text)status.append(node('span',{},text));if(details.length){const more=node('details');more.append(node('summary',{},t('details')));details.forEach(message=>more.append(node('p',{class:'hint'},message)));status.append(more);}}
    surface.announce(text);
  }
  function iconButton(label,icon,handler){const b=button('',handler,'quiet icon-button');b.append(QuickfillIcon(icon));b.setAttribute('aria-label',label);b.title=label;if(destructiveLabel(label))b.classList.add('danger');return b;}
  function menu(items){
    const wrap=node('div',{class:'menu-wrap'}),trigger=iconButton(t('moreActions'),'more',()=>{const open=list.hidden;shadow.querySelectorAll('.menu-list').forEach(el=>{el.hidden=true;el.previousSibling.setAttribute('aria-expanded','false');});list.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open)list.querySelector('button')?.focus();});
    const list=node('div',{class:'menu-list',hidden:''});trigger.setAttribute('aria-expanded','false');
    items.forEach(([label,run,danger])=>list.append(button(label,()=>{list.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});run();},danger?'danger':'')));
    wrap.append(trigger,list);return wrap;
  }
  function captureDraft(){if(mode==='editor'&&main?.querySelector('form'))draft={nodes:[...main.childNodes]};}
  function syncHeader(){
    if(!header)return;const registry=['registry','fill'].includes(mode);registryTools.hidden=!registry;taskTools.hidden=registry||(standalone&&['settings','templates'].includes(mode)&&!main?.querySelector('form'));
    taskTools.querySelector('strong').tabIndex=-1;taskTools.querySelector('strong').textContent=main.querySelector('h2')?.textContent||'';updateDestination();
    header.querySelectorAll('[data-view]').forEach(item=>{if(item.dataset.view===(mode==='templates'?'templates':['settings','import','importPreview'].includes(mode)?'settings':'registry'))item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
  }
  function fieldLabel(el){return el?.getAttribute('aria-label')||el?.labels?.[0]?.textContent?.trim()||el?.getAttribute('placeholder')||fields.describe(el).hints[0]||el?.type||t('value');}
  function updateDestination(){if(destination&&!standalone){destination.textContent=target?.isConnected?t('destination',fieldLabel(target)):t('selectField');destination.title=destination.textContent;}}
  function screen(next,title){QuickfillControls.close();captureDraft();mode=next;++screenVersion;main.dataset.view=next;delete main.dataset.settingsTab;main.replaceChildren(node('h2',{},title));main.scrollTop=0;syncHeader();taskTools.querySelector('strong').focus({preventScroll:true});return screenVersion;}
  function typedValue(value,type='string'){
    const fragment=document.createDocumentFragment();
    if(type==='string'){fragment.append(highlighted(value));return fragment;}
    for(const token of types.tokenize(value,type)){const span=node('span',{class:'token token-'+token.kind});span.append(highlighted(token.text));fragment.append(span);}return fragment;
  }
  function typedBlock(value,type='string'){const block=node('pre',{class:'resolved typed-value','data-value-kind':type});block.append(typedValue(value,type));return block;}
  function highlighted(text){const fragment=document.createDocumentFragment();const q=query.toLocaleLowerCase();let rest=String(text);if(!q){fragment.append(rest);return fragment;}let at;while((at=rest.toLocaleLowerCase().indexOf(q))>=0){fragment.append(rest.slice(0,at),node('mark',{},rest.slice(at,at+q.length)));rest=rest.slice(at+q.length);}fragment.append(rest);return fragment;}
  function clearValidation(input){input.setCustomValidity('');input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');if(input.nextElementSibling?.classList.contains('field-error'))input.nextElementSibling.remove();}
  function lockForm(form){
    const controls=[...form.querySelectorAll('input,select,textarea,button')].filter(el=>el.type!=='submit'&&!(el.localName==='button'&&el.textContent===t('cancel'))).map(el=>[el,el.disabled]);
    controls.forEach(([el])=>{el.disabled=true;});form.setAttribute('aria-busy','true');
    return ()=>{controls.forEach(([el,disabled])=>{el.disabled=disabled;});form.removeAttribute('aria-busy');};
  }
  function validation(input,message){input.setCustomValidity(message);input.setAttribute('aria-invalid','true');let error=input.nextElementSibling;if(!error?.classList.contains('field-error')){error=node('p',{class:'field-error',id:input.id+'-error'});input.after(error);}error.textContent=message;input.setAttribute('aria-describedby',error.id);input.closest('details')?.setAttribute('open','');input.focus();input.addEventListener('input',()=>clearValidation(input),{once:true});}

  async function mutate(payload) {
    const response = await chrome.runtime.sendMessage({type:'mutate', ...payload});
    if (response.error) throw new Error(response.error);
    data = response.data; return data;
  }
  function mount() {
    if (host) {if(!host.isConnected)document.documentElement.append(host);return;}
    host = document.createElement('quickfill-sidebar');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0 0 auto auto!important;z-index:2147483646!important;';
    shadow = host.attachShadow({mode:'open'});
    shadow.append(node('style', {}, globalThis.QuickfillStyles));
    const panel = node(standalone?'div':'aside', {class:'panel'+(standalone?' standalone':''), id:'quickfill-panel',lang:boot.locale, 'aria-label':t('registryLabel')});
    header = node('header');
    const top=node('div',{class:'top'}),brand=node('div',{class:'brand'});brand.append(QuickfillIcon('magic'),node('h1',{},'Quickfill'));
    const controls=node('div',{class:'row header-controls'});
    if(!standalone){
      sidebarSideButton=iconButton(t('moveSidebarLeft'),'sidebarLeft',moveSidebar);sidebarSideButton.dataset.action='sidebarSide';
      fullscreenButton=iconButton(t('enterFullscreen'),'fullscreen',()=>setFullscreen(!fullscreen));fullscreenButton.dataset.action='fullscreen';
      const newTab=iconButton(t('openInTab'),'external',openInTab);newTab.dataset.action='openInTab';
      controls.append(sidebarSideButton,fullscreenButton,newTab,iconButton(t('settings'),'settings',settings));
    }
    controls.append(menu([[t('importData'),importData],[t('exportData'),exportData],[t('palette'),()=>surface.palette()]]));
    if(!standalone)controls.append(iconButton(t('closeSidebar'),'close',()=>toggle(false)));top.append(brand,controls);
    registryTools=node('div');const searchRow=node('div',{class:'search-row'});
    search=node('input',{class:'search',type:'search',placeholder:t('searchPlaceholder'),'aria-label':t('searchLabel'),oninput:()=>{query=search.value;mode='registry';render();}});
    searchRow.append(search,button(t('newEntryButton'),()=>editor(),'primary'));registryTools.append(searchRow);
    taskTools=node('div',{class:'task-heading',hidden:''});taskTools.append(iconButton(t('back'),'back',back),node('strong'));
    header.append(top,registryTools,taskTools);
    if(standalone){
      const navigation=node('nav',{class:'manager-nav','aria-label':'Quickfill'});
      for(const [view,label,icon,run] of [['registry',t('manageEntries'),'list',back],['templates',t('manageTemplates'),'copy',templates],['settings',t('settings'),'settings',settings]]){const item=button('',run,'quiet');item.append(QuickfillIcon(icon),document.createTextNode(label));item.dataset.view=view;navigation.append(item);}
      top.after(navigation);document.title=t('managerTitle');document.documentElement.lang=boot.locale;
    }
    main=node('main');
    const footer=node('footer');destination=node('div',{class:'destination'});
    status=node('div',{class:'status',role:'status','aria-live':'polite'});
    undoButton=button(t('undo'),undo,'quiet');undoButton.disabled=!undoBatch.length;
    if(standalone){destination.hidden=true;undoButton.hidden=true;}
    const feedback=node('div',{class:'feedback'});feedback.append(status,undoButton,iconButton(t('dismiss'),'close',()=>notify('')));
    footer.append(destination,feedback);panel.append(header,main,footer);if(!standalone){resizeHandle=makeResizeHandle();panel.append(resizeHandle);}shadow.append(panel);
    shadow.addEventListener('pointerdown',event=>{if(!event.target.closest('.menu-wrap'))shadow.querySelectorAll('.menu-list').forEach(el=>{el.hidden=true;el.previousSibling.setAttribute('aria-expanded','false');});});
    shadow.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=shadow.querySelector('.menu-list:not([hidden])');if(open){event.preventDefault();event.stopPropagation();open.hidden=true;open.previousSibling.setAttribute('aria-expanded','false');open.previousSibling.focus();}}});
    document.documentElement.append(host);QuickfillControls.enhance(shadow,{t});setFullscreen(fullscreen);
  }
  function toggle(force) {
    finishResize(false);
    mount(); visible = standalone|| (force ?? !visible); host.style.setProperty('display', visible ? 'block' : 'none', 'important');
    if (!visible) {
      QuickfillControls.close();
      captureDraft();
      ++screenVersion;
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
  const relevantEntries = () => core.ordered(data.entries.filter(e => (standalone || showAll || core.relevant(e,location.origin)) && (!tagFilter || e.tags?.includes(tagFilter)) && (!collectionFilter || e.collection===collectionFilter)),standalone?'':location.origin).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||(data.entryOrder ? ((data.entryOrder.indexOf(a.id)<0?Infinity:data.entryOrder.indexOf(a.id))-(data.entryOrder.indexOf(b.id)<0?Infinity:data.entryOrder.indexOf(b.id))) : Number(b.id===prefs().preferredEntry)-Number(a.id===prefs().preferredEntry)));
  function reason(match) {return match.reason === 'association' ? t('savedAssociation') : t('matchedHint',match.hint);}
  function valueButton(entry, key, value) {
    const b = button('', () => standalone?editor(entry):chooseValue(entry,key), 'value');
    b.draggable = !standalone; b.setAttribute('aria-label', `${key}: ${value}`);
    const label=node('small'),text=node('span'),type=typeFor(entry,key);label.append(highlighted(key));if(type!=='string')label.append(node('span',{class:'type-badge'},t('type_'+type)));text.append(typedValue(value||t('emptyValue'),type));b.append(label,text,QuickfillMagicParticles());b.title=value;b.dataset.valueKind=type;b.style.setProperty('--entry-color',entry.color);
    if(value.length>100||value.includes('\n')){b.classList.add('long-value');b.setAttribute('aria-label',key+': '+value);}
    b.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', value);
      event.dataTransfer.setData('application/x-quickfill', JSON.stringify({entryId:entry.id,key}));
      event.dataTransfer.effectAllowed = 'copy';
    });
    return b;
  }
  let draggedEntry=null;
  function card(entry, pairs = Object.entries(entry.values), edit = true) {
    const article = node('article'); article.style.setProperty('--entry-color', /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : '#a05dff');
    const row=node('div',{class:'row card-heading'}),title=node('h2');title.append(highlighted(entry.name));row.append(title);
    if(edit){const pin=iconButton(t(entry.pinned?'unpin':'pin'),'pin',()=>flags(entry,{pinned:!entry.pinned}));pin.setAttribute('aria-pressed',String(!!entry.pinned));row.append(pin);
      const expand=iconButton(t(entry.collapsed?'expand':'collapse'),entry.collapsed?'down':'up',()=>flags(entry,{collapsed:!entry.collapsed}));expand.setAttribute('aria-expanded',String(!entry.collapsed));row.append(expand,menu([[t('edit'),()=>editor(entry)],[t('duplicate'),()=>duplicate(entry)],[t('createTemplateFromEntry'),()=>templateEditor(null,entry)],[t('deleteEntry'),()=>deleteEntry(entry),true]]));}
    if(edit){
      article.dataset.entryId=entry.id;
      const handle=button('',()=>{},'reorder-handle');
      const grip=document.createElementNS('http://www.w3.org/2000/svg','svg');
      grip.setAttribute('viewBox','0 0 12 18');grip.setAttribute('aria-hidden','true');
      for(const x of [3,9])for(const y of [3,9,15]){const dot=document.createElementNS(grip.namespaceURI,'circle');dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r','1.5');dot.setAttribute('fill','currentColor');grip.append(dot);}
      handle.append(grip);
      handle.title=t('reorderEntry');handle.setAttribute('aria-label',t('reorderEntry'));handle.draggable=true;row.prepend(handle);
      const clear=()=>{main.querySelectorAll('[data-drop]').forEach(el=>el.removeAttribute('data-drop'));};
      const move=async(targetId,after)=>{try{await mutate({action:'reorder',id:entry.id,targetId,after});render();}catch(error){notify(t(error.message));}};
      handle.addEventListener('dragstart',event=>{draggedEntry=entry;event.dataTransfer.setData('application/x-quickfill-entry',entry.id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setDragImage(article,24,24);
        requestAnimationFrame(()=>{if(draggedEntry?.id===entry.id)article.setAttribute('data-dragging','');});
      });
      handle.addEventListener('dragend',()=>{draggedEntry=null;article.removeAttribute('data-dragging');clear();});
      handle.addEventListener('keydown',event=>{
        if(!['ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();
        const entries=relevantEntries().filter(e=>!!e.pinned===!!entry.pinned),index=entries.findIndex(e=>e.id===entry.id),next=entries[index+(event.key==='ArrowDown'?1:-1)];
        if(next)move(next.id,event.key==='ArrowDown');
      });
      article.addEventListener('dragover',event=>{
        if(!draggedEntry||draggedEntry.id===entry.id||!!draggedEntry.pinned!==!!entry.pinned)return;
        event.preventDefault();event.dataTransfer.dropEffect='move';clear();
        article.dataset.drop=event.clientY>article.getBoundingClientRect().top+article.offsetHeight/2?'after':'before';
      });
      article.addEventListener('dragleave',event=>{if(!article.contains(event.relatedTarget))article.removeAttribute('data-drop');});
      article.addEventListener('drop',async event=>{
        if(!draggedEntry||!article.dataset.drop)return;
        event.preventDefault();event.stopPropagation();
        const id=draggedEntry.id,after=article.dataset.drop==='after';draggedEntry=null;clear();
        try{await mutate({action:'reorder',id,targetId:entry.id,after});render();}catch(error){notify(t(error.message));}
      });
    }
    article.append(row);
    const linkedTemplate=(data.templates||[]).find(item=>item.id===entry.templateId),templateName=linkedTemplate?.name;
    if(templateName)article.append(node('p',{class:'hint template-label'},t('templateLabel',templateName)));
    if(entry.collection||entry.tags?.length){const meta=node('p',{class:'hint metadata'});meta.append(highlighted([entry.collection,...(entry.tags||[]).map(tag=>'#'+tag)].filter(Boolean).join(' · ')));article.append(meta);}
    if(edit){const actions=node('div',{class:'card-actions'});actions.append(node('span',{class:'hint'},t('valueCount',String(Object.keys(entry.values).length))),standalone?button(t('edit'),()=>editor(entry),'quiet'):button(t('fillForm'),()=>previewForm(entry),'quiet'));article.append(actions);}
    const shown=new Map(pairs),declared=linkedTemplate?.fields||[],orderedKeys=[...new Set([...declared.map(field=>field.key),...shown.keys()])];
    if(!edit||!entry.collapsed||query)for(const key of orderedKeys){
      const field=declared.find(field=>field.key===key),missing=field&&(!Object.hasOwn(entry.values,key)||entry.values[key]==='');
      if(edit&&missing){
        if(query&&!key.toLowerCase().includes(query.toLowerCase())&&!entry.name.toLowerCase().includes(query.toLowerCase()))continue;
        const placeholder=button('',()=>editor(entry),'value unfilled-value');placeholder.dataset.unfilledKey=key;
        placeholder.append(node('small',{},key+' · '+t('type_'+field.type)),node('span',{},t('notFilled')));article.append(placeholder);continue;
      }
      if(!shown.has(key))continue;
      const value=shown.get(key);article.append(valueButton(entry,key,value));
      if(value.length>100||value.includes('\n')){const full=node('details',{class:'full-value'});full.append(node('summary',{},t('showFullValue')),typedBlock(value,typeFor(entry,key)));article.append(full);}
    }
    if(!pairs.length&&!declared.length)article.append(node('p',{class:'hint'},t('noValues')));
    return article;
  }
  function render() {
    if (!visible || !['registry','fill'].includes(mode)) return;
    ++screenVersion;
    main.dataset.view='registry';
    main.replaceChildren();
    syncHeader();
    const toolbar=node('div',{class:'row registry-toolbar'}),scope=node('select',{'aria-label':t('entryScope')});
    scope.append(node('option',{value:'site'},t('websiteSettings')),node('option',{value:'all'},t('allEntries')));scope.value=showAll?'all':'site';scope.addEventListener('change',()=>{showAll=scope.value==='all';render();});
    const filterButton=button(t('filters'),()=>{filtersOpen=!filtersOpen;render();});filterButton.setAttribute('aria-expanded',String(filtersOpen));toolbar.append(standalone?node('strong',{},t('allEntries')):scope,filterButton);main.append(toolbar);
    const filterBox=filters();filterBox.hidden=!filtersOpen;main.append(filterBox);
    const chips=node('div',{class:'chips'});if(collectionFilter)chips.append(button(collectionFilter+' ×',()=>{collectionFilter='';render();},'chip'));if(tagFilter)chips.append(button('#'+tagFilter+' ×',()=>{tagFilter='';render();},'chip'));main.append(chips);
    if(draft){const resume=node('div',{class:'resume'});resume.append(button(t('resumeDraft'),()=>{mode='editor';main.dataset.view='editor';main.replaceChildren(...draft.nodes);syncHeader();main.querySelector('input')?.focus();},'quiet'),button(t('discardDraft'),()=>{draft=null;render();},'quiet'));main.append(resume);}
    if(!standalone&&!data.onboardingDone){const welcome=node('div',{class:'pair welcome'});welcome.append(node('p',{},t('welcomeText')),button(t('walkthrough'),walkthrough),button(t('skipWalkthrough'),finishWalkthrough,'quiet'));main.append(welcome);}
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
    const entries = relevantEntries().filter(entry => [entry.name,entry.collection||'',...(entry.tags||[]),...((data.templates||[]).find(item=>item.id===entry.templateId)?.fields||[]).map(field=>field.key), ...Object.entries(entry.values).flat()].some(v => v.toLowerCase().includes(q)));
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
    const id = `qf-${core.uuid()}`; input.id = id;
    form.append(node('label', {for:id}, title), input); return input;
  }
  function valueEditor(typeParent,valueParent,raw='',initialType='string'){
    const select=labeled(typeParent,t('valueType'),node('select',{'data-value-type':''}));
    for(const type of types.names)select.append(node('option',{value:type},t('type_'+type)));select.value=initialType;
    const body=node('div',{class:'typed-editor'});valueParent.append(body);let input;
    function paint(value){
      const type=select.value;body.replaceChildren();
      if(type==='bool'){
        input=node('select',{'data-value-input':''});input.append(node('option',{value:''},t('chooseBoolean')),node('option',{value:'true'},t('booleanTrue')),node('option',{value:'false'},t('booleanFalse')));
        if(value&&!['true','false'].includes(value))input.append(node('option',{value},value));
      }else if(['date','datetime','number'].includes(type))input=node('input',{type:'text','data-value-input':'',maxlength:'100000',...(type==='number'?{inputmode:'decimal',placeholder:'42.5'}:{placeholder:type==='date'?'YYYY-MM-DD':'YYYY-MM-DDTHH:mm'})});
      else input=node('textarea',{'data-value-input':'',maxlength:'100000',rows:type==='string'?'2':'4',spellcheck:type==='string'?'true':'false',placeholder:type==='json'?'{"name": "Alex"}':type==='xml'?'<name>Alex</name>':'alex@example.com'});
      input.value=value;labeled(body,t('value'),input);input.previousSibling.className='sr-only';
      if(['date','datetime'].includes(type)){const anchor=node('span');input.replaceWith(anchor);anchor.replaceWith(QuickfillControls.datePicker(input,type,{t}));}
      const preview=node('pre',{class:'typed-preview','aria-hidden':'true'}),hint=node('p',{class:'hint typed-hint'});body.append(preview,hint);
      const update=()=>{const error=types.validate(input.value,type);preview.hidden=type==='string'||!input.value;preview.replaceChildren(typedValue(input.value,type));hint.hidden=!error;hint.textContent=error?t(error):'';};
      input.addEventListener('input',update);input.addEventListener('change',update);update();
    }
    select.addEventListener('change',()=>{const raw=input.value;paint(raw);});paint(raw);
    return {select,get input(){return input;},get value(){return input.value;},get type(){return select.value;},validate(){const error=types.validate(input.value,select.value);if(error){validation(input,t(error));return false;}return true;}};
  }
  function inferType(el){const type=el.type;if(type==='checkbox')return 'bool';if(type==='number'&&fields.value(el)!=='')return 'number';if(type==='date'&&fields.value(el)!=='')return 'date';if(type==='datetime-local'&&fields.value(el)!=='')return 'datetime';return 'string';}
  function editor(existing) {
    screen('editor',existing?.id&&data.entries.some(e=>e.id===existing.id)?t('editEntry'):t('newEntry'));draft=null;
    const entryId=existing?.id||core.uuid();
    const form = node('form',{class:'entry-editor'});
    const name = labeled(form, t('entryName'), node('input', {required:'', placeholder:t('entryNamePlaceholder'), maxlength:'100'})); name.value = existing?.name || '';
    const template=labeled(form,t('entryTemplate'),node('select',{'data-template':''}));
    template.append(node('option',{value:''},t('blankTemplate')));
    (data.templates||[]).forEach(item=>template.append(node('option',{value:item.id},item.name)));
    template.value=existing?.templateId||'';
    form.append(node('p',{class:'hint'},t('templateAssociationHint')));

    const color = labeled(form, t('entryColor'), node('input', {type:'color'})); color.value = existing?.color || '#a05dff';
    const organization=node('details',{class:'organization'});organization.append(node('summary',{},t('organization')));
    const sites = labeled(organization,t('sites'),node('textarea',{placeholder:'https://example.com'})); sites.value = (existing?.sites || []).join('\n');
    organization.append(node('p',{class:'hint'},t('sitesHint')));if(!standalone)organization.append(button(t('currentSite'),()=>{sites.value=location.origin;},'quiet'));
    const tags=labeled(organization,t('tags'),node('input',{'data-tags':'',placeholder:t('tagsHint')}));tags.value=(existing?.tags||[]).join(', ');
    const collection=labeled(organization,t('collection'),node('input',{'data-collection':'',maxlength:'100'}));collection.value=existing?.collection||'';
    const swatches=node('div',{class:'swatches',role:'group','aria-label':t('entryColor')});
    for(const hex of ['#a05dff','#315de4','#16866b','#ce4774','#b56b16','#65748b']){const swatch=button('',()=>{color.value=hex;updateSwatches();},'swatch');swatch.style.setProperty('--swatch',hex);swatch.title=hex;swatch.setAttribute('aria-label',hex);swatch.dataset.color=hex;swatches.append(swatch);}
    function updateSwatches(){swatches.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===color.value)));}color.addEventListener('input',updateSwatches);updateSwatches();color.after(swatches);
    const table=node('table',{class:'values-table'}),caption=node('caption',{},t('keyValues')),head=node('thead'),headRow=node('tr');
    headRow.append(node('th',{scope:'col'},t('key')),node('th',{scope:'col'},t('value')),node('th',{scope:'col','aria-label':t('actionsGroup')}));head.append(headRow);
    const pairs = node('tbody'),valueEditors=new WeakMap();table.append(caption,head,pairs);form.append(table);
    const count=node('p',{class:'hint',role:'status'}),empty=node('p',{class:'hint'},t('noValues'));
    let add;
    function clearKeyErrors(){pairs.querySelectorAll('td:first-child input[aria-invalid]').forEach(clearValidation);}
    function updatePairs(){clearKeyErrors();count.textContent=t('valueCount',String(pairs.children.length));empty.hidden=!!pairs.children.length;if(add)add.disabled=pairs.children.length>=200;}
    function addPair(key = '', value = '', valueType = existing?typeFor(existing,key):'string', placeholder=false) {
      if(pairs.children.length>=(placeholder?400:200))return;
      const pair = node('tr', {class:'pair value-row'}),keyCell=node('td'),valueCell=node('td'),actionsCell=node('td',{class:'value-row-actions'});
      const k = labeled(keyCell, t('key'), node('input', {required:'', maxlength:'200', placeholder:'email',spellcheck:'false'})); k.value = key;k.previousSibling.className='sr-only';
      if(placeholder){pair.dataset.templatePlaceholder=key;keyCell.append(node('small',{class:'hint'},t('notFilled')));}
      k.addEventListener('input',clearKeyErrors);
      valueEditors.set(pair,valueEditor(keyCell,valueCell,value,valueType));
      const advanced=node('details');advanced.append(node('summary',{},t('valueOptions')));transformControl(advanced,existing?.transforms?.[key]);advanced.append(node('p',{class:'hint'},t('variablesHint')));valueCell.append(advanced);
      actionsCell.append(iconButton(t('removeValue'),'close',()=>{const next=pair.nextElementSibling||pair.previousElementSibling;pair.remove();updatePairs();(next?.querySelector('input')||add).focus();}));
      pair.append(keyCell,valueCell,actionsCell);pairs.append(pair);updatePairs();
    }
    if (existing) Object.entries(existing.values).forEach(([k,v]) => addPair(k,v,typeFor(existing,k),!data.entries.some(entry=>entry.id===existing.id)&&v===''&&!!(data.templates||[]).find(item=>item.id===existing.templateId)?.fields.some(field=>field.key===k))); else addPair();
    function showTemplateFields(){
      // Discard only untouched virtual rows when switching templates.
      for(const pair of [...pairs.children])if(pair.dataset.templatePlaceholder!==undefined&&!valueEditors.get(pair).value&&pair.querySelector('input').value===pair.dataset.templatePlaceholder)pair.remove();
      const selected=(data.templates||[]).find(item=>item.id===template.value);if(!selected){updatePairs();return;}
      const keys=new Set([...pairs.children].map(pair=>pair.querySelector('input').value.trim()));
      const missing=selected.fields.filter(field=>!keys.has(field.key));
      if(missing.length)for(const pair of [...pairs.children])if(!pair.querySelector('input').value.trim()&&!valueEditors.get(pair).value)pair.remove();
      missing.forEach(field=>addPair(field.key,'',field.type,true));
      const rank=new Map(selected.fields.map((field,index)=>[field.key,index]));
      [...pairs.children].sort((a,b)=>(rank.get(a.querySelector('input').value.trim())??Infinity)-(rank.get(b.querySelector('input').value.trim())??Infinity)).forEach(row=>pairs.append(row));updatePairs();
    }
    showTemplateFields();
    template.addEventListener('change',showTemplateFields);
    add=button(t('addValue'), () => {addPair();pairs.lastChild.querySelector('input').focus();}, 'quiet');updatePairs();
    const tableTools=node('div',{class:'row value-table-tools'});tableTools.append(add,count);form.append(empty,tableTools,organization);
    const actions = node('div', {class:'actions'});
    actions.classList.add('sticky-actions');actions.append(node('button', {type:'submit', class:'primary'}, t('saveEntry')),button(t('cancel'),()=>{draft=null;mode='registry';render();search.focus();}));
    if(existing?.id&&data.entries.some(e=>e.id===existing.id))organization.append(button(t('deleteEntry'),()=>deleteEntry(existing),'danger'));
    form.append(actions); main.append(form); name.focus();
    form.addEventListener('submit', async event => {
      event.preventDefault(); const values = Object.create(null),transforms=Object.create(null),valueTypes=Object.create(null);
      for (const pair of pairs.children) {
        const key = pair.querySelector('input').value.trim();
        if(!key||Object.hasOwn(values,key)){validation(pair.querySelector('input'),t('uniqueKeyRequired'));return;}
        const control=valueEditors.get(pair);if(pair.dataset.templatePlaceholder===key&&control.value==='')continue;if(!control.validate())return;values[key]=control.value;valueTypes[key]=control.type;
        transforms[key]={type:pair.querySelector('[data-transform]').value,format:pair.querySelector('[data-format]').value};
      }
      if(!name.value.trim()){validation(name,t('entryNameRequired'));return;}
      let allowedSites;try{allowedSites=QuickfillRegistry.sites(sites.value.split(/[,\n]/).map(x=>x.trim()).filter(Boolean));}catch{validation(sites,t('sitesHint'));return;}
      const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;const request=screenVersion,unlock=lockForm(form);
      try {await mutate({action:'upsert', entry:{...existing, id:entryId, templateId:template.value, name:name.value.trim(), color:color.value, values,types:valueTypes,transforms,tags:tags.value.split(',').map(tag=>tag.trim()).filter(Boolean),collection:collection.value.trim(), sites:allowedSites}});if(draft?.nodes.includes(form))draft=null;if(request===screenVersion&&main.contains(form)){draft=null;mode='registry';back();}notify(t('entrySaved'));} catch(e) {notify(e.message === 'invalidImport' ? t('invalidImport') : e.message);}finally{unlock();submit.disabled=false;}
    });
  }
  function back() {captureDraft();++screenVersion;mode='registry';render();search.focus();}
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
    const control=valueEditor(form,form,fields.value(target),inferType(target));
    const replacement=node('div',{class:'replacement'});let reviewed='';
    const review=()=>{const isNew=select.value==='__new';name.hidden=!isNew;name.previousSibling.hidden=!isNew;name.required=isNew;const entry=data.entries.find(e=>e.id===select.value),old=Object.hasOwn(entry?.values||{},key.value.trim())?entry.values[key.value.trim()]:undefined;replacement.replaceChildren();if(old!==undefined){replacement.append(node('strong',{},t('replaceValue')),node('small',{},t('beforeValue')),typedBlock(old,typeFor(entry,key.value.trim())),node('small',{},t('afterValue')),typedBlock(control.value,control.type));}return JSON.stringify([select.value,key.value.trim(),control.value,control.type,old,entry?typeFor(entry,key.value.trim()):'string']);};
    form.addEventListener('input',()=>{reviewed=review();});form.addEventListener('change',()=>{reviewed=review();});reviewed=review();
    const actions=node('div',{class:'actions sticky-actions'});actions.append(node('button',{class:'primary',type:'submit'},t('saveValue')),button(t('cancel'),back));form.append(replacement,node('p',{class:'hint'},t('saveFieldHint')),actions);main.append(form);
    form.addEventListener('submit',async event=>{event.preventDefault();if(!key.value.trim()){validation(key,t('keyRequired'));return;}if(!control.validate())return;
      const submit=form.querySelector('[type=submit]');if(submit.disabled)return;const request=screenVersion;let unlock=()=>{};
      try{const next=review();if(next!==reviewed){reviewed=next;if(replacement.children.length){notify(t('reviewReplacement'));return;}}
        const create=select.value==='__new';if(create&&!name.value.trim()){validation(name,t('entryNameRequired'));return;}
        submit.disabled=true;unlock=lockForm(form);await mutate({action:'save-fields',id:create?core.uuid():select.value,create,name:name.value.trim(),fields:[{key:key.value.trim(),value:control.value,valueType:control.type,signature:field.signature}]});if(request===screenVersion)back();notify(t('fieldSaved'));
      }catch(e){notify(t(e.message));}finally{unlock();submit.disabled=false;}
    });
  }
  function saveAllFields(){
    const selectedForm=target?.isConnected?(target.form||target.closest?.('form')):null;
    const candidates=fields.collect().filter(el=>(!selectedForm||el.form===selectedForm||selectedForm.contains(el))&&el.type!=='password'&&!excluded(el));
    toggle(true);screen('capture',t('saveAllFields'));
    main.append(node('p',{class:'hint'},t(selectedForm?'captureFormHint':'capturePageHint')));
    if(!candidates.length){main.append(node('p',{},t('noFields')),button(t('back'),back));return;}
    const form=node('form',{class:'capture-form'}),select=labeled(form,t('saveToEntry'),node('select',{'data-capture-entry':''}));
    select.append(node('option',{value:'__new'},t('newEntry')));data.entries.forEach(entry=>select.append(node('option',{value:entry.id},entry.name)));
    const name=labeled(form,t('entryName'),node('input',{maxlength:'100',required:'',placeholder:t('entryNamePlaceholder')}));name.value=(selectedForm?.getAttribute('aria-label')||document.title||t('newEntry')).slice(0,100);
    const count=node('p',{class:'preview-summary',role:'status'}),list=node('div',{class:'capture-fields'});form.append(count,list);
    const captured=[],used=new Set(),newId=core.uuid();let reviewed='',submit,saving=false;
    for(const el of candidates){
      const field=fields.describe(el,data.associations),row=node('section',{class:'pair capture-field','data-capture-field':''});
      const include=node('input',{type:'checkbox','data-capture-include':''});include.checked=true;const title=node('label',{class:'check'});title.append(include,document.createTextNode(fieldLabel(el)));row.append(title);
      const key=labeled(row,t('key'),node('input',{'data-capture-key':'',maxlength:'200',required:''}));
      const base=(field.associatedKey||el.name||el.id||core.canonical(field.hints[0])||'value').slice(0,190);let next=base,index=2;while(used.has(next))next=base+'_'+index++;used.add(next);key.value=next;
      const control=valueEditor(row,row,fields.value(el),inferType(el)),replacement=node('div',{class:'replacement'});row.append(replacement);list.append(row);captured.push({row,include,key,control,replacement,signature:field.signature});
      include.addEventListener('change',()=>{key.disabled=!include.checked;key.required=include.checked;control.input.disabled=!include.checked;control.select.disabled=!include.checked;reviewed=review();});
    }
    function review(){
      const create=select.value==='__new',entry=data.entries.find(item=>item.id===select.value);name.hidden=!create;name.previousSibling.hidden=!create;name.required=create;
      let total=0,replaced=0;const changes=[];
      for(const item of captured){
        const key=item.key.value.trim(),old=Object.hasOwn(entry?.values||{},key)?entry.values[key]:undefined;item.replacement.replaceChildren();
        if(!item.include.checked)continue;total++;changes.push([key,item.control.value,item.control.type,old,entry?typeFor(entry,key):'string']);
        if(old!==undefined){replaced++;item.replacement.append(node('small',{},t('beforeValue')),typedBlock(old,typeFor(entry,key)));}
      }
      count.textContent=t('captureSummary',[String(total),String(replaced)]);if(submit)submit.disabled=saving||total===0;return JSON.stringify([select.value,changes]);
    }
    form.addEventListener('input',()=>{captured.forEach(item=>clearValidation(item.key));reviewed=review();});form.addEventListener('change',()=>{reviewed=review();});
    submit=node('button',{type:'submit',class:'primary'},t('saveSelectedFields'));const actions=node('div',{class:'actions sticky-actions'});actions.append(submit,button(t('cancel'),back));form.append(actions);main.append(form);reviewed=review();
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(saving||submit.disabled)return;const chosen=captured.filter(item=>item.include.checked),keys=new Set();
      if(chosen.length>200){notify(t('maxValues'));return;}
      for(const item of chosen){const key=item.key.value.trim();if(!key||keys.has(key)){validation(item.key,t('uniqueKeyRequired'));return;}keys.add(key);if(!item.control.validate())return;}
      const create=select.value==='__new';if(create&&!name.value.trim()){validation(name,t('entryNameRequired'));return;}
      const next=review();if(next!==reviewed){reviewed=next;notify(t('reviewReplacement'));return;}
      saving=true;submit.disabled=true;const request=screenVersion,unlock=lockForm(form);
      try{await mutate({action:'save-fields',id:create?newId:select.value,create,name:name.value.trim(),fields:chosen.map(item=>({key:item.key.value.trim(),value:item.control.value,valueType:item.control.type,signature:item.signature}))});if(request===screenVersion)back();notify(t('fieldsSaved',String(chosen.length)));}
      catch(error){notify(t(error.message));}finally{unlock();saving=false;submit.disabled=false;}
    });
  }
  async function previewForm(entry) {
    const selectedForm=target?.form||target?.closest?.('form');
    const request=screen('resolving',t('resolving'));
    let context;try{context=await contextFor(entry);}catch(e){if(request===screenVersion){back();notify(t(e.message));}return;}
    if(!visible||request!==screenVersion)return;
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
    function summarize(){let ready=0,issues=0,skipped=0;for(const item of plan){const skip=emptyOnly.checked&&!fields.empty(item.el);item.attention=!skip&&(!!item.error||(item.select.value===''&&item.ambiguous&&!item.touched));if(item.attention)issues++;else if(skip||item.select.value==='')skipped++;else ready++;item.row.hidden=attention.checked&&!item.attention;item.row.style.order=item.attention?'0':'1';item.row.classList.toggle('ambiguous',item.attention);const hint=item.row.querySelector('.ambiguity-hint');if(hint)hint.hidden=!(item.select.value===''&&item.ambiguous&&!item.touched);}
      summary.replaceChildren(...t('previewSummary',[String(ready),String(issues),String(skipped)]).split(' · ').map(text=>node('span',{},text)));if(apply){apply.textContent=ready===1?t('fillOneField'):t('fillFields',String(ready));apply.disabled=!ready;addButtonIcon(apply,t('applyForm'));}}
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
        try{item.value=power.resolve(entry.values[key],context,transform.get());item.error=types.validate(item.value,typeFor(entry,key),{allowVariables:false});if(!item.error&&!core.compatible(field,item.value))item.error='incompatibleValue';}catch(e){item.error=e.message;}
        resolved.replaceChildren(typedValue(item.value??'',typeFor(entry,key)));
        if(emptyOnly.checked&&!fields.empty(el)){row.classList.add('will-skip');explanation.textContent=t('nonemptySkipped');}
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
        if(emptyOnly.checked&&!fields.empty(item.el)){skipped++;continue;}
        if(item.error){failures.push(t(item.error));skipped++;continue;}
        const current=fields.snapshot(item.el);
        if(!item.el.isConnected||!fields.matchesSnapshot(item.el,item.before)){failures.push(t(item.el.isConnected?'fieldChanged':'fieldRemoved'));skipped++;continue;}
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
    const next=await bootstrap();
    if(request!==languageRequest)return;
    finishResize(false);boot=next; data=boot.data;QuickfillControls.close();surface.escape();surface.hide(true);
    captureDraft();++screenVersion;const wasVisible=visible,wasSettings=mode==='settings'; host?.remove();host=null;mode='registry';query='';
    if(wasVisible){toggle(true);if(standalone&&wasSettings)settings();}
  }
  function templates(){
    screen('templates',t('manageTemplates'));
    main.querySelector('h2').remove();main.append(templateSettings());syncHeader();
  }
  function templateSettings(){
    const section=node('section',{class:'settings-section template-settings'}),heading=node('div',{class:'section-heading'});
    heading.append(node('h2',{},t('manageTemplates')),button(t('newTemplate'),()=>templateEditor(),'primary'));
    section.append(heading,node('p',{class:'hint'},t('templatesHint')));
    if(!(data.templates||[]).length)section.append(node('p',{class:'hint'},t('noTemplates')));
    const grid=node('div',{class:'template-grid'});section.append(grid);
    for(const item of data.templates||[]){
      const card=node('article',{class:'template-card'}),members=data.entries.filter(entry=>entry.templateId===item.id);
      const row=node('div',{class:'section-heading'});row.append(node('h3',{},item.name),button(t('edit'),()=>templateEditor(item),'quiet'));card.append(row);
      const schema=node('div',{class:'template-schema'});
      for(const field of item.fields){const chip=node('span',{class:'schema-field'});chip.append(node('strong',{},field.key),node('small',{},t('type_'+field.type)));schema.append(chip);}card.append(schema);
      const linked=node('div',{class:'template-members'});linked.append(node('p',{class:'hint'},t('entryCount',String(members.length))));
      for(const entry of members)linked.append(button(entry.name,()=>editor(entry),'chip'));card.append(linked);
      const actions=node('div',{class:'template-card-actions'});
      actions.append(button(t('newEntry'),()=>editor({name:'',templateId:item.id,values:Object.fromEntries(item.fields.map(field=>[field.key,''])),types:Object.fromEntries(item.fields.map(field=>[field.key,field.type]))}),'quiet'),
        button(t('associateEntries'),()=>associateTemplateEntries(item),'quiet'));
      card.append(actions);grid.append(card);
    }
    return section;
  }
  function associateTemplateEntries(template){
    screen('templates',t('associateEntries'));
    main.append(node('h3',{},template.name),node('p',{class:'hint'},t('associateEntriesHint')));
    const form=node('form'),list=node('div',{class:'template-entry-list'});
    const candidates=data.entries.filter(entry=>entry.templateId!==template.id);
    const choices=[];
    for(const entry of candidates){
      const label=node('label',{class:'template-entry-choice'}),input=node('input',{type:'checkbox',value:entry.id}),text=node('span');
      text.append(node('strong',{},entry.name));
      const current=data.templates.find(item=>item.id===entry.templateId);
      if(current)text.append(node('small',{},t('templateLabel',current.name)));
      label.append(input,text);list.append(label);choices.push(input);
    }
    if(!candidates.length)list.append(node('p',{class:'hint'},t('noEntriesToAssociate')));
    const actions=node('div',{class:'actions sticky-actions'}),submit=button(t('associateEntries'),associate,'primary');
    submit.dataset.action='associateEntries';
    const feedback=node('p',{class:'hint',role:'status','aria-live':'polite'});
    let saving=false;
    const sync=()=>{submit.disabled=saving||!choices.some(input=>input.checked);};
    sync();list.addEventListener('change',sync);list.addEventListener('input',sync);
    actions.append(submit,button(t('cancel'),templates));form.append(list,feedback,actions);main.append(form);
    // Use an explicit action: binding must not depend on native form submission
    // or constraint validation in the document hosting the sidebar.
    form.addEventListener('submit',event=>{event.preventDefault();void associate();});
    async function associate(){
      const entryIds=choices.filter(input=>input.checked).map(input=>input.value);
      if(!entryIds.length||saving)return;
      saving=true;sync();const request=screenVersion,unlock=lockForm(form);
      feedback.textContent=t('associatingEntries');
      try{
        await mutate({action:'template-associate',id:template.id,entryIds});
        if(request===screenVersion){templates();notify(t('entriesAssociated'));}
      }catch(error){feedback.textContent=t(error.message);notify(t(error.message));}
      finally{saving=false;unlock();sync();}
    }
  }

  function templateEditor(existing,source){
    screen('templates',existing?t('editTemplate'):t('newTemplate'));
    const form=node('form',{class:'template-editor'}),name=labeled(form,t('templateName'),node('input',{required:'',maxlength:'100'}));
    name.value=existing?.name||source?.name||'';
    form.append(node('p',{class:'hint'},t('templateStructureHint')));
    const rows=node('div',{class:'template-fields'});form.append(rows);
    let draggedField=null;
    function clearFieldDrop(){rows.querySelectorAll('[data-drop]').forEach(row=>row.removeAttribute('data-drop'));}
    function add(field={key:'',type:'string'}){
      if(rows.children.length>=200)return;
      const row=node('div',{class:'template-field'}),keyCell=node('div'),typeCell=node('div');
      const key=labeled(keyCell,t('key'),node('input',{required:'',maxlength:'200'})),type=labeled(typeCell,t('valueType'),node('select'));
      const grip=button('⠿',()=>{},'field-grip');grip.draggable=true;grip.title=t('reorderField');grip.setAttribute('aria-label',t('reorderField'));
      grip.addEventListener('keydown',event=>{
        if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();
        const next=event.key==='ArrowUp'?row.previousElementSibling:row.nextElementSibling;
        if(next){rows.insertBefore(row,event.key==='ArrowUp'?next:next.nextElementSibling);grip.focus();}
      });
      grip.addEventListener('dragstart',event=>{draggedField=row;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-quickfill-template-field','field');event.dataTransfer.setDragImage(row,20,20);});
      grip.addEventListener('dragend',()=>{draggedField=null;clearFieldDrop();});
      row.addEventListener('dragover',event=>{if(!draggedField||draggedField===row)return;event.preventDefault();event.dataTransfer.dropEffect='move';clearFieldDrop();row.dataset.drop=event.clientY>row.getBoundingClientRect().top+row.offsetHeight/2?'after':'before';});
      row.addEventListener('dragleave',event=>{if(!row.contains(event.relatedTarget))row.removeAttribute('data-drop');});
      row.addEventListener('drop',event=>{if(!draggedField||!row.dataset.drop)return;event.preventDefault();rows.insertBefore(draggedField,row.dataset.drop==='after'?row.nextElementSibling:row);draggedField=null;clearFieldDrop();});
      row.append(grip,keyCell,typeCell);
      key.value=field.key;types.names.forEach(value=>type.append(node('option',{value},t('type_'+value))));type.value=field.type;
      row.append(button(t('removeValue'),()=>row.remove(),'quiet'));rows.append(row);
    }
    const fields=existing?.fields||(source?Object.keys(source.values).map(key=>({key,type:typeFor(source,key)})):[]);
    (fields.length?fields:[{key:'',type:'string'}]).forEach(add);
    form.append(button(t('addValue'),()=>add(),'quiet'));
    const actions=node('div',{class:'actions sticky-actions'});actions.append(node('button',{type:'submit',class:'primary'},t('saveTemplate')),button(t('cancel'),templates));
    if(existing)actions.append(button(t('deleteTemplate'),()=>{
      screen('templates',t('deleteTemplate'));main.append(node('p',{},t('deleteTemplateHint')));
      main.append(button(t('deleteTemplate'),async()=>{try{await mutate({action:'template-delete',id:existing.id});templates();}catch(error){notify(t(error.message));}},'danger'),button(t('cancel'),()=>templateEditor(existing)));
    },'danger'));
    form.append(actions);main.append(form);name.focus();
    form.addEventListener('submit',async event=>{
      event.preventDefault();const template={id:existing?.id||core.uuid(),name:name.value.trim(),fields:[...rows.children].map(row=>({key:row.querySelector('input').value.trim(),type:row.querySelector('select').value}))};
      try{QuickfillRegistry.template(template);}catch{notify(t('templateValidation'));return;}
      const unlock=lockForm(form);
      try{await mutate({action:'template-upsert',template});templates();notify(t('templateSaved'));}catch(error){notify(t(error.message));}finally{unlock();}
    });
  }
  function settings() {
    screen('settings',t('settings'));
    const general=node('section',{class:'settings-section'});general.append(node('h2',{},t('general')));
    const select=labeled(general,t('language'),node('select'));[['auto',t('automatic')],['en','English'],['ru','Русский']].forEach(([value,label])=>select.append(node('option',{value},label)));select.value=data.language||'auto';
    general.append(node('p',{class:'hint'},t('languageHint')));
    const suggestions=labeled(general,t('suggestionBehavior'),node('select',{'data-global-suggestions':''}));
    ['button','off'].forEach(value=>suggestions.append(node('option',{value},t('suggestions_'+value))));suggestions.value=globalSuggestions();
    general.append(node('p',{class:'hint'},t('globalSuggestionsHint')));
    if(!standalone){const newTab=button(t('openInTab'),openInTab,'quiet'),icon=QuickfillIcon('external');icon.classList.add('button-icon');newTab.prepend(icon);newTab.dataset.action='openInTab';general.append(newTab,button(t('walkthrough'),walkthrough,'quiet'));}
    suggestions.addEventListener('change',async()=>{
      suggestions.disabled=true;
      try{await mutate({action:'global-preferences',preferences:{suggestions:suggestions.value}});updatePreferences();notify(t('preferencesSaved'));}
      catch(error){suggestions.value=globalSuggestions();notify(t(error.message));}
      finally{suggestions.disabled=false;}
    });
    const storage=node('section',{class:'settings-section'}),storageHeader=node('div',{class:'section-heading'}),dataTools=node('div',{class:'data-tools',role:'group','aria-label':t('dataSettings')});
    const importButton=iconButton(t('importData'),'import',importData),exportButton=iconButton(t('exportData'),'export',exportData);importButton.dataset.action='importData';exportButton.dataset.action='exportData';dataTools.append(importButton,exportButton);
    storageHeader.append(node('h2',{},t('dataSettings')),dataTools);storage.append(storageHeader,node('p',{class:'hint'},t('backupHint')));
    main.append(general,standalone?savedWebsiteSettings():websiteSettings(),storage);if(!standalone)general.append(button(t('manageTemplates'),templates,'quiet'));
    select.addEventListener('change',async()=>{try{await mutate({action:'language',language:select.value});await reloadLanguage();}catch(e){notify(t(e.message));}});
  }
  function exportData() {
    const bundle={version:1,templates:data.templates||[],entries:data.entries,associations:data.associations,mappings:data.mappings||{},preferences:data.preferences||{},globalPreferences:QuickfillRegistry.globalSettings(data.globalPreferences)};
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
  document.addEventListener('focusin', event => {if (standalone||!isCurrent()||event.composedPath().includes(host)||surface.inside(event)) return; const field = pageField(event); if (field) {target = field;updateDestination();surface.track(excluded(field)?null:field);} else surface.hide();}, true);
  document.addEventListener('contextmenu', event => {if (!standalone&&isCurrent()&&!event.composedPath().includes(host)&&!surface.inside(event)) target = event.composedPath().find(fields.supported) || null;}, true);
  document.addEventListener('dragover', event => {
    if(standalone||!isCurrent())return;
    if (pageField(event) && event.dataTransfer.types.includes('application/x-quickfill')) {event.preventDefault(); event.dataTransfer.dropEffect = 'copy';}
  }, true);
  document.addEventListener('drop', event => {
    if(standalone||!isCurrent())return;
    const field = pageField(event);
    if (!field || !event.dataTransfer.types.includes('application/x-quickfill')) return;
    event.preventDefault(); event.stopPropagation(); target = field;
    const raw=event.dataTransfer.getData('application/x-quickfill');
    try{const item=JSON.parse(raw),entry=data.entries.find(e=>e.id===item.entryId);if(entry&&Object.hasOwn(entry.values,item.key)){chooseValue(entry,item.key,field);return;}}catch{}
    fill(raw);
  }, true);
  document.addEventListener('keydown', event => {
    if(!isCurrent())return;
    if(resizeKeydown(event))return;
    // Commands API owns Ctrl+B; avoid a second toggle from a page key handler.
    if(QuickfillControls.handleKeydown(event))return;
    if(surface.inside(event))return;
    if(event.composedPath().includes(host)){
      const open=shadow.querySelector('.menu-list:not([hidden])');if(open){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();open.hidden=true;open.previousSibling.setAttribute('aria-expanded','false');open.previousSibling.focus();return;}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const options=[...open.querySelectorAll('button')],at=options.indexOf(shadow.activeElement);options[(at+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();return;}}
    }
    if (event.key === 'Escape') {surface.escape();if(visible){event.preventDefault();if(standalone){if(mode!=='registry')back();}else if(fullscreen)setFullscreen(false);else toggle(false);}return;}
    if(!standalone&&visible&&fullscreen&&event.key==='Tab'){
      const controls=[...shadow.querySelectorAll('button,input,textarea,select,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.checkVisibility());
      const first=controls[0],last=controls.at(-1),active=shadow.activeElement;
      if(!controls.includes(active)||(event.shiftKey&&active===first)||(!event.shiftKey&&active===last)){event.preventDefault();(event.shiftKey?last:first)?.focus();}return;
    }
    if (!visible || !event.composedPath().includes(host) || !['registry','fill'].includes(mode)) return;
    const active = shadow.activeElement;
    const values = Array.from(main.querySelectorAll('.value'));
    if (['ArrowDown','ArrowUp'].includes(event.key) && (active === search || values.includes(active)) && values.length) {
      event.preventDefault(); const index = values.indexOf(active);
      values[index<0?(event.key==='ArrowDown'?0:values.length-1):(index+(event.key==='ArrowDown'?1:-1)+values.length)%values.length].focus();
    } else if (event.key === 'Enter' && values.length && (active === search || values.includes(active))) {event.preventDefault(); (active === search ? values[0] : active).click();}
  }, true);
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if(standalone&&message.type==='manager-command'&&message.tabId===managerTabId){
      if(message.command==='palette')surface.palette();
      if(message.command==='toggle')toggle(true);
      respond({ok:true});return;
    }
    if (message.type === 'palette') surface.palette();
    if (message.type === 'toggle') toggle();
    if (!standalone&&message.type === 'fill') {captureDraft();mode = 'fill'; query = ''; if (search) search.value = ''; toggle(true);}
    if (!standalone&&message.type === 'save') saveField();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.registry) return;
    const next = changes.registry.newValue || {entries:[],associations:{},language:'auto'};
    const changedLanguage = (boot.data.language || 'auto') !== (next.language || 'auto'); data = next;
    if (changedLanguage) reloadLanguage(); else {updatePreferences();render();}
  });
  // Page frameworks can replace root children without reloading the content script.
  new MutationObserver(()=>{if(isCurrent()&&visible&&host&&!host.isConnected){finishResize(false);mount();}}).observe(document,{childList:true,subtree:true});
  window.addEventListener('resize',()=>{if(isCurrent()){finishResize(false);applySidebarWidth();}});
  if(standalone){toggle(true);back();}
})();
globalThis.QuickfillReady.catch(error=>{console.error('Quickfill could not initialize:',error);globalThis.QuickfillReady=null;});
}
