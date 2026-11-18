/* Pure validation and import operations; no input objects are merged into prototypes. */
(function(root) {
  const typed = root.QuickfillTypes || (typeof require === 'function' ? require('./types.js') : null);
  const record = x => x && typeof x === 'object' && !Array.isArray(x);
  const fail = () => {throw new Error('invalidImport');};
  function sites(list = []) {
    if (!Array.isArray(list) || list.length > 100) fail();
    return [...new Set(list.map(site => {
      if (typeof site !== 'string') fail();
      let url; try {url = new URL(site);} catch {fail();}
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail();
      return url.origin;
    }))];
  }
  function transform(value = {type:'none'}) {
    if (!record(value) || !['none','trim','upper','lower','digits','format'].includes(value.type) || (value.format !== undefined && (typeof value.format !== 'string' || value.format.length > 500))) fail();
    return {type:value.type,format:value.format || ''};
  }
  function settings(value = {}) {
    if(!record(value))fail();
    const width=value.width ?? 380;
    const suggestions=value.suggestions ?? 'inherit';
    if(!Number.isInteger(width) || width<320 || width>640 || !['inherit','off','button','auto'].includes(suggestions))fail();
    if(typeof (value.preferredEntry ?? '')!=='string' || !Array.isArray(value.excluded ?? []) || (value.excluded ?? []).some(x=>typeof x!=='string'||x.length>5000))fail();
    return {width,suggestions:suggestions === 'auto' ? 'button' : suggestions,preferredEntry:value.preferredEntry || '',excluded:value.excluded || []};
  }
  function globalSettings(value = {}) {
    if(!record(value) || !['off','button'].includes(value.suggestions ?? 'button'))fail();
    return {suggestions:value.suggestions ?? 'button'};
  }
  function effectiveSettings(site = {}, global = {}) {
    const local=settings(site),defaults=globalSettings(global);
    return {...local,suggestions:local.suggestions === 'inherit' ? defaults.suggestions : local.suggestions};
  }
  function mappings(value = {}) {
    if(!record(value))fail();
    return Object.fromEntries(Object.entries(value).map(([key,rules])=>{
      if(key.length>5000 || !Array.isArray(rules) || rules.length>300)fail();
      return [key,rules.map(rule=>{
        if(!record(rule)||typeof rule.signature!=='string'||rule.signature.length>5000||typeof rule.key!=='string'||rule.key.length>200||!Array.isArray(rule.locator)||!rule.locator.length||rule.locator.length>20||rule.locator.some(x=>typeof x!=='string'||x.length>2000))fail();
        return {signature:rule.signature,key:rule.key,locator:rule.locator,transform:transform(rule.transform)};
      })];
    }));
  }
  function entry(item) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || item.id.length > 200 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || !/^#[0-9a-f]{6}$/i.test(item.color) || !record(item.values)) fail();
    const pairs = Object.entries(item.values);
    if (pairs.length > 200 || pairs.some(([k,v]) => !k.trim() || k.length > 200 || typeof v !== 'string' || v.length > 100000)) fail();
    const tags=item.tags ?? [];
    if(!Array.isArray(tags)||tags.length>30||tags.some(x=>typeof x!=='string'||!x.trim()||x.length>60)||typeof (item.collection ?? '')!=='string'||(item.collection ?? '').length>100)fail();
    const rules=item.transforms ?? {};if(!record(rules))fail();
    const transforms=Object.fromEntries(Object.entries(rules).filter(([key])=>Object.hasOwn(item.values,key)).map(([key,value])=>[key,transform(value)]));
    const valueTypes=item.types ?? {};if(!record(valueTypes))fail();
    const types=Object.fromEntries(Object.entries(valueTypes).filter(([key])=>Object.hasOwn(item.values,key)).map(([key,type])=>{if(!typed.names.includes(type))fail();const error=typed.validate(item.values[key],type);if(error)throw new Error(error);return [key,type];}));
    return {tags:[...new Set(tags.map(x=>x.trim()))],collection:item.collection || '',transforms,types,id:item.id, name:item.name.trim(), color:item.color, values:Object.fromEntries(pairs), sites:sites(item.sites), pinned:!!item.pinned, collapsed:!!item.collapsed};
  }
  function bundle(input) {
    if (!record(input) || input.version !== 1 || !Array.isArray(input.entries) || input.entries.length > 500 || new TextEncoder().encode(JSON.stringify(input)).length > 2000000) fail();
    const entries = input.entries.map(entry);
    if (new Set(entries.map(e => e.id)).size !== entries.length) fail();
    const associations = input.associations ?? {};
    if (!record(associations) || Object.entries(associations).some(([k,v]) => k.length > 5000 || typeof v !== 'string' || !v.trim() || v.length > 200)) fail();
    const preferences=input.preferences ?? {};if(!record(preferences))fail();
    return {version:1, entries, associations:Object.fromEntries(Object.entries(associations)), mappings:mappings(input.mappings), preferences:Object.fromEntries(Object.entries(preferences).map(([key,value])=>[key,settings(value)])),...(Object.hasOwn(input,'globalPreferences')?{globalPreferences:globalSettings(input.globalPreferences)}:{})};
  }
  function merge(data, incoming, strategy) {
    if (!['merge','replace','skip'].includes(strategy)) fail();
    const clean = bundle(incoming), entries = data.entries.map(e => ({...e}));
    for (const item of clean.entries) {
      const index = entries.findIndex(e => e.id === item.id);
      if (index < 0) entries.push(item);
      else if (strategy === 'replace') entries[index] = item;
      else if (strategy === 'merge') {
        const previous = entries[index];
        // A value and its transformation travel together. Preserve options on
        // retained keys, and let imported keys replace their previous options.
        const retainedTransforms = Object.fromEntries(Object.entries(previous.transforms || {}).filter(([key]) => !Object.hasOwn(item.values, key)));
        const retainedTypes = Object.fromEntries(Object.entries(previous.types || {}).filter(([key]) => !Object.hasOwn(item.values, key)));
        entries[index] = entry({...item, values:{...previous.values, ...item.values}, transforms:{...retainedTransforms, ...item.transforms}, types:{...retainedTypes,...item.types}});
      }
    }
    if (entries.length > 500) fail();
    const mergeMap=(current,incoming)=>strategy==='skip'?{...incoming,...current}:{...current,...incoming};
    const globalPreferences=Object.hasOwn(clean,'globalPreferences') && (strategy!=='skip'||!Object.hasOwn(data,'globalPreferences')) ? {globalPreferences:clean.globalPreferences} : {};
    return {...data, entries, ...globalPreferences, mappings:mergeMap(data.mappings,clean.mappings),preferences:mergeMap(data.preferences,clean.preferences), associations:strategy === 'skip' ? {...clean.associations, ...data.associations} : {...data.associations, ...clean.associations}};
  }
  const api = {entry, bundle, merge, sites, transform, settings, globalSettings, effectiveSettings, mappings}; root.QuickfillRegistry = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
