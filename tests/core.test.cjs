const {test} = require('node:test');
const assert = require('node:assert/strict');
const {suggestions, compatible, canonical} = require('../extension/core.js');
const entries = [{id:'work', name:'Work', values:{email:'alex@example.com', first_name:'Alex', phone:'555', custom:'ACME-42', wrong:'not an email'}}];
test('matches camelCase, separators and autocomplete aliases', () => {
 assert.equal(canonical('firstName'), 'given name');
 assert.equal(suggestions(entries,{type:'text',hints:['given-name']})[0].value,'Alex');
 assert.equal(suggestions(entries,{type:'tel',hints:['telephone']})[0].key,'phone');
});
test('remembered association matches an opaque field', () => {
 assert.equal(suggestions(entries,{type:'text',hints:['opaque_42'],associatedKey:'custom'})[0].value,'ACME-42');
});
test('filters incompatible values even when associated', () => {
 assert.equal(suggestions(entries,{type:'email',hints:[],associatedKey:'wrong'}).length,0);
 assert.equal(compatible({type:'number'},''),false);
 assert.equal(compatible({type:'number'},'12.5'),true);
 assert.equal(compatible({type:'url'},'javascript:alert(1)'),false);
});
test('does not match unrelated keys or use inherited properties', () => {
 assert.deepEqual(suggestions(entries,{type:'text',hints:['username']}),[]);
 assert.deepEqual(suggestions(entries,{type:'text',hints:['toString']}),[]);
});
test('checkbox values are explicit booleans and radio choices respect disabled options', () => {
 assert.equal(compatible({type:'checkbox'},'true'),true);
 assert.equal(compatible({type:'checkbox'},'false'),true);
 assert.equal(compatible({type:'checkbox'},' true '),true);
 for (const value of ['on','yes','1','FALSE','']) assert.equal(compatible({type:'checkbox'},value),false);
 const radio={type:'radio',options:[{value:'basic',label:'Basic'},{value:'pro',label:'Professional'},{value:'disabled',label:'Unavailable',disabled:true}]};
 assert.equal(compatible(radio,'pro'),true);
 assert.equal(compatible(radio,'Professional'),true);
 assert.equal(compatible(radio,''),true);
 assert.equal(compatible(radio,'disabled'),false);
 assert.equal(compatible(radio,'missing'),false);
});

test('UUID fallback uses secure bytes when randomUUID is unavailable on HTTP', () => {
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');let calls=0;
 const context={crypto:{getRandomValues(bytes){calls++;bytes.fill(255);return bytes;}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/core.js'),'utf8'),context);
 const id=context.QuickfillCore.uuid();assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(calls,1);
 context.crypto.randomUUID=()=> 'native-uuid';assert.equal(context.QuickfillCore.uuid(),'native-uuid');assert.equal(calls,1);
});
