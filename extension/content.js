(() => {
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
  const core = globalThis.QuickfillCore;
  let data = {entries: [], associations: {}}, target = null, visible = false, mode = 'registry', query = '';
  let host, shadow, main, status, search;
  const supported = element => element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && ['text','email','tel','url','number','search','date','datetime-local','time','month','week','password'].includes(element.type));
  const editable = element => supported(element) && !element.disabled && !element.readOnly;
  function node(tag, attrs = {}, text) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value);
    }
    if (text !== undefined) el.textContent = text;
    return el;
  }
  const button = (text, handler, className = '') => node('button', {type:'button', class:className, onclick:handler}, text);
  function describe() {
    if (!target) return null;
    const hints = [target.name, target.id, target.getAttribute('aria-label'), target.placeholder,
      ...(target.getAttribute('autocomplete') || '').split(' '), ...Array.from(target.labels || [], label => label.textContent.trim())].filter(Boolean);
    // URL path keeps same-named fields on unrelated forms separate; values never enter the signature.
    const signature = JSON.stringify([location.origin, location.pathname, target.form?.id || target.form?.name || '', target.name || target.id || hints.join('|'), target.type]);
    return {hints, signature, type:target.type, associatedKey:data.associations[signature]};
  }
  function notify(text) { if (status) status.textContent = text; }
  async function mutate(payload) {
    const response = await chrome.runtime.sendMessage({type:'mutate', ...payload});
    if (response.error) throw new Error(response.error);
    data = response.data;
  }
  function mount() {
    if (host) return;
    host = document.createElement('quickfill-sidebar');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0 0 auto auto!important;z-index:2147483647!important;';
    shadow = host.attachShadow({mode:'open'});
    shadow.append(node('style', {}, globalThis.QuickfillStyles));
    const panel = node('aside', {class:'panel', lang:chrome.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en', 'aria-label':t('registryLabel')});
    const header = node('header');
    header.append(node('div', {class:'badge'}, t('badge')));
    const top = node('div', {class:'top'});
    top.append(node('h1', {}, t('savedEntries')), button('×', () => toggle(false), 'quiet'));
    top.lastChild.setAttribute('aria-label', t('closeSidebar'));
    header.append(top, node('p', {class:'hint'}, t('tagline')));
    search = node('input', {class:'search', type:'search', placeholder:t('searchPlaceholder'), 'aria-label':t('searchLabel'), oninput:() => {query = search.value; mode = 'registry'; render();}});
    header.append(search);
    main = node('main');
    const footer = node('footer');
    footer.append(node('span', {}, t('footerHint')));
    status = node('div', {class:'status', role:'status', 'aria-live':'polite'});
    footer.append(status); panel.append(header, main, footer); shadow.append(panel);
    document.documentElement.append(host);
  }
  function toggle(force) {
    mount(); visible = force ?? !visible; host.style.setProperty('display', visible ? 'block' : 'none', 'important');
    if (!visible) {
      mode = 'registry';
      query = '';
      search.value = '';
      main.replaceChildren();
      notify('');
    }
    if (visible) render();
  }
  function fill(value) {
    if (!target?.isConnected || !editable(target)) {notify(t('selectField')); return false;}
    if (!core.compatible(describe(), value)) {notify(t('incompatibleValue')); return false;}
    const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, value);
    if (target.value !== value && target.value === '') {notify(t('rejectedValue')); return false;}
    target.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
    target.dispatchEvent(new Event('change', {bubbles:true, composed:true}));
    target.focus(); notify(t('fieldFilled')); return true;
  }
  function valueButton(entry, key, value) {
    const b = button('', () => fill(value), 'value');
    b.draggable = true; b.setAttribute('aria-label', `${key}: ${value}`);
    b.append(node('small', {}, key), node('span', {}, value || t('emptyValue')));
    b.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', value);
      event.dataTransfer.setData('application/x-quickfill', value);
      event.dataTransfer.effectAllowed = 'copy';
    });
    return b;
  }
  function card(entry, pairs = Object.entries(entry.values), edit = true) {
    const article = node('article'); article.style.setProperty('--entry-color', /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : '#315de4');
    const row = node('div', {class:'row'}); row.append(node('h2', {}, entry.name));
    if (edit) row.append(button(t('edit'), () => editor(entry), 'quiet'));
    article.append(row);
    for (const [key,value] of pairs) article.append(valueButton(entry, key, value));
    if (!pairs.length) article.append(node('p', {class:'hint'}, t('noValues')));
    return article;
  }
  function render() {
    if (!visible || mode === 'editor' || mode === 'save') return;
    main.replaceChildren();
    const toolbar = node('div', {class:'row'});
    toolbar.append(node('span', {class:'count'}, t('entryCount', String(data.entries.length))), button(t('newEntryButton'), () => editor(), 'primary'));
    main.append(toolbar);
    if (mode === 'fill' && target) {
      main.append(node('h2', {class:'section'}, t('suggestedValues')));
      const matches = core.suggestions(data.entries, describe());
      for (const match of matches) main.append(card(match.entry, [[match.key, match.value]], false));
      if (!matches.length) main.append(node('p', {}, t('noMatchingKeys')));
      main.append(node('h2', {class:'section'}, t('allEntries')));
    }
    const q = query.toLowerCase();
    const entries = data.entries.filter(entry => [entry.name, ...Object.entries(entry.values).flat()].some(v => v.toLowerCase().includes(q)));
    entries.forEach(entry => main.append(card(entry)));
    if (!entries.length) {
      const empty = node('div', {class:'empty'});
      empty.append(node('strong', {}, q ? t('noMatchingEntries') : t('emptyTitle')), node('p', {}, q ? t('tryAnotherSearch') : t('emptyDescription')));
      main.append(empty);
    }
  }
  function labeled(form, title, input) {
    const id = `qf-${crypto.randomUUID()}`; input.id = id;
    form.append(node('label', {for:id}, title), input); return input;
  }
  function editor(existing) {
    mode = 'editor'; main.replaceChildren();
    main.append(node('h2', {}, existing ? t('editEntry') : t('newEntry')));
    const form = node('form');
    const name = labeled(form, t('entryName'), node('input', {required:'', placeholder:t('entryNamePlaceholder'), maxlength:'100'})); name.value = existing?.name || '';
    const color = labeled(form, t('entryColor'), node('input', {type:'color'})); color.value = existing?.color || '#5375ed';
    const pairs = node('div'); form.append(pairs);
    function addPair(key = '', value = '') {
      const pair = node('div', {class:'pair'});
      const k = labeled(pair, t('key'), node('input', {required:'', placeholder:'email'})); k.value = key;
      const v = labeled(pair, t('value'), node('textarea', {placeholder:'alex@example.com'})); v.value = value;
      pair.append(button(t('removeValue'), () => pair.remove(), 'quiet danger')); pairs.append(pair);
    }
    if (existing) Object.entries(existing.values).forEach(([k,v]) => addPair(k,v)); else addPair();
    form.append(button(t('addValue'), () => addPair(), 'quiet'));
    const actions = node('div', {class:'actions'});
    actions.append(node('button', {type:'submit', class:'primary'}, t('saveEntry')), button(t('cancel'), back));
    if (existing) actions.append(button(t('deleteEntry'), async () => {
      if (!confirm(t('confirmDelete', existing.name))) return;
      try {await mutate({action:'delete', id:existing.id}); back(); notify(t('entryDeleted'));} catch(e) {notify(e.message);}
    }, 'danger'));
    form.append(actions); main.append(form); name.focus();
    form.addEventListener('submit', async event => {
      event.preventDefault(); const values = Object.create(null);
      for (const pair of pairs.children) {
        const key = pair.querySelector('input').value.trim();
        if (!key || Object.hasOwn(values, key)) {notify(t('uniqueKeyRequired')); return;}
        values[key] = pair.querySelector('textarea').value;
      }
      if (!name.value.trim()) {notify(t('entryNameRequired')); return;}
      try {await mutate({action:'upsert', entry:{id:existing?.id || crypto.randomUUID(), name:name.value.trim(), color:color.value, values}}); back(); notify(t('entrySaved'));} catch(e) {notify(e.message);}
    });
  }
  function back() {mode = 'registry'; render();}
  function saveField() {
    toggle(true);
    if (!target || !editable(target)) {notify(t('chooseInput')); return;}
    mode = 'save'; main.replaceChildren(); main.append(node('h2', {}, t('keepField')));
    if (!data.entries.length) {
      main.append(node('p', {}, t('createEntryFirst')), button(t('newEntryButton'), () => editor(), 'primary')); return;
    }
    const field = describe(), form = node('form');
    const select = labeled(form, t('saveToEntry'), node('select'));
    data.entries.forEach(entry => select.append(node('option', {value:entry.id}, entry.name)));
    const key = labeled(form, t('associatedKey'), node('input', {required:''})); key.value = field.associatedKey || core.canonical(field.hints[0]) || 'value';
    const value = labeled(form, t('value'), node('textarea')); value.value = target.value;
    form.append(node('p', {class:'hint'}, t('saveFieldHint')));
    const actions = node('div', {class:'actions'}); actions.append(node('button', {class:'primary', type:'submit'}, t('saveValue')), button(t('cancel'), back)); form.append(actions); main.append(form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {await mutate({action:'save-field', id:select.value, key:key.value.trim(), value:value.value, signature:field.signature}); back(); notify(t('fieldSaved'));} catch(e) {notify(e.message);}
    });
  }
  const pageField = event => event.composedPath().find(editable);
  document.addEventListener('focusin', event => {if (event.composedPath().includes(host)) return; const field = pageField(event); if (field) target = field;}, true);
  document.addEventListener('contextmenu', event => {if (!event.composedPath().includes(host)) target = pageField(event) || null;}, true);
  document.addEventListener('dragover', event => {
    if (pageField(event) && event.dataTransfer.types.includes('application/x-quickfill')) {event.preventDefault(); event.dataTransfer.dropEffect = 'copy';}
  }, true);
  document.addEventListener('drop', event => {
    const field = pageField(event);
    if (!field || !event.dataTransfer.types.includes('application/x-quickfill')) return;
    event.preventDefault(); event.stopPropagation(); target = field; fill(event.dataTransfer.getData('application/x-quickfill'));
  }, true);
  document.addEventListener('keydown', event => {
    // Commands API owns Ctrl+B; avoid a second toggle from a page key handler.
    if (event.key === 'Escape' && visible) toggle(false);
  }, true);
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'toggle') toggle();
    if (message.type === 'fill') {mode = 'fill'; query = ''; if (search) search.value = ''; toggle(true);}
    if (message.type === 'save') saveField();
  });
  chrome.storage.onChanged.addListener((changes, area) => {if (area === 'local' && changes.registry) {data = changes.registry.newValue || {entries:[], associations:{}}; render();}});
  chrome.storage.local.get('registry').then(result => {if (result.registry) data = result.registry; render();});
})();
