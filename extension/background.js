importScripts('core.js', 'registry.js', 'power.js');
const initial = () => ({entries: [], associations: {}, language:'auto', mappings:{},preferences:{},counters:{},onboardingDone:false});
const read = async () => ({...initial(), ...(await chrome.storage.local.get('registry')).registry});
const catalogs = Promise.all(['en','ru'].map(async language => [language, await (await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`))).json()])).then(Object.fromEntries);
const locale = data => data.language && data.language !== 'auto' ? data.language : (chrome.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en');
const messages = async data => (await catalogs)[locale(data)];
let pending = Promise.resolve();
async function refreshMenus() {
  const catalog = await messages(await read());
  const t = key => QuickfillCore.formatMessage(catalog, key);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id:'fill', title:t('menuFill'), contexts:['editable','page']});
  chrome.contextMenus.create({id:'save', title:t('menuSave'), contexts:['editable','page']});
  await chrome.action.setTitle({title:t('toggleSidebar')});
}
chrome.runtime.onInstalled.addListener(refreshMenus);
chrome.runtime.onStartup.addListener(refreshMenus);
const send = (tabId, message, frameId = 0) => chrome.tabs.sendMessage(tabId, message, {frameId}).catch(() => {});
chrome.contextMenus.onClicked.addListener((info, tab) => {if (tab?.id) send(tab.id, {type:info.menuItemId}, info.frameId || 0);});
chrome.action.onClicked.addListener(tab => send(tab.id, {type:'toggle'}));
chrome.commands.onCommand.addListener(async command => {
  if (!['toggle-sidebar','command-palette'].includes(command)) return;
  const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
  if (tab?.id) send(tab.id, {type:command==='command-palette'?'palette':'toggle'});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'bootstrap') {
    read().then(async data => respond({data, locale:locale(data), messages:await messages(data)})); return true;
  }
  if (message.type !== 'mutate') return;
  pending = pending.catch(() => {}).then(async () => {
    let data = await read();
    const t = key => QuickfillCore.formatMessage(catalog, key);
    const catalog = await messages(data);
    const find = () => {const entry = data.entries.find(e => e.id === message.id); if (!entry) throw new Error(t('entryMissing')); return entry;};
    try {
      if (message.action === 'upsert') {
        const entry = QuickfillRegistry.entry(message.entry);
        const index = data.entries.findIndex(item => item.id === entry.id);
        if (index < 0) {if (data.entries.length >= 500) throw new Error('invalidImport'); data.entries.push(entry);} else data.entries[index] = entry;
      } else if (message.action === 'delete') data.entries = data.entries.filter(entry => entry.id !== message.id);
      else if (message.action === 'flags') {
        const entry = find();
        for (const key of ['pinned','collapsed']) if (typeof message[key] === 'boolean') entry[key] = message[key];
      } else if (message.action === 'save-field') {
        const entry = find();
        if (!message.key?.trim()) throw new Error(t('keyRequired'));
        const updated = QuickfillRegistry.entry({...entry, values:{...entry.values, [message.key]:String(message.value)}});
        Object.assign(entry, updated);
        data.associations = {...data.associations, [message.signature]:message.key};
      } else if (message.action === 'associate') {
        if (message.key) data.associations = {...data.associations, [message.signature]:message.key};
        else delete data.associations[message.signature];
      } else if(message.action === 'mapping') {
        data.mappings={...data.mappings,...QuickfillRegistry.mappings({[message.scope]:message.rules})};
      } else if(message.action === 'preferences') {
        data.preferences={...data.preferences,[message.origin]:QuickfillRegistry.settings(message.preferences)};
      } else if(message.action === 'onboarding') {
        data.onboardingDone=true;
      } else if(message.action === 'reserve') {
        const entry=find();const counter=(data.counters[entry.id] || 0)+1;
        if(!Number.isSafeInteger(counter))throw new Error(t('invalidImport'));
        data.counters={...data.counters,[entry.id]:counter};
      } else if (message.action === 'language') {
        if (!['auto','en','ru'].includes(message.language)) throw new Error(t('unknownAction'));
        data.language = message.language;
      } else if (message.action === 'import') data = QuickfillRegistry.merge(data, message.bundle, message.strategy);
      else throw new Error(t('unknownAction'));
    } catch(error) {if (error.message === 'invalidImport') throw new Error(t('invalidImport')); throw error;}
    await chrome.storage.local.set({registry:data});
    if (message.action === 'language') await refreshMenus();
    return data;
  });
  pending.then(data => respond({data}), error => respond({error:error.message})); return true;
});
