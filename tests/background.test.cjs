const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function worker(initialRegistry, {openOptionsPage=async()=>{}}={}) {
  let registry=structuredClone(initialRegistry), receive, writes=0;
  const listen = {addListener() {}};
  const context = {
    importScripts() {},
    QuickfillCore: require('../extension/core.js'),
    QuickfillRegistry: require('../extension/registry.js'),
    fetch: async () => ({json: async () => require('../extension/_locales/en/messages.json')}),
    chrome: {
      storage: {local: {
        get: async () => ({registry: structuredClone(registry)}),
        set: async value => {registry = structuredClone(value.registry);writes++;}
      }},
      runtime: {getURL: value => value, openOptionsPage, onInstalled: listen, onStartup: listen,
        onMessage: {addListener(listener) {receive = listener;}}},
      i18n: {getUILanguage: () => 'en'},
      contextMenus: {onClicked: listen},
      action: {onClicked: listen},
      commands: {onCommand: listen}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const send=message => new Promise(resolve => receive(message, {}, response=>resolve(structuredClone(response))));
  send.writes=()=>writes;
  send.read=async()=>(await send({type:'bootstrap'})).data;
  return send;
}

test('opening settings waits for the dedicated options tab and preserves saved data', async () => {
  const gate=deferred();let opens=0,finished=false;
  const registry={entries:[],associations:{},globalPreferences:{suggestions:'off'}};
  const send=worker(registry,{openOptionsPage:()=>{opens++;return gate.promise;}}),before=await send.read();
  const opening=send({type:'open-options'}).then(result=>{finished=true;return result;});
  await Promise.resolve();
  assert.equal(opens,1);assert.equal(finished,false);
  gate.resolve();assert.deepEqual(await opening,{ok:true});
  assert.equal(send.writes(),0);assert.deepEqual(await send.read(),before);
});

test('a failed options-tab request reports its error and can be retried', async () => {
  let attempts=0;
  const send=worker(undefined,{openOptionsPage:async()=>{if(++attempts===1)throw new Error('Could not open tab');}});
  assert.deepEqual(await send({type:'open-options'}),{error:'Could not open tab'});
  assert.deepEqual(await send({type:'open-options'}),{ok:true});
  assert.equal(send.writes(),0);
});

test('counter reservation treats prototype-looking entry IDs as stored keys', async () => {
  const send = worker();
  for (const id of ['constructor', '__proto__', 'toString', 'ordinary']) {
    const created = await send({type:'mutate', action:'upsert', entry:{id,name:id,color:'#315de4',values:{value:'{{counter}}'}}});
    assert.equal(created.error, undefined);
    const first = await send({type:'mutate', action:'reserve', id});
    assert.equal(first.error, undefined);
    assert.equal(first.data.counters[id], 1);
    const second = await send({type:'mutate', action:'reserve', id});
    assert.equal(second.data.counters[id], 2);
  }
});

const field=(key,value,valueType='string',signature='field:'+key)=>({key,value,valueType,signature});
const entry=(id='existing',extra={})=>({id,name:'Existing profile',color:'#315de4',values:{email:'old@example.com'},...extra});
const saveFields=(id,fields,extra={})=>({type:'mutate',action:'save-fields',id,fields,...extra});

test('save-fields creates one typed entry and all associations in one storage write', async () => {
  const send=worker();
  const fields=[field('email','new@example.com'),field('enabled','false','bool'),field('count','12.5','number'),field('date','2026-11-18','date'),field('meeting','2026-11-18T14:30','datetime'),field('config','{"enabled":true}','json'),field('xml','<root/>','xml')];
  const result=await send(saveFields('created',fields,{create:true,name:'Captured profile'}));
  assert.equal(result.error,undefined);
  assert.equal(send.writes(),1);
  assert.equal(result.data.entries.length,1);
  assert.equal(result.data.entries[0].id,'created');
  assert.equal(result.data.entries[0].name,'Captured profile');
  assert.deepEqual(result.data.entries[0].values,Object.fromEntries(fields.map(item=>[item.key,item.value])));
  assert.deepEqual(result.data.entries[0].types,Object.fromEntries(fields.map(item=>[item.key,item.valueType])));
  assert.deepEqual({...result.data.associations},Object.fromEntries(fields.map(item=>[item.signature,item.key])));
  assert.deepEqual(await send.read(),structuredClone(result.data));
});

test('save-fields merges captured values while preserving unrelated keys, metadata and entries', async () => {
  const original=entry('existing',{values:{count:'3',enabled:'true',phone:' +1 555 '},types:{count:'number',enabled:'bool'},transforms:{count:{type:'upper'},phone:{type:'digits'}},tags:['work'],collection:'QA',sites:['https://example.com'],pinned:true});
  const unrelated=entry('unrelated');
  const send=worker({entries:[original,unrelated],associations:{old:'phone',reused:'obsolete'},language:'ru'});
  const result=await send(saveFields('existing',[field('count','now text','string','reused'),field('date','2026-11-18','date')],{create:false}));
  assert.equal(result.error,undefined);
  const saved=result.data.entries[0];
  assert.deepEqual(saved.values,{count:'now text',enabled:'true',phone:' +1 555 ',date:'2026-11-18'});
  assert.deepEqual(saved.types,{count:'string',enabled:'bool',date:'date'});
  assert.deepEqual(saved.transforms,{phone:{type:'digits',format:''}});
  assert.deepEqual(saved.tags,['work']);assert.equal(saved.collection,'QA');assert.equal(saved.pinned,true);
  assert.deepEqual(saved.sites,['https://example.com']);assert.equal(saved.color,original.color);
  assert.deepEqual(result.data.entries[1],unrelated);
  assert.deepEqual({...result.data.associations},{old:'phone',reused:'count','field:date':'date'});
  assert.equal(result.data.language,'ru');assert.equal(send.writes(),1);
});

test('save-fields rejects invalid members atomically and the worker accepts the next valid request', async () => {
  const original=entry('existing',{values:{count:'3'},types:{count:'number'},transforms:{count:{type:'upper'}}});
  const send=worker({entries:[original],associations:{retained:'count'}}),before=await send.read();
  const invalidRows=[
    [field('valid','new'),field('count','not a number','number')],
    [field('valid','new'),field('date','2025-02-29','date')],
    [field('valid','new'),field('json','{','json')],
    [field('valid','new'),field('xml','<open>','xml')],
    [field('valid','new'),field('duplicate','one'),field('duplicate','two')],
    [field('valid','new'),field('   ','blank key')],
    [field('valid','new'),field('bad','value','script')],
    [field('valid','new'),field('long-signature','value','string','x'.repeat(5001))],
    [field('valid','new'),{key:'non-string',value:42,signature:'field:non-string'}],
    [],
    Array.from({length:201},(_,index)=>field('key'+index,'value'))
  ];
  for(const fields of invalidRows){
    const result=await send(saveFields('existing',fields,{create:false}));
    assert.ok(result.error,JSON.stringify(fields).slice(0,100));
    assert.deepEqual(await send.read(),before);
    assert.equal(send.writes(),0);
  }
  const result=await send(saveFields('existing',[field('count','4','number')],{create:false}));
  assert.equal(result.error,undefined);assert.equal(result.data.entries[0].values.count,'4');
  assert.equal(send.writes(),1);
});

test('save-fields creation failure never leaves an empty entry or partial associations', async () => {
  const send=worker(),before=await send.read();
  const result=await send(saveFields('new',[field('email','new@example.com'),field('enabled','yes','bool')],{create:true,name:'Failed capture'}));
  assert.ok(result.error);assert.deepEqual(await send.read(),before);assert.equal(send.writes(),0);
  const missing=await send(saveFields('missing',[field('email','new@example.com')],{create:false}));
  assert.ok(missing.error);assert.deepEqual(await send.read(),before);
});

test('save-fields enforces combined key and entry limits without partially applying changes', async () => {
  const values=Object.fromEntries(Array.from({length:200},(_,index)=>['key'+index,'value']));
  const send=worker({entries:[entry('full',{values})],associations:{old:'key0'}}),before=await send.read();
  const overflow=await send(saveFields('full',[field('key0','changed'),field('extra','new')],{create:false}));
  assert.ok(overflow.error);assert.deepEqual(await send.read(),before);assert.equal(send.writes(),0);
  const replacement=await send(saveFields('full',[field('key0','changed')],{create:false}));
  assert.equal(replacement.error,undefined);assert.equal(Object.keys(replacement.data.entries[0].values).length,200);
  const existingId=await send(saveFields('full',[field('name','new')],{create:true,name:'Duplicate'}));
  assert.ok(existingId.error);assert.equal(send.writes(),1);
  const limit=worker({entries:Array.from({length:500},(_,index)=>entry(String(index))),associations:{}}),atLimit=await limit.read();
  const result=await limit(saveFields('over-limit',[field('name','new')],{create:true,name:'Over limit'}));
  assert.ok(result.error);assert.deepEqual(await limit.read(),atLimit);assert.equal(limit.writes(),0);
});

test('save-fields preserves prototype-looking keys and signatures as ordinary data', async () => {
  const send=worker();
  const result=await send(saveFields('__proto__',[field('__proto__','true','bool','__proto__'),field('constructor','42','number','constructor'),field('toString','literal','string','toString')],{create:true,name:'Special keys'}));
  assert.equal(result.error,undefined);
  const saved=result.data.entries[0];
  for(const key of ['__proto__','constructor','toString']){
    assert.equal(Object.hasOwn(saved.values,key),true);
    assert.equal(Object.hasOwn(saved.types,key),true);
    assert.equal(Object.hasOwn(result.data.associations,key),true);
    assert.equal(result.data.associations[key],key);
  }
  assert.equal(saved.values.__proto__,'true');assert.equal(saved.types.__proto__,'bool');
  assert.equal(saved.values.constructor,'42');assert.equal(saved.types.constructor,'number');
  assert.equal({}.polluted,undefined);
  const next=await send(saveFields('__proto__',[field('__proto__','now string','string','__proto__')],{create:false}));
  assert.equal(next.error,undefined);assert.equal(next.data.entries[0].values.__proto__,'now string');
  assert.equal(next.data.entries[0].types.__proto__,'string');
});

test('single-field saves default prototype-looking keys to string without inherited types', async () => {
  const send=worker({entries:[entry()],associations:{}});
  for(const key of ['constructor','__proto__','toString']) {
    const result=await send({type:'mutate',action:'save-field',id:'existing',key,value:'plain text',signature:'field:'+key});
    assert.equal(result.error,undefined,key);
    assert.equal(result.data.entries[0].values[key],'plain text');
    assert.equal(result.data.entries[0].types[key],'string');
  }
});

test('global inline preference persists without changing explicit website overrides or unrelated data', async () => {
  const preferences={site:{width:520,suggestions:'button',preferredEntry:'existing',excluded:['field']}};
  const send=worker({entries:[entry()],associations:{field:'email'},preferences});
  assert.deepEqual((await send.read()).globalPreferences,{suggestions:'button',sidebarSide:'right'});
  const result=await send({type:'mutate',action:'global-preferences',preferences:{suggestions:'off'}});
  assert.equal(result.error,undefined);
  assert.deepEqual(result.data.globalPreferences,{suggestions:'off',sidebarSide:'right'});
  assert.deepEqual(result.data.preferences,preferences);
  assert.equal(result.data.entries[0].values.email,'old@example.com');
  assert.deepEqual(result.data.associations,{field:'email'});
  assert.equal(send.writes(),1);
  assert.deepEqual((await send.read()).globalPreferences,{suggestions:'off',sidebarSide:'right'});
  const inherited=await send({type:'mutate',action:'preferences',origin:'site',preferences:{...preferences.site,suggestions:'inherit'}});
  assert.equal(inherited.error,undefined);
  assert.equal(inherited.data.preferences.site.suggestions,'inherit');
  assert.equal(require('../extension/registry.js').effectiveSettings(inherited.data.preferences.site,inherited.data.globalPreferences).suggestions,'off');
});

test('global preference validation is atomic and older imports preserve the chosen default', async () => {
  const send=worker({entries:[],globalPreferences:{suggestions:'off'}}),before=await send.read();
  for(const preferences of [null,[],{suggestions:'inherit'},{suggestions:'auto'},{suggestions:false}]){
    const rejected=await send({type:'mutate',action:'global-preferences',preferences});
    assert.ok(rejected.error);assert.deepEqual(await send.read(),before);assert.equal(send.writes(),0);
  }
  const legacy=await send({type:'mutate',action:'import',strategy:'replace',bundle:{version:1,entries:[]}});
  assert.equal(legacy.error,undefined);assert.deepEqual(legacy.data.globalPreferences,{suggestions:'off'});
  const updated=await send({type:'mutate',action:'global-preferences',preferences:{suggestions:'button'}});
  assert.equal(updated.error,undefined);assert.deepEqual(updated.data.globalPreferences,{suggestions:'button',sidebarSide:'right'});
  assert.equal(send.writes(),2);
});

test('partial and concurrent global updates preserve sidebar side and inline preferences', async () => {
  const send=worker({entries:[],globalPreferences:{suggestions:'button'}});
  const updates=await Promise.all([
    send({type:'mutate',action:'global-preferences',preferences:{sidebarSide:'left'}}),
    send({type:'mutate',action:'global-preferences',preferences:{suggestions:'off'}})
  ]);
  assert.ok(updates.every(result=>result.error===undefined));
  assert.deepEqual((await send.read()).globalPreferences,{suggestions:'off',sidebarSide:'left'});
  const right=await send({type:'mutate',action:'global-preferences',preferences:{sidebarSide:'right'}});
  assert.equal(right.error,undefined);
  assert.deepEqual(right.data.globalPreferences,{suggestions:'off',sidebarSide:'right'});
  assert.equal(send.writes(),3);
});

test('invalid sidebar updates cannot partially reset saved global preferences', async () => {
  const globalPreferences={suggestions:'off',sidebarSide:'left'};
  const send=worker({entries:[],globalPreferences}),before=await send.read();
  for(const preferences of [undefined,null,[],false,'left',{sidebarSide:'top',suggestions:'button'},{sidebarSide:null},{sidebarSide:0},{sidebarSide:[]}]){
    const result=await send({type:'mutate',action:'global-preferences',preferences});
    assert.ok(result.error,JSON.stringify(preferences));
    assert.deepEqual(await send.read(),before);
  }
  assert.equal(send.writes(),0);
  const legacy=await send({type:'mutate',action:'import',strategy:'replace',bundle:{version:1,entries:[]}});
  assert.equal(legacy.error,undefined);
  assert.deepEqual(legacy.data.globalPreferences,globalPreferences);
});

test('sidebar width updates preserve site choices, global settings and unrelated registry data', async () => {
  const origin='https://example.com',site={width:380,suggestions:'inherit',preferredEntry:'existing',excluded:['field']};
  const send=worker({entries:[entry()],associations:{field:'email'},preferences:{[origin]:site,other:{width:520,suggestions:'off'}},globalPreferences:{suggestions:'off',sidebarSide:'left'}});
  const before=await send.read();
  for(const width of [320,467,640]){
    const result=await send({type:'mutate',action:'sidebar-width',origin,width});
    assert.equal(result.error,undefined);
    assert.deepEqual(result.data,{...before,preferences:{...before.preferences,[origin]:{...site,width}}});
  }
  const fileOrigin=await send({type:'mutate',action:'sidebar-width',origin:'null',width:420});
  assert.equal(fileOrigin.error,undefined);
  assert.deepEqual(fileOrigin.data.preferences.null,{width:420,suggestions:'inherit',preferredEntry:'',excluded:[]});
  assert.equal(send.writes(),4);
});

test('invalid sidebar widths and origins cannot alter stored preferences', async () => {
  const origin='https://example.com',send=worker({entries:[],preferences:{[origin]:{width:480,suggestions:'button',excluded:['keep']}}}),before=await send.read();
  const invalid=[
    ...[undefined,null,'400',319,641,350.5,NaN,Infinity,false,[],{}].map(width=>({origin,width})),
    ...[undefined,null,'','   ',42,[],{},'x'.repeat(2049)].map(origin=>({origin,width:400}))
  ];
  for(const request of invalid){
    const result=await send({type:'mutate',action:'sidebar-width',...request});
    assert.ok(result.error,JSON.stringify(request));
    assert.deepEqual(await send.read(),before);
  }
  assert.equal(send.writes(),0);
  const valid=await send({type:'mutate',action:'sidebar-width',origin,width:400});
  assert.equal(valid.error,undefined);assert.equal(valid.data.preferences[origin].width,400);
});

test('queued sidebar resizing preserves the latest website and global preferences', async () => {
  const origin='https://example.com',send=worker({entries:[],preferences:{},globalPreferences:{suggestions:'button',sidebarSide:'right'}});
  const choices={width:380,suggestions:'off',preferredEntry:'chosen',excluded:['latest']};
  const results=await Promise.all([
    send({type:'mutate',action:'preferences',origin,preferences:choices}),
    send({type:'mutate',action:'sidebar-width',origin,width:521}),
    send({type:'mutate',action:'global-preferences',preferences:{sidebarSide:'left'}}),
    send({type:'mutate',action:'sidebar-width',origin:'https://other.example',width:333})
  ]);
  assert.ok(results.every(result=>result.error===undefined));
  const data=await send.read();
  assert.deepEqual(data.preferences[origin],{...choices,width:521});
  assert.equal(data.preferences['https://other.example'].width,333);
  assert.deepEqual(data.globalPreferences,{suggestions:'button',sidebarSide:'left'});
});

test('sidebar resizing treats prototype-looking origins as ordinary stored keys', async () => {
  const send=worker();
  for(const origin of ['__proto__','constructor','toString']){
    const created=await send({type:'mutate',action:'sidebar-width',origin,width:400});
    assert.equal(created.error,undefined);
    assert.equal(Object.hasOwn(created.data.preferences,origin),true);
    assert.equal(created.data.preferences[origin].width,400);
    const updated=await send({type:'mutate',action:'sidebar-width',origin,width:460});
    assert.equal(updated.error,undefined);assert.equal(updated.data.preferences[origin].width,460);
  }
  assert.equal({}.width,undefined);
});

const noReceiver = () => new Error('Could not establish connection. Receiving end does not exist.');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no) => {resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function routingWorker({deliver=async()=>{},execute=async()=>[],manager=async()=>({ok:true}),activeTab}={}) {
  const calls={messages:[],managerMessages:[],scripts:[],badges:[],titles:[],colors:[],reloads:0,queries:0},handlers={};
  const listen={addListener(){}};
  const context=vm.createContext({
    importScripts(){},
    QuickfillCore:require('../extension/core.js'),
    QuickfillRegistry:require('../extension/registry.js'),
    fetch:async()=>({json:async()=>require('../extension/_locales/en/messages.json')}),
    chrome:{
      storage:{local:{get:async()=>({})}},
      runtime:{getURL:value=>'chrome-extension://quickfill/'+value,getManifest:()=>require('../extension/manifest.json'),onInstalled:listen,onStartup:listen,onMessage:listen,
        sendMessage:async message=>{calls.managerMessages.push(structuredClone(message));return manager(message);}},
      i18n:{getUILanguage:()=> 'en'},
      contextMenus:{onClicked:{addListener(fn){handlers.context=fn;}}},commands:{onCommand:{addListener(fn){handlers.command=fn;}}},
      action:{onClicked:{addListener(fn){handlers.action=fn;}},
        setBadgeText:async value=>{calls.badges.push(structuredClone(value));},
        setTitle:async value=>{calls.titles.push(structuredClone(value));},
        setBadgeBackgroundColor:async value=>{calls.colors.push(structuredClone(value));}
      },
      tabs:{
        query:async()=>{calls.queries++;return activeTab?[activeTab]:[];},
        sendMessage:async(tabId,message,options)=>{
          const call={tabId,message:structuredClone(message),options:structuredClone(options)};
          calls.messages.push(call);return deliver(call);
        },
        reload:async()=>{calls.reloads++;}
      },
      scripting:{executeScript:async options=>{calls.scripts.push(options);return execute(options);}}
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
  return {send:vm.runInContext('send',context),dispatch:vm.runInContext('dispatch',context),calls,handlers};
}

test('manager tab actions use extension messaging scoped to the selected tab', async () => {
  const tab={id:12,url:'chrome-extension://quickfill/options.html?view=settings#general'};
  const {handlers,calls}=routingWorker({activeTab:tab});
  await handlers.action(tab);
  await handlers.command('command-palette',tab);
  await handlers.command('toggle-sidebar');
  await handlers.context({menuItemId:'save',frameId:7},tab);
  assert.deepEqual(calls.managerMessages,[
    {type:'manager-command',tabId:12,command:'toggle'},
    {type:'manager-command',tabId:12,command:'palette'},
    {type:'manager-command',tabId:12,command:'toggle'},
    {type:'manager-command',tabId:12,command:'save'}
  ]);
  assert.equal(calls.messages.length,0);assert.equal(calls.scripts.length,0);
  assert.equal(calls.queries,1);
  assert.ok(calls.badges.every(item=>item.tabId===12&&item.text===''));
});

test('normal pages keep their content-script routing and requested frame', async () => {
  const {handlers,dispatch,calls}=routingWorker();
  await handlers.context({menuItemId:'fill',frameId:7},{id:3,url:'https://example.com/options.html'});
  await handlers.command('command-palette',{id:4,url:'https://example.com/'});
  await dispatch({id:5,url:'chrome-extension://other/options.html'},{type:'toggle'});
  await dispatch({id:6,url:'chrome-extension://quickfill/options.html/other'},{type:'toggle'});
  assert.deepEqual(calls.messages.map(item=>[item.tabId,item.message.type,item.options.frameId]),[[3,'fill',7],[4,'palette',0],[5,'toggle',0],[6,'toggle',0]]);
  assert.equal(calls.managerMessages.length,0);assert.equal(calls.queries,0);
});

test('missing or failed manager acknowledgements report failure without injection or replay', async () => {
  for(const manager of [async()=>undefined,async()=>({ok:false}),async()=>{throw noReceiver();}]) {
    const {dispatch,calls}=routingWorker({manager});
    assert.equal(await dispatch({id:12,url:'chrome-extension://quickfill/options.html'},{type:'palette'}),false);
    assert.equal(calls.managerMessages.length,1);assert.equal(calls.messages.length,0);assert.equal(calls.scripts.length,0);
    assert.deepEqual(calls.badges,[{tabId:12,text:'!'}]);
  }
});

test('sidebar actions delivered to an existing receiver do not inject scripts', async () => {
  const {send,calls}=routingWorker();
  assert.equal(await send(9,{type:'toggle'}),true);
  assert.deepEqual(calls.messages,[{tabId:9,message:{type:'toggle'},options:{frameId:0}}]);
  assert.equal(calls.scripts.length,0);
  assert.deepEqual(calls.badges,[{tabId:9,text:''}]);
  assert.equal(calls.reloads,0);
});

test('a missing receiver recovers only the requested frame and replays its action once', async () => {
  let ready=false;
  const {send,calls}=routingWorker({
    deliver:async()=>{if(!ready)throw noReceiver();},
    execute:async options=>{
      if(options.files){ready=true;return [];}
      return [{frameId:7,result:ready}];
    }
  });
  assert.equal(await send(9,{type:'save'},7),true);
  assert.deepEqual(calls.messages,[
    {tabId:9,message:{type:'save'},options:{frameId:7}},
    {tabId:9,message:{type:'save'},options:{frameId:7}}
  ]);
  assert.equal(calls.scripts.length,3);
  for(const script of calls.scripts){
    assert.deepEqual(structuredClone(script.target),{tabId:9,frameIds:[7]});
    assert.equal(script.world,'ISOLATED');
  }
  assert.deepEqual(structuredClone(calls.scripts[1].files),require('../extension/manifest.json').content_scripts[0].js);
  assert.deepEqual(calls.badges,[{tabId:9,text:''}]);
  assert.equal(calls.reloads,0);
});

test('an in-progress content bootstrap is awaited without injecting it again', async () => {
  const boot=deferred(),probed=deferred();let ready=false;
  const {send,calls}=routingWorker({
    deliver:async()=>{if(!ready)throw noReceiver();},
    execute:async()=>{probed.resolve();await boot.promise;return [{frameId:0,result:true}];}
  });
  const action=send(9,{type:'palette'});
  await probed.promise;
  assert.equal(calls.messages.length,1);
  ready=true;boot.resolve();
  assert.equal(await action,true);
  assert.equal(calls.messages.length,2);
  assert.equal(calls.scripts.length,1);
  assert.equal(calls.scripts.some(item=>item.files),false);
});

test('concurrent actions share frame recovery and each is delivered once after readiness', async () => {
  const injection=deferred(),started=deferred();let ready=false;
  const {send,calls}=routingWorker({
    deliver:async()=>{if(!ready)throw noReceiver();},
    execute:async options=>{
      if(options.files){started.resolve();await injection.promise;ready=true;return [];}
      return [{frameId:0,result:ready}];
    }
  });
  const first=send(9,{type:'toggle'});
  await started.promise;
  const second=send(9,{type:'palette'});
  await Promise.resolve();
  injection.resolve();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(calls.scripts.filter(item=>item.files).length,1);
  assert.deepEqual(calls.messages.map(item=>item.message.type),['toggle','palette','toggle','palette']);
  assert.equal(calls.reloads,0);
});

test('recoveries in different tabs and frames do not block or reuse each other', async () => {
  const ready=new Set();
  const {send,calls}=routingWorker({
    deliver:async({tabId,options})=>{if(!ready.has(tabId+':'+options.frameId))throw noReceiver();},
    execute:async options=>{
      const {tabId,frameIds:[frameId]}=options.target,key=tabId+':'+frameId;
      if(options.files){ready.add(key);return [];}
      return [{frameId,result:ready.has(key)}];
    }
  });
  assert.deepEqual(await Promise.all([send(9,{type:'fill'},0),send(9,{type:'save'},7),send(10,{type:'toggle'},0)]),[true,true,true]);
  assert.deepEqual(calls.scripts.filter(item=>item.files).map(item=>structuredClone(item.target)),[
    {tabId:9,frameIds:[0]},{tabId:9,frameIds:[7]},{tabId:10,frameIds:[0]}
  ]);
  assert.equal(calls.messages.length,6);
});

test('ambiguous delivery failures are surfaced without replaying an already-handled action', async () => {
  for(const message of ['The message port closed before a response was received.','Could not establish connection. The message port closed.','Unexpected handler failure']){
    const {send,calls}=routingWorker({deliver:async()=>{throw new Error(message);}});
    assert.equal(await send(9,{type:'toggle'}),false);
    assert.equal(calls.messages.length,1);
    assert.equal(calls.scripts.length,0);
    assert.deepEqual(calls.badges,[{tabId:9,text:'!'}]);
    assert.match(calls.titles[0].title,/could not open/i);
    assert.equal(calls.reloads,0);
  }
});

test('denied script access produces feedback and does not poison the next explicit attempt', async () => {
  let permitted=false,ready=false;
  const {send,calls}=routingWorker({
    deliver:async()=>{if(!ready)throw noReceiver();},
    execute:async options=>{
      if(!permitted)throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
      if(options.files){ready=true;return [];}
      return [{frameId:0,result:ready}];
    }
  });
  assert.equal(await send(9,{type:'toggle'}),false);
  assert.equal(calls.messages.length,1);
  assert.deepEqual(calls.badges,[{tabId:9,text:'!'}]);
  permitted=true;
  assert.equal(await send(9,{type:'toggle'}),true);
  assert.equal(calls.messages.length,3);
  assert.equal(calls.scripts.filter(item=>item.files).length,1);
  assert.deepEqual(calls.badges,[{tabId:9,text:'!'},{tabId:9,text:''}]);
  assert.equal(calls.reloads,0);
});

test('failed injection and failed startup do not deliver the action or retry indefinitely', async () => {
  for(const failure of ['injection','startup','retry']){
    const {send,calls}=routingWorker({
      deliver:async()=>{throw noReceiver();},
      execute:async options=>{
        if(options.files){if(failure==='injection')throw new Error('The frame was removed.');return [];}
        return [{frameId:0,result:failure==='retry'}];
      }
    });
    assert.equal(await send(9,{type:'toggle'}),false,failure);
    assert.equal(calls.messages.length,failure==='retry'?2:1,failure);
    assert.equal(calls.scripts.filter(item=>item.files).length,failure==='retry'?0:1,failure);
    assert.deepEqual(calls.badges,[{tabId:9,text:'!'}]);
    assert.equal(calls.reloads,0);
  }
});

test('readiness probe rejects unsupported pages and waits for initialization with a bounded timeout', async () => {
  const {send,calls}=routingWorker({deliver:async()=>{throw noReceiver();}});
  await send(9,{type:'toggle'});
  const probeSource='('+calls.scripts[0].func.toString()+')()';
  assert.equal(await vm.runInNewContext(probeSource,{location:{protocol:'https:'}}),false);
  await assert.rejects(vm.runInNewContext(probeSource,{location:{protocol:'chrome:'}}),/Unsupported page/);
  const boot=deferred();let expire,timeout,cleared=false;
  const probe=vm.runInNewContext(probeSource,{
    location:{protocol:'file:'},QuickfillReady:boot.promise,
    setTimeout(callback,delay){expire=callback;timeout=delay;return 17;},
    clearTimeout(id){assert.equal(id,17);cleared=true;}
  });
  assert.equal(timeout,5000);
  expire();
  await assert.rejects(probe,/Quickfill startup timed out/);
  assert.equal(cleared,true);
  assert.equal(await vm.runInNewContext(probeSource,{
    location:{protocol:'http:'},QuickfillReady:Promise.resolve(),setTimeout,clearTimeout
  }),true);
});
