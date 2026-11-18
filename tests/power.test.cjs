const {test}=require('node:test');const assert=require('node:assert/strict');
const power=require('../extension/power.js');const registry=require('../extension/registry.js');
test('all supported transformations preserve source values',()=>{
 const raw=' +1 (555) 010-1234 ';
 assert.equal(power.resolve(raw,{}, {type:'trim'}),'+1 (555) 010-1234');
 assert.equal(power.resolve('Alex',{}, {type:'upper'}),'ALEX');
 assert.equal(power.resolve('Alex',{}, {type:'lower'}),'alex');
 assert.equal(power.resolve(raw,{}, {type:'digits'}),'15550101234');
 assert.equal(power.resolve(raw,{}, {type:'format',format:'+# (###) ###-####'}),'+1 (555) 010-1234');
 assert.equal(power.resolve('abc',{}, {type:'format',format:'prefix-{value}'}),'prefix-abc');
 assert.equal(raw,' +1 (555) 010-1234 ');
});
test('variables resolve consistently within a preview and reject unsupported expressions',()=>{
 const context=power.context(7,new Date('2026-11-16T10:00:00Z'),'test-uuid');
 assert.equal(power.resolve('test+{{counter}}@example.com / {{uuid}} / {{date}}',context),'test+7@example.com / test-uuid / 2026-11-16');
 assert.equal(power.resolve('{{timestamp}}',context),'1794823200000');
 assert.throws(()=>power.resolve('{{process.env}}',context),/unknownVariable/);
 assert.equal(power.dynamic('test+{{counter}}@example.com'),true);
 assert.equal(power.dynamic('literal {value}'),false);
});
test('backup validation preserves tags, collections, mappings, transforms and preferences',()=>{
 const data={version:1,entries:[{id:'1',name:'Profile',color:'#315de4',values:{phone:'123'},tags:['QA'],collection:'Work',transforms:{phone:{type:'format',format:'###'}}}],mappings:{site:[{signature:'field',key:'phone',locator:['#form','#phone'],transform:{type:'digits'}}]},preferences:{site:{width:480,suggestions:'auto',preferredEntry:'1',excluded:['field']}}};
 const clean=registry.bundle(data);
 assert.deepEqual(clean.entries[0].tags,['QA']);assert.equal(clean.entries[0].collection,'Work');
 assert.equal(clean.mappings.site[0].transform.type,'digits');assert.equal(clean.preferences.site.width,480);
 assert.throws(()=>registry.settings({width:2000}));assert.throws(()=>registry.transform({type:'eval'}));
 assert.throws(()=>registry.mappings({bad:[{signature:'x',key:'x',locator:[],transform:{type:'none'}}]}));
 assert.equal(registry.bundle({version:1,entries:[]}).entries.length,0);
});

test('legacy automatic suggestions use explicit activation for browser-autofill coexistence',()=>{
 assert.equal(registry.settings({suggestions:'auto'}).suggestions,'button');
 assert.equal(registry.settings({suggestions:'off'}).suggestions,'off');
 assert.equal(registry.settings({}).suggestions,'inherit');
 assert.equal(registry.effectiveSettings({}).suggestions,'button');
});
