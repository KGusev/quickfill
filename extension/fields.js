(function(root) {
  const rich = el => el instanceof HTMLElement && el.isContentEditable && !el.parentElement?.isContentEditable;
  const supported = el => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || rich(el) || (el instanceof HTMLInputElement && ['text','email','tel','url','number','search','date','datetime-local','time','month','week','password'].includes(el.type));
  const editable = el => supported(el) && !el.matches(':disabled') && !el.readOnly && el.getAttribute('aria-readonly') !== 'true' && !el.closest('[inert]');
  const value = el => rich(el) ? el.textContent : el.value;
  function describe(el, associations = {}) {
    const labelIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
    const hints = [el.name, el.id, el.getAttribute('aria-label'), ...labelIds.map(id => el.getRootNode().getElementById?.(id)?.textContent), el.placeholder,
      ...(el.getAttribute('autocomplete') || '').split(' '), ...Array.from(el.labels || [], label => label.textContent.trim())].filter(Boolean);
    const type = rich(el) ? 'contenteditable' : el.type;
    const signature = JSON.stringify([location.origin, location.pathname, el.form?.id || el.form?.name || '', el.name || el.id || hints.join('|'), type]);
    return {hints, signature, type, associatedKey:associations[signature], options:el instanceof HTMLSelectElement ? Array.from(el.options, o => ({value:o.value,label:o.label,disabled:o.disabled || o.parentElement?.disabled})) : undefined};
  }
  function snapshot(el) {
    return {el, value:value(el), html:rich(el) ? el.innerHTML : null, nodes:rich(el) ? Array.from(el.childNodes, n => n.cloneNode(true)) : null, selected:el instanceof HTMLSelectElement ? Array.from(el.options, o => o.selected) : null};
  }
  function emit(el) {
    el.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertReplacementText',data:null}));
    el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
  }
  function writeResult(el, text) {
    if (!el?.isConnected) return {ok:false,code:'fieldRemoved'};
    if (!editable(el)) return {ok:false,code:'fieldReadOnly'};
    if (!QuickfillCore.compatible(describe(el),text)) return {ok:false,code:'incompatibleValue'};
    const option = el instanceof HTMLSelectElement ? Array.from(el.options).find(o => !o.disabled && !o.parentElement?.disabled && (o.value === text || QuickfillCore.normalize(o.label) === QuickfillCore.normalize(text))) : null;
    const before = snapshot(el);
    if (!el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,composed:true,cancelable:true,inputType:'insertReplacementText',data:text}))) return {ok:false,code:'inputCancelled'};
    if(!el.isConnected)return {ok:false,code:'fieldRemoved'};
    if (rich(el)) el.textContent = text;
    else {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, option ? option.value : text);
      if (el.value === '' && text !== '' && !option) {Object.getOwnPropertyDescriptor(proto,'value').set.call(el,before.value); return {ok:false,code:'rejectedValue'};}
    }
    const expected=value(el);emit(el);
    if(!el.isConnected)return {ok:false,code:'fieldRemoved'};
    if(value(el)!==expected)return {ok:false,code:'fieldOverridden'};
    return {ok:true};
  }
  const write=(el,text)=>writeResult(el,text).ok;
  const unchanged = state => rich(state.el) ? state.el.innerHTML === state.after.html : state.el instanceof HTMLSelectElement ? JSON.stringify(Array.from(state.el.options,o=>o.selected)) === JSON.stringify(state.after.selected) : value(state.el) === state.after.value;
  function restore(state) {
    const {el} = state;
    if (!el.isConnected || !editable(el) || !unchanged(state)) return false;
    if (!el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,composed:true,cancelable:true,inputType:'historyUndo'}))) return false;
    if (state.nodes) el.replaceChildren(...state.nodes.map(n=>n.cloneNode(true)));
    else if (state.selected) Array.from(el.options).forEach((o,i)=>{o.selected=!!state.selected[i];});
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,state.value);
    }
    emit(el); return true;
  }
  function collect(scope = document) {
    const found = [];
    for (const el of scope.querySelectorAll('*')) {
      if (['quickfill-sidebar','quickfill-tools'].includes(el.localName)) continue;
      if (editable(el) && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden') found.push(el);
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
  root.QuickfillFields = {editable, supported, value, describe, snapshot, write, writeResult, restore, collect, locator, locate};
})(globalThis);
