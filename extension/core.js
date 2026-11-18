/* Shared pure matching logic, also exercised by Node tests. */
(function (root) {
  const normalize = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const groups = [
    ['email', 'e mail', 'email address', 'электронная почта', 'почта', 'адрес электронной почты'], ['tel', 'phone', 'telephone', 'phone number', 'телефон', 'номер телефона'],
    ['given name', 'first name', 'firstname', 'имя'], ['family name', 'last name', 'surname', 'фамилия'],
    ['name', 'full name', 'fullname', 'полное имя', 'фио'], ['organization', 'company', 'company name', 'компания', 'организация'],
    ['postal code', 'zip', 'zip code', 'индекс', 'почтовый индекс'], ['street address', 'address', 'адрес'], ['url', 'website', 'сайт'], ['country', 'страна'], ['notes', 'заметки', 'примечание']
  ];
  const canonical = value => { const n = normalize(value); return groups.find(g => g.includes(n))?.[0] || n; };
  function compatible(field, value) {
    if (field.type === 'checkbox') return typeof value==='string' && ['true','false'].includes(value.trim());
    if (field.type === 'radio' && value === '') return true;
    if (field.options) return field.options.some(o => !o.disabled && (o.value === value || normalize(o.label) === normalize(value)));
    if (field.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (field.type === 'number') return value.trim() !== '' && Number.isFinite(Number(value));
    if (field.type === 'url') { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } }
    if (field.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value);
    return true;
  }
  function suggestions(entries, field) {
    const hints = field.hints.map(canonical).filter(Boolean);
    return entries.flatMap(entry => Object.entries(entry.values).filter(([key, value]) =>
      compatible(field, value) && (key === field.associatedKey || hints.includes(canonical(key)))
    ).map(([key, value]) => ({entry, key, value, reason:key === field.associatedKey ? 'association' : 'hint', hint:field.hints.find(h => canonical(h) === canonical(key)) || key}))).sort((a,b) => Number(b.key === field.associatedKey) - Number(a.key === field.associatedKey));
  }
  const relevant = (entry, origin) => !entry.sites?.length || entry.sites.includes(origin);
  const ordered = (entries, origin) => [...entries].sort((a,b) => Number(!!b.pinned) - Number(!!a.pinned) || Number(!!b.sites?.includes(origin)) - Number(!!a.sites?.includes(origin)) || a.name.localeCompare(b.name));
  function formatMessage(catalog, key, substitutions = []) {
    const entry = catalog[key];
    if (!entry) return key;
    const args = Array.isArray(substitutions) ? substitutions : [substitutions];
    return entry.message.replace(/\$(\w+)\$/g, (_, name) => {
      const content = entry.placeholders?.[name.toLowerCase()]?.content || '';
      return content.replace(/\$(\d)/g, (_, n) => String(args[Number(n)-1] ?? ''));
    });
  }
  function uuid() {
    if(root.crypto.randomUUID)return root.crypto.randomUUID();
    const bytes=root.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  const api = {relevant, ordered, formatMessage, normalize, canonical, compatible, suggestions, uuid};
  root.QuickfillCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
