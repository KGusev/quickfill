const {test} = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../extension/registry.js');
const core = require('../extension/core.js');
const a={id:'a',name:'Work',color:'#315de4',values:{email:'old@example.com',phone:'123'}};
const data={entries:[a,{...a,id:'b'}],associations:{field:'email'},language:'ru'};
const imported={version:1,entries:[{...a,values:{email:'new@example.com'},sites:['https://example.com/']}],associations:{field:'phone'}};
test('import modes preserve unrelated entries and apply documented conflicts',()=>{
 const merged=registry.merge(data,imported,'merge');
 assert.deepEqual(merged.entries[0].values,{email:'new@example.com',phone:'123'});
 assert.equal(merged.associations.field,'phone');assert.equal(merged.language,'ru');
 assert.deepEqual(registry.merge(data,imported,'replace').entries[0].values,{email:'new@example.com'});
 assert.deepEqual(registry.merge(data,imported,'skip').entries[0],a);
 assert.equal(registry.merge(data,imported,'skip').associations.field,'email');
 assert.deepEqual(merged.entries[1],data.entries[1]);assert.equal(data.entries[0].values.email,'old@example.com');
});
test('rejects invalid imports atomically including duplicate IDs and oversized values',()=>{
 for(const input of [{...imported,version:2},{...imported,entries:[a,a]}, {...imported,entries:[{...a,values:{bad:{}}}]},{...imported,entries:[{...a,sites:['javascript:alert(1)']}]},{...imported,entries:[{...a,values:{big:'x'.repeat(100001)}}]}]) assert.throws(()=>registry.bundle(input));
 assert.throws(()=>registry.sites(['https://example.com/path']));
 assert.deepEqual(registry.sites(['https://example.com/','https://example.com']),['https://example.com']);
});
test('merge retains transformations for retained values and replaces imported value options',()=>{
 const current={entries:[{...a,values:{email:'old@example.com',phone:'123',name:'Alex'},transforms:{email:{type:'upper'},phone:{type:'digits'},name:{type:'lower'}}}],associations:{}};
 const incoming={version:1,entries:[{...a,values:{email:'new@example.com',name:'Sam'},transforms:{name:{type:'upper'}}}]};
 const merged=registry.merge(current,incoming,'merge').entries[0];
 assert.deepEqual(merged.values,{email:'new@example.com',phone:'123',name:'Sam'});
 assert.deepEqual(merged.transforms,{phone:{type:'digits',format:''},name:{type:'upper',format:''}});
 assert.equal(current.entries[0].transforms.email.type,'upper');
 assert.deepEqual(registry.bundle({version:1,entries:[merged]}).entries,[merged]);
});
test('merge enforces the per-entry key limit atomically after combining values',()=>{
 const values=Object.fromEntries(Array.from({length:200},(_,i)=>['key'+i,'saved']));
 const current={entries:[{...a,values}],associations:{}};
 const before=structuredClone(current);
 const incoming={version:1,entries:[{...a,values:{extra:'new'}}]};
 assert.throws(()=>registry.merge(current,incoming,'merge'),/invalidImport/);
 assert.deepEqual(current,before);
 assert.equal(Object.keys(registry.merge(current,{version:1,entries:[{...a,values:{key0:'updated'}}]},'merge').entries[0].values).length,200);
 assert.deepEqual(registry.merge(current,incoming,'replace').entries[0].values,{extra:'new'});
});
test('prototype-looking keys remain plain data',()=>{
 const values=JSON.parse('{"__proto__":"saved","constructor":"value"}');
 const result=registry.merge(data,{version:1,entries:[{...a,values}]},'merge');
 assert.equal(result.entries[0].values.__proto__,'saved');
 assert.equal({}.saved,undefined);
});
test('typed entries preserve legacy string values, validate types, and round-trip through backups',()=>{
 const original={...a,values:{active:'false',count:'12',created:'2024-02-29',config:'{"ok":true}',markup:'<root/>'},types:{active:'bool',count:'number',created:'date',config:'json',markup:'xml'}};
 const cleaned=registry.entry(original);
 assert.deepEqual(cleaned.types,original.types);
 assert.deepEqual(cleaned.values,original.values);
 assert.deepEqual(registry.bundle({version:1,entries:[cleaned]}).entries[0],cleaned);
 assert.deepEqual(registry.entry(a).types,{});
 for(const [value,type] of [['abc','number'],['2025-02-29','date'],['yes','bool'],['{','json'],['<open>','xml'],['anything','script']]) {
   assert.throws(()=>registry.entry({...a,values:{value},types:{value:type}}));
 }
 assert.throws(()=>registry.entry({...a,types:[]}));
});
test('merging imported values replaces their type and retains types on untouched keys',()=>{
 const existing={...a,values:{active:'true',count:'3',notes:'{}'},types:{active:'bool',count:'number',notes:'json'}};
 const incoming={...a,values:{count:'now text',notes:'<root/>',newDate:'2026-11-18'},types:{notes:'xml',newDate:'date'}};
 const merged=registry.merge({entries:[existing]},{version:1,entries:[incoming]},'merge').entries[0];
 assert.deepEqual(merged.types,{active:'bool',notes:'xml',newDate:'date'});
 assert.equal(merged.values.count,'now text');
 assert.equal(existing.types.count,'number');
 assert.deepEqual(registry.merge({entries:[existing]},{version:1,entries:[incoming]},'skip').entries[0],existing);
 assert.deepEqual(registry.merge({entries:[existing]},{version:1,entries:[incoming]},'replace').entries[0].types,incoming.types);
});
test('prototype-looking type keys are preserved as ordinary entry data',()=>{
 const item={...a,values:JSON.parse('{"__proto__":"true","constructor":"42"}'),types:JSON.parse('{"__proto__":"bool","constructor":"number"}')};
 const clean=registry.entry(item);
 assert.equal(clean.types.__proto__,'bool');assert.equal(clean.types.constructor,'number');
 assert.equal(Object.hasOwn(clean.types,'__proto__'),true);
 assert.equal(Object.getPrototypeOf(clean.types),Object.prototype);
 assert.deepEqual(registry.entry({...a,values:{constructor:'anything'}}).types,{});
});
test('Russian hints match English keys and give an explanation',()=>{
 const matches=core.suggestions([a],{type:'email',hints:['Электронная почта']});
 assert.equal(matches[0].key,'email');assert.equal(matches[0].hint,'Электронная почта');assert.equal(matches[0].reason,'hint');
 assert.equal(core.suggestions([a],{type:'email',hints:[],associatedKey:'email'})[0].reason,'association');
});
test('sites use exact origins and pinned entries sort first',()=>{
 const site={...a,id:'site',sites:['https://example.com']};
 assert.equal(core.relevant(site,'https://example.com.evil'),false);
 assert.equal(core.relevant(site,'https://example.com'),true);
 assert.equal(core.relevant(a,'https://other.example'),true);
 const pinned={...a,id:'pinned',pinned:true};
 assert.deepEqual(core.ordered([a,site,pinned],'https://example.com').map(e=>e.id),['pinned','site','a']);
});
test('select matching excludes disabled options and message substitutions are literal',()=>{
 const field={options:[{label:'Russia',value:'RU'},{label:'Blocked',value:'no',disabled:true}]};
 assert.equal(core.compatible(field,'russia'),true);assert.equal(core.compatible(field,'no'),false);
 const en=require('../extension/_locales/en/messages.json');
 assert.equal(core.formatMessage(en,'confirmDelete','<b>$1</b>'),'Delete “<b>$1</b>” and its saved values?');
});
test('global suggestions apply to inheriting sites while explicit website choices retain precedence',()=>{
 assert.deepEqual(registry.globalSettings(),{suggestions:'button',sidebarSide:'right'});
 assert.equal(registry.settings().suggestions,'inherit');
 assert.equal(registry.effectiveSettings().suggestions,'button');
 assert.equal(registry.effectiveSettings({}, {suggestions:'off'}).suggestions,'off');
 assert.equal(registry.effectiveSettings({suggestions:'inherit'}, {suggestions:'off'}).suggestions,'off');
 assert.equal(registry.effectiveSettings({suggestions:'button'}, {suggestions:'off'}).suggestions,'button');
 assert.equal(registry.effectiveSettings({suggestions:'off'}, {suggestions:'button'}).suggestions,'off');
 assert.equal(registry.effectiveSettings({suggestions:'auto'}, {suggestions:'off'}).suggestions,'button');
 const site={width:520,preferredEntry:'a',excluded:['field']};
 assert.deepEqual(registry.effectiveSettings(site,{suggestions:'off'}),{...site,suggestions:'off'});
 assert.deepEqual(site,{width:520,preferredEntry:'a',excluded:['field']});
 for(const value of [null,[],{suggestions:'inherit'},{suggestions:'auto'},{suggestions:true},{suggestions:'always'}])assert.throws(()=>registry.globalSettings(value),/invalidImport/);
 assert.throws(()=>registry.settings({suggestions:'always'}),/invalidImport/);
});
test('backups preserve global defaults and website inheritance without adding globals to old backups',()=>{
 const input={version:1,entries:[a],globalPreferences:{suggestions:'off'},preferences:{'https://example.com':{width:520,suggestions:'inherit'},'https://legacy.example':{suggestions:'auto'}}};
 const clean=registry.bundle(input);
 assert.deepEqual(clean.globalPreferences,{suggestions:'off',sidebarSide:'right'});
 assert.equal(clean.preferences['https://example.com'].suggestions,'inherit');
 assert.equal(clean.preferences['https://legacy.example'].suggestions,'button');
 assert.deepEqual(registry.bundle(JSON.parse(JSON.stringify(clean))),clean);
 assert.equal(Object.hasOwn(registry.bundle({version:1,entries:[]}),'globalPreferences'),false);
 const legacy=registry.bundle({version:1,entries:[],preferences:{'https://example.com':{width:480}}});
 assert.equal(legacy.preferences['https://example.com'].suggestions,'inherit');
 assert.throws(()=>registry.bundle({...input,globalPreferences:null}),/invalidImport/);
 assert.throws(()=>registry.bundle({...input,globalPreferences:{suggestions:'inherit'}}),/invalidImport/);
});
test('global preference imports obey duplicate strategy and omitted defaults never reset current settings',()=>{
 const current={entries:[],globalPreferences:{suggestions:'off'},preferences:{site:{suggestions:'inherit'}}};
 const before=structuredClone(current),incoming={version:1,entries:[],globalPreferences:{suggestions:'button'}};
 for(const strategy of ['merge','replace'])assert.deepEqual(registry.merge(current,incoming,strategy).globalPreferences,{suggestions:'button',sidebarSide:'right'});
 assert.deepEqual(registry.merge(current,incoming,'skip').globalPreferences,{suggestions:'off'});
 for(const strategy of ['merge','replace','skip']){
   assert.deepEqual(registry.merge(current,{version:1,entries:[]},strategy).globalPreferences,{suggestions:'off'});
   assert.deepEqual(registry.merge({entries:[]},incoming,strategy).globalPreferences,{suggestions:'button',sidebarSide:'right'});
 }
 assert.deepEqual(current,before);
 assert.equal(Object.hasOwn(registry.merge({entries:[]},{version:1,entries:[]},'merge'),'globalPreferences'),false);
});
test('sidebar side defaults for legacy settings and survives backup round trips and import strategies',()=>{
 assert.deepEqual(registry.globalSettings({suggestions:'off'}),{suggestions:'off',sidebarSide:'right'});
 for(const sidebarSide of ['left','right']){
   const globalPreferences={suggestions:'off',sidebarSide};
   assert.deepEqual(registry.globalSettings(globalPreferences),globalPreferences);
   const input={version:1,entries:[a],globalPreferences};
   assert.deepEqual(registry.bundle(JSON.parse(JSON.stringify(registry.bundle(input)))).globalPreferences,globalPreferences);
 }
 const current={entries:[],globalPreferences:{suggestions:'off',sidebarSide:'left'}};
 const incoming={version:1,entries:[],globalPreferences:{suggestions:'button',sidebarSide:'right'}};
 for(const strategy of ['merge','replace'])assert.deepEqual(registry.merge(current,incoming,strategy).globalPreferences,incoming.globalPreferences);
 assert.deepEqual(registry.merge(current,incoming,'skip').globalPreferences,current.globalPreferences);
 for(const strategy of ['merge','replace','skip'])assert.deepEqual(registry.merge(current,{version:1,entries:[]},strategy).globalPreferences,current.globalPreferences);
 for(const sidebarSide of [null,'top','LEFT','',false,0,[],{}]){
   assert.throws(()=>registry.globalSettings({sidebarSide}),/invalidImport/);
   assert.throws(()=>registry.bundle({...incoming,globalPreferences:{sidebarSide}}),/invalidImport/);
 }
});

test('templates validate structure and survive backup merges with associations',()=>{
 const template={id:'profile',name:'Profile',fields:[{key:'email',type:'string'}]};
 const linked={...a,templateId:'profile'};
 const backup={version:1,templates:[template],entries:[linked]};
 assert.deepEqual(registry.bundle(backup).templates,[template]);
 assert.equal(registry.merge({entries:[],associations:{}},backup,'merge').entries[0].templateId,'profile');
 assert.throws(()=>registry.template({...template,fields:[]}));
 assert.throws(()=>registry.template({...template,fields:[...template.fields,...template.fields]}));
 assert.throws(()=>registry.template({...template,fields:[{key:'email',type:'invalid'}]}));
 assert.throws(()=>registry.merge({entries:[],associations:{}},{...backup,templates:[]},'merge'));
 const renamed={...template,name:'Renamed'};
 assert.equal(registry.merge({entries:[],templates:[template]}, {...backup,templates:[renamed]},'skip').templates[0].name,'Profile');
 assert.equal(registry.merge({entries:[],templates:[template]}, {...backup,templates:[renamed]},'replace').templates[0].name,'Renamed');
});
