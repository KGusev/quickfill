(function(root) {
  const rich = el => el instanceof HTMLElement && el.isContentEditable && !el.parentElement?.isContentEditable;
  const supported = el => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || rich(el) || (el instanceof HTMLInputElement && ['text','email','tel','url','number','search','date','datetime-local','time','month','week','password','checkbox','radio'].includes(el.type));
  const editable = el => supported(el) && !el.matches(':disabled') && !el.readOnly && el.getAttribute('aria-readonly') !== 'true' && !el.closest('[inert]');
  const checkable = el => el instanceof HTMLInputElement && ['checkbox','radio'].includes(el.type);
  function radioGroup(el) {
    if (el.type !== 'radio' || !el.name) return [el];
    return Array.from(el.getRootNode().querySelectorAll('input[type=radio]')).filter(item=>item.name===el.name && item.form===el.form);
  }
  const value = el => el?.type==='checkbox' ? String(el.checked) : el?.type==='radio' ? radioGroup(el).find(item=>item.checked)?.value || '' : rich(el) ? el.textContent : el.value;
  const empty = el => el?.type==='checkbox' ? !el.checked : value(el)==='';
  const optionLabel = el => el.getAttribute('aria-label') || Array.from(el.labels || [],label=>label.textContent.trim()).join(' ') || el.value;
  function describe(el, associations = {}) {
    const labelIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
    const hints = [el.name, el.id, el.getAttribute('aria-label'), ...labelIds.map(id => el.getRootNode().getElementById?.(id)?.textContent), el.placeholder,
      ...(el.getAttribute('autocomplete') || '').split(' '), ...Array.from(el.labels || [], label => label.textContent.trim())].filter(Boolean);
    const type = rich(el) ? 'contenteditable' : el.type;
    const identity = type==='checkbox' ? JSON.stringify([el.name||'',el.id||'',el.getAttribute('value')||'',...(el.id && el.getRootNode().querySelectorAll('#'+CSS.escape(el.id)).length===1 ? [] : locator(el))]) : el.name || el.id || hints.join('|');
    const signature = JSON.stringify([location.origin, location.pathname, el.form?.id || el.form?.name || '', identity, type]);
    return {hints, signature, type, associatedKey:associations[signature], options:el.type==='radio' ? radioGroup(el).map(item=>({value:item.value,label:optionLabel(item),disabled:!editable(item)})) : el instanceof HTMLSelectElement ? Array.from(el.options, o => ({value:o.value,label:o.label,disabled:o.disabled || o.parentElement?.disabled})) : undefined};
  }
  function snapshot(el) {
    return {el, value:value(el), html:rich(el) ? el.innerHTML : null, nodes:rich(el) ? Array.from(el.childNodes, n => n.cloneNode(true)) : null, selected:el instanceof HTMLSelectElement ? Array.from(el.options, o => o.selected) : null, checked:el.type==='checkbox' ? el.checked : null, indeterminate:el.type==='checkbox' ? el.indeterminate : null, group:el.type==='radio' ? radioGroup(el).map(item=>({el:item,checked:item.checked,value:item.value})) : null};
  }
  function emit(el) {
    el.dispatchEvent(checkable(el) ? new Event('input',{bubbles:true,composed:true}) : new InputEvent('input',{bubbles:true,composed:true,inputType:'insertReplacementText',data:null}));
    el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
  }
  const setChecked = (el,checked) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked').set.call(el,checked);
  function matchesSnapshot(el, state) {
    if (!state) return false;
    if (state.group) {
      const current=radioGroup(el);
      return current.length===state.group.length && current.every((item,index)=>item===state.group[index].el && item.checked===state.group[index].checked && item.value===state.group[index].value);
    }
    if (el.type==='checkbox') return el.checked===state.checked && el.indeterminate===state.indeterminate;
    if (rich(el)) return el.innerHTML===state.html;
    if (el instanceof HTMLSelectElement) return JSON.stringify(Array.from(el.options,o=>o.selected))===JSON.stringify(state.selected);
    return value(el)===state.value;
  }
  function writeResult(el, text) {
    if (!el?.isConnected) return {ok:false,code:'fieldRemoved'};
    if (!editable(el)) return {ok:false,code:'fieldReadOnly'};
    if (!QuickfillCore.compatible(describe(el),text)) return {ok:false,code:'incompatibleValue'};
    // Native number controls reject a leading plus and surrounding whitespace.
    // Keep the remaining decimal text intact to avoid precision or formatting loss.
    if(el.type==='number')text=text.trim().replace(/^\+/,'');
    const option = el instanceof HTMLSelectElement ? Array.from(el.options).find(o => !o.disabled && !o.parentElement?.disabled && (o.value === text || QuickfillCore.normalize(o.label) === QuickfillCore.normalize(text))) : null;
    const radio = el.type==='radio' && text!=='' ? radioGroup(el).find(item=>editable(item) && (item.value===text || QuickfillCore.normalize(optionLabel(item))===QuickfillCore.normalize(text))) : null;
    const recipient=radio || el, before=snapshot(el);
    if (!recipient.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,composed:true,cancelable:true,inputType:'insertReplacementText',data:text}))) return {ok:false,code:'inputCancelled'};
    if(!el.isConnected || !recipient.isConnected)return {ok:false,code:'fieldRemoved'};
    if(!editable(el) || !editable(recipient))return {ok:false,code:'fieldReadOnly'};
    if(!matchesSnapshot(el,before))return {ok:false,code:'fieldChanged'};
    if (el.type==='checkbox') {setChecked(el,text.trim()==='true');el.indeterminate=false;}
    else if (el.type==='radio') {if(radio)setChecked(radio,true);else radioGroup(el).forEach(item=>setChecked(item,false));}
    else if (rich(el)) el.textContent = text;
    else {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, option ? option.value : text);
      if (el.value === '' && text !== '' && !option) {Object.getOwnPropertyDescriptor(proto,'value').set.call(el,before.value); return {ok:false,code:'rejectedValue'};}
    }
    const expected=snapshot(el);emit(recipient);
    if(!el.isConnected || !recipient.isConnected)return {ok:false,code:'fieldRemoved'};
    if(!matchesSnapshot(el,expected))return {ok:false,code:'fieldOverridden'};
    return {ok:true};
  }
  const write=(el,text)=>writeResult(el,text).ok;
  const unchanged = state => matchesSnapshot(state.el, state.after);
  function restore(state) {
    const {el} = state;
    if (!el.isConnected || !editable(el) || !unchanged(state)) return false;
    const recipient=state.group?.find(item=>item.checked)?.el || el;
    if(!recipient.isConnected || !editable(recipient))return false;
    if (!recipient.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,composed:true,cancelable:true,inputType:'historyUndo'}))) return false;
    if (!el.isConnected || !recipient.isConnected || !editable(el) || !editable(recipient) || !unchanged(state)) return false;
    if (state.group) {
      // Clear first: restoring a selected member must not be undone by later rows.
      state.group.forEach(item=>setChecked(item.el,false));
      state.group.filter(item=>item.checked).forEach(item=>setChecked(item.el,true));
    } else if (el.type==='checkbox') {setChecked(el,state.checked);el.indeterminate=state.indeterminate;}
    else if (state.nodes) el.replaceChildren(...state.nodes.map(n=>n.cloneNode(true)));
    else if (state.selected) Array.from(el.options).forEach((o,i)=>{o.selected=!!state.selected[i];});
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,state.value);
    }
    emit(recipient); return el.isConnected && recipient.isConnected && matchesSnapshot(el,state);
  }
  function collect(scope = document) {
    const found = [], seenRadios = new Set();
    const visible = el => editable(el) && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    for (const el of scope.querySelectorAll('*')) {
      if (['quickfill-sidebar','quickfill-tools'].includes(el.localName)) continue;
      if (visible(el)) {
        if(el.type==='radio') {
          if(!seenRadios.has(el)) {radioGroup(el).forEach(item=>seenRadios.add(item));found.push(el);}
        } else found.push(el);
      }
      if (el.shadowRoot) found.push(...collect(el.shadowRoot));
    }
    return found;
  }
  function locator(el) {
    const parts=[];
    while(el && el.nodeType===1) {
      const scope=el.getRootNode();let selector='';let current=el;
      while(current && current.nodeType===1) {
        const unique=current.id ? '#'+CSS.escape(current.id) : '';
        if(unique && scope.querySelectorAll(unique).length===1) {selector=unique+(selector?' > '+selector:'');break;}
        const siblings=Array.from(current.parentElement?.children || scope.children || []).filter(x=>x.localName===current.localName);
        const part=current.localName+':nth-of-type('+(siblings.indexOf(current)+1)+')';
        selector=part+(selector?' > '+selector:'');current=current.parentElement;
      }
      parts.unshift(selector);el=scope.host;
    }
    return parts;
  }
  function locate(parts) {
    let scope=document,found;
    try {for(let i=0;i<parts.length;i++){const matches=scope.querySelectorAll(parts[i]);if(matches.length!==1)return null;found=matches[0];if(i<parts.length-1){scope=found.shadowRoot;if(!scope)return null;}}}catch{return null;}
    return found;
  }
  root.QuickfillFields = {editable, supported, value, empty, describe, snapshot, matchesSnapshot, write, writeResult, restore, collect, locator, locate};
})(globalThis);
