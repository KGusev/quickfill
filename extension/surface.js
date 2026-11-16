/* Page-local inline controls and an accessible keyboard command dialog. */
(function(root){
  root.QuickfillSurface=function({t,node,button,matches,choose,commands,prefs,onClose,undo,canUndo}){
    const host=document.createElement('quickfill-tools');
    host.style.cssText='all:initial!important;position:fixed!important;inset:0 auto auto 0!important;z-index:2147483647!important;';
    const shadow=host.attachShadow({mode:'open'});
    shadow.append(node('style',{},QuickfillStyles+`
.launcher{position:fixed;display:grid;place-items:center;width:36px;height:36px;min-width:36px;min-height:36px;padding:0;background:var(--qf-accent);color:white;border:1px solid #ffffffa6;border-radius:12px;isolation:isolate;overflow:visible;box-shadow:inset 0 1px 0 #ffffff55,0 3px 10px #7135b733;transition:box-shadow .2s ease,background .2s ease}
.launcher[hidden]{display:none}
.launcher svg{width:23px;height:23px;pointer-events:none;filter:drop-shadow(0 1px 1px #56238b55);transition:transform .22s ease}
.launcher::before,.launcher::after{content:"";position:absolute;pointer-events:none;border-radius:inherit}
.launcher::before{inset:-5px;z-index:-1;opacity:0;background:radial-gradient(circle,#cda7ff99,transparent 72%);filter:blur(4px);transition:opacity .2s ease}
.launcher::after{inset:1px;opacity:0;background:linear-gradient(115deg,transparent 25%,#ffffff66 45%,transparent 65%);background-size:250% 100%;background-position:150% 0}
.launcher:is(:hover,:focus-visible){background:var(--qf-accent);box-shadow:inset 0 1px 0 #ffffff77,0 0 0 3px #a05dff22,0 0 22px #a05dff77,0 5px 14px #7135b733}
.launcher:is(:hover,:focus-visible)::before{opacity:1}
.launcher:is(:hover,:focus-visible)::after{animation:qf-sheen 1.1s ease-in-out 1}
.launcher:is(:hover,:focus-visible) svg{transform:rotate(-9deg) translateY(-1px)}
.launcher .magic-particles i:nth-child(1){--dx:-25px;--dy:-18px;--delay:0s}
.launcher .magic-particles i:nth-child(2){--dx:18px;--dy:-29px;--delay:.2s}
.launcher .magic-particles i:nth-child(3){--dx:28px;--dy:5px;--delay:.4s}
.launcher .magic-particles i:nth-child(4){--dx:8px;--dy:28px;--delay:.6s}
.launcher .magic-particles i:nth-child(5){--dx:-27px;--dy:15px;--delay:.8s}
.launcher .magic-particles i:nth-child(6){--dx:-6px;--dy:-32px;--delay:1s}
.launcher:is(:hover,:focus-visible) .magic-particles i{animation:qf-spark 0.8s ease-out var(--delay) 1}
@keyframes qf-spark{0%{opacity:0;transform:translate(-50%,-50%) scale(.2) rotate(0deg)}20%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.5) rotate(100deg)}}

@media(prefers-reduced-motion:reduce){.launcher,.launcher svg,.launcher::before,.launcher::after,.magic-particles i{animation:none!important;transition:none!important}.launcher:is(:hover,:focus-visible) svg{transform:none}.launcher::after,.magic-particles{display:none}}

.inline{position:fixed;width:min(340px,calc(100vw - 16px));max-height:320px;overflow:auto;background:white;border:1px solid #dbe1eb;border-radius:12px;padding:12px;box-shadow:0 8px 30px #0003;font:14px/1.5 system-ui;color:#20304a}
.inline .value{border-left:4px solid var(--entry-color,var(--qf-accent))}
.scrim{position:fixed;inset:0;background:#14213a55;display:flex;align-items:flex-start;justify-content:center;padding:clamp(12px,8vh,72px) 12px;overflow:hidden;overscroll-behavior:contain}
.palette{font:14px/1.5 system-ui;color:var(--qf-text);background:white;padding:18px;border:1px solid var(--qf-border);border-radius:16px;width:min(560px,100%);max-height:calc(100dvh - clamp(24px,16vh,144px));display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 50px #0004}.palette h2{margin:0 0 12px;flex-shrink:0}.palette .value{cursor:pointer}.palette>.quiet{align-self:flex-end;flex-shrink:0}.palette-search{flex-shrink:0}.palette-results{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:4px 6px 8px}.palette-count{font-size:11px;color:var(--qf-muted);margin:8px 0 4px;flex-shrink:0}.palette-preview{margin:8px 0 0;flex-shrink:0;max-height:25vh;overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--qf-border);padding-top:4px}.palette-preview .resolved{background:color-mix(in srgb,var(--entry-color,var(--qf-accent)) 5%,transparent);margin:4px 0}.palette .keyboard-hint{flex-shrink:0;margin:8px 0 0}.palette-results .value>span:not(.magic-particles){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.palette-results .value small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inline-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.inline-heading strong{font-size:12px}.inline .value>span:not(.magic-particles){font-size:14px;white-space:pre-wrap}.inline .value small{display:flex;align-items:center;gap:6px;margin-top:4px}.entry-dot{width:7px;height:7px;border-radius:50%;background:var(--entry-color);flex-shrink:0}.inline .value .match-reason{font-size:11px}.inline .value>kbd{position:absolute;right:10px;top:10px;opacity:0}.inline .value:focus-visible>kbd{opacity:1}.inline .value{padding-right:32px}.palette [role=option]{border-left:3px solid var(--entry-color,var(--qf-accent));}.palette .group-title{margin:14px 0 6px}.keyboard-hint{font-size:11px;margin:10px 0}.surface-feedback{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);display:flex;gap:10px;align-items:center;padding:10px 14px;border:1px solid #ddd4ef;background:white;border-radius:12px;box-shadow:0 6px 24px #25304725;font:13px/1.5 system-ui;color:#253047;overflow-wrap:anywhere}.surface-feedback span{min-width:0}.surface-feedback button{font-size:12px;flex-shrink:0}
.sr{position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
`));document.documentElement.append(host);
    const live=node('div',{class:'sr',role:'status','aria-live':'polite'});shadow.append(live);
    let target,launcher,popup,dialog,restoreFocus,feedback,paletteIndex=-1,sidebarState;
    const resizeObserver=new ResizeObserver(()=>position());
    const inside=event=>event.composedPath().includes(host);
    function announce(text){live.textContent='';queueMicrotask(()=>{live.textContent=text;});feedback?.remove();feedback=null;
      const sidebar=document.querySelector('quickfill-sidebar');if(!text||(sidebar&&sidebar.style.display!=='none'))return;
      feedback=node('div',{class:'surface-feedback'});feedback.append(node('span',{},text));if(canUndo?.())feedback.append(button(t('undo'),undo,'quiet'));feedback.append(button(t('dismiss'),()=>{feedback.remove();feedback=null;},'quiet'));shadow.append(feedback);
    }
    function closeInline(){popup?.remove();popup=null;launcher?.setAttribute('aria-expanded','false');}
    function hide(clearFeedback=false){if(clearFeedback){feedback?.remove();feedback=null;}closeInline();launcher?.remove();launcher=null;target=null;resizeObserver.disconnect();}
    function position(){
      if(!target?.isConnected){hide();return;}if(!launcher)return;
      const r=target.getBoundingClientRect();
      if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth){launcher.hidden=true;if(popup)popup.hidden=true;return;}
      launcher.hidden=false;
      // Keep the launcher out of the native autofill area below the input.
      const size=36,gap=6;
      const right=r.right+gap,left=r.left-size-gap;
      const x=right+size<=innerWidth-4 ? right : left>=4 ? left : Math.max(4,Math.min(innerWidth-size-4,r.right-size));
      const y=right+size<=innerWidth-4 || left>=4 ? r.top+(r.height-size)/2 : r.top-size-gap;
      launcher.style.left=x+'px';
      launcher.style.top=Math.max(4,Math.min(innerHeight-size-4,y))+'px';
      if(popup){popup.hidden=false;const above=Math.max(0,r.top-12),below=Math.max(0,innerHeight-r.bottom-12);popup.style.maxHeight=Math.max(40,Math.min(360,Math.max(above,below)))+'px';const bounds=popup.getBoundingClientRect();const y=below>=bounds.height||below>=above?r.bottom+6:r.top-bounds.height-6;popup.style.left=Math.max(8,Math.min(innerWidth-bounds.width-8,r.left))+'px';popup.style.top=Math.max(8,Math.min(innerHeight-bounds.height-8,y))+'px';}
    }
    function openInline(){
      closeInline();if(!target)return;
      popup=node('div',{class:'inline',role:'region','aria-label':t('suggestedValues')});
      const field=target,values=matches(field);
      const heading=node('div',{class:'inline-heading'});heading.append(node('strong',{},t('suggestedValues')),button(t('close'),()=>{closeInline();launcher?.focus();},'quiet'));popup.append(heading);
      for(const match of values.slice(0,30)){
        const suggestion=button('',()=>{
          // Move to a stable Quickfill control before removing the selected button.
          // Focusing the page field here reopens Chrome's native autofill popup.
          launcher?.focus({preventScroll:true});closeInline();choose(match,field);
        },'value');
        suggestion.setAttribute('aria-label',`${match.value} · ${match.entry.name} · ${match.key}`);suggestion.append(node('span',{},match.value||t('emptyValue')));const meta=node('small');meta.append(node('i',{class:'entry-dot','aria-hidden':'true'}),document.createTextNode(match.entry.name+' · '+match.key));suggestion.append(meta,node('kbd',{'aria-hidden':'true'},'↵'));if(values.length>1)suggestion.append(node('small',{class:'match-reason'},match.reason==='association'?t('savedAssociation'):t('matchedHint',match.hint)));
        suggestion.style.setProperty('--entry-color',/^#[0-9a-f]{6}$/i.test(match.entry.color)?match.entry.color:'#a05dff');
        suggestion.append(QuickfillMagicParticles());
        popup.append(suggestion);
      }
      if(!values.length)popup.append(node('p',{},t('noMatchingKeys')));
      popup.append(node('p',{class:'keyboard-hint'},t('suggestionKeys')));
      shadow.append(popup);launcher?.setAttribute('aria-expanded','true');position();popup.querySelector('.value')?.focus();
    }
    function magicIcon(){
      const ns='http://www.w3.org/2000/svg';
      const svg=document.createElementNS(ns,'svg');
      for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
      const wand=document.createElementNS(ns,'path');
      for(const [key,value] of Object.entries({d:'M5 17 15.5 6.5 18.5 9.5 8 20.5 5 20.5Z M13 9 16 12',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round'}))wand.setAttribute(key,value);
      const stars=document.createElementNS(ns,'path');stars.setAttribute('d','M19 1.5 19.8 4.2 22.5 5 19.8 5.8 19 8.5 18.2 5.8 15.5 5 18.2 4.2Z M6 4 6.6 6 8.6 6.6 6.6 7.2 6 9.2 5.4 7.2 3.4 6.6 5.4 6Z');stars.setAttribute('fill','currentColor');
      svg.append(wand,stars);return svg;
    }
    function track(el){
      if(dialog)return;
      if(el!==target)closeInline();
      target=el;resizeObserver.disconnect();if(el)resizeObserver.observe(el);
      if(!el || prefs().suggestions==='off'){hide();return;}
      if(!launcher){launcher=button('',()=>{if(popup){closeInline();launcher.focus({preventScroll:true});}else openInline();},'launcher');launcher.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();});launcher.append(magicIcon());launcher.append(QuickfillMagicParticles());launcher.setAttribute('aria-label',t('inlineFill'));launcher.setAttribute('aria-expanded','false');shadow.append(launcher);}
      position();
    }
    function closePalette(restore=true){
      dialog?.remove();dialog=null;
      if(sidebarState){sidebarState.element.inert=sidebarState.inert;sidebarState=null;}
      const old=restoreFocus;restoreFocus=null;
      if(restore&&old?.isConnected)old.focus?.({preventScroll:true});else if(!restore){host.tabIndex=-1;host.focus({preventScroll:true});}
      onClose?.();
    }
    function selectPalette(index,scroll=true){
      const buttons=[...dialog.querySelectorAll('[role=option]')];if(!buttons.length)return;
      paletteIndex=((index%buttons.length)+buttons.length)%buttons.length;
      buttons.forEach((b,i)=>b.setAttribute('aria-selected',String(i===paletteIndex)));
      const selected=buttons[paletteIndex],input=dialog.querySelector('input');input.setAttribute('aria-activedescendant',selected.id);
      if(scroll)selected.scrollIntoView({block:'nearest'});
      const preview=dialog.querySelector('.palette-preview'),value=selected.querySelector('.palette-label').textContent;
      preview.hidden=value.length<=120&&!value.includes('\n');preview.querySelector('p').textContent=value;preview.style.setProperty('--entry-color',selected.style.getPropertyValue('--entry-color')||'#a05dff');
    }
    function highlight(text,query){
      const fragment=document.createDocumentFragment();let rest=String(text),at;
      if(!query){fragment.append(rest);return fragment;}
      while((at=rest.toLocaleLowerCase().indexOf(query))>=0){fragment.append(rest.slice(0,at),node('mark',{},rest.slice(at,at+query.length)));rest=rest.slice(at+query.length);}
      fragment.append(rest);return fragment;
    }
    function palette(){
      if(dialog){closePalette();return;}hide(true);restoreFocus=document.activeElement;
      while(restoreFocus?.shadowRoot?.activeElement)restoreFocus=restoreFocus.shadowRoot.activeElement;
      const sidebar=document.querySelector('quickfill-sidebar');if(sidebar){sidebarState={element:sidebar,inert:sidebar.inert};sidebar.inert=true;}
      dialog=node('div',{class:'scrim'});const panel=node('div',{class:'palette',role:'dialog','aria-modal':'true','aria-label':t('palette')});
      const title=node('h2',{},t('palette')),searchBox=node('div',{class:'palette-search'}),input=node('input',{type:'search',role:'combobox','aria-autocomplete':'list','aria-expanded':'true','aria-controls':'qf-command-results','aria-label':t('commandSearch'),placeholder:t('commandSearch')});
      const results=node('div',{class:'palette-results',role:'listbox',id:'qf-command-results','aria-label':t('palette')}),close=button(t('close'),()=>closePalette(),'quiet');
      const resultCount=node('p',{class:'palette-count',role:'status','aria-live':'polite'}),preview=node('details',{class:'palette-preview',hidden:''});preview.append(node('summary',{},t('showFullValue')),node('p',{class:'resolved'}));
      const render=()=>{results.replaceChildren();results.scrollTop=0;preview.hidden=true;preview.open=false;paletteIndex=-1;input.removeAttribute('aria-activedescendant');const query=input.value.toLocaleLowerCase();const actions=commands().filter(a=>(a.label+' '+(a.detail||'')).toLocaleLowerCase().includes(query));let count=0;
        for(const group of ['values','actions']){const items=actions.filter(a=>(a.group||'actions')===group).slice(0,group==='values'?30:20);if(!items.length)continue;const section=node('div',{role:'group','aria-label':group==='values'?t('valuesGroup'):t('actionsGroup')});section.append(node('div',{class:'group-title','aria-hidden':'true'},group==='values'?t('valuesGroup'):t('actionsGroup')));
          for(const action of items){const b=button('',()=>{closePalette(false);action.run();},'value');b.id='qf-command-'+count++;b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.tabIndex=-1;const label=node('span',{class:'palette-label'});label.append(highlight(action.label||t('emptyValue'),query));b.append(label);if(action.detail){const detail=node('small');detail.append(highlight(action.detail,query));b.append(detail);}const index=count-1;b.addEventListener('pointermove',event=>{if(event.movementX||event.movementY)selectPalette(index,false);});if(/^#[0-9a-f]{6}$/i.test(action.color||''))b.style.setProperty('--entry-color',action.color);b.append(QuickfillMagicParticles());section.append(b);}results.append(section);}
        resultCount.textContent=count===actions.length?t('resultCount',String(count)):t('showingResults',[String(count),String(actions.length)]);
        if(!count){const empty=node('div',{class:'empty'});empty.append(node('strong',{},t('noMatchingEntries')),node('p',{},t('tryAnotherSearch')));results.append(empty);}
      };
      input.addEventListener('input',render);searchBox.append(input);panel.append(title,searchBox,resultCount,results,preview,node('p',{class:'keyboard-hint'},t('paletteKeys')),close);dialog.append(panel);shadow.append(dialog);render();input.focus();
      dialog.addEventListener('click',event=>{if(event.target===dialog)closePalette();});
    }
    shadow.addEventListener('keydown',event=>{
      const active=shadow.activeElement,container=dialog||popup;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(dialog)closePalette();else{closeInline();target?.focus();}return;}
      if(!container)return;
      if(dialog&&active?.matches('input')&&['ArrowDown','ArrowUp','PageDown','PageUp','Enter'].includes(event.key)){event.preventDefault();if(event.key==='Enter'){const options=dialog.querySelectorAll('[role=option]');options[Math.max(0,paletteIndex)]?.click();}else{const forward=['ArrowDown','PageDown'].includes(event.key),step=event.key.startsWith('Page')?5:1;selectPalette(paletteIndex<0?(forward?0:-1):paletteIndex+(forward?step:-step));}return;}
      const buttons=Array.from(container.querySelectorAll('.value'));
      if(['ArrowDown','ArrowUp'].includes(event.key)&&buttons.length){event.preventDefault();const index=buttons.indexOf(active);buttons[index<0?(event.key==='ArrowDown'?0:buttons.length-1):(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}
      if(event.key==='Enter'&&active?.matches('input')&&buttons.length){event.preventDefault();buttons[0].click();}
      if(event.key==='Tab'&&dialog){const focusable=Array.from(dialog.querySelectorAll('input,summary,button:not([tabindex="-1"])')).filter(el=>el.checkVisibility());const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&active===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}}
    });
    document.addEventListener('pointerdown',event=>{if(!inside(event))closeInline();},true);
    document.addEventListener('focusin',event=>{if(!inside(event))closeInline();},true);
    document.addEventListener('scroll',position,true);window.addEventListener('resize',position);
    return {host,inside,track,hide,palette,announce,escape(){if(dialog)closePalette();else{closeInline();launcher?.remove();launcher=null;}},refresh(){if(target)track(target);}};
  };
})(globalThis);
