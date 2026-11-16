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
test('prototype-looking keys remain plain data',()=>{
 const values=JSON.parse('{"__proto__":"saved","constructor":"value"}');
 const result=registry.merge(data,{version:1,entries:[{...a,values}]},'merge');
 assert.equal(result.entries[0].values.__proto__,'saved');
 assert.equal({}.saved,undefined);
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
