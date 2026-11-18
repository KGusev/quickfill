/* Shared accessible controls. Native selects remain the source of form values. */
(function(root){
  if(root.QuickfillControls)return;
  const enhanced=new WeakMap(),roots=new WeakSet();
  let active=null,nextId=0;
  const el=(tag,attrs={},text)=>{const n=document.createElement(tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);if(text!==undefined)n.textContent=text;return n;};
  const icon=name=>QuickfillIcon(name);
  const button=(label,name,run,className='quiet')=>{const b=el('button',{type:'button',class:className,'aria-label':label,title:label});if(name)b.append(icon(name));else b.textContent=label;b.addEventListener('click',run);return b;};
  function close(restore=false){const previous=active;active=null;if(previous){previous.popup.remove();previous.trigger.setAttribute('aria-expanded','false');previous.trigger.removeAttribute('aria-activedescendant');if(restore&&previous.trigger.isConnected)previous.trigger.focus({preventScroll:true});}}
  function position(){
    if(!active)return;
    const {trigger,popup}=active;if(!trigger.isConnected||!trigger.checkVisibility()){close();return;}
    const r=trigger.getBoundingClientRect(),space=Math.max(r.top-12,innerHeight-r.bottom-12);
    popup.style.maxHeight=Math.max(80,Math.min(active.kind==='combo'?320:470,space))+'px';
    if(active.kind==='combo')popup.style.width=Math.min(Math.max(r.width,180),innerWidth-16)+'px';
    const p=popup.getBoundingClientRect(),below=innerHeight-r.bottom-8;
    popup.style.left=Math.max(8,Math.min(innerWidth-p.width-8,r.left))+'px';
    popup.style.top=Math.max(8,Math.min(innerHeight-p.height-8,below>=p.height?r.bottom+5:r.top-p.height-5))+'px';
  }
  function enhance(shadow,{t}){
    if(roots.has(shadow))return;roots.add(shadow);
    const upgrade=select=>{
      if(enhanced.has(select)||select.multiple||select.size>1)return;
      const wrapper=el('span',{class:'qf-combo'}),trigger=el('button',{type:'button',class:'qf-combo-trigger',role:'combobox','aria-haspopup':'listbox','aria-expanded':'false'}),label=el('span',{class:'qf-combo-label'}),chevron=icon('down');
      select.before(wrapper);wrapper.append(select,trigger);trigger.append(label,chevron);select.classList.add('qf-select-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
      const sync=()=>{
        const text=select.selectedOptions[0]?.label||'';if(label.textContent!==text)label.textContent=text;
        trigger.disabled=select.disabled;wrapper.hidden=select.hidden;trigger.setAttribute('aria-required',String(select.required));
        const invalid=select.getAttribute('aria-invalid');if(invalid)trigger.setAttribute('aria-invalid',invalid);else trigger.removeAttribute('aria-invalid');
        const accessible=select.getAttribute('aria-label')||Array.from(select.labels||[]).map(l=>l.textContent).join(' ')||t('value');trigger.setAttribute('aria-label',accessible);
        if(select.getAttribute('aria-describedby'))trigger.setAttribute('aria-describedby',select.getAttribute('aria-describedby'));else trigger.removeAttribute('aria-describedby');
      };
      const choose=index=>{const option=select.options[index];if(!option||option.disabled||option.parentElement?.disabled)return;close();trigger.focus({preventScroll:true});if(select.selectedIndex!==index){select.selectedIndex=index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}sync();};
      const open=()=>{
        if(trigger.disabled)return;if(active?.trigger===trigger){close();return;}close();sync();trigger.focus({preventScroll:true});
        const popup=el('div',{class:'qf-select-popup',role:'listbox',id:'qf-options-'+(++nextId),'aria-label':trigger.getAttribute('aria-label')});
        const options=Array.from(select.options),available=options.map((o,i)=>!o.disabled&&!o.parentElement?.disabled&&!o.hidden?i:-1).filter(i=>i>=0);
        for(const [index,option] of options.entries()){
          if(option.hidden)continue;const item=el('div',{class:'qf-select-option',role:'option',id:popup.id+'-'+index,'aria-selected':String(index===select.selectedIndex),'aria-disabled':String(option.disabled||!!option.parentElement?.disabled)},option.label);
          item.append(icon('check'));item.addEventListener('pointerdown',event=>event.preventDefault());item.addEventListener('click',()=>choose(index));popup.append(item);
        }
        const state={kind:'combo',trigger,popup,select,available,index:available.includes(select.selectedIndex)?select.selectedIndex:available[0],search:'',searchAt:0};
        state.select=index=>{state.index=index;popup.querySelectorAll('[role=option]').forEach(n=>n.classList.toggle('active',n.id===popup.id+'-'+index));const item=popup.querySelector('[id="'+popup.id+'-'+index+'"]');if(item){trigger.setAttribute('aria-activedescendant',item.id);item.scrollIntoView({block:'nearest'});}};
        state.key=event=>{
          if(event.key==='Escape'){close(true);return true;}
          if(event.key==='Tab'){if(state.index!==undefined)choose(state.index);else close();return false;}
          if(['Enter',' '].includes(event.key)){if(state.index!==undefined)choose(state.index);return true;}
          const at=available.indexOf(state.index);
          if(['ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(event.key)){const delta=event.key.includes('Down')?1:-1,step=event.key.startsWith('Page')?5:1;const next=event.key==='Home'?0:event.key==='End'?available.length-1:Math.max(0,Math.min(available.length-1,at+delta*step));state.select(available[next]);return true;}
          if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){const now=Date.now();state.search=now-state.searchAt<700?state.search+event.key:event.key;state.searchAt=now;const query=state.search.toLocaleLowerCase();const ordered=[...available.slice(at+1),...available.slice(0,at+1)];const match=ordered.find(i=>options[i].label.toLocaleLowerCase().startsWith(query));if(match!==undefined)state.select(match);return true;}
          return false;
        };
        shadow.append(popup);active=state;trigger.setAttribute('aria-controls',popup.id);trigger.setAttribute('aria-expanded','true');position();state.select(state.index);
      };
      enhanced.set(select,{sync,open,trigger});trigger.addEventListener('click',open);trigger.addEventListener('keydown',event=>{if(!active&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open();if(event.key==='Home'||event.key==='End')active?.key(event);}});
      select.addEventListener('input',sync);select.addEventListener('change',sync);select.addEventListener('focus',()=>trigger.focus());select.addEventListener('invalid',event=>{event.preventDefault();trigger.setAttribute('aria-invalid','true');trigger.focus();});sync();
    };
    const scan=()=>{shadow.querySelectorAll('select').forEach(upgrade);};scan();
    new MutationObserver(records=>{
      let scanNeeded=false;
      for(const record of records){const select=record.target.matches?.('select')?record.target:record.target.closest?.('select');if(select){enhanced.get(select)?.sync();if(active?.select===select)close();}
        if(record.type==='childList')for(const added of record.addedNodes)if(added.nodeType===1&&(added.matches('select')||added.querySelector('select')))scanNeeded=true;
      }
      if(scanNeeded)scan();if(active&&!active.trigger.isConnected)close();
    }).observe(shadow,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','required','aria-invalid','aria-describedby','aria-label','selected','label']});
  }
  const pad=value=>String(value).padStart(2,'0');
  const dateString=date=>String(date.getFullYear()).padStart(4,'0')+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
  const localDate=(year,month,day)=>{const date=new Date(2000,0,1,12);date.setFullYear(year,month,day);return date;};
  function datePicker(input,type,{t}){
    const wrap=el('span',{class:'qf-date-wrap'}),trigger=button(t('chooseDate'),'calendar',open,'qf-date-trigger icon-button');
    input.type='text';input.placeholder=type==='datetime'?'YYYY-MM-DDTHH:mm':'YYYY-MM-DD';input.autocomplete='off';input.spellcheck=false;trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');wrap.append(input,trigger);
    function open(){
      if(input.disabled||input.readOnly)return;if(active?.trigger===trigger){close();return;}close();
      const shadow=input.getRootNode(),locale=shadow.querySelector('.panel')?.lang||document.documentElement.lang||undefined,now=new Date(),match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(:\d{2}(?:\.\d{1,3})?)?)?$/.exec(input.value);
      let timeHours,timeMinutes;
      let chosen=match?localDate(Number(match[1]),Number(match[2])-1,Number(match[3])):localDate(now.getFullYear(),now.getMonth(),now.getDate()),month=localDate(chosen.getFullYear(),chosen.getMonth(),1),hour=match?.[4]||'12',minute=match?.[5]||'00',seconds=match?.[6]||'';
      const popup=el('div',{class:'qf-calendar',role:'dialog',id:'qf-calendar-'+(++nextId),'aria-label':t('chooseDate')}),heading=el('div',{class:'qf-calendar-heading'}),title=el('strong',{'aria-live':'polite'}),grid=el('div',{class:'qf-calendar-grid',role:'grid','aria-label':t('chooseDate')}),weekdays=el('div',{class:'qf-calendar-weekdays','aria-hidden':'true'});
      const commit=(date,finish=type!=='datetime')=>{chosen=date;input.value=dateString(date)+(type==='datetime'?'T'+pad(Number(hour))+':'+pad(Number(minute))+seconds:'');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));if(finish)close(true);else render();};
      const moveMonth=amount=>{heading.querySelector(amount<0?'button:first-child':'button:last-child')?.focus({preventScroll:true});month=localDate(month.getFullYear(),month.getMonth()+amount,1);render();};
      heading.append(button(t('previousMonth'),'back',()=>moveMonth(-1),'icon-button quiet'),title,button(t('nextMonth'),'forward',()=>moveMonth(1),'icon-button quiet'));
      for(let i=0;i<7;i++)weekdays.append(el('span',{},new Intl.DateTimeFormat(locale,{weekday:'short'}).format(localDate(2024,0,1+i))));
      function render(focusDate){
        title.textContent=new Intl.DateTimeFormat(locale,{month:'long',year:'numeric'}).format(month);grid.replaceChildren();
        const start=localDate(month.getFullYear(),month.getMonth(),1-((month.getDay()+6)%7));
        for(let week=0;week<6;week++){const row=el('div',{class:'qf-calendar-week',role:'row'});for(let weekday=0;weekday<7;weekday++){
          const date=localDate(start.getFullYear(),start.getMonth(),start.getDate()+week*7+weekday),text=dateString(date),selected=text===input.value.slice(0,10),day=button(new Intl.DateTimeFormat(locale,{dateStyle:'full'}).format(date),null,()=>commit(date),'qf-calendar-day quiet');
          day.textContent=date.getDate();day.dataset.date=text;day.setAttribute('role','gridcell');day.setAttribute('aria-selected',String(selected));day.tabIndex=text===dateString(focusDate||chosen)?0:-1;day.classList.toggle('outside',date.getMonth()!==month.getMonth());if(text===dateString(now))day.setAttribute('aria-current','date');row.append(day);
        }grid.append(row);}
        if(!grid.querySelector('[tabindex="0"]'))grid.querySelector('button:not(.outside)').tabIndex=0;
        if(focusDate)grid.querySelector('[data-date="'+dateString(focusDate)+'"]')?.focus();position();
      }
      popup.append(heading,weekdays,grid);
      if(type==='datetime'){
        const time=el('div',{class:'qf-calendar-time'}),label=el('span',{},t('time')),hours=el('input',{type:'number',min:'0',max:'23',step:'1','aria-label':t('hour')}),minutes=el('input',{type:'number',min:'0',max:'59',step:'1','aria-label':t('minute')});hours.value=hour;minutes.value=minute;timeHours=hours;timeMinutes=minutes;time.append(icon('clock'),label,hours,el('span',{},':'),minutes);popup.append(time);
        const change=()=>{if(!hours.checkValidity()||!minutes.checkValidity()||hours.value===''||minutes.value==='')return;hour=pad(Number(hours.value));minute=pad(Number(minutes.value));commit(chosen,false);};hours.addEventListener('change',change);minutes.addEventListener('change',change);
      }
      const actions=el('div',{class:'qf-calendar-actions'});actions.append(button(t('today'),null,()=>{month=localDate(now.getFullYear(),now.getMonth(),1);commit(localDate(now.getFullYear(),now.getMonth(),now.getDate()));}),button(t('clearValue'),null,()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close(true);}));
      if(type==='datetime')actions.append(button(t('confirmDate'),null,()=>{for(const field of [timeHours,timeMinutes])if(field.value===''||!field.checkValidity()){field.focus();field.reportValidity();return;}hour=pad(Number(timeHours.value));minute=pad(Number(timeMinutes.value));commit(chosen,true);},'primary'));
      popup.append(actions);shadow.append(popup);trigger.setAttribute('aria-controls',popup.id);trigger.setAttribute('aria-expanded','true');
      active={kind:'date',trigger,popup,key:event=>{
        if(event.key==='Escape'){close(true);return true;}
        if(event.key==='Tab'){const controls=[...popup.querySelectorAll('button,input')].filter(n=>!n.disabled&&n.tabIndex>=0),current=shadow.activeElement,first=controls[0],last=controls.at(-1);if(event.shiftKey&&current===first){last.focus();return true;}if(!event.shiftKey&&current===last){first.focus();return true;}return false;}
        const day=event.composedPath().find(n=>n.dataset?.date);if(!day)return false;
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)){
          const [year,mon,date]=day.dataset.date.split('-').map(Number);let next=localDate(year,mon-1,date);const weekday=(next.getDay()+6)%7;
          if(event.key==='PageUp'||event.key==='PageDown'){const offset=(event.key==='PageUp'?-1:1)*(event.shiftKey?12:1),lastDay=localDate(year,mon+offset,0).getDate();next=localDate(year,mon-1+offset,Math.min(date,lastDay));}
          else next.setDate(date+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday}[event.key]));
          month=localDate(next.getFullYear(),next.getMonth(),1);render(next);return true;
        }
        return false;
      }};render();position();grid.querySelector('[tabindex="0"]')?.focus();
    }
    input.addEventListener('keydown',event=>{if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();open();}});
    return wrap;
  }
  function handleKeydown(event){
    if(!active)return false;if(!event.composedPath().includes(active.trigger)&&!event.composedPath().includes(active.popup))return false;
    if(active.key(event)){event.preventDefault();event.stopPropagation();return true;}return false;
  }
  document.addEventListener('pointerdown',event=>{if(active&&!event.composedPath().includes(active.popup)&&!event.composedPath().includes(active.trigger))close();},true);
  document.addEventListener('focusin',event=>{if(active&&!event.composedPath().includes(active.popup)&&!event.composedPath().includes(active.trigger))close();},true);
  document.addEventListener('scroll',event=>{if(active&&!event.composedPath().includes(active.popup))position();},true);window.addEventListener('resize',position);
  root.QuickfillControls={enhance,datePicker,handleKeydown,close};
})(globalThis);
