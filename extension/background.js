importScripts('core.js', 'types.js', 'registry.js', 'power.js');
const initial = () => ({entries: [], associations: {}, language:'auto', mappings:{},preferences:{},globalPreferences:QuickfillRegistry.globalSettings(),counters:{},onboardingDone:false});
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
const recovering = new Map();
async function contentReady(tabId, frameId) {
  const result = await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},world:'ISOLATED',func:async () => {
    if(!['http:','https:','file:'].includes(location.protocol))throw new Error('Unsupported page');
    if(!globalThis.QuickfillReady)return false;
    let timer;
    try {
      await Promise.race([globalThis.QuickfillReady,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Quickfill startup timed out')),5000);})]);
      return true;
    } finally {clearTimeout(timer);}
  }});
  return result.some(item=>item.frameId===frameId&&item.result===true);
}
async function recoverContent(tabId, frameId) {
  const key=tabId+':'+frameId;
  if(!recovering.has(key)) {
    const recovery=(async()=>{
      // An initial bootstrap may already be running before its listener is ready.
      if(await contentReady(tabId,frameId))return;
      const files=chrome.runtime.getManifest().content_scripts[0].js;
      await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},world:'ISOLATED',files});
      if(!await contentReady(tabId,frameId))throw new Error('Quickfill did not initialize');
    })();
    recovering.set(key,recovery);
    recovery.finally(()=>{if(recovering.get(key)===recovery)recovering.delete(key);}).catch(()=>{});
  }
  return recovering.get(key);
}
async function actionFeedback(tabId, failed) {
  let title=failed?'Quickfill could not open on this page. Reload the page and try again.':'Toggle Quickfill sidebar';
  try {const catalog=await messages(await read());title=QuickfillCore.formatMessage(catalog,failed?'sidebarUnavailable':'toggleSidebar');}catch{}
  await Promise.allSettled([
    chrome.action.setBadgeText({tabId,text:failed?'!':''}),
    chrome.action.setTitle({tabId,title}),
    ...(failed?[chrome.action.setBadgeBackgroundColor({tabId,color:'#ae243f'})]:[])
  ]);
}
async function send(tabId, message, frameId = 0) {
  try {
    try {await chrome.tabs.sendMessage(tabId,message,{frameId});}
    catch(error) {
      // A closed response port can follow an already-handled action: never replay it.
      if(!/Receiving end does not exist/i.test(error.message||''))throw error;
      await recoverContent(tabId,frameId);
      await chrome.tabs.sendMessage(tabId,message,{frameId});
    }
    await actionFeedback(tabId,false);return true;
  } catch(error) {await actionFeedback(tabId,true);return false;}
}
async function dispatch(tab, message, frameId = 0) {
  if(!tab?.id)return false;
  if(tab.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('options.html'))return send(tab.id,message,frameId);
  try {
    const response=await chrome.runtime.sendMessage({type:'manager-command',tabId:tab.id,command:message.type});
    if(!response?.ok)throw new Error('Quickfill settings did not respond');
    await actionFeedback(tab.id,false);return true;
  } catch(error) {await actionFeedback(tab.id,true);return false;}
}
chrome.contextMenus.onClicked.addListener((info, tab) => {if (tab?.id)return dispatch(tab, {type:info.menuItemId}, info.frameId || 0);});
chrome.action.onClicked.addListener(tab => dispatch(tab, {type:'toggle'}));
chrome.commands.onCommand.addListener(async (command, currentTab) => {
  if (!['toggle-sidebar','command-palette'].includes(command)) return;
  const tab=currentTab?.id?currentTab:(await chrome.tabs.query({active:true, currentWindow:true}))[0];
  if (tab?.id)return dispatch(tab, {type:command==='command-palette'?'palette':'toggle'});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'open-options') {
    Promise.resolve().then(()=>chrome.runtime.openOptionsPage()).then(
      ()=>respond({ok:true}),
      error=>respond({error:error?.message || 'Could not open Quickfill settings'})
    );
    return true;
  }
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
        const updated = QuickfillRegistry.entry({...entry, values:{...entry.values, [message.key]:String(message.value)},types:{...entry.types,[message.key]:message.valueType??(Object.hasOwn(entry.types||{},message.key)?entry.types[message.key]:'string')}});
        Object.assign(entry, updated);
        data.associations = {...data.associations, [message.signature]:message.key};
      } else if (message.action === 'save-fields') {
        if(!Array.isArray(message.fields)||!message.fields.length||message.fields.length>200)throw new Error('invalidImport');
        const index=data.entries.findIndex(entry=>entry.id===message.id);
        if(message.create ? index>=0||data.entries.length>=500 : index<0)throw new Error('invalidImport');
        const original=message.create?{id:message.id,name:message.name,color:'#a05dff',values:{}}:data.entries[index];
        const values={...original.values},types={...original.types},associations={...data.associations},transforms={...original.transforms},keys=new Set();
        for(const field of message.fields){
          if(!field||typeof field.key!=='string'||!field.key.trim()||keys.has(field.key)||typeof field.value!=='string'||typeof field.signature!=='string'||field.signature.length>5000)throw new Error('invalidImport');
          keys.add(field.key);Object.defineProperty(values,field.key,{value:field.value,writable:true,enumerable:true,configurable:true});
          Object.defineProperty(types,field.key,{value:field.valueType??'string',writable:true,enumerable:true,configurable:true});
          delete transforms[field.key];Object.defineProperty(associations,field.signature,{value:field.key,writable:true,enumerable:true,configurable:true});
        }
        const updated=QuickfillRegistry.entry({...original,values,types,transforms});
        if(message.create)data.entries.push(updated);else data.entries[index]=updated;
        data.associations=associations;
      } else if (message.action === 'associate') {
        if (message.key) data.associations = {...data.associations, [message.signature]:message.key};
        else delete data.associations[message.signature];
      } else if(message.action === 'mapping') {
        data.mappings={...data.mappings,...QuickfillRegistry.mappings({[message.scope]:message.rules})};
      } else if(message.action === 'preferences') {
        data.preferences={...data.preferences,[message.origin]:QuickfillRegistry.settings(message.preferences)};
      } else if(message.action === 'global-preferences') {
        data.globalPreferences=QuickfillRegistry.globalSettings(message.preferences);
      } else if(message.action === 'onboarding') {
        data.onboardingDone=true;
      } else if(message.action === 'reserve') {
        const entry=find();const counter=(Object.hasOwn(data.counters,entry.id) ? data.counters[entry.id] : 0)+1;
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
