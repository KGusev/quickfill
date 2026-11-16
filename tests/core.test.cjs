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
