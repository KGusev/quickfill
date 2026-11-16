const t = key => chrome.i18n.getMessage(key);
const initial = () => ({entries: [], associations: {}});
const read = async () => (await chrome.storage.local.get('registry')).registry || initial();
let pending = Promise.resolve();
function refreshMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({id: 'fill', title: t('menuFill'), contexts: ['editable']});
    chrome.contextMenus.create({id: 'save', title: t('menuSave'), contexts: ['editable']});
  });
}
chrome.runtime.onInstalled.addListener(refreshMenus);
chrome.runtime.onStartup.addListener(refreshMenus);
const send = (tabId, message, frameId = 0) => chrome.tabs.sendMessage(tabId, message, {frameId}).catch(() => {});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id) send(tab.id, {type: info.menuItemId}, info.frameId || 0);
});
chrome.action.onClicked.addListener(tab => send(tab.id, {type: 'toggle'}));
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-sidebar') return;
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (tab?.id) send(tab.id, {type: 'toggle'});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'mutate') return;
  pending = pending.catch(() => {}).then(async () => {
    const data = await read();
    if (message.action === 'upsert') {
      const entry = message.entry;
      if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || !/^#[0-9a-f]{6}$/i.test(entry.color) || !entry.values || Object.values(entry.values).some(v => typeof v !== 'string')) throw new Error(t('invalidEntry'));
      const index = data.entries.findIndex(item => item.id === entry.id);
      if (index < 0) data.entries.push(entry); else data.entries[index] = entry;
    } else if (message.action === 'delete') {
      data.entries = data.entries.filter(entry => entry.id !== message.id);
    } else if (message.action === 'save-field') {
      const entry = data.entries.find(entry => entry.id === message.id);
      if (!entry) throw new Error(t('entryMissing'));
      if (!message.key?.trim()) throw new Error(t('keyRequired'));
      Object.defineProperty(entry.values, message.key, {value: String(message.value), enumerable: true, configurable: true, writable: true});
      data.associations[message.signature] = message.key;
    } else throw new Error(t('unknownAction'));
    await chrome.storage.local.set({registry: data});
    return data;
  });
  pending.then(data => respond({data}), error => respond({error: error.message}));
  return true;
});
